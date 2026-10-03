// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PathWriter} from "./PathWriter.sol";
import {FrameGeometry} from "./FrameGeometry.sol";

/// @notice The answer band: one square per credited day round three edges, and
/// the finisher's own number along the top in actual 1s and 0s.
///
/// @dev NO SVG <text>: a font depends on what the viewer has installed. Every
/// digit here is a 3x3 cell bitmap emitted as a path, so the token carries its
/// own letterforms.
library DigitBand {
    uint256 internal constant GW = 3; // a glyph is three cells wide
    uint256 internal constant GH = 3; // and three cells tall
    uint256 internal constant STEP = 4; // three cells and one of space
    uint256 internal constant BITS = 16; // the ordinal, as sixteen binary digits

    /// @dev One gap short of BITS * STEP: the last digit needs no trailing
    /// space, and centring on this true span gives every edge equal margins.
    uint256 internal constant SPAN = BITS * STEP - (STEP - GW);

    /// @notice The band's ink before a token finishes, and the fallback for a
    /// place with no finisher Mark.
    /// @dev Once finished, the band takes its finisher Mark's ink
    /// (`MarkRenderer.finisherInk`). Never the frame's fill or the token's own
    /// colour: those move as a streak lapses, and the band must not. Seven
    /// characters, like the five finisher inks, so the byte count does not
    /// depend on which is chosen.
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

    /// @notice The credited day the band appears, with its first side of answers.
    uint32 internal constant FIRST_SIDE = 122;
    /// @dev Answers per side are two lanes of COLS columns.
    uint256 internal constant COLS = 61;

    struct Layout {
        uint256 modules;
        uint256 pad;
        uint256 start;
        uint256 sides;
    }

    /// @notice The band as one path, drawn in QR MODULES: answers on the right,
    /// bottom and left edges as `level` unlocks them, the place on top once finished.
    /// @dev The caller wraps this in a group carrying scale(MODULE_UNITS).
    function path(uint32 ordinal, uint256[2] memory answers, uint32 level, uint256 canvasCells, string memory fill)
        internal
        pure
        returns (string memory)
    {
        if (level < FIRST_SIDE) return "";
        uint256 modules = canvasUnits(canvasCells) / FrameGeometry.MODULE_UNITS;
        Layout memory l =
            Layout(modules, (modules - SPAN) / 2, (modules - COLS) / 2, level >= 365 ? 3 : level / FIRST_SIDE);
        // Bounds: 3 glyph rows x 16 glyphs x 2 runs, 4 side squares per row
        // over COLS rows, and 2 bottom rows of up to COLS runs.
        PathWriter.Buffer memory buf = PathWriter.create(GH * BITS * 2 + 6 * COLS);
        bool lit;
        for (uint256 y; y < modules; ++y) {
            uint256 row = _rowBits(ordinal, answers, y, l);
            if (row != 0) {
                lit = true;
                PathWriter.writeRow(buf, row, modules, 0, y);
            }
        }
        if (!lit) return "";
        return string(abi.encodePacked('<path fill="', fill, '" d="', PathWriter.seal(buf), '"/>'));
    }

    /// @dev Bit `modules - 1 - x` set means x is lit, as PathWriter.writeRow expects.
    function _rowBits(uint32 ordinal, uint256[2] memory answers, uint256 y, Layout memory l)
        private
        pure
        returns (uint256 row)
    {
        uint256 m = l.modules;
        if (ordinal != 0 && y < GH) {
            for (uint256 i; i < BITS; ++i) {
                row |= _glyphRow(_digit(ordinal, i), y) << (m - (l.pad + i * STEP) - GW);
            }
        }
        // Right edge, bits 0..121: x = m - 1 - depth, y = along.
        if (y >= l.start && y < l.start + COLS) {
            uint256 a = y - l.start;
            for (uint256 d = 1; d <= 2; ++d) {
                if (_bit(answers, a * 2 + d - 1)) row |= uint256(1) << d;
            }
        }
        // Bottom edge, bits 122..243: x = m - 1 - along, y = m - 1 - depth.
        if (l.sides >= 2 && (y == m - 2 || y == m - 3)) {
            uint256 d = m - 1 - y;
            for (uint256 a; a < COLS; ++a) {
                if (_bit(answers, FIRST_SIDE + a * 2 + d - 1)) row |= uint256(1) << (l.start + a);
            }
        }
        // Left edge, bits 244..364: x = depth, y = m - 1 - along.
        if (l.sides >= 3 && y <= m - 1 - l.start && y + COLS > m - 1 - l.start) {
            uint256 a = (m - 1 - l.start) - y;
            for (uint256 d = 1; d <= 2; ++d) {
                uint256 p = a * 2 + d - 1;
                if (p < 365 - 2 * FIRST_SIDE && _bit(answers, 2 * FIRST_SIDE + p)) row |= uint256(1) << (m - 1 - d);
            }
        }
    }

    function _bit(uint256[2] memory w, uint256 i) private pure returns (bool) {
        return (w[i >> 8] >> (i & 255)) & 1 == 1;
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
