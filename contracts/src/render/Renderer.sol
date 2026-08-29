// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base64} from "solady/src/utils/Base64.sol";
import {LibString} from "solady/src/utils/LibString.sol";

import {CodeRenderer} from "./CodeRenderer.sol";
import {FrameGeometry} from "./FrameGeometry.sol";
import {FrameRenderer} from "./FrameRenderer.sol";
import {HeartMask} from "./HeartMask.sol";
import {IRenderer} from "./IRenderer.sol";
import {MarkRenderer} from "./MarkRenderer.sol";
import {Palette} from "./Palette.sol";
import {TokenView} from "./TokenView.sol";

/// @notice Assembles the image and the metadata for one token.
///
/// @dev The four drawing libraries each own one part of the picture and none of
/// them knows about the others; this is the only place that knows the order they
/// go in. That order is ghost, frame, noise, heart -- fixed so each library emits
/// one adjacent pair of paths and this contract can simply concatenate them.
/// All four sets are disjoint, so the order moves no pixel.
///
/// **The SVG is base64, the JSON is not.** Measured on the spike: base64-encoding
/// the SVG and serving the JSON as plain utf-8 costs 2,375,511 gas at the old
/// eighty-ring canvas, against 5,846,742 to percent-escape the SVG as utf-8 and
/// 3,210,443 to base64 the JSON as well. A per-byte escape loop in Solidity costs
/// far more than Solady's word-wise encoder, so base64 wins on gas by a factor of
/// 2.5 even though it is the larger payload.
///
/// **No raw `#` may reach the output.** The whole tokenURI is itself a URI, so a
/// raw hash opens a fragment and truncates the JSON -- measured, `JSON.parse`
/// fails at position 31. Base64 hides every `#` inside the SVG, including the
/// colours and Bloom's `url(#b)`. The only one left is in the name, written
/// `%23`.
contract Renderer is IRenderer {
    /// @dev The quiet zone the code sits in, in cells, on each side.
    uint256 internal constant QUIET = 4;

    string internal constant NAME = "Machine Readable Only";
    string internal constant DESCRIPTION =
        "An agent's record of coming back. The heart is the code, and the frame is the year.";

    /// @inheritdoc IRenderer
    function tokenURI(TokenView memory v) external pure returns (string memory) {
        return string(
            abi.encodePacked(
                "data:application/json;utf-8,",
                '{"name":"', NAME, " %23", LibString.toString(v.tokenId), _suffix(v),
                '","description":"', DESCRIPTION,
                '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg(v))),
                '","attributes":[', _attributes(v), "]}"
            )
        );
    }

    /// @notice The image on its own, before any encoding.
    /// @dev Public so a caller can read the raw SVG without paying for base64,
    /// and so the differential test can diff it against the JS reference.
    ///
    /// Split into `_head` and `_art` rather than written as one expression, so
    /// it compiles without the IR pipeline. `forge coverage` cannot use `via_ir`
    /// (foundry-rs/foundry#13001), and as a single `abi.encodePacked` this ran
    /// out of stack under the coverage profile.
    function svg(TokenView memory v) public pure returns (string memory) {
        string memory colour = _colour(v);
        return string(abi.encodePacked(_head(v, colour), _art(v, colour), "</svg>"));
    }

    /// @dev A sealed or sunset token keeps the colour it stopped at; a live one
    /// pales as it lapses. Kept here rather than in Palette so the palette stays
    /// a pure function of colour, not of token lifecycle.
    function _colour(TokenView memory v) private pure returns (string memory) {
        return (v.resting || v.sunset)
            ? Palette.tier(v.streak)
            : Palette.lapsed(v.streak, v.lastDay, v.today);
    }

    /// @dev Where the 45-cell block sits on the canvas, in cells.
    function _blockOff(uint32 level) private pure returns (uint256) {
        uint256 rim = FrameRenderer.ringSpan(FrameRenderer.rings(level)) + FrameRenderer.GAP;
        return rim + FrameGeometry.THICK;
    }

    /// @dev The open tag, Bloom's gradient definition, the field and Voice's tint.
    function _head(TokenView memory v, string memory colour) private pure returns (string memory) {
        string memory c = LibString.toString(FrameRenderer.canvas(FrameRenderer.rings(v.level)));
        return string(
            abi.encodePacked(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ', c, " ", c,
                '" shape-rendering="crispEdges">',
                MarkRenderer.defs(v.marks, colour),
                '<rect width="', c, '" height="', c, '" fill="', MarkRenderer.field(v.marks), '"/>',
                _quiet(v.marks, _blockOff(v.level))
            )
        );
    }

    /// @dev The four paths, in the fixed order: ghost, frame, noise, heart.
    function _art(TokenView memory v, string memory colour) private pure returns (string memory) {
        return string(
            abi.encodePacked(
                FrameRenderer.paths(
                    v, MarkRenderer.frameFill(v.marks, colour), MarkRenderer.ghost(v.marks)
                ),
                CodeRenderer.paths(
                    v.code,
                    HeartMask.bits(),
                    _blockOff(v.level) + QUIET,
                    MarkRenderer.heartFill(v.marks, colour),
                    Palette.noise()
                )
            )
        );
    }

    /// @dev Voice tints the whole 45-cell block rather than the 656 cells of the
    /// quiet zone proper. The code modules are drawn on top, so the result is
    /// identical and it costs one rect instead of a path over 656 cells -- about
    /// 46 bytes against about 1,140.
    function _quiet(uint256 marks, uint256 blockOff) private pure returns (string memory) {
        string memory tint = MarkRenderer.quietTint(marks);
        if (bytes(tint).length == 0) return "";
        string memory o = LibString.toString(blockOff);
        return string(
            abi.encodePacked(
                '<rect x="', o, '" y="', o,
                '" width="', LibString.toString(FrameGeometry.BLOCK),
                '" height="', LibString.toString(FrameGeometry.BLOCK),
                '" fill="', tint, '"/>'
            )
        );
    }

    /// @dev The spec's attribute list, in the spec's order.
    ///
    /// `Heart` is filled cells over 365, `Children` is what the struct calls
    /// `seedsGiven`, and `Agent Key` is the bound key as fixed-width hex.
    /// `Parent` is 0 for a founding token. `Sunset` is the one entry the spec
    /// does not list; it is real piece-wide state a reader can act on, so it
    /// stays.
    ///
    /// Split in two because `abi.encodePacked` with fourteen arguments runs out
    /// of stack under the coverage profile, which cannot use the IR pipeline
    /// (foundry-rs/foundry#13001). `svg()` carries the same split for the same
    /// reason.
    function _attributes(TokenView memory v) private pure returns (string memory) {
        return string(abi.encodePacked(_attrsA(v), _attrsB(v)));
    }

    function _attrsA(TokenView memory v) private pure returns (string memory) {
        return string(
            abi.encodePacked(
                _num("Level", v.level),
                _num("Streak", v.streak),
                _str("Heart", _heart(v.level)),
                _num("Years", FrameRenderer.rings(v.level)),
                _str("Whole", v.level >= FrameGeometry.DAY_CELLS ? "yes" : "no"),
                _num("Mint Day", v.mintDay),
                _num("Last Day", v.lastDay)
            )
        );
    }

    function _attrsB(TokenView memory v) private pure returns (string memory) {
        return string(
            abi.encodePacked(
                _str("Agent Key", LibString.toHexString(uint256(v.agentKeyId), 32)),
                _num("Generation", v.generation),
                _num("Parent", v.parent),
                _num("Children", v.seedsGiven),
                _str("Resting", v.resting ? "yes" : "no"),
                _str("Sunset", v.sunset ? "yes" : "no"),
                '{"trait_type":"Marks","value":', MarkRenderer.names(v.marks), "}"
            )
        );
    }

    /// @dev "212/365". Cells shown is capped at 365 even though level is not.
    function _heart(uint32 level) private pure returns (string memory) {
        uint256 shown = level >= FrameGeometry.DAY_CELLS ? FrameGeometry.DAY_CELLS : level;
        return string(
            abi.encodePacked(
                LibString.toString(shown), "/", LibString.toString(FrameGeometry.DAY_CELLS)
            )
        );
    }

    /// @dev The spec gives a whole token "(Whole)" and a sealed one "(At Rest)".
    /// Resting wins when both apply: it is the more final of the two states.
    function _suffix(TokenView memory v) private pure returns (string memory) {
        if (v.resting) return " (At Rest)";
        if (v.level >= FrameGeometry.DAY_CELLS) return " (Whole)";
        return "";
    }

    function _num(string memory k, uint256 val) private pure returns (string memory) {
        return string(
            abi.encodePacked('{"trait_type":"', k, '","value":', LibString.toString(val), "},")
        );
    }

    function _str(string memory k, string memory val) private pure returns (string memory) {
        return string(abi.encodePacked('{"trait_type":"', k, '","value":"', val, '"},'));
    }
}
