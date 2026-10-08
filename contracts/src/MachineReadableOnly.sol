// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {IRenderer} from "./render/IRenderer.sol";
import {TokenView} from "./render/TokenView.sol";

/// @notice The collection. An agent's own record of coming back.
/// @dev Permanent by design: no proxy and no upgrade path. Only the renderer is
/// swappable, so every drawing decision lives behind IRenderer and none of it
/// lives here. The daily write OVERWRITES one `Token` slot; nothing is ever
/// keyed by day.
contract MachineReadableOnly is ERC721, Ownable2Step, Pausable, EIP712, IERC4906 {
    /// @dev Exactly one storage slot: six uint32s (192 bits) plus a bool (8)
    /// plus 56 bits of run history = 256. Widening it would add a slot to every
    /// token.
    ///
    ///   fellRun  uint16  the run that MOST RECENTLY fell
    ///   bestRun  uint16  the longest run ever completed
    ///   fellDay  uint24  the day that run fell
    ///
    /// Two run fields, not one: the colour fades from the run that most
    /// recently fell, while the earned-Mark gate asks whether a run was EVER
    /// completed, which a recent small fall would wrongly answer no.
    struct Token {
        uint32 level;
        uint32 streak;
        uint32 lastDay;
        uint32 mintDay;
        uint32 generation;
        uint32 seedsGiven;
        bool resting;
        uint16 fellRun;
        uint16 bestRun;
        uint24 fellDay;
    }

    /// @dev One Mark tier. 240 of 256 bits, so still ONE storage slot:
    /// priceUsdc6 64, maxSupply 32, sold 32, minLevel 32, minStreak 32,
    /// requiresWhole 8, active 8, excludes 16, requiresAny 16.
    ///
    /// The masks are uint16 because the Mark ids run to MAX_MARK_ID and bit 0
    /// is deliberately never a Mark.
    struct Upgrade {
        uint64 priceUsdc6;
        uint32 maxSupply; // 0 = unlimited
        uint32 sold;
        uint32 minLevel;
        uint32 minStreak;
        bool requiresWhole;
        bool active;
        uint16 excludes;     // bit n set = holding mark n forbids this one
        uint16 requiresAny;  // 0 = no requirement; else at least one bit must be held
    }

    mapping(uint256 => Token) internal _tokens;
    mapping(uint256 => uint256) internal _marks;
    mapping(uint256 => uint256) internal _parentOf;
    mapping(uint256 => bytes32) internal _agentKeyOf;
    mapping(uint256 => bytes) internal _codeOf;

    /// @dev Days the line had run when this token was seeded. Its own mapping
    /// because `Token` is EXACTLY full at 256 bits. Written once, in `seed`.
    mapping(uint256 => uint32) internal _echo;
    /// @dev The day each token was rested. Its own mapping because `Token` is full.
    mapping(uint256 => uint32) internal _restDay;
    /// @dev One answer bit per credit, 365 in two words: credit `level` is bit `level - 1`.
    mapping(uint256 => uint256[2]) internal _answers;

    /// @dev One mint per key ever. Binding is unlimited, so `rebind` can move a
    /// token to a new key but can never resurrect a mint.
    mapping(bytes32 => bool) internal _hasMinted;
    mapping(bytes32 => uint32) internal _firstMintDay;
    mapping(bytes32 => uint32) internal _seedsSpent;

    /// @dev Tokens ever MINTED to an address, not tokens currently held.
    /// Counting holdings would let the cap be defeated by transferring out.
    mapping(address => uint32) public mintedTo;

    mapping(uint8 => Upgrade) internal _upgrades;

    /// @notice k[0] of the split's key chain, fixed once before the door opens.
    bytes32 public splitAnchor;
    /// @notice The last key revealed; the next must hash to it.
    bytes32 public lastSplitKey;

    address public renderer;
    address public warden;
    uint32 public supplyCap;
    uint32 public walletCap;
    uint32 public totalMinted;
    uint32 public sunsetDay;
    /// @notice The last day the Warden wrote anything at all. This is what
    /// `sunsetByAbsence` measures.
    uint32 public lastWardenDay;
    /// @notice The day the anchor was set: key n belongs to day splitAnchorDay + n - 1.
    uint32 public splitAnchorDay;
    /// @notice How many keys have been revealed.
    uint32 public splitKeysRevealed;
    /// @notice The block of the last reveal, so a verifier can walk back night by night.
    uint64 public lastRevealBlock;
    /// @notice The day this contract was deployed. Nothing may be dated before it.
    uint32 public immutable DEPLOY_DAY;
    /// @notice How many tokens have taken a finishing place. Token 1 never
    /// does. The next finisher's place is this plus one.
    uint32 public finishers;
    bool public isSunset;
    bool public vouchersEnabled;

    /// @dev The packed code bitmap is a fixed 407 bytes: 57 x 57 modules, QR
    /// version 10. The length is checked here, in `mint` and in `seed`, and a
    /// token's code is written once and is immutable -- so changing it needs a
    /// new deployment of this contract.
    uint256 internal constant CODE_BYTES = 407;

    /// @dev Fifteen Marks. Bit 0 is never a Mark. Ids 1-10 are the five pairs,
    /// bought or earned, applied through `applyMark`; ids 11-15 are the
    /// FINISHER Marks, which only `_finish` ever gives and `applyMark` refuses
    /// outright.
    ///
    /// Fifteen is the ceiling: `excludes` and `requiresAny` are uint16 so bit
    /// 15 is the last addressable Mark bit, and bit 16 is already the Iris
    /// shape.
    uint8 internal constant MAX_MARK_ID = 15;

    /// @dev The first of the five finisher Marks. Ids at or above this are
    /// given by finishing a year and can never be asked for.
    uint8 internal constant FIRST_FINISHER_MARK = 11;

    /// @dev The project's own agent. It never takes a finishing place.
    uint256 internal constant HOUSE_TOKEN = 1;
    /// @dev The uncapped finisher Mark, which the house token is given.
    uint8 internal constant AORTA = 11;

    /// @dev ERC-4906's interface id. OpenZeppelin ships the interface, not a mixin.
    bytes4 internal constant ERC4906_ID = 0x49064906;

    error NotWarden();
    error ZeroRenderer();
    error RendererNotContract();
    error ZeroWarden();
    error RenounceDisabled();
    /// @dev The piece is closed. Distinct from AlreadySunset, the double-call
    /// guard.
    error Sunset();
    error AlreadySunset();
    /// The split anchor is set once and never moves.
    error SplitAnchorAlreadySet();
    /// A zero anchor would leave the chain unset.
    error ZeroSplitAnchor();
    /// No key can be revealed before the anchor exists.
    error NoSplitAnchor();
    /// Key `index` does not hash to the key before it.
    error BadSplitKey(uint32 index);
    /// Key `index` belongs to a day that is not over yet.
    error SplitKeyTooEarly(uint32 index);

    event RendererSet(address renderer);
    event WardenSet(address warden);
    event SupplyCapSet(uint32 cap);
    event WalletCapSet(uint32 cap);
    event SunsetAt(uint32 day);
    event SplitAnchorSet(bytes32 anchor, uint32 day);
    /// @notice Keys `firstIndex` onward; `prevRevealBlock` is the reveal before this one.
    event SplitKeysRevealed(uint32 firstIndex, bytes32[] keys, uint64 prevRevealBlock, bytes questions);

    /// @dev Also the heartbeat. Stamping `lastWardenDay` HERE rather than in
    /// each Warden function means a new one cannot be added without it.
    ///
    /// `checkInWithVoucher` deliberately does NOT stamp it: a voucher proves a
    /// signature EXISTED, not that the operator is still there, so a hoarded
    /// one could hold the piece open against the absence this measures.
    modifier onlyWarden() {
        if (msg.sender != warden) revert NotWarden();
        uint32 d = today();
        if (lastWardenDay != d) lastWardenDay = d;
        _;
    }

    modifier notSunset() {
        if (isSunset) revert Sunset();
        _;
    }

    /// @notice Say, on chain, that the operator is still here. Writes nothing
    /// else.
    /// @dev Every other `onlyWarden` function needs real work to do, so without
    /// this `lastWardenDay` would stop advancing when AGENTS go quiet rather
    /// than only when the operator does. A one-token `batchCheckIn` would
    /// restamp the clock just as cheaply and is refused on MEANING: it would
    /// write a visit the agent never made.
    ///
    /// Deliberately NOT `whenNotPaused`: a pause outlasting `ABSENCE_DAYS`
    /// would otherwise force the ending with no way to speak against it. It
    /// does not reopen a closed piece -- `isSunset` is one-way -- and is
    /// refused once the piece has closed.
    function heartbeat() external onlyWarden notSunset {}

    constructor(address renderer_, address warden_)
        ERC721("Machine Readable Only", "MRO")
        Ownable(msg.sender)
        EIP712("MachineReadableOnly", "1")
    {
        _setRenderer(renderer_);
        _setWarden(warden_);
        supplyCap = 10_000;
        walletCap = 20;
        DEPLOY_DAY = today();
        // Deployment counts as a write. Left at zero, the gap from day zero
        // already exceeds ABSENCE_DAYS and anyone could close the piece at once.
        lastWardenDay = today();
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice The UTC day index, the unit every date in this piece uses.
    function today() public view virtual returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// @notice Everything the renderer needs, assembled from storage.
    function viewOf(uint256 id) public view returns (TokenView memory v) {
        Token storage s = _tokens[id];
        v.tokenId = id;
        v.level = s.level;
        v.streak = s.streak;
        v.lastDay = s.lastDay;
        v.mintDay = s.mintDay;
        v.generation = s.generation;
        v.seedsGiven = s.seedsGiven;
        v.parent = _parentOf[id];
        v.echo = _echo[id];
        v.resting = s.resting;
        v.restDay = _restDay[id];
        v.sunset = isSunset;
        v.sunsetDay = sunsetDay;
        v.fellRun = s.fellRun;
        v.fellDay = s.fellDay;
        v.marks = _marks[id];
        v.answers = _answers[id];
        v.agentKeyId = _agentKeyOf[id];
        v.code = _codeOf[id];
        v.today = today();
    }

    /// @notice The token's answer bits: credit `level` is bit `level - 1`.
    function answersOf(uint256 id) external view returns (uint256[2] memory) {
        return _answers[id];
    }

    /// @dev Set the bit for credit `level`. A 0 writes nothing.
    function _setAnswer(uint256 id, uint32 level) private {
        uint256 i = uint256(level) - 1;
        _answers[id][i >> 8] |= uint256(1) << (i & 255);
    }

    /// @notice The sealed inherited tenure: days the line had run when this
    /// token was seeded. 0 for a founding token.
    function echoOf(uint256 id) public view returns (uint32) {
        return _echo[id];
    }

    /// @notice The longest run this token has ever completed: what the earned Marks gate on.
    function bestRunOf(uint256 id) external view returns (uint32) {
        return _effectiveRun(_tokens[id]);
    }

    /// @notice ERC-7572 collection metadata, drawn by the renderer.
    function contractURI() external view returns (string memory) {
        return IRenderer(renderer).contractURI();
    }

    /// @inheritdoc ERC721
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return IRenderer(renderer).tokenURI(viewOf(id));
    }

    /// @inheritdoc ERC721
    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == ERC4906_ID || super.supportsInterface(id);
    }

    // ---------------------------------------------------------------------
    // Dials
    // ---------------------------------------------------------------------

    /// @notice True once the renderer can never be swapped again.
    bool public rendererFrozen;

    error RendererIsFrozen();
    event RendererFrozen(address renderer);
    /// @notice ERC-7572: the collection metadata changed with the renderer.
    event ContractURIUpdated();

    function setRenderer(address r) external onlyOwner {
        if (rendererFrozen) revert RendererIsFrozen();
        _setRenderer(r);
    }

    /// @notice Make the current renderer permanent. Irreversible.
    function freezeRenderer() external onlyOwner {
        if (rendererFrozen) revert RendererIsFrozen();
        rendererFrozen = true;
        emit RendererFrozen(renderer);
    }
    function setWarden(address w) external onlyOwner { _setWarden(w); }

    /// @dev THE BAND IS SIXTEEN DIGITS WIDE, so this dial stops at 65,535.
    /// `DigitBand` writes a finisher's place round the border as sixteen binary
    /// digits (`DigitBand.BITS`) and a token's picture is permanent, so a place
    /// that wrapped could never be redrawn. The band cannot gain a digit
    /// without a new deployment, so the cap is what refuses.
    function setSupplyCap(uint32 cap) external onlyOwner {
        if (cap > 65_535) revert SupplyCapTooLarge(cap);
        supplyCap = cap;
        emit SupplyCapSet(cap);
    }

    function setWalletCap(uint32 cap) external onlyOwner {
        walletCap = cap;
        emit WalletCapSet(cap);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Disabled. Ownership can be transferred but never abandoned.
    /// @dev Renouncing WHILE PAUSED would freeze the piece forever: no mint, no
    /// check-in, no seed, no unpause and no upgrade path. `sunset()` is the
    /// designed operator ending and leaves transfers, `rebind` and every
    /// token's art intact.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Close the piece. Irreversible.
    /// @dev Emits no metadata event: the collection-wide range is the one event
    /// indexers treat as hostile, and the piece must never depend on an indexer
    /// refreshing anyway.
    function sunset() external onlyOwner {
        if (isSunset) revert AlreadySunset();
        isSunset = true;
        sunsetDay = today();
        emit SunsetAt(sunsetDay);
    }

    /// @notice How long the piece must be silent before anyone may close it.
    uint32 public constant ABSENCE_DAYS = 365;

    error NotAbsent(uint32 daysSinceLastWrite);

    /// @notice Close the piece after a year in which the Warden wrote nothing.
    /// Anyone may call it. Irreversible. It grants no new power: only what the
    /// owner could already have done with `sunset()`.
    ///
    /// @dev `sunsetDay` IS `lastWardenDay` HERE, and that is load-bearing. The
    /// renderer freezes a sunset token at `lapsedIndex(streak, lastDay,
    /// sunsetDay)`, so using `today()` would give every token a gap of 365 and
    /// freeze the whole collection at the start colour. Owner-called `sunset()`
    /// keeps `today()`, because there the operator chooses the moment.
    function sunsetByAbsence() external {
        if (isSunset) revert AlreadySunset();
        uint32 gap = today() - lastWardenDay;
        if (gap < ABSENCE_DAYS) revert NotAbsent(gap);
        isSunset = true;
        sunsetDay = lastWardenDay;
        emit SunsetAt(sunsetDay);
    }

    /// @notice Fix the split's key chain. Once, by the owner, before the door opens.
    function setSplitAnchor(bytes32 anchor) external onlyOwner {
        if (splitAnchor != bytes32(0)) revert SplitAnchorAlreadySet();
        if (anchor == bytes32(0)) revert ZeroSplitAnchor();
        uint32 d = today();
        splitAnchor = anchor;
        lastSplitKey = anchor;
        splitAnchorDay = d;
        emit SplitAnchorSet(anchor, d);
    }

    /// @notice Reveal the next keys of the split chain, each for a day that is over.
    /// @param questions Each revealed day's question and answer set, as JSON; not read here.
    /// @dev Not `notSunset`: a mint written on the last night still needs its key.
    function revealSplitKeys(bytes32[] calldata keys, bytes calldata questions) external onlyWarden {
        bytes32 last = lastSplitKey;
        if (last == bytes32(0)) revert NoSplitAnchor();
        uint32 n = splitKeysRevealed;
        uint32 first = n + 1;
        uint32 tday = today();
        for (uint256 i; i < keys.length; ++i) {
            ++n;
            if (splitAnchorDay + n - 1 >= tday) revert SplitKeyTooEarly(n);
            if (keccak256(abi.encodePacked(keys[i])) != last) revert BadSplitKey(n);
            last = keys[i];
        }
        lastSplitKey = last;
        splitKeysRevealed = n;
        emit SplitKeysRevealed(first, keys, lastRevealBlock, questions);
        lastRevealBlock = uint64(block.number);
    }

    function _setRenderer(address r) internal {
        if (r == address(0)) revert ZeroRenderer();
        // Non-zero is not the same as usable: tokenURI STATICCALLs this address
        // for every token, so an EOA here returns empty data and bricks the
        // metadata of the whole collection at once.
        if (r.code.length == 0) revert RendererNotContract();
        renderer = r;
        emit RendererSet(r);
        emit ContractURIUpdated();
    }

    function _setWarden(address w) internal {
        if (w == address(0)) revert ZeroWarden();
        warden = w;
        emit WardenSet(w);
    }

    error AlreadyMinted();
    error IdTooLarge(uint256 id);
    error ZeroKeyId();
    error TokenExists(uint256 id);
    error SupplyCap();
    error SupplyCapTooLarge(uint32 cap);
    error WalletCap();
    error BadCodeLength(uint256 got);

    event Minted(uint256 indexed id, bytes32 indexed keyId);

    // ---------------------------------------------------------------------
    // Warden functions
    // ---------------------------------------------------------------------

    /// @notice Mint one token for one agent key.
    /// @dev The id is chosen by the Warden rather than a counter, so a mint can
    /// be reserved before it settles. `_hasMinted` is per key and permanent: a
    /// later `rebind` moves a token to a new key but never frees the old one.
    /// @param day The day the agent PAID, as the Warden recorded it, not
    /// `today()`: the Clock writes a mint the day after payment, and a token
    /// dated the write day would lose the check-in that landed on its first
    /// day. Bounded both ways by `_checkCreationDay`.
    /// @param firstAnswer The first day's answer bit: the Clock's coin flip, since the mint day cannot be answered.
    function mint(uint256 id, address to, bytes32 keyId, bytes calldata code, uint32 day, bool firstAnswer)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        // batchCheckIn addresses ids in 4 packed bytes, so an id that does not
        // fit 32 bits would mint and render but could never be checked in.
        if (id > type(uint32).max) revert IdTooLarge(id);
        // A zero key id would burn the zero key permanently AND create a shared
        // seed budget any token owner could rebind into for free.
        if (keyId == bytes32(0)) revert ZeroKeyId();
        if (_hasMinted[keyId]) revert AlreadyMinted();
        if (_ownerOf(id) != address(0)) revert TokenExists(id);
        if (totalMinted >= supplyCap) revert SupplyCap();
        if (mintedTo[to] >= walletCap) revert WalletCap();
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);
        _checkCreationDay(day);

        uint32 d = day;
        // Named rather than positional: three of the ten fields are adjacent
        // small ints, and a positional list is how one silently lands in the
        // wrong one. `bestRun` is 1 because the run IS 1 from the first day.
        _tokens[id] = Token({
            level: 1, streak: 1, lastDay: d, mintDay: d, generation: 0,
            seedsGiven: 0, resting: false, fellRun: 0, bestRun: 1, fellDay: 0
        });
        _agentKeyOf[id] = keyId;
        _codeOf[id] = code;
        _hasMinted[keyId] = true;
        _firstMintDay[keyId] = d;
        if (firstAnswer) _setAnswer(id, 1);
        unchecked {
            totalMinted += 1;
            mintedTo[to] += 1;
        }

        _mint(to, id);
        emit Minted(id, keyId);
    }

    error DayNotAdvanced(uint256 id);
    error FutureDay(uint32 day);
    /// A credit to a token whose year is already complete. A finished token's
    /// record is final: the same freeze `rest` gives, reached by completion.
    error AlreadyFinished(uint256 id);

    /// @dev The day a token's year is complete. Equal to FrameGeometry.DAY_CELLS
    /// in the renderer; a test pins the two together.
    uint32 internal constant FINISH_LEVEL = 365;
    /// A day more than MAX_LAG days behind today().
    error StaleDay(uint32 day);
    /// A creation day before this contract existed.
    error BeforeDeploy(uint32 day);

    /// How late a mint, seed or check-in may be dated. Without it the Warden
    /// could backdate days and write a year of history in one night.
    uint32 internal constant MAX_LAG = 30;

    /// @dev The bound on a creation day, shared by `mint` and `seed`.
    function _checkCreationDay(uint32 day) internal view {
        uint32 tday = today();
        if (day > tday) revert FutureDay(day);
        if (day + MAX_LAG < tday) revert StaleDay(day);
        if (day < DEPLOY_DAY) revert BeforeDeploy(day);
    }
    error LengthMismatch();
    error Resting(uint256 id);
    error NoSuchToken(uint256 id);
    error EmptyBatch();

    event BatchCheckedIn(uint32 fromDay, uint32 toDay, uint256 count);

    /// @dev The bookkeeping both check-in paths share: level, run, run history
    /// and the day. One function rather than two sets of lines that would have
    /// to stay identical.
    function _credit(uint256 id, Token storage s, uint32 day) private {
        // THE YEAR ENDS. Refused here, in the one function both check-in paths
        // share, so the voucher path cannot become a way round it.
        if (s.level >= FINISH_LEVEL) revert AlreadyFinished(id);
        uint32 run;
        unchecked {
            s.level += 1;
            if (day == s.lastDay + 1) {
                run = s.streak + 1;
            } else {
                // The run ends here. Record WHAT fell and WHEN before the
                // reset, so the renderer can pale from the run that was lost
                // instead of snapping to the day-one colour.
                s.fellRun = _toU16(s.streak);
                // Bounded by `today()`, which both callers check `day` against,
                // so this cannot truncate.
                s.fellDay = uint24(s.lastDay);
                run = 1;
            }
            s.streak = run;
        }
        // The longest run ever completed, which is what the earned-Mark gate
        // asks about. Written on the way UP only, so a later fall never lowers
        // it -- a run that was completed stays completed.
        if (run > s.bestRun) s.bestRun = _toU16(run);
        s.lastDay = day;
        if (s.level == FINISH_LEVEL) _finish(id);
    }

    /// @notice Which Mark a finishing place earns.
    /// @dev CONSTANTS, deliberately not dials: a table the owner could edit
    /// after finishers exist is a promise that can be broken. The Upgrade
    /// records for 11-15 repeat the caps for readers, and a test pins them.
    ///   1st          15 apex
    ///   2nd-4th      14 atrium
    ///   5th-14th     13 valve
    ///   15th-64th    12 chamber
    ///   65th on      11 aorta, never refused
    function finisherMark(uint32 ordinal) public pure returns (uint8) {
        if (ordinal <= 1) return 15;
        if (ordinal <= 4) return 14;
        if (ordinal <= 14) return 13;
        if (ordinal <= 64) return 12;
        return 11;
    }

    /// @dev Called once in a token's life, by the credit that makes it whole.
    /// Token 1 is given Aorta and no place. For every other token the place is
    /// the ORDER finishes are credited in: across days by day, and within one
    /// batch by the order the Warden listed them, which it sorts by token id. The ordinal lands in bits 64-95 of the marks word, the slot
    /// TokenView reserves for it; bits 32-63 are the earned Iris's run and are
    /// never touched here.
    function _finish(uint256 id) private {
        // The house token leaves `finishers` alone, so the next token home
        // still takes the first place.
        if (id == HOUSE_TOKEN) {
            _marks[id] |= uint256(1) << AORTA;
            unchecked { _upgrades[AORTA].sold += 1; }
            emit Finished(id, 0, AORTA);
            return;
        }
        uint32 ordinal;
        unchecked { ordinal = ++finishers; }
        uint8 markId = finisherMark(ordinal);
        _marks[id] |= (uint256(1) << markId) | (uint256(ordinal) << 64);
        unchecked { _upgrades[markId].sold += 1; }
        emit Finished(id, ordinal, markId);
    }

    /// @dev Saturates rather than truncating: a silent wrap in a value a Mark
    /// gate reads is not an acceptable failure mode.
    function _toU16(uint32 v) private pure returns (uint16) {
        return v > type(uint16).max ? type(uint16).max : uint16(v);
    }

    /// @notice The longest run this token has ever completed.
    /// @dev `bestRun` is only written on the way up, so the live `streak` can
    /// exceed it by exactly one credit -- the one not yet folded in. Taking the
    /// larger means the gate never lags the token by a day.
    function _effectiveRun(Token storage s) private view returns (uint32) {
        uint32 best = s.bestRun;
        return s.streak > best ? s.streak : best;
    }

    /// @notice Credit a day to each of many tokens, in one transaction.
    /// @dev Ids arrive packed as 4-byte big-endian values rather than a
    /// uint32[] because calldata is the dominant cost at this batch size.
    ///
    /// Emits one `MetadataUpdate` per token written, AFTER the writes, and
    /// never a range: a day's check-ins are a scattered subset of ids, so
    /// `minId..maxId` would claim untouched tokens had changed.
    /// @param answerBits One bit per entry, high bit first.
    /// @param record One byte per entry, the answer index or 0xff, never read here: it is the
    /// public record the verifier reads.
    function batchCheckIn(bytes calldata packedIds, uint32[] calldata days_, bytes calldata answerBits, bytes calldata record)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        uint256 n = days_.length;
        if (packedIds.length != n * 4) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();
        if (answerBits.length != (n + 7) / 8 || record.length != n) revert LengthMismatch();

        // Read once, not once per token: this is the gas-critical loop.
        uint32 tday = today();

        uint32 lo = type(uint32).max;
        uint32 hi = 0;

        for (uint256 i = 0; i < n; i++) {
            uint256 id = uint256(uint32(bytes4(packedIds[i * 4:i * 4 + 4])));
            uint32 day = days_[i];

            Token storage s = _tokens[id];
            // level is 1 from the moment a token exists, so a zero here means
            // this id was never minted. Read off the struct already loaded
            // rather than via _ownerOf, which would cost a cold SLOAD per entry.
            if (s.level == 0) revert NoSuchToken(id);
            if (s.resting) revert Resting(id);
            // A day index is bounded above as well as below: a TIMESTAMP passed
            // where a day index belongs would set lastDay far past any real day
            // and revert every later check-in forever, with no admin reset.
            if (day > tday) revert FutureDay(day);
            if (day + MAX_LAG < tday) revert StaleDay(day);
            if (day <= s.lastDay) revert DayNotAdvanced(id);

            _credit(id, s, day);
            if ((uint8(answerBits[i >> 3]) >> (7 - (i & 7))) & 1 == 1) _setAnswer(id, s.level);

            if (day < lo) lo = day;
            if (day > hi) hi = day;
        }

        emit BatchCheckedIn(lo, hi, n);

        // After every storage write, never before: an indexer that re-reads on
        // the event must not be able to read pre-write state.
        for (uint256 i = 0; i < n; i++) {
            emit MetadataUpdate(uint256(uint32(bytes4(packedIds[i * 4:i * 4 + 4]))));
        }
    }

    // ---------------------------------------------------------------------
    // Voucher check-ins: the durability path, shipped disabled
    // ---------------------------------------------------------------------

    error VouchersDisabled();
    error BadVoucher();

    event VouchersEnabledSet(bool enabled);

    /// @dev The typed-data hash the Warden signs for one token on one day.
    bytes32 internal constant VOUCHER_TYPEHASH = keccak256("CheckIn(uint256 id,uint32 day)");

    function setVouchersEnabled(bool enabled) external onlyOwner {
        vouchersEnabled = enabled;
        emit VouchersEnabledSet(enabled);
    }

    /// @notice The digest a Warden signature must cover.
    /// @dev Exposed so the reference client can build a voucher without
    /// reimplementing the domain separator.
    function voucherHash(uint256 id, uint32 day) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, id, day)));
    }

    /// @notice The durability path: anyone may submit a Warden-signed check-in
    /// and pay its own gas.
    /// @dev Ships with `vouchersEnabled` false. It exists from day one because
    /// the contract has no upgrade path, so a path left out now could never be
    /// added and the piece would die with the Warden.
    ///
    /// `level == 0` means the id was never minted; without that guard a voucher
    /// for one would pass the `day > lastDay` rule against a zero struct and
    /// silently create state for a token nobody owns. The signer is read fresh
    /// from `warden` on every call rather than captured at signing time, so
    /// rotating the Warden invalidates every voucher the old key signed.
    function checkInWithVoucher(uint256 id, uint32 day, bytes calldata wardenSig)
        external
        whenNotPaused
        notSunset
    {
        if (!vouchersEnabled) revert VouchersDisabled();

        Token storage s = _tokens[id];
        if (s.level == 0) revert NoSuchToken(id);
        if (s.resting) revert Resting(id);

        // ASK, DO NOT RECOVER. A Warden that outlives its operator is most
        // likely a Safe or a 4337 account, and a contract has no key: no
        // signature it authorises could ever recover to its own address.
        // SignatureChecker keeps the ECDSA path byte-for-byte for an EOA
        // (`signer.code.length == 0`) and asks the contract through ERC-1271
        // otherwise, so a misconfigured rotation is a closed door.
        if (!SignatureChecker.isValidSignatureNowCalldata(warden, voucherHash(id, day), wardenSig)) {
            revert BadVoucher();
        }

        // Bounded above for the same reason as batchCheckIn: a signed voucher
        // for a nonsense future day would brick the token permanently.
        uint32 tday = today();
        if (day > tday) revert FutureDay(day);
        if (day + MAX_LAG < tday) revert StaleDay(day);
        if (day <= s.lastDay) revert DayNotAdvanced(id);

        _credit(id, s, day);

        emit MetadataUpdate(id);
    }

    // ---------------------------------------------------------------------
    // Marks
    // ---------------------------------------------------------------------

    error MarkInactive();
    error MarkAlreadyApplied();
    error MarkSoldOut();
    error MarkGate();
    /// @dev Carries the id that blocked it, so an agent is told WHAT closed the
    /// door rather than that a door is closed.
    error MarkExcluded(uint8 by);
    error MarkRequires();
    /// @dev `applyMark` computes `1 << upgradeId`, and `_marks` packs the Iris
    /// shape at bit 16 and the Tint ink at bit 24, so an id of 16 would alias
    /// the shape bits exactly. Refused where the record is written, so the bad
    /// record cannot exist.
    error MarkIdOutOfRange(uint8 upgradeId);
    /// A Mark whose own bit is in its own excludes or requiresAny mask can
    /// never be applied. See setUpgrade.
    error MarkExcludesItself(uint8 upgradeId);
    error MarkRequiresItself(uint8 upgradeId);
    error BadVariant(uint8 got);
    /// Ids 11-15 are given by finishing and can never be asked for.
    error MarkNotRequestable(uint8 upgradeId);
    /// A finisher Mark's record (11-15) is written once and never edited.
    error FinisherRecordSet(uint8 upgradeId);

    /// @dev The variant is part of what was bought, so it belongs in the event.
    /// Not indexed: nobody filters by shape.
    event MarkApplied(uint256 indexed id, uint8 indexed upgradeId, uint8 variant);
    /// @dev The one record of a place. Not MarkApplied: nobody applied this,
    /// the year's end did.
    event Finished(uint256 indexed id, uint32 ordinal, uint8 indexed markId);
    event UpgradeSet(uint8 indexed upgradeId);

    /// @dev How many variants a Mark accepts. In the contract rather than a
    /// field on `Upgrade`, because a dial turned up past what the renderer can
    /// draw would brick a token's image: the renderer and this bound move
    /// together or not at all.
    ///
    ///   Mark 5, the bought Iris: three shapes -- target, squircle, leaf.
    ///   Mark 9, Tint: two inks -- violet, gold.
    ///
    /// Every other Mark accepts only variant 0.
    function _variantCount(uint8 upgradeId) private pure returns (uint8) {
        if (upgradeId == 5) return 3;
        if (upgradeId == 9) return 2;
        return 1;
    }

    function marksOf(uint256 id) external view returns (uint256) {
        return _marks[id];
    }

    function upgradeOf(uint8 upgradeId) external view returns (Upgrade memory) {
        return _upgrades[upgradeId];
    }

    /// @dev `sold` is owned by `applyMark` and is preserved across an edit.
    /// Taking it from calldata would mean an edit had to re-supply the current
    /// count, and getting it wrong would reset scarcity and re-open a sold-out
    /// Mark.
    function setUpgrade(uint8 upgradeId, Upgrade calldata u) external onlyOwner {
        if (upgradeId == 0 || upgradeId > MAX_MARK_ID) revert MarkIdOutOfRange(upgradeId);
        // The place table is constant, so its readable record is written once.
        if (upgradeId >= FIRST_FINISHER_MARK && _upgrades[upgradeId].active) {
            revert FinisherRecordSet(upgradeId);
        }
        // THE TWO INVARIANTS A SINGLE ENTRY CAN BREAK ON ITS OWN. A Mark that
        // excludes itself can never be applied, because the moment it lands its
        // own bit satisfies its own exclusion; a Mark that requires itself can
        // never be applied at all, because `requiresAny` is read against Marks
        // already held.
        //
        // NOT CHECKED HERE: the symmetry rule (a pair excludes both ways, and
        // no mask names a Mark from another pair). That is a statement about
        // TWO entries, and entries are written one at a time, so an on-chain
        // check would refuse the first half of every correct pair. Ladder.sol
        // and the Warden's ladder mirror each other by hash, and the suite
        // asserts each mask names exactly its partner.
        uint16 self = uint16(1) << upgradeId;
        if (u.excludes & self != 0) revert MarkExcludesItself(upgradeId);
        if (u.requiresAny & self != 0) revert MarkRequiresItself(upgradeId);
        uint32 sold = _upgrades[upgradeId].sold;
        _upgrades[upgradeId] = u;
        _upgrades[upgradeId].sold = sold;
        emit UpgradeSet(upgradeId);
    }

    /// @notice Apply a Mark to a token.
    /// @param variant the shape or ink index, 0 for every Mark that has none.
    /// @dev Payment settles off chain through x402 before the Warden calls
    /// this, which is why there is no value transfer here. Four of the ten
    /// Marks are free and settle nothing at all.
    function applyMark(uint256 id, uint8 upgradeId, uint8 variant)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        // Bounds the `1 << upgradeId` below. setUpgrade bounds the id too, but
        // the bound belongs on the shift that needs it.
        if (upgradeId == 0 || upgradeId > MAX_MARK_ID) revert MarkIdOutOfRange(upgradeId);
        // A PLACE IS NOT FOR SALE. The finisher Marks ship active, so without
        // this an agent could buy one and spend a cap on a token that had
        // finished nothing.
        if (upgradeId >= FIRST_FINISHER_MARK) revert MarkNotRequestable(upgradeId);

        Upgrade storage u = _upgrades[upgradeId];
        if (!u.active) revert MarkInactive();

        uint256 bit = 1 << upgradeId;
        uint256 held = _marks[id];
        if (held & bit != 0) revert MarkAlreadyApplied();
        if (u.maxSupply != 0 && u.sold >= u.maxSupply) revert MarkSoldOut();

        Token storage s = _tokens[id];
        // level is 1 from the moment a token exists, so zero means never
        // minted. Without this, an upgrade whose minLevel is 0 lets marks be
        // written to a phantom id, consuming a capped supply slot; mint does not
        // clear _marks, so that id would later mint already marked.
        if (s.level == 0) revert NoSuchToken(id);
        if (s.resting) revert Resting(id);
        if (s.level < u.minLevel) revert MarkGate();
        // THE RUN A MARK IS EARNED BY IS THE LONGEST ONE EVER COMPLETED, not
        // the one standing today. `streak` alone would admit a token that
        // reached 365 and went dark, and refuse one that reached 365, missed a
        // single day and RETURNED.
        uint32 run = _effectiveRun(s);
        if (run < u.minStreak) revert MarkGate();
        if (u.requiresWhole && s.level < 365) revert MarkGate();

        if (u.excludes != 0 && held & u.excludes != 0) {
            revert MarkExcluded(_lowestMark(held & u.excludes));
        }
        if (u.requiresAny != 0 && held & u.requiresAny == 0) revert MarkRequires();
        if (variant >= _variantCount(upgradeId)) revert BadVariant(variant);

        uint256 next = held | bit;
        // The variant bytes and the run are written from the SAME word, so a
        // Mark that carries neither costs what it cost before.
        if (upgradeId == 5) next |= uint256(variant) << 16;
        if (upgradeId == 9) next |= uint256(variant) << 24;
        // The earned Iris stores the RUN, read from the token rather than
        // supplied by the Warden, so it cannot be forged -- and the SAME value
        // the gate above admitted it on. Not the rung (which breaks if
        // minStreak is ever turned down) and not the colour (which would freeze
        // a swappable renderer's decision into token state forever).
        if (upgradeId == 6) next |= uint256(run) << 32;
        _marks[id] = next;

        unchecked { u.sold += 1; }

        emit MarkApplied(id, upgradeId, variant);
        emit MetadataUpdate(id);
    }

    /// @dev The lowest Mark id set in a mask. The loop runs 1..MAX_MARK_ID, the
    /// range setUpgrade and applyMark both enforce, and bit 0 is never set in
    /// _marks -- so on a non-zero mask the loop always returns and the trailing
    /// `return 0` is unreachable.
    function _lowestMark(uint256 mask) private pure returns (uint8) {
        for (uint8 i = 1; i <= MAX_MARK_ID; ++i) {
            if (mask & (1 << i) != 0) return i;
        }
        return 0;
    }

    // ---------------------------------------------------------------------
    // Lifecycle: rebind and rest
    // ---------------------------------------------------------------------

    error NotTokenOwner();

    event Rebound(uint256 indexed id, bytes32 indexed newKeyId);
    event Rested(uint256 indexed id, uint32 day, uint32 level, uint32 streak);

    modifier onlyTokenOwner(uint256 id) {
        if (_ownerOf(id) != msg.sender) revert NotTokenOwner();
        _;
    }

    /// @notice Point a token at a new agent key. Level, streak and marks are
    /// untouched.
    /// @dev Deliberately does NOT clear `_hasMinted` for either key. Minting is
    /// once per key forever; binding is unlimited. Clearing it would turn
    /// rebind into an unlimited mint.
    function rebind(uint256 id, bytes32 newKeyId) external onlyTokenOwner(id) {
        // A token bound to zero is bound to nothing: no agent could ever sign
        // for it again, and the record stops. `mint` refuses the same value.
        if (newKeyId == bytes32(0)) revert ZeroKeyId();
        _agentKeyOf[id] = newKeyId;
        emit Rebound(id, newKeyId);
        emit MetadataUpdate(id);
    }

    /// @notice Seal a token forever. The image stops changing.
    /// @dev Irreversible, and deliberately does not block transfer or rebind:
    /// a sealed token can still be owned and traded, which is the point.
    function rest(uint256 id) external onlyTokenOwner(id) {
        Token storage s = _tokens[id];
        if (s.resting) revert Resting(id);
        uint32 d = today();
        s.resting = true;
        _restDay[id] = d;
        emit Rested(id, d, s.level, s.streak);
        emit MetadataUpdate(id);
    }

    // ---------------------------------------------------------------------
    // Lifecycle: seed
    // ---------------------------------------------------------------------

    error ParentNotWhole();
    error NoSeedAvailable();
    /// The parent's key changed after the seed was asked for.
    error KeyChanged(uint256 parentId);

    event Seeded(uint256 indexed parentId, uint256 indexed childId, uint32 generation);

    /// @notice How many seeds the parent's KEY still has this tenure.
    /// @dev Keyed by agent key, not by token -- "tenure, not depth": a lineage
    /// cannot accelerate by seeding children who immediately seed further
    /// children, because every descendant shares the same key and therefore the
    /// same budget.
    function seedsAvailable(uint256 parentId) public view returns (uint32) {
        bytes32 key = _agentKeyOf[parentId];
        uint32 first = _firstMintDay[key];
        if (first == 0 && !_hasMinted[key]) return 0;
        uint32 budget = (today() - first) / 365;
        uint32 spent = _seedsSpent[key];
        return budget > spent ? budget - spent : 0;
    }

    /// @notice Create a child token from a whole parent. Free.
    /// @param day The day the seed was asked for, as the Warden recorded it --
    /// the same rule and the same bounds as `mint`: a child must begin on the
    /// day it was made, not the day it was written.
    /// @param expectedKeyId The key the Warden verified when the seed was asked
    /// for; a rebind since then refuses it.
    /// @param firstAnswer The first day's answer bit: the Clock's coin flip, since the mint day cannot be answered.
    function seed(
        uint256 childId,
        uint256 parentId,
        address to,
        bytes calldata code,
        uint32 day,
        bytes32 expectedKeyId,
        bool firstAnswer
    )
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        Token storage p = _tokens[parentId];
        if (p.resting) revert Resting(parentId);
        if (_agentKeyOf[parentId] != expectedKeyId) revert KeyChanged(parentId);
        if (p.level < 365) revert ParentNotWhole();
        // Same 32-bit ceiling as mint: seed is the other creation path.
        if (childId > type(uint32).max) revert IdTooLarge(childId);
        if (_ownerOf(childId) != address(0)) revert TokenExists(childId);
        if (totalMinted >= supplyCap) revert SupplyCap();
        if (mintedTo[to] >= walletCap) revert WalletCap();
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);
        if (seedsAvailable(parentId) == 0) revert NoSeedAvailable();
        _checkCreationDay(day);

        bytes32 key = expectedKeyId;
        uint32 d = day;

        _tokens[childId] = Token({
            level: 1, streak: 1, lastDay: d, mintDay: d,
            generation: p.generation + 1,
            seedsGiven: 0, resting: false, fellRun: 0, bestRun: 1, fellDay: 0
        });
        _parentOf[childId] = parentId;
        // The parent's own credited days PLUS what the parent itself inherited,
        // so the whole line accumulates in O(1) and no renderer ever walks a
        // parent chain. CHECKED arithmetic, deliberately outside the `unchecked`
        // block below: it must revert rather than wrap.
        _echo[childId] = p.level + _echo[parentId];
        _agentKeyOf[childId] = key;
        _codeOf[childId] = code;
        if (firstAnswer) _setAnswer(childId, 1);

        unchecked {
            _seedsSpent[key] += 1;
            p.seedsGiven += 1;
            totalMinted += 1;
            mintedTo[to] += 1;
        }

        _mint(to, childId);
        emit Seeded(parentId, childId, p.generation + 1);
        emit MetadataUpdate(parentId);
    }
}
