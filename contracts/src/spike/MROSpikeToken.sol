// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IRenderer} from "../render/IRenderer.sol";
import {TokenView} from "../render/TokenView.sol";

/// @notice The throwaway token contract the Phase 0 spike measures against.
///
/// @dev **This is not the collection.** It exists to answer one question: what
/// does `tokenURI` cost when a real ERC-721 reads storage and calls the
/// renderer, rather than a test handing the renderer a struct it already holds.
/// Every gas figure before this one measured the renderer alone.
///
/// The real `MachineReadableOnly` has a Warden, x402 pricing, mark gating,
/// seeding rules, a pause and a voucher path. None of that changes the cost of
/// drawing, so none of it is here.
///
/// Two things are faithful to the spec on purpose, because both move the
/// number this contract exists to produce: the `Token` struct occupies exactly
/// one 256-bit slot, and the code bitmap is written once at mint and never
/// rewritten.
contract MROSpikeToken is ERC721, Ownable2Step, IERC4906 {
    /// @dev Six uint32s (192 bits) plus a bool (8) plus 56 reserved = 256.
    ///
    /// `reserved` is not padding for its own sake. The real contract spends it,
    /// and dropping it here would change the slot count and with it the
    /// measurement, which is the only reason this contract exists.
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

    mapping(uint256 => Token) private _tokens;
    mapping(uint256 => uint256) private _marks;
    mapping(uint256 => uint256) private _parentOf;
    /// @dev A child's inherited days. Its own mapping, exactly as the real
    /// contract stores it, because the slot is what the measurement is for: a
    /// second mapping means a second COLD SLOAD on every `tokenURI`, and a
    /// spike that skipped it would report the echo as free.
    mapping(uint256 => uint32) private _echo;
    mapping(uint256 => bytes32) private _agentKeyOf;
    mapping(uint256 => bytes) private _codeOf;

    /// @notice The renderer this token draws through. Swappable by design.
    address public renderer;

    /// @notice The day the piece closed. Only meaningful once `isSunset`.
    /// @dev The spec writes this as "0 until sunset(), then the day number",
    /// using 0 as the sentinel. That works only because the piece does not
    /// launch on 1 January 1970 -- and it fails immediately in a test, where
    /// the chain clock starts at timestamp 1 and `today()` is genuinely 0. The
    /// flag below removes the ambiguity for nothing: a uint32 and a bool share
    /// one slot, so the second field is free.
    uint32 public sunsetDay;

    /// @notice Whether the piece has closed. Irreversible.
    bool public isSunset;

    /// @dev The packed code bitmap is a fixed 172 bytes: 37 x 37 modules.
    uint256 private constant CODE_BYTES = 172;

    /// @dev ERC-4906's interface id. OpenZeppelin ships the interface but no
    /// mixin, so the id is declared here.
    bytes4 private constant ERC4906_ID = 0x49064906;

    error TokenExists(uint256 id);
    error BadCodeLength(uint256 got);
    error BadRange();
    error ZeroRenderer();
    error AlreadySunset();

    event RendererSet(address renderer);
    event SunsetAt(uint32 day);

    constructor(address renderer_)
        ERC721("MRO Spike (throwaway)", "MROS")
        Ownable(msg.sender)
    {
        _setRenderer(renderer_);
    }

    // ---------------------------------------------------------------------
    // Reads
    // ---------------------------------------------------------------------

    /// @notice The UTC day index, the unit every date in this piece uses.
    function today() public view returns (uint32) {
        return uint32(block.timestamp / 1 days);
    }

    /// @notice Everything the renderer needs, assembled from storage.
    /// @dev `sunset` is piece-wide, so it is read from `sunsetDay` rather than
    /// from the token. `today` is passed in rather than read by the renderer,
    /// which is what keeps every renderer a pure function of its input.
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
    // Owner functions
    // ---------------------------------------------------------------------

    /// @notice Mint at day one, the way the real contract does.
    function mint(uint256 id, address to, bytes32 keyId, bytes calldata code) external onlyOwner {
        if (_ownerOf(id) != address(0)) revert TokenExists(id);
        if (code.length != CODE_BYTES) revert BadCodeLength(code.length);

        uint32 d = today();
        _tokens[id] = Token(1, 1, d, d, 0, 0, false, 0);
        _agentKeyOf[id] = keyId;
        _codeOf[id] = code;
        _safeMint(to, id);
    }

    /// @notice Overwrite the whole daily slot.
    /// @dev The spike's stand-in for `batchCheckIn`, `rest` and `seed` at once.
    /// It exists to place a token at any life stage for measurement, not to
    /// model the real rules -- which is why it takes the struct wholesale
    /// rather than applying a check-in.
    function setState(uint256 id, Token calldata t) external onlyOwner {
        _requireOwned(id);
        _tokens[id] = t;
        emit MetadataUpdate(id);   // after the write, never before
    }

    function setMarks(uint256 id, uint256 marks) external onlyOwner {
        _requireOwned(id);
        _marks[id] = marks;
        emit MetadataUpdate(id);
    }

    function setParent(uint256 id, uint256 parentId) external onlyOwner {
        _requireOwned(id);
        _parentOf[id] = parentId;
        emit MetadataUpdate(id);
    }

    /// @notice Place a token's inherited days, so a child can be measured.
    /// @dev The real contract derives this at `seed` time and never lets it be
    /// set directly. The spike takes it wholesale for the same reason
    /// `setState` does: this contract exists to place a token at a life stage,
    /// not to model the rules that get it there.
    function setEcho(uint256 id, uint32 echo) external onlyOwner {
        _requireOwned(id);
        _echo[id] = echo;
        emit MetadataUpdate(id);
    }

    /// @notice Tell marketplaces that a range of tokens changed.
    /// @dev The range must be the exact one written. A range ending at
    /// `type(uint256).max` is the collection-wide catch-all that indexers treat
    /// as hostile, so it is refused rather than merely discouraged.
    function touchRange(uint256 from, uint256 to) external onlyOwner {
        if (from > to || to == type(uint256).max) revert BadRange();
        emit BatchMetadataUpdate(from, to);
    }

    function setRenderer(address r) external onlyOwner {
        _setRenderer(r);
    }

    /// @notice Close the piece. Every token freezes at the colour it holds.
    /// @dev Irreversible, as the spec requires.
    ///
    /// Deliberately emits no `BatchMetadataUpdate`. A sunset does change every
    /// token, but this contract does not track its own id range, and the
    /// collection-wide catch-all is the exact range `touchRange` refuses. The
    /// real contract emits over the ids it actually minted.
    function sunset() external onlyOwner {
        if (isSunset) revert AlreadySunset();
        isSunset = true;
        sunsetDay = today();
        emit SunsetAt(sunsetDay);
    }

    function _setRenderer(address r) private {
        if (r == address(0)) revert ZeroRenderer();
        renderer = r;
        emit RendererSet(r);
    }
}
