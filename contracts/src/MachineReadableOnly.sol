// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {IRenderer} from "./render/IRenderer.sol";
import {TokenView} from "./render/TokenView.sol";

/// @notice The collection. An agent's own record of coming back.
///
/// @dev Permanent by design: no proxy and no upgrade path. Only the renderer
/// is swappable, which is why every drawing decision lives behind IRenderer and
/// none of it lives here.
///
/// The storage rule that decides the gas bill: the daily write OVERWRITES one
/// `Token` slot. Nothing is ever keyed by day.
contract MachineReadableOnly is ERC721, Ownable2Step, Pausable, EIP712, IERC4906 {
    /// @dev Six uint32s (192 bits) plus a bool (8) plus 56 bits of run history
    /// = 256. Keeping this in ONE slot is what makes a check-in about 5,000
    /// gas, and it is the only reason the three fields below are as narrow as
    /// they are:
    ///
    ///   fellRun  uint16  the run that MOST RECENTLY fell    65,535 days, 179 years
    ///   bestRun  uint16  the longest run ever completed     179 years
    ///   fellDay  uint24  the day that run fell              about the year 47,000
    ///
    /// TWO run fields rather than one, because they answer different questions
    /// and a single field cannot be both. The colour fades from the run that
    /// most recently fell, starting the day it fell -- an old long run
    /// colouring a fresh slip would be wrong. The earned-Mark gate instead asks
    /// whether a run was EVER completed, which a recent small fall would
    /// wrongly answer no.
    ///
    /// Both exist because the piece was rewarding an agent that stopped over
    /// one that came back: a missed day reset `streak` to 1, so the image
    /// snapped to the day-one colour while a token that simply walked away
    /// paled gently over a month.
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

    /// @dev One Mark tier. 240 of 256 bits, so still ONE storage slot and
    /// `setUpgrade` costs what it always did.
    ///
    ///   priceUsdc6 64, maxSupply 32, sold 32, minLevel 32, minStreak 32,
    ///   requiresWhole 8, active 8, excludes 16, requiresAny 16 = 240.
    ///
    /// uint16 rather than uint8 because the ids run to 10 and bit 0 is
    /// deliberately never a Mark, so bit 10 must be addressable with room left.
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
    /// because `Token` is EXACTLY full at 256 bits (6 x uint32 + bool + uint16
    /// + uint16 + uint24), and widening it would add a slot to every token and
    /// change the cost of every check-in. Written once, in `seed`.
    mapping(uint256 => uint32) internal _echo;

    /// @dev One mint per key ever. Binding is unlimited, so `rebind` can move a
    /// token to a new key but can never resurrect a mint.
    mapping(bytes32 => bool) internal _hasMinted;
    mapping(bytes32 => uint32) internal _firstMintDay;
    mapping(bytes32 => uint32) internal _seedsSpent;

    /// @dev Tokens ever MINTED to an address, not tokens currently held.
    /// Counting holdings would let the cap be defeated by transferring out.
    mapping(address => uint32) public mintedTo;

    mapping(uint8 => Upgrade) internal _upgrades;

    address public renderer;
    address public warden;
    uint32 public supplyCap;
    uint32 public walletCap;
    uint32 public totalMinted;
    uint32 public sunsetDay;
    /// @notice The last day the Warden wrote anything at all.
    /// @dev The piece's most likely death is the operator simply stopping, and
    /// as built that had no ending: the Clock falls silent, no one can call
    /// `sunset()` but the owner, and within thirty days every heart renders at
    /// the start colour with `Sunset: no` -- the operator's abandonment drawn
    /// as every agent's. This is what `sunsetByAbsence` measures. One warm
    /// SSTORE per transaction, not per token, so the nightly batch pays it once.
    uint32 public lastWardenDay;
    bool public isSunset;
    bool public vouchersEnabled;

    /// @dev The packed code bitmap is a fixed 172 bytes: 37 x 37 modules.
    uint256 internal constant CODE_BYTES = 172;

    /// @dev Ten Marks in five pairs. Bit 0 is never a Mark.
    /// Ten are written by the deploy; the ceiling is 15 so the ladder can grow
    /// without a redeploy, decided 2026-09-05. Fifteen is the TRUE ceiling and
    /// not a round number: `excludes` and `requiresAny` are uint16 so bit 15 is
    /// the last addressable Mark bit, and bit 16 is already the Iris shape.
    /// Nothing is served promising an eleventh, and nothing is served
    /// promising there will never be one.
    uint8 internal constant MAX_MARK_ID = 15;

    /// @dev ERC-4906's interface id. OpenZeppelin ships the interface, not a mixin.
    bytes4 internal constant ERC4906_ID = 0x49064906;

    error NotWarden();
    error ZeroRenderer();
    error RendererNotContract();
    error ZeroWarden();
    error RenounceDisabled();
    /// @dev The piece is closed. Distinct from AlreadySunset, which is the
    /// double-call guard. These cannot share a name with the event.
    error Sunset();
    error AlreadySunset();

    event RendererSet(address renderer);
    event WardenSet(address warden);
    event SupplyCapSet(uint32 cap);
    event WalletCapSet(uint32 cap);
    event SunsetAt(uint32 day);

    /// @dev Also the heartbeat. Stamping `lastWardenDay` HERE rather than in
    /// each of `mint`, `batchCheckIn`, `applyMark` and `seed` means a fifth
    /// Warden function cannot be added without one, which is the failure mode
    /// that would make `sunsetByAbsence` fire on a living piece.
    ///
    /// `checkInWithVoucher` deliberately does NOT stamp it, though it carries a
    /// Warden signature. A voucher proves a signature EXISTED, not that the
    /// operator is still there -- it can be signed today and submitted in three
    /// years. Counting one as a heartbeat would let a hoarded voucher hold the
    /// piece open forever against the very absence this measures. (The plan
    /// listed it; the plan was wrong.)
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

    constructor(address renderer_, address warden_)
        ERC721("Machine Readable Only", "MRO")
        Ownable(msg.sender)
        EIP712("MachineReadableOnly", "1")
    {
        _setRenderer(renderer_);
        _setWarden(warden_);
        supplyCap = 10_000;
        walletCap = 20;
        // Deployment counts as a write. Leaving this at zero would make the
        // piece closeable by anyone on day one, since the gap from day zero is
        // 20,700 days and climbing.
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
        v.sunset = isSunset;
        v.sunsetDay = sunsetDay;
        v.fellRun = s.fellRun;
        v.fellDay = s.fellDay;
        v.marks = _marks[id];
        v.agentKeyId = _agentKeyOf[id];
        v.code = _codeOf[id];
        v.today = today();
    }

    /// @notice The sealed inherited tenure: days the line had run when this
    /// token was seeded. 0 for a founding token.
    /// @dev Read on its own, without the whole `TokenView`, by the deploy
    /// verification script and by anything that only needs this one number.
    function echoOf(uint256 id) public view returns (uint32) {
        return _echo[id];
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

    function setRenderer(address r) external onlyOwner { _setRenderer(r); }
    function setWarden(address w) external onlyOwner { _setWarden(w); }

    function setSupplyCap(uint32 cap) external onlyOwner {
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
    /// @dev OpenZeppelin ships `renounceOwnership` live and `Ownable2Step` does
    /// not override it. Renouncing WHILE PAUSED would freeze the piece forever:
    /// no mint, no check-in, no seed, no unpause and no remedy, because there is
    /// no upgrade path. `sunset()` is the designed operator ending and leaves
    /// transfers, `rebind` and every token's art intact, so renounce has no
    /// legitimate use here and exactly one catastrophic failure mode.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    /// @notice Close the piece. Irreversible.
    /// @dev Emits no metadata event. A sunset does change every token, but the
    /// collection-wide range is the one event indexers treat as hostile, and
    /// the piece must never depend on an indexer refreshing anyway.
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
    /// Anyone may call it. Irreversible.
    ///
    /// @dev The operator stopping is this piece's most likely ending -- five of
    /// six comparable projects died that way -- and it was the one ending the
    /// contract could not express. Without this, silence is drawn as every
    /// agent's abandonment: the Clock stops, no check-in lands, and thirty days
    /// later every heart is at the start colour while `Sunset` still reads no,
    /// with nobody on earth able to say otherwise.
    ///
    /// It grants no new power. It can only do what the owner could already have
    /// done with `sunset()`, and only after a whole frame's worth of silence.
    ///
    /// `sunsetDay` IS `lastWardenDay` HERE, and that is load-bearing rather than
    /// a shortcut. The renderer freezes a sunset token at
    /// `lapsedIndex(streak, lastDay, sunsetDay)`. Setting it to `today()` -- a
    /// year after the last write -- would give every token a gap of 365 and
    /// freeze the whole collection at the start colour, which is precisely the
    /// lie this function exists to prevent. The day the piece ENDED is the day
    /// it stopped, not the day somebody noticed. Owner-called `sunset()` keeps
    /// `today()`, because there the operator is choosing the moment.
    function sunsetByAbsence() external {
        if (isSunset) revert AlreadySunset();
        uint32 gap = today() - lastWardenDay;
        if (gap < ABSENCE_DAYS) revert NotAbsent(gap);
        isSunset = true;
        sunsetDay = lastWardenDay;
        emit SunsetAt(sunsetDay);
    }

    function _setRenderer(address r) internal {
        if (r == address(0)) revert ZeroRenderer();
        // 12.6. Non-zero is not the same as usable. tokenURI STATICCALLs this
        // address for every token, so an EOA here -- a mistyped or truncated
        // paste of an address that is perfectly valid -- returns empty data and
        // bricks the metadata of the entire collection at once. Code size does
        // not prove it is the RIGHT contract, but it rules out the whole class
        // of mistake that has no code at all.
        if (r.code.length == 0) revert RendererNotContract();
        renderer = r;
        emit RendererSet(r);
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
    error WalletCap();
    error BadCodeLength(uint256 got);

    event Minted(uint256 indexed id, bytes32 indexed keyId);

    // ---------------------------------------------------------------------
    // Warden functions
    // ---------------------------------------------------------------------

    /// @notice Mint one token for one agent key.
    /// @dev The id is chosen by the Warden rather than a counter, so a mint can
    /// be reserved before it settles. `hasMinted` is per key and permanent: a
    /// later `rebind` moves a token to a new key but never frees the old one.
    /// @param day The day the agent PAID, as the Warden recorded it. Not
    /// `today()`: the Clock writes a mint at 00:05 the day after payment, and a
    /// token that began on the write day disagreed with the Warden by one day
    /// for its whole life -- its next-day check-in landed ON its first day and
    /// was lost (found by the fast-days copy, 2026-09-11). A pending row keeps
    /// its own day number, as check-ins always have. Bounded both ways by
    /// `_checkCreationDay`.
    function mint(uint256 id, address to, bytes32 keyId, bytes calldata code, uint32 day)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        // batchCheckIn addresses ids in 4 packed bytes, so an id that does not
        // fit 32 bits would mint and render but could never be checked in, and
        // vouchers ship disabled. Rejected here rather than widening the packing.
        if (id > type(uint32).max) revert IdTooLarge(id);
        // A Warden serialising a missing thumbprint to zero would burn the zero
        // key permanently AND create a shared seed budget that any token owner
        // could rebind into for free.
        if (keyId == bytes32(0)) revert ZeroKeyId();
        if (_hasMinted[keyId]) revert AlreadyMinted();
        if (_ownerOf(id) != address(0)) revert TokenExists(id);
        if (totalMinted >= supplyCap) revert SupplyCap();
        if (mintedTo[to] >= walletCap) revert WalletCap();
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);
        _checkCreationDay(day);

        uint32 d = day;
        // Named rather than positional: the struct now carries ten fields, three
        // of them adjacent small ints, and a positional list is how one of those
        // silently lands in the wrong one. `bestRun` is 1 because the token's run
        // IS 1 from the moment it exists.
        _tokens[id] = Token({
            level: 1, streak: 1, lastDay: d, mintDay: d, generation: 0,
            seedsGiven: 0, resting: false, fellRun: 0, bestRun: 1, fellDay: 0
        });
        _agentKeyOf[id] = keyId;
        _codeOf[id] = code;
        _hasMinted[keyId] = true;
        _firstMintDay[keyId] = d;
        unchecked {
            totalMinted += 1;
            mintedTo[to] += 1;
        }

        _safeMint(to, id);
        emit Minted(id, keyId);
    }

    error DayNotAdvanced(uint256 id);
    error FutureDay(uint32 day);
    /// A creation day more than MAX_CREATION_LAG days behind today().
    error StaleDay(uint32 day);

    /// How far behind `today()` a mint or seed may be dated. The Warden
    /// records the day an agent paid and the Clock writes it later -- normally
    /// at 00:05 the next day, longer only if the gas guard defers or the box is
    /// down. Without a floor, a Warden could backdate a mint and credit every
    /// day since, fabricating a year of history in one night; thirty days is
    /// far beyond any honest delay. A paid mint older than that is refused by
    /// name and waits for a human, by the path stuck mints already take.
    uint32 internal constant MAX_CREATION_LAG = 30;

    /// @dev The one bound on a creation day, shared by `mint` and `seed`: not
    /// after today (the FutureDay rule check-ins already follow) and not more
    /// than MAX_CREATION_LAG days before it.
    function _checkCreationDay(uint32 day) internal view {
        uint32 tday = today();
        if (day > tday) revert FutureDay(day);
        if (day + MAX_CREATION_LAG < tday) revert StaleDay(day);
    }
    error LengthMismatch();
    error Resting(uint256 id);
    error NoSuchToken(uint256 id);
    error EmptyBatch();

    event BatchCheckedIn(uint32 fromDay, uint32 toDay, uint256 count);

    /// @dev The bookkeeping both check-in paths share: level, run, run history,
    /// and the day.
    ///
    /// It lives in one function because the two paths used to be identical
    /// lines that merely HAD to stay identical. With one field to maintain that
    /// held; with four it would not, and `checkInWithVoucher` is the path that
    /// ships paused and therefore gets read least.
    ///
    /// Every write lands in a slot this function is already dirtying, so a
    /// check-in costs what it always did.
    function _credit(Token storage s, uint32 day) private {
        uint32 run;
        unchecked {
            s.level += 1;
            if (day == s.lastDay + 1) {
                run = s.streak + 1;
            } else {
                // The run ends here. Record WHAT fell and WHEN before the
                // reset, so the renderer can pale from the run that was lost
                // instead of snapping to the day-one colour. Without this a
                // token that missed one day and came back rendered paler than
                // one that had been gone a month.
                s.fellRun = _toU16(s.streak);
                // Bounded by `today()`, which both callers check `day` against,
                // so this cannot truncate until about the year 47,000.
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
    }

    /// @dev A run cannot reach 65,535 days here -- that is 179 years -- but a
    /// silent wrap in a value a Mark gate reads is not an acceptable failure
    /// mode, so it saturates rather than truncating.
    function _toU16(uint32 v) private pure returns (uint16) {
        return v > type(uint16).max ? type(uint16).max : uint16(v);
    }

    /// @notice The longest run this token has ever completed.
    /// @dev `bestRun` is only written on the way up, so the live `streak` can
    /// exceed it by exactly one credit -- the one that has not yet been folded
    /// in. Taking the larger of the two costs nothing and means the gate never
    /// lags the token by a day.
    function _effectiveRun(Token storage s) private view returns (uint32) {
        uint32 best = s.bestRun;
        return s.streak > best ? s.streak : best;
    }

    /// @notice Credit a day to each of many tokens, in one transaction.
    ///
    /// @dev Ids arrive packed as 4-byte big-endian values rather than a
    /// uint32[] because calldata is the dominant cost at this batch size.
    ///
    /// Emits one `MetadataUpdate` per token written, AFTER the writes, and
    /// never a range. A day's check-ins are a scattered subset of ids, so
    /// `minId..maxId` would always claim untouched tokens had changed. The
    /// Clock adds paling-step crossers to the same per-token emit set.
    function batchCheckIn(bytes calldata packedIds, uint32[] calldata days_)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        uint256 n = days_.length;
        if (packedIds.length != n * 4) revert LengthMismatch();
        if (n == 0) revert EmptyBatch();

        // Read once, not once per token: this is the gas-critical loop.
        uint32 tday = today();

        uint32 lo = type(uint32).max;
        uint32 hi = 0;

        for (uint256 i = 0; i < n; i++) {
            uint256 id = uint256(uint32(bytes4(packedIds[i * 4:i * 4 + 4])));
            uint32 day = days_[i];

            Token storage s = _tokens[id];
            // level is 1 from the moment a token exists (mint and seed both set
            // it), so a zero here means this id was never minted. Checked off
            // the struct we already loaded rather than via _ownerOf, which
            // reads a different mapping and would cost a cold SLOAD per entry.
            if (s.level == 0) revert NoSuchToken(id);
            if (s.resting) revert Resting(id);
            // A day index is bounded above as well as below. Without this, a
            // Warden passing a TIMESTAMP where a day index belongs sets lastDay
            // to about 4.7M and every real check-in reverts DayNotAdvanced
            // forever, with no admin path to reset it.
            if (day > tday) revert FutureDay(day);
            if (day <= s.lastDay) revert DayNotAdvanced(id);

            _credit(s, day);

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
    /// added, and the piece would die with the Warden.
    ///
    /// Existence is checked the same way `batchCheckIn` checks it: `level == 0`
    /// means the id was never minted. Without that guard a voucher for a
    /// never-minted id would still pass the `day > lastDay` rule against a
    /// zero struct and silently create Token state for a token nobody owns.
    ///
    /// The signer is recovered from `warden`, read fresh from storage on every
    /// call rather than captured at signing time, so rotating the Warden
    /// invalidates every voucher the old key already signed.
    function checkInWithVoucher(uint256 id, uint32 day, bytes calldata wardenSig)
        external
        whenNotPaused
        notSunset
    {
        if (!vouchersEnabled) revert VouchersDisabled();

        Token storage s = _tokens[id];
        if (s.level == 0) revert NoSuchToken(id);
        if (s.resting) revert Resting(id);

        address signer = ECDSA.recoverCalldata(voucherHash(id, day), wardenSig);
        if (signer != warden) revert BadVoucher();

        // Bounded above for the same reason as batchCheckIn: a signed voucher
        // for a nonsense future day would brick the token permanently.
        if (day > today()) revert FutureDay(day);
        if (day <= s.lastDay) revert DayNotAdvanced(id);

        _credit(s, day);

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
    /// door rather than that a door is closed. `cast call` returns the selector
    /// and the argument for free, so the guard is provable without a transaction.
    error MarkExcluded(uint8 by);
    error MarkRequires();
    /// @dev `applyMark` computes `1 << upgradeId`, and `_marks` packs the Iris
    /// shape at bit 16 and the Tint ink at bit 24. An id of 16 would therefore
    /// alias the shape bits exactly and silently corrupt every token's variant.
    /// Refused where the record is written, so the bad record cannot exist.
    error MarkIdOutOfRange(uint8 upgradeId);
    /// A Mark whose own bit is in its own excludes or requiresAny mask can
    /// never be applied. See setUpgrade.
    error MarkExcludesItself(uint8 upgradeId);
    error MarkRequiresItself(uint8 upgradeId);
    error BadVariant(uint8 got);

    /// @dev The variant is part of what was bought, so it belongs in the event
    /// the Clock and any indexer read. Not indexed: nobody filters by shape.
    event MarkApplied(uint256 indexed id, uint8 indexed upgradeId, uint8 variant);
    event UpgradeSet(uint8 indexed upgradeId);

    /// @dev How many variants a Mark accepts. PER MARK AND IN THE CONTRACT, not
    /// a field on `Upgrade`, because a dial that can be turned up past what the
    /// renderer can draw is a dial that can brick a token's image. The renderer
    /// and this bound move together or not at all.
    ///
    ///   Mark 5, the bought Iris: three shapes -- target, squircle, leaf.
    ///   Mark 9, Tint: two inks -- violet, gold. (Three until 2026-09-02, when
    ///   near-black was measured as the default appearance of a QR eye and
    ///   dropped: a paid Mark must not offer the unmarked look.)
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
    /// Taking it from calldata meant that editing a price required re-supplying
    /// the current count, and getting it wrong silently reset scarcity and
    /// re-opened a sold-out Mark. Scarcity is a stated property of the ladder.
    function setUpgrade(uint8 upgradeId, Upgrade calldata u) external onlyOwner {
        if (upgradeId == 0 || upgradeId > MAX_MARK_ID) revert MarkIdOutOfRange(upgradeId);
        // 1.L3. THE TWO INVARIANTS A SINGLE ENTRY CAN BREAK ON ITS OWN.
        //
        // A Mark that excludes itself can never be applied: applyMark reads the
        // held mask, and the moment this Mark lands its own bit satisfies its
        // own exclusion, so the second half of the pair is unreachable and the
        // first is unrepeatable. A Mark that requires itself can never be
        // applied at all -- `requiresAny` is read against marks already held,
        // and this one cannot be held before it is applied. Both are dead ends
        // that only a deploy would reveal, and by then the entry is on chain.
        //
        // WHAT IS DELIBERATELY NOT CHECKED HERE: the spec's symmetry rule (a
        // pair excludes both ways, and no mask names a Mark from another pair).
        // That is a statement about TWO entries, and entries are written one at
        // a time -- so any on-chain check would refuse the first half of every
        // correct pair. It is enforced where it can be: Ladder.sol and
        // ladder.mjs mirror each other by hash, and the suite asserts each
        // mask names exactly its partner.
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
        // 12.4. `1 << upgradeId` below is unbounded, and was safe only because
        // setUpgrade (the sole writer of _upgrades) bounds the id, so no
        // out-of-range entry can ever be `active`. That is an argument about a
        // second function, and it stops being true the day anyone adds another
        // writer. The bound belongs on the shift that needs it.
        if (upgradeId == 0 || upgradeId > MAX_MARK_ID) revert MarkIdOutOfRange(upgradeId);

        Upgrade storage u = _upgrades[upgradeId];
        if (!u.active) revert MarkInactive();

        uint256 bit = 1 << upgradeId;
        uint256 held = _marks[id];
        if (held & bit != 0) revert MarkAlreadyApplied();
        if (u.maxSupply != 0 && u.sold >= u.maxSupply) revert MarkSoldOut();

        Token storage s = _tokens[id];
        // level is 1 from the moment a token exists, so zero means never
        // minted. Without this, any upgrade whose minLevel dial is 0 lets marks
        // be written to a phantom id, consuming a capped supply slot; mint does
        // not clear _marks, so that id would later mint already marked.
        if (s.level == 0) revert NoSuchToken(id);
        if (s.resting) revert Resting(id);
        if (s.level < u.minLevel) revert MarkGate();
        // THE RUN A MARK IS EARNED BY IS THE LONGEST ONE EVER COMPLETED, not
        // the one standing today. `streak` alone rewarded an agent that stopped
        // over one that came back: a token that reached 365 and went dark keeps
        // `streak == 365` forever and could take Break, while one that reached
        // 365, missed a single day and RETURNED was reset to 1 and refused.
        // Decided 2026-09-05; the ladder spec says so in the same words.
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
        // Mark that carries neither costs exactly what it cost before.
        if (upgradeId == 5) next |= uint256(variant) << 16;
        if (upgradeId == 9) next |= uint256(variant) << 24;
        // The earned Iris stores the RUN, read from the token here rather than
        // supplied by the Warden, so it cannot be forged. Not the rung (which
        // breaks if minStreak is ever turned down with setUpgrade) and not the
        // colour (which would freeze a swappable renderer's decision into token
        // state forever).
        // The SAME value the gate above admitted it on, so the Mark records the
        // run it was actually granted for. Reading `s.streak` here would store
        // 1 for a token admitted on a completed run it had since slipped from.
        if (upgradeId == 6) next |= uint256(run) << 32;
        _marks[id] = next;

        unchecked { u.sold += 1; }

        emit MarkApplied(id, upgradeId, variant);
        emit MetadataUpdate(id);
    }

    /// @dev The lowest Mark id set in a mask. Only ever called on a non-zero
    /// mask confined to bits 1..10, so the loop terminates.
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
        // 12.5. `mint` rejects a zero key id explicitly; rebind accepted it, so
        // the one value the piece refuses to start with could be arrived at by
        // a second call. A token bound to zero is bound to nothing: no agent
        // can ever sign for it again, and the record stops.
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
        s.resting = true;
        emit Rested(id, today(), s.level, s.streak);
        emit MetadataUpdate(id);
    }

    // ---------------------------------------------------------------------
    // Lifecycle: seed
    // ---------------------------------------------------------------------

    error ParentNotWhole();
    error NoSeedAvailable();

    event Seeded(uint256 indexed parentId, uint256 indexed childId, uint32 generation);

    /// @notice How many seeds the parent's KEY still has this tenure.
    /// @dev Keyed by agent key, not by token. This is the "tenure, not depth"
    /// rule: a lineage cannot accelerate by seeding children who immediately
    /// seed further children, because every descendant shares the same key and
    /// therefore the same budget.
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
    /// the same rule and the same bounds as `mint`, for the same reason: the
    /// Clock writes it at 00:05 the next day, and a child must begin on the day
    /// it was made, not the day it was written.
    function seed(uint256 childId, uint256 parentId, address to, bytes calldata code, uint32 day)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        Token storage p = _tokens[parentId];
        if (p.resting) revert Resting(parentId);
        if (p.level < 365) revert ParentNotWhole();
        // Same 32-bit ceiling as mint: seed is the other creation path.
        if (childId > type(uint32).max) revert IdTooLarge(childId);
        if (_ownerOf(childId) != address(0)) revert TokenExists(childId);
        if (totalMinted >= supplyCap) revert SupplyCap();
        if (mintedTo[to] >= walletCap) revert WalletCap();
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);
        if (seedsAvailable(parentId) == 0) revert NoSeedAvailable();
        _checkCreationDay(day);

        bytes32 key = _agentKeyOf[parentId];
        uint32 d = day;

        _tokens[childId] = Token({
            level: 1, streak: 1, lastDay: d, mintDay: d,
            generation: p.generation + 1,
            seedsGiven: 0, resting: false, fellRun: 0, bestRun: 1, fellDay: 0
        });
        _parentOf[childId] = parentId;
        // The parent's own credited days PLUS what the parent itself
        // inherited, so the whole line accumulates in O(1) and no renderer ever
        // walks a parent chain. CHECKED arithmetic, deliberately outside the
        // `unchecked` block below: this is an addition of two independent
        // values and must revert rather than wrap.
        _echo[childId] = p.level + _echo[parentId];
        _agentKeyOf[childId] = key;
        _codeOf[childId] = code;

        unchecked {
            _seedsSpent[key] += 1;
            p.seedsGiven += 1;
            totalMinted += 1;
            mintedTo[to] += 1;
        }

        _safeMint(to, childId);
        emit Seeded(parentId, childId, p.generation + 1);
        emit MetadataUpdate(parentId);
    }
}
