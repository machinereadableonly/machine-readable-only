// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PathWriter} from "./PathWriter.sol";
import {FrameGeometry} from "./FrameGeometry.sol";

/// @notice The finisher's own number, written round the border in actual 1s
/// and 0s.
///
/// @dev NO SVG <text>: a font depends on what the viewer has installed. Every
/// digit here is a 3x3 cell bitmap emitted as a path, so the token carries its
/// own letterforms. The glyph is square so a single STEP serves all four edges,
/// and every edge is upright rather than rotated a quarter turn per side.
library DigitBand {
    uint256 internal constant GW = 3; // a glyph is three cells wide
    uint256 internal constant GH = 3; // and three cells tall
    uint256 internal constant STEP = 4; // three cells and one of space
    uint256 internal constant BITS = 16; // the ordinal, as sixteen binary digits

    /// @dev One gap short of BITS * STEP: the last digit needs no trailing
    /// space, and centring on this true span gives every edge equal margins.
    uint256 internal constant SPAN = BITS * STEP - (STEP - GW);

    /// @notice The fallback ink: what the band is written in when the token
    /// holds an ordinal but no finisher Mark.
    ///
    /// @dev The band normally has one of five inks -- gold, silver, bronze,
    /// blue or the heart's red -- selected by `MarkRenderer.finisherInk`. This
    /// near-black is only what the renderer draws when it is handed an ordinal
    /// with no Mark, which `_finish` cannot produce: it writes the Mark bit and
    /// the ordinal in a single word.
    ///
    /// The ink must never be the frame's fill or the token's own colour. Those
    /// walk down the tier ladder as a streak lapses, and a finisher's number
    /// must not change colour because its holder missed a week.
    ///
    /// Seven characters, like all five of the real inks, so the byte count does
    /// not depend on which one is chosen.
    string internal constant INK = "#2f2f2f";

    /// @dev Three glyph cells, and no row of air: `bandUnits` then pads by up
    /// to 8 units, which is all that separates the digits from the ring.
    ///
    /// This sets the image's size in modules, and that size alone decides which
    /// pixel widths a crisp rasteriser can decode -- not the digits, not the
    /// bitmap. `GH + 1` puts a finished token at a size that fails to decode at
    /// widths a robust solve is supposed to guarantee. Re-measure before
    /// changing it: tools/echo-decode-check.mjs.
    uint256 private constant MIN_BAND = GH * FrameGeometry.MODULE_UNITS;

    /// @notice How thick the band is, in the common unit.
    ///
    /// @dev A glyph cell is one QR MODULE (9 units), not a frame cell (13).
    /// The canvas is counted in frame cells and 13 does not divide 9, so the
    /// band absorbs the remainder by growing up to 8 units. Without that the
    /// digits would land on fractional module coordinates, which PathWriter
    /// cannot write: a run is composed in a single 32-byte word with no room
    /// for a decimal point.
    function bandUnits(uint256 canvasCells) internal pure returns (uint256) {
        uint256 band = MIN_BAND;
        while (
            (canvasCells * FrameGeometry.CELL_UNITS + 2 * band) % FrameGeometry.MODULE_UNITS != 0
        ) {
            unchecked {
                ++band;
            }
        }
        return band;
    }

    /// @notice The whole canvas, in the common unit, band included.
    function canvasUnits(uint256 canvasCells) internal pure returns (uint256) {
        return canvasCells * FrameGeometry.CELL_UNITS + 2 * bandUnits(canvasCells);
    }

    /// @notice The band as one path, drawn in QR MODULES.
    ///
    /// @param ordinal the finisher's number; 0 means the token is not a
    /// finisher and nothing is drawn at all.
    /// @param canvasCells the canvas WITHOUT the band, in frame cells.
    /// @param fill the ink.
    ///
    /// @dev The caller wraps this in a group carrying scale(MODULE_UNITS).
    function path(uint32 ordinal, uint256 canvasCells, string memory fill)
        internal
        pure
        returns (string memory)
    {
        if (ordinal == 0) return "";

        uint256 modules = canvasUnits(canvasCells) / FrameGeometry.MODULE_UNITS;
        uint256 pad = (modules - SPAN) / 2;
        uint256 last = modules - GW;

        // Two runs is the most a three-cell glyph row can take (101), so six is
        // the most one glyph contributes, and sixty-four glyphs bound the
        // buffer at 384. Sized to what the geometry CAN produce, not to what it
        // typically does.
        PathWriter.Buffer memory buf = PathWriter.create(4 * BITS * 2 * GH);

        // Every row of the canvas that carries any digit, top to bottom.
        for (uint256 y; y < modules; ++y) {
            uint256 row = _rowBits(ordinal, y, modules, pad, last);
            if (row != 0) PathWriter.writeRow(buf, row, modules, 0, y);
        }

        return string(
            abi.encodePacked('<path fill="', fill, '" d="', PathWriter.seal(buf), '"/>')
        );
    }

    /// @dev Which cells of canvas row `y` the four edges light, packed the way
    /// PathWriter.writeRow expects: bit `modules - 1 - x` set means x is lit.
    ///
    /// Every edge reads the way a reader scans -- left to right along the top
    /// and the bottom, top to bottom down each side -- so no glyph is ever
    /// turned and one bitmap serves all four edges.
    function _rowBits(uint32 ordinal, uint256 y, uint256 modules, uint256 pad, uint256 last)
        private
        pure
        returns (uint256 row)
    {
        // The top and the bottom edges: sixteen glyphs along the row, whenever
        // `y` falls inside either band.
        if (y < GH || y >= last) {
            uint256 r = y < GH ? y : y - last;
            for (uint256 i; i < BITS; ++i) {
                row |= _glyphRow(_digit(ordinal, i), r) << (modules - (pad + i * STEP) - GW);
            }
        }

        // The left and the right edges: one glyph row from each, whenever `y`
        // falls inside a side glyph rather than in the space between two.
        if (y >= pad && y < pad + SPAN) {
            uint256 off = y - pad;
            if (off % STEP < GH) {
                uint256 g = _glyphRow(_digit(ordinal, off / STEP), off % STEP);
                row |= g << (modules - GW); // the left edge, at x = 0
                row |= g << (modules - last - GW); // the right edge, at x = last
            }
        }
    }

    /// @dev Row `r` of the glyph for `d`, as GW bits, high bit leftmost.
    ///   0 -> 111 101 111        1 -> 110 010 111
    function _glyphRow(uint256 d, uint256 r) private pure returns (uint256) {
        if (d == 0) return r == 1 ? 5 : 7; // 101 between two 111
        if (r == 0) return 6; // 110, the flag
        if (r == 1) return 2; // 010, the stem
        return 7; // 111, the foot
    }

    /// @dev Digit `i` of the ordinal, most significant first.
    function _digit(uint32 ordinal, uint256 i) private pure returns (uint256) {
        return (uint256(ordinal) >> (BITS - 1 - i)) & 1;
    }
}
