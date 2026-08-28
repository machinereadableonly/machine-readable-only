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
/// @dev Rings are the only part of the image that grows without bound until the
/// cap, so they are the only part whose cost has to be checked at the far end
/// rather than at a typical value. Measured 2026-08-28, the frame alone:
///
///   1 year   452,160 gas   2,676 bytes
///   10 years 535,550 gas   3,222 bytes
///   40 years 726,274 gas   4,313 bytes
///   80 years 997,185 gas   5,938 bytes
///
/// Roughly 6,800 gas and 42 bytes per additional year past the first ten. Run
/// with -vv to print the current curve.
contract RingCurveTest is Test {
    /// @dev The frame's share at the cap. The whole tokenURI has 2,000,000, the
    /// code block takes about 692,000 of it, and the JSON and base64 wrapper are
    /// still to be measured in Task 7. If this ceiling is ever hit, lower
    /// FrameRenderer.MAX_RINGS rather than raising it -- the curve above says what
    /// each year costs, so the right cap can be read straight off it.
    uint256 constant CEILING_AT_CAP = 1_100_000;

    function test_ringsStayInsideTheirGasShareAtTheCap() public {
        RingCurveHarness h = new RingCurveHarness();
        uint256[8] memory ringYears = [uint256(1), 3, 5, 10, 20, 40, 60, 80];
        uint256 worst;
        for (uint256 i; i < ringYears.length; ++i) {
            TokenView memory v;
            v.level = uint32(365 * ringYears[i]);
            uint256 before = gasleft();
            string memory out = h.paths(v, "#c8102e", "#f4eef0");
            uint256 used = before - gasleft();
            console.log(ringYears[i], used, bytes(out).length);
            assertGt(used, 0, "the call did nothing");
            if (used > worst) worst = used;
        }
        assertLt(worst, CEILING_AT_CAP, "the frame overruns its gas share at the ring cap");
    }
}
