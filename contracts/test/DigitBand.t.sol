// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {LibString} from "solady/src/utils/LibString.sol";

import {DigitBand} from "../src/render/DigitBand.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";

/// @notice The finisher's digit band, as geometry: the band that makes the
/// canvas divide, the centring, and the glyph bitmaps.
///
/// @dev The design is section 10k of
/// docs/specs/2026-09-20-mro-finisher-marks-design.md, settled by the operator
/// from rendered sheets. Every constant here traces to it.
contract DigitBandTest is Test {
    string constant INK = "#2f2f2f";

    /// @dev Every ring count a token can wear: its own finished-year ring and,
    /// for a child, the echo ring. Spec 10f retired the ten-ring cap this used
    /// to sweep to, so the sweep stops where the piece does.
    uint256 constant MAX_RINGS_DRAWN = 2;

    /// The band exists to make the canvas an exact number of QR modules, so
    /// every digit sits on an integer coordinate inside one scaled group. A
    /// fraction here would need a decimal point, and PathWriter's per-run word
    /// has no room for one -- MAX_RUN_BYTES is 20 and its own comment says
    /// there is no slack.
    function test_everyLegalCanvasBecomesAWholeNumberOfModules() public pure {
        for (uint256 ringCount; ringCount <= MAX_RINGS_DRAWN; ++ringCount) {
            uint256 cells = FrameRenderer.canvas(ringCount);
            uint256 band = DigitBand.bandUnits(cells);
            uint256 units = DigitBand.canvasUnits(cells);

            assertEq(
                units,
                cells * FrameGeometry.CELL_UNITS + 2 * band,
                "the band is the only thing that grows the canvas"
            );
            assertEq(units % FrameGeometry.MODULE_UNITS, 0, "the canvas must divide into whole modules");
            assertGe(band, 27, "the band is never thinner than three glyph cells");
            assertLe(band, 35, "the band never grows by more than a module to get there");
        }
    }

    /// Centring is exact on every canvas, not merely close. It is the property
    /// that took four passes to find: top and right were centred while bottom
    /// and left ran flush from the far corner, so the corners doubled up and
    /// the reading was ambiguous about where an edge began.
    function test_theDigitsCentreExactlyOnEveryCanvas() public pure {
        for (uint256 ringCount; ringCount <= MAX_RINGS_DRAWN; ++ringCount) {
            uint256 modules =
                DigitBand.canvasUnits(FrameRenderer.canvas(ringCount)) / FrameGeometry.MODULE_UNITS;

            assertEq(
                (modules - DigitBand.SPAN) % 2,
                0,
                "the two margins must be equal, so the span must centre exactly"
            );
            assertGe(modules, DigitBand.SPAN + 2, "sixteen digits must fit along the edge with a margin");
        }
    }

    /// One ring is the canvas a finished token actually has, so its numbers are
    /// pinned rather than merely derived.
    function test_theOneRingCanvasIsTheWorkedExample() public pure {
        uint256 cells = FrameRenderer.canvas(1);
        assertEq(cells, 53, "one ring is a 53 cell canvas");
        assertEq(DigitBand.bandUnits(cells), 29, "the band is 29 units there");
        assertEq(DigitBand.canvasUnits(cells), 747, "which makes the canvas 747 units");
        assertEq(
            DigitBand.canvasUnits(cells) / FrameGeometry.MODULE_UNITS, 83, "that is 83 modules exactly"
        );
    }

    /// THE TWO SIZES THAT DECODE, pinned because they were measured, not
    /// derived. Which pixel widths a crisp rasteriser can read depends on the
    /// image's size in modules alone, and the old band made a finished founding
    /// token 85 modules -- a size at which every token measured failed at
    /// 350px, a width robust-solve guarantees, under all eight masks. 83 and 89
    /// clear every gate width on all twelve tokens tested (2026-09-26). A change
    /// here must be re-measured with tools/echo-decode-check.mjs, not reasoned.
    function test_aFinishedTokenIsASizeThatDecodes() public pure {
        assertEq(
            DigitBand.canvasUnits(FrameRenderer.canvas(1)) / FrameGeometry.MODULE_UNITS,
            83,
            "a finished founding token is 83 modules, never the 85 that failed at 350px"
        );
        assertEq(
            DigitBand.canvasUnits(FrameRenderer.canvas(2)) / FrameGeometry.MODULE_UNITS,
            89,
            "a finished child is 89 modules"
        );
    }

    function test_anOrdinalOfZeroDrawsNothing() public pure {
        assertEq(
            bytes(DigitBand.path(0, FrameRenderer.canvas(1), INK)).length,
            0,
            "a token with no ordinal is not a finisher and carries no band"
        );
    }

    /// 83 modules, span 63, pad 10, last 80. The four edges put a glyph cell at
    /// each of those, and nothing else in the picture ever reaches them: the
    /// band is drawn in its own group, outside everything.
    function test_anOrdinalDrawsAllFourEdges() public pure {
        string memory p = DigitBand.path(1, FrameRenderer.canvas(1), INK);

        assertGt(bytes(p).length, 0, "a finisher carries a band");
        assertTrue(LibString.contains(p, "M10 0"), "the top edge starts at the pad");
        assertTrue(LibString.contains(p, " 80"), "the bottom edge sits on the last module row");
        assertTrue(LibString.contains(p, "M80 "), "the right edge sits on the last module column");
        assertTrue(LibString.contains(p, "M0 "), "the left edge sits on column zero");
    }

    /// The glyphs are the ones on the approved sheet. A `1` drawn as a plain
    /// bar read as a dotted rule rather than as writing, which lost the one
    /// thing the idea is for -- so the `1` carries a flag and a foot, and it
    /// therefore holds LESS ink than a `0`. An ordinal of all 1s must draw less
    /// than one that alternates.
    function test_theGlyphsAreTheApprovedBitmaps() public pure {
        uint256 cells = FrameRenderer.canvas(1);
        string memory ones = DigitBand.path(0xFFFF, cells, INK);
        string memory mixed = DigitBand.path(0xAAAA, cells, INK);

        assertGt(
            bytes(mixed).length,
            bytes(ones).length,
            "a 0 carries more ink than a 1, so an alternating ordinal draws more than all ones"
        );
    }

    /// Two finishers must be visibly different objects. That is the whole
    /// reason a number beat a colour: five inks were peers, and a number is a
    /// rank.
    function test_twoFinishersDrawDifferentBands() public pure {
        uint256 cells = FrameRenderer.canvas(1);

        assertTrue(
            keccak256(bytes(DigitBand.path(1, cells, INK)))
                != keccak256(bytes(DigitBand.path(365, cells, INK))),
            "the ring IS the rank"
        );
    }
}
