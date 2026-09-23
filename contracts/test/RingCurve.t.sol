// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";
import {TokenView} from "../src/render/TokenView.sol";

contract RingCurveHarness {
    function paths(TokenView memory v, string memory colour, string memory ghostFill)
        external
        pure
        returns (string memory)
    {
        return FrameRenderer.paths(v, colour, ghostFill);
    }
}

/// @notice What the rings cost, and a ceiling on it.
/// @dev Rings were the only part of the image that grew with age, so they were
/// the only part whose cost had to be checked at the far end rather than at a
/// typical value. Spec 10f ended the year at 365 and with it the growth: a
/// token draws one ring when it finishes, a child draws one more for the line
/// it came from, and that is every ring the piece can produce. The far end is
/// now two rings away rather than two hundred years away.
///
/// The curve this file used to carry ran 1, 3, 5, 9, 10, 11 and 200 years of
/// FOUNDING token and topped out at 320,122 gas / 1,941 bytes. None of those
/// states exists any more, and the ones that replace them are:
///
///   1 ring    242,764 gas   1,344 bytes   a finished founding token
///   2 rings   324,575 gas   2,096 bytes   a finished child, the widest canvas
///
/// The second row is dearer than the old ten-ring worst case looked, and the
/// reason is not that rings got dearer: the old sweep measured founding tokens
/// only, so the dashed echo ring -- 54 runs, the single most expensive element
/// in the frame -- was never in it. The solid rings themselves got much
/// cheaper.
///
/// The gas column jitters by a few tens between runs (the loop's own
/// bookkeeping is inside the window); the BYTE column does not, which is why
/// the second assertion is on bytes. Run with -vv to print the current curve.
contract RingCurveTest is Test {
    /// @dev The frame's share at the widest canvas. Unchanged at 360,000: it was
    /// about 12% of headroom over a measured worst of 320,052 and it is about
    /// 11% over today's 324,575. Enough that ordinary compiler drift does not
    /// fail the suite, tight enough that a change which actually grew the frame
    /// would.
    ///
    /// If this ceiling is ever hit, make the echo ring cheaper rather than
    /// raising it -- the curve above says what each ring costs, and the dash is
    /// where the money is.
    uint256 constant CEILING_AT_WIDEST = 360_000;

    function test_ringsStayInsideTheirGasShareAtTheWidestCanvas() public {
        RingCurveHarness h = new RingCurveHarness();

        // WARM THE HARNESS FIRST. Whichever call is made first pays the cold
        // account access, which is about 4,500 gas -- measured, a part-year row
        // in first position read 359,184 against a whole frame's 242,764, and
        // most of that gap was position rather than picture.
        TokenView memory warm;
        warm.level = 1;
        h.paths(warm, "#c8102e", "#f4eef0");

        // level, echo: a finished founding token, then a finished child. Both
        // frames are WHOLE, so the only difference between them is the rings.
        uint32[2] memory echoes = [uint32(0), 3650];
        uint256 worst;
        uint256 oneRing;
        uint256 twoRings;
        for (uint256 i; i < echoes.length; ++i) {
            TokenView memory v;
            v.level = 365;
            v.echo = echoes[i];
            uint256 before = gasleft();
            string memory out = h.paths(v, "#c8102e", "#f4eef0");
            uint256 used = before - gasleft();
            console.log(FrameRenderer.rings(v.level, v.echo), used, bytes(out).length);
            assertGt(used, 0, "the call did nothing");
            if (used > worst) worst = used;
            if (i == 0) oneRing = bytes(out).length;
            else twoRings = bytes(out).length;
        }
        assertLt(worst, CEILING_AT_WIDEST, "the frame overruns its gas share at the widest canvas");

        // THE ASSERTION THE OLD SWEEP WAS MISSING, kept in the shape the new
        // range allows: without it this file could not tell "the cap holds"
        // from "the cap is gone". The echo ring is real ink, so the child's
        // frame must be LARGER than the founding token's -- and a `ringBudget`
        // that had stopped capping would not show up here at all, which is why
        // the cap itself is asserted directly beside it.
        assertGt(twoRings, oneRing, "the echo ring must draw something");
        assertEq(FrameRenderer.rings(365 * 200, 0), 1, "a level past the end must not grow the frame");
    }
}
