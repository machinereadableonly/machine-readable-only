// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibString} from "solady/src/utils/LibString.sol";

import {HeartMask} from "./HeartMask.sol";

/// @notice The QR's three finder patterns -- the "eyes" -- reshaped and erased
/// to ground before being redrawn on top of everything else.
///
/// @dev A QR puts the finder patterns at the same three module coordinates for
/// every token, so nothing here depends on per-token data: the whole overlay is
/// nine shapes at positions derived from one runtime number, the code offset.
///
/// Reshaping erases the 7x7 and draws something else there, so the 1:1:3:1:1
/// ratio a scanner looks for along a line through an eye is genuinely at risk.
/// Any change to a shape must be decode-tested, not judged by eye:
/// `tools/eye-shape-sheet.mjs` and `tools/tint-on-green-sheet.mjs`.
library EyeRenderer {
    /// @notice The three eyes, reshaped, at the three fixed finder-pattern
    /// positions relative to `codeOff`.
    /// @param codeOff where the code's modules start, in cells -- the block
    /// offset plus the quiet zone.
    /// @param shape 0 target (concentric circles), 1 squircle (rounded
    /// rects), 2 leaf (two opposite corners rounded).
    /// @param ink the colour the eyes are drawn in.
    /// @param ground the colour actually under the code block: HUSH_QUIET
    /// when Hush is worn, otherwise the field, which Aura tints. NEVER a
    /// constant -- a white constant would punch a white square into a tinted
    /// page.
    function eyes(uint256 codeOff, uint8 shape, string memory ink, string memory ground)
        internal
        pure
        returns (string memory out)
    {
        uint256 s = HeartMask.SIZE;
        // Top-left, top-right, bottom-left. There is no fourth finder pattern.
        uint256[3] memory xs = [uint256(0), s - 7, uint256(0)];
        uint256[3] memory ys = [uint256(0), uint256(0), s - 7];

        for (uint256 i = 0; i < 3; i++) {
            uint256 x = codeOff + xs[i];
            uint256 y = codeOff + ys[i];
            out = string(
                abi.encodePacked(out, _erase(x, y, ground), _shape(shape, x, y, ink, ground))
            );
        }
    }

    /// @dev Erase the 7x7 finder pattern to the ground before redrawing.
    function _erase(uint256 x, uint256 y, string memory ground)
        private
        pure
        returns (string memory)
    {
        return string(
            abi.encodePacked(
                '<rect x="', LibString.toString(x), '" y="', LibString.toString(y),
                '" width="7" height="7" fill="', ground, '"/>'
            )
        );
    }

    function _shape(uint8 shape, uint256 x, uint256 y, string memory ink, string memory ground)
        private
        pure
        returns (string memory)
    {
        if (shape == 1) return _squircle(x, y, ink, ground);
        if (shape == 2) return _leaf(x, y, ink, ground);
        return _target(x, y, ink, ground);
    }

    /// @dev Concentric circles, r 3.5 / 2.5 / 1.5, all three sharing one centre.
    /// That centre is offset by 7/2, which is not an integer, so the half is
    /// written as a fixed ".5" rather than computed.
    function _target(uint256 x, uint256 y, string memory ink, string memory ground)
        private
        pure
        returns (string memory)
    {
        string memory cx = string(abi.encodePacked(LibString.toString(x + 3), ".5"));
        string memory cy = string(abi.encodePacked(LibString.toString(y + 3), ".5"));
        return string(
            abi.encodePacked(
                '<circle cx="', cx, '" cy="', cy, '" r="3.5" fill="', ink, '"/>',
                '<circle cx="', cx, '" cy="', cy, '" r="2.5" fill="', ground, '"/>',
                '<circle cx="', cx, '" cy="', cy, '" r="1.5" fill="', ink, '"/>'
            )
        );
    }

    /// @dev Rounded rects, rx 3 / 2.1 / 1.5.
    function _squircle(uint256 x, uint256 y, string memory ink, string memory ground)
        private
        pure
        returns (string memory)
    {
        string memory xs = LibString.toString(x);
        string memory ys = LibString.toString(y);
        string memory x1 = LibString.toString(x + 1);
        string memory y1 = LibString.toString(y + 1);
        string memory x2 = LibString.toString(x + 2);
        string memory y2 = LibString.toString(y + 2);
        return string(
            abi.encodePacked(
                '<rect x="', xs, '" y="', ys, '" width="7" height="7" rx="3" fill="', ink, '"/>',
                '<rect x="', x1, '" y="', y1, '" width="5" height="5" rx="2.1" fill="', ground, '"/>',
                '<rect x="', x2, '" y="', y2, '" width="3" height="3" rx="1.5" fill="', ink, '"/>'
            )
        );
    }

    /// @dev Two opposite corners rounded, r 2.6 / 1.8 / 1.3. Solidity has no
    /// fractional arithmetic, so every decimal here is built as a string
    /// rather than computed: `x + 2.6` is `toString(x + 2)` with a literal
    /// ".6" appended. The offsets are chosen so that no running offset
    /// (x + 2.6, x + 1 + 1.8, x + 2 + 1.3) produces a fractional part other
    /// than the one already in the literal.
    function _leaf(uint256 x, uint256 y, string memory ink, string memory ground)
        private
        pure
        returns (string memory)
    {
        string memory ys = LibString.toString(y);
        string memory y1 = LibString.toString(y + 1);
        string memory y2 = LibString.toString(y + 2);
        string memory outerX = string(abi.encodePacked(LibString.toString(x + 2), ".6"));
        string memory midX = string(abi.encodePacked(LibString.toString(x + 2), ".8"));
        string memory innerX = string(abi.encodePacked(LibString.toString(x + 3), ".3"));
        return string(
            abi.encodePacked(
                '<path fill="', ink, '" d="M', outerX, ' ', ys,
                'h4.4v4.4a2.6 2.6 0 0 1 -2.6 2.6h-4.4v-4.4a2.6 2.6 0 0 1 2.6 -2.6z"/>',
                '<path fill="', ground, '" d="M', midX, ' ', y1,
                'h3.2v3.2a1.8 1.8 0 0 1 -1.8 1.8h-3.2v-3.2a1.8 1.8 0 0 1 1.8 -1.8z"/>',
                '<path fill="', ink, '" d="M', innerX, ' ', y2,
                'h1.7v1.7a1.3 1.3 0 0 1 -1.3 1.3h-1.7v-1.7a1.3 1.3 0 0 1 1.3 -1.3z"/>'
            )
        );
    }
}
