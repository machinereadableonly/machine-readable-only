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
    /// @dev Six uint32s (192 bits) plus a bool (8) plus 56 reserved = 256.
    /// Keeping this in one slot is what makes a check-in about 5,000 gas.
    struct Token {
        uint32 level;
        uint32 streak;
        uint32 lastDay;
        uint32 mintDay;
        uint32 generation;
        uint32 seedsGiven;
        bool resting;
        uint56 reserved;
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
    bool public isSunset;
    bool public vouchersEnabled;

    /// @dev The packed code bitmap is a fixed 172 bytes: 37 x 37 modules.
    uint256 internal constant CODE_BYTES = 172;

    /// @dev Ten Marks in five pairs. Bit 0 is never a Mark.
    uint8 internal constant MAX_MARK_ID = 10;

    /// @dev ERC-4906's interface id. OpenZeppelin ships the interface, not a mixin.
    bytes4 internal constant ERC4906_ID = 0x49064906;

    error NotWarden();
    error ZeroRenderer();
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

    modifier onlyWarden() {
        if (msg.sender != warden) revert NotWarden();
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
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice The UTC day index, the unit every date in this piece uses.
    function today() public view returns (uint32) {
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
        v.resting = s.resting;
        v.sunset = isSunset;
        v.marks = _marks[id];
        v.agentKeyId = _agentKeyOf[id];
        v.code = _codeOf[id];
        v.today = today();
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

    function _setRenderer(address r) internal {
        if (r == address(0)) revert ZeroRenderer();
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
    function mint(uint256 id, address to, bytes32 keyId, bytes calldata code)
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

        uint32 d = today();
        _tokens[id] = Token(1, 1, d, d, 0, 0, false, 0);
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
    error LengthMismatch();
    error Resting(uint256 id);
    error NoSuchToken(uint256 id);
    error EmptyBatch();

    event BatchCheckedIn(uint32 fromDay, uint32 toDay, uint256 count);

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

            unchecked {
                s.level += 1;
                s.streak = (day == s.lastDay + 1) ? s.streak + 1 : 1;
            }
            s.lastDay = day;

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

        unchecked {
            s.level += 1;
            s.streak = (day == s.lastDay + 1) ? s.streak + 1 : 1;
        }
        s.lastDay = day;

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

    event MarkApplied(uint256 indexed id, uint8 indexed upgradeId);
    event UpgradeSet(uint8 indexed upgradeId);

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
        uint32 sold = _upgrades[upgradeId].sold;
        _upgrades[upgradeId] = u;
        _upgrades[upgradeId].sold = sold;
        emit UpgradeSet(upgradeId);
    }

    /// @notice Apply a paid Mark to a token.
    /// @dev Payment settles off chain through x402 before the Warden calls
    /// this, which is why there is no value transfer here.
    function applyMark(uint256 id, uint8 upgradeId)
        external
        onlyWarden
        whenNotPaused
        notSunset
    {
        Upgrade storage u = _upgrades[upgradeId];
        if (!u.active) revert MarkInactive();

        uint256 bit = 1 << upgradeId;
        if (_marks[id] & bit != 0) revert MarkAlreadyApplied();
        if (u.maxSupply != 0 && u.sold >= u.maxSupply) revert MarkSoldOut();

        Token storage s = _tokens[id];
        // level is 1 from the moment a token exists, so zero means never
        // minted. Without this, any upgrade whose minLevel dial is 0 lets marks
        // be written to a phantom id, consuming a capped supply slot; mint does
        // not clear _marks, so that id would later mint already marked.
        if (s.level == 0) revert NoSuchToken(id);
        if (s.resting) revert Resting(id);
        if (s.level < u.minLevel) revert MarkGate();
        if (s.streak < u.minStreak) revert MarkGate();
        if (u.requiresWhole && s.level < 365) revert MarkGate();

        uint256 held = _marks[id];
        if (u.excludes != 0 && held & u.excludes != 0) {
            revert MarkExcluded(_lowestMark(held & u.excludes));
        }
        if (u.requiresAny != 0 && held & u.requiresAny == 0) revert MarkRequires();

        _marks[id] |= bit;
        unchecked { u.sold += 1; }

        emit MarkApplied(id, upgradeId);
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
    function seed(uint256 childId, uint256 parentId, address to, bytes calldata code)
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

        bytes32 key = _agentKeyOf[parentId];
        uint32 d = today();

        _tokens[childId] = Token(1, 1, d, d, p.generation + 1, 0, false, 0);
        _parentOf[childId] = parentId;
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
