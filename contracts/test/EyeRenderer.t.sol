// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {EyeRenderer} from "../src/render/EyeRenderer.sol";

contract EyeRendererTest is Test {
    function test_theTargetShapeMatchesTheMeasuredPrototype() public pure {
        string memory out = EyeRenderer.eyes(6, 0, "#c8102e", "#ffffff");
        // Nine elements for three eyes: an erase and three circles each.
        assertEq(_count(out, "<circle"), 9);
        assertEq(_count(out, "<rect"), 3);
        // 635 bytes in tools/eye-shape-sheet.mjs at this offset. The two are
        // written independently, so a wide divergence means one is drawing
        // something different.
        assertGt(bytes(out).length, 500);
        assertLt(bytes(out).length, 800);
    }

    function test_theEraseTakesTheGroundAndNeverAConstant() public pure {
        string memory out = EyeRenderer.eyes(6, 0, "#c8102e", "#fdf3e3");
        assertEq(_count(out, "#fdf3e3"), 6, "erase and inner ring must both use the ground");
        assertEq(_count(out, "#ffffff"), 0, "a white constant leaked into a tinted token");
    }

    function test_allThreeShapesDraw() public pure {
        for (uint8 s = 0; s < 3; s++) {
            assertGt(bytes(EyeRenderer.eyes(6, s, "#c8102e", "#ffffff")).length, 400);
        }
    }

    /// @dev Non-overlapping substring count. Written out rather than imported:
    /// LibString has no counter, and a test helper that needs a dependency is a
    /// test helper nobody reads.
    function _count(string memory hay, string memory needle) internal pure returns (uint256 n) {
        bytes memory h = bytes(hay);
        bytes memory k = bytes(needle);
        if (k.length == 0 || k.length > h.length) return 0;
        for (uint256 i = 0; i + k.length <= h.length; ) {
            bool hit = true;
            for (uint256 j = 0; j < k.length; ++j) {
                if (h[i + j] != k[j]) { hit = false; break; }
            }
            if (hit) { n += 1; i += k.length; } else { i += 1; }
        }
    }
}
