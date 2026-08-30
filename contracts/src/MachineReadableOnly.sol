// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

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
contract MachineReadableOnly is ERC721, Ownable2Step, Pausable, IERC4906 {
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

    /// @dev One paid Mark tier.
    struct Upgrade {
        uint64 priceUsdc6;
        uint32 maxSupply; // 0 = unlimited
        uint32 sold;
        uint32 minLevel;
        uint32 minStreak;
        bool requiresWhole;
        bool active;
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

    /// @dev ERC-4906's interface id. OpenZeppelin ships the interface, not a mixin.
    bytes4 internal constant ERC4906_ID = 0x49064906;

    error NotWarden();
    error ZeroRenderer();
    error ZeroWarden();
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
    // Marks
    // ---------------------------------------------------------------------

    error MarkInactive();
    error MarkAlreadyApplied();
    error MarkSoldOut();
    error MarkGate();

    event MarkApplied(uint256 indexed id, uint8 indexed upgradeId);
    event UpgradeSet(uint8 indexed upgradeId);

    function marksOf(uint256 id) external view returns (uint256) {
        return _marks[id];
    }

    function upgradeOf(uint8 upgradeId) external view returns (Upgrade memory) {
        return _upgrades[upgradeId];
    }

    function setUpgrade(uint8 upgradeId, Upgrade calldata u) external onlyOwner {
        _upgrades[upgradeId] = u;
        emit UpgradeSet(upgradeId);
    }

    /// @notice Apply a paid Mark to a token.
    /// @dev Payment settles off chain through x402 before the Warden calls
    /// this, which is why there is no value transfer here.
    function applyMark(uint256 id, uint8 upgradeId) external onlyWarden notSunset {
        Upgrade storage u = _upgrades[upgradeId];
        if (!u.active) revert MarkInactive();

        uint256 bit = 1 << upgradeId;
        if (_marks[id] & bit != 0) revert MarkAlreadyApplied();
        if (u.maxSupply != 0 && u.sold >= u.maxSupply) revert MarkSoldOut();

        Token storage s = _tokens[id];
        if (s.resting) revert Resting(id);
        if (s.level < u.minLevel) revert MarkGate();
        if (s.streak < u.minStreak) revert MarkGate();
        if (u.requiresWhole && s.level < 365) revert MarkGate();

        _marks[id] |= bit;
        unchecked { u.sold += 1; }

        emit MarkApplied(id, upgradeId);
        emit MetadataUpdate(id);
    }
}
