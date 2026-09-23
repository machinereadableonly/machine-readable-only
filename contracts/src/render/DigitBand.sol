// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {PathWriter} from "./PathWriter.sol";
import {FrameGeometry} from "./FrameGeometry.sol";

/// @notice The finisher's own number, written round the border in actual 1s
/// and 0s.
///
/// @dev A machine reads the rank off the artwork and a human reads it as
/// writing. In a piece called Machine Readable Only that is the border doing
/// the work rather than decorating it. Colour was the alternative: five inks
/// were rendered at every streak tier and all of them worked, and they lost
/// anyway, because inks are PEERS -- nothing about teal says it is rarer than
/// violet -- so rank had to be read from metadata. A number IS the rank.
///
/// Colour then came back on top of the number rather than instead of it: the
/// five finisher Marks write the digits in gold, silver, bronze, blue and the
/// heart's red. That is not the rejected design returning. The number already
/// carries the rank, so the ink no longer has to, and gold over silver over
/// bronze is a ranking a viewer reads at a glance before reading the digits.
///
/// NO SVG <text>, EVER. A token drawn with a font depends on what the VIEWER
/// has installed: it renders differently in two browsers and may not render at
/// all in ten years. Every digit here is a 3x3 cell bitmap emitted as a path,
/// so the token carries its own letterforms.
///
/// THE `1` HAS A FLAG AND A FOOT. A first draft drew it as a plain vertical
/// bar, and a row of them read as a dotted rule rather than as writing --
/// losing the one thing the idea was for.
///
/// A SQUARE GLYPH IS WHY 3x3 WORKS. A 3-wide, 5-tall glyph needs a step of 4
/// one way and 6 the other, and using 4 for both is what made the side digits
/// collide on the first sheet. At 3x3 one step serves every edge, and the
/// composition closes on all four rather than reading as a caption top and
/// bottom.
///
/// UPRIGHT, NOT ROTATED. A quarter turn per edge gives a clockwise inscription
/// with proper rotational symmetry -- right for a coin or a seal, wrong here,
/// because the bottom edge comes out upside down and reads as a printing error
/// on a screen. Both were rendered and the operator chose upright: it gives up
/// the symmetry for being legible from the one viewpoint this artwork is
/// actually seen from.
///
/// Design: docs/specs/2026-09-20-mro-finisher-marks-design.md section 10k.
library DigitBand {
    uint256 internal constant GW = 3; // a glyph is three cells wide
    uint256 internal constant GH = 3; // and three tall, which is the point
    uint256 internal constant STEP = 4; // three cells and one of space
    uint256 internal constant BITS = 16; // the ordinal, as sixteen binary digits

    /// @dev One gap short of BITS * STEP: the last digit needs no trailing
    /// space, and centring on the TRUE span is what gives every edge equal
    /// margins at both ends.
    uint256 internal constant SPAN = BITS * STEP - (STEP - GW);

    /// @notice The fallback ink: what the band is written in when the token
    /// holds an ordinal but no finisher Mark.
    ///
    /// @dev THE BAND HAS FIVE INKS, and this is not one of them. The number is
    /// written in the ink of the finisher Mark the token was given -- gold,
    /// silver, bronze, blue or the heart's red, chosen by the operator
    /// 2026-09-23 and selected by `MarkRenderer.finisherInk`. The five ARE the
    /// rank, which is why they can be colours at all: colour lost to a number
    /// in section 10k because five inks with nothing ranking them are peers,
    /// and a place ranks them.
    ///
    /// What is still true is what the ink must NOT be. It is not the frame's
    /// fill and not the token's own colour: the frame walks down the tier
    /// ladder as a streak lapses and turns gold under Vessel, and a finisher's
    /// number must not change colour because its holder missed a week. The
    /// Mark is fixed on the day the place is earned, so the band is the one
    /// part of the picture that never moves again.
    ///
    /// `_finish` writes the Mark bit and the ordinal in a single word, so a
    /// token with an ordinal and no Mark cannot exist on chain. This near-black
    /// is what the renderer does when it is handed one anyway -- the spike's
    /// `setMarks` can write it -- and it is the ink every pre-Mark sheet and
    /// every Sepolia token minted before this change already carries.
    ///
    /// Seven characters, like all five of the real inks, so the byte count does
    /// not depend on which one is chosen.
    string internal constant INK = "#2f2f2f";

    /// @dev Three glyph cells and one of air between the digits and the ring.
    uint256 private constant MIN_BAND = (GH + 1) * FrameGeometry.MODULE_UNITS;

    /// @notice How thick the band is, in the common unit.
    ///
    /// @dev A glyph cell is one QR MODULE (9 units), not a frame cell (13).
    /// That is what makes the picture the one the operator approved: at module
    /// size the code block keeps about three fifths of the image.
    ///
    /// The canvas is counted in frame cells, and 13 does not divide 9, so left
    /// alone the digits would land on fractional module coordinates -- which
    /// PathWriter cannot write, because a run is composed in a single 32-byte
    /// word with no room for a decimal point. The band absorbs the remainder:
    /// it grows by up to 8 units, under one module and invisible, and in
    /// exchange the whole band draws in one scaled group with small integer
    /// coordinates.
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
        // typically does: PathWriter's own comment is explicit that a measured
        // figure would let a worst-case pattern write past the end.
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
    /// UPRIGHT means every edge reads the way a reader scans -- left to right
    /// along the top and the bottom, top to bottom down each side -- so no
    /// glyph is ever turned and one bitmap serves all four edges. The rejected
    /// rotated variant cannot come back by accident, because there is no
    /// rotation in this file to reach for.
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
