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

/// @notice What the year rings cost as a token ages, and a ceiling on it.
/// @dev Rings are the only part of the image that grows at all with age, so
/// they are the only part whose cost has to be checked at the far end rather
/// than at a typical value.
///
/// RE-MEASURED 2026-09-06 (2.L2), and both the old table and its conclusion
/// were pre-cap and wrong in both directions. The frame alone, today:
///
///   1 year   242,083 gas   1,344 bytes
///   3 years  257,736 gas   1,464 bytes
///   5 years  279,021 gas   1,631 bytes
///   9 years  311,649 gas   1,879 bytes
///   10 years 320,122 gas   1,941 bytes   <- MAX_RINGS
///   11 years 320,215 gas   1,941 bytes
///   200 yrs  320,289 gas   1,941 bytes
///
/// The gas column jitters by a few tens between runs (the loop's own bookkeeping
/// is inside the window); the BYTE column does not, which is why the assertion
/// below is on bytes.
///
/// The old header said "roughly 6,800 gas and 42 bytes per additional year past
/// the first ten". The true figure past ten is ZERO bytes and a few gas for the
/// arithmetic: rings() clamps at MAX_RINGS, so every year past the tenth draws
/// the identical picture. The old sweep (20, 40, 60, 80) was four measurements
/// of one number.
///
/// So the years below are chosen to straddle the cap rather than to run past
/// it: the interesting rows are 9, 10 and 11, where the growth actually stops.
/// Run with -vv to print the current curve.
contract RingCurveTest is Test {
    /// @dev The frame's share at the cap. It was 1,100,000 against a measured
    /// worst of 320,052 -- a 3.4x slack no regression could ever trip, which
    /// made this file read as a guard on ring cost while guarding nothing.
    /// 360,000 is about 12% of headroom over the measured worst: enough that
    /// ordinary compiler drift does not fail the suite, tight enough that a
    /// change which actually grew the frame would.
    ///
    /// If this ceiling is ever hit, lower FrameRenderer.MAX_RINGS rather than
    /// raising it -- the curve above says what each year costs, so the right cap
    /// can be read straight off it.
    uint256 constant CEILING_AT_CAP = 360_000;

    function test_ringsStayInsideTheirGasShareAtTheCap() public {
        RingCurveHarness h = new RingCurveHarness();
        // Straddling the cap, not running past it: 9 -> 10 is the last year
        // that costs anything, and 11 and 200 are the proof that it is the last.
        uint256[7] memory ringYears = [uint256(1), 3, 5, 9, 10, 11, 200];
        uint256 worst;
        uint256 atCap;
        uint256 farPast;
        for (uint256 i; i < ringYears.length; ++i) {
            TokenView memory v;
            v.level = uint32(365 * ringYears[i]);
            uint256 before = gasleft();
            string memory out = h.paths(v, "#c8102e", "#f4eef0");
            uint256 used = before - gasleft();
            console.log(ringYears[i], used, bytes(out).length);
            assertGt(used, 0, "the call did nothing");
            if (used > worst) worst = used;
            if (ringYears[i] == 10) atCap = bytes(out).length;
            if (ringYears[i] == 200) farPast = bytes(out).length;
        }
        assertLt(worst, CEILING_AT_CAP, "the frame overruns its gas share at the ring cap");
        // THE ASSERTION THE OLD SWEEP WAS MISSING. Four rows past the cap all
        // drew the same picture and nothing said so, so the file could not tell
        // "the cap holds" from "the cap is gone". This is the sentence.
        assertEq(farPast, atCap, "past MAX_RINGS the frame must not grow at all");
        assertGt(atCap, 0, "the ten-ring frame drew nothing");
    }
}
