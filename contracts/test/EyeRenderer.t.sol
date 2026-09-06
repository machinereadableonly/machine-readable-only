// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {EyeRenderer} from "../src/render/EyeRenderer.sol";
import {HeartMask} from "../src/render/HeartMask.sol";

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

    /// @notice The three finder patterns are where the QR specification says
    /// they are, and there is no fourth.
    ///
    /// @dev Every other test in this file counts elements or checks a byte
    /// band, so all three eyes could have been drawn on top of each other at
    /// (0,0) and the counts would be identical. Position is what makes a QR
    /// decodable: a finder pattern in the wrong cell is not a stylistic
    /// difference, it is an unscannable token, permanently, because the code
    /// is written once at mint and never rewritten.
    ///
    /// Positions were covered only transitively, by the three Iris cases in
    /// RenderFixture -- which would go red for any change at all and never say
    /// that the eyes had moved.
    ///
    /// The origins are top-left (0,0), top-right (SIZE-7, 0) and bottom-left
    /// (0, SIZE-7), each offset by `codeOff`. Asserted through the erase rect,
    /// which every shape emits at the eye's own origin.
    function test_theThreeEyesSitAtTheFinderPatternOrigins() public pure {
        uint256 off = 6;
        uint256 far = off + HeartMask.SIZE - 7;
        string memory out = EyeRenderer.eyes(off, 0, "#c8102e", "#ffffff");

        assertEq(_count(out, _rectAt(off, off)), 1, "top-left eye");
        assertEq(_count(out, _rectAt(far, off)), 1, "top-right eye");
        assertEq(_count(out, _rectAt(off, far)), 1, "bottom-left eye");
        assertEq(_count(out, _rectAt(far, far)), 0, "a QR has no fourth finder pattern");
    }

    /// @dev The offset is not decoration: the eyes must track the code block as
    /// the frame grows a ring, or they drift off the modules they are covering.
    /// Two offsets, so a hard-coded position cannot pass.
    function test_theEyesMoveWithTheCodeOffset() public pure {
        string memory near = EyeRenderer.eyes(6, 0, "#c8102e", "#ffffff");
        string memory far = EyeRenderer.eyes(24, 0, "#c8102e", "#ffffff");

        assertEq(_count(near, _rectAt(6, 6)), 1);
        assertEq(_count(near, _rectAt(24, 24)), 0, "the near eyes must not sit at the far offset");

        assertEq(_count(far, _rectAt(24, 24)), 1);
        assertEq(_count(far, _rectAt(6, 6)), 0, "the far eyes must not sit at the near offset");
    }

    /// @dev Every shape erases at the same three origins, so a squircle or a
    /// leaf cannot quietly draw somewhere else.
    ///
    /// Matches the COMPLETE erase rect rather than its opening, because the
    /// squircle's own outer rect is also 7x7 at the same origin -- it carries
    /// `rx="3"` and the ink, where the erase carries the ground and no radius.
    /// The first draft of this test asserted the opening alone and read the
    /// squircle as a duplicate eye, which is the distinction worth keeping.
    function test_everyShapeErasesAtTheSameThreeOrigins() public pure {
        uint256 off = 6;
        uint256 far = off + HeartMask.SIZE - 7;
        for (uint8 shape = 0; shape < 3; shape++) {
            string memory out = EyeRenderer.eyes(off, shape, "#c8102e", "#fdf3e3");
            assertEq(_count(out, _eraseAt(off, off, "#fdf3e3")), 1, "top-left");
            assertEq(_count(out, _eraseAt(far, off, "#fdf3e3")), 1, "top-right");
            assertEq(_count(out, _eraseAt(off, far, "#fdf3e3")), 1, "bottom-left");
            assertEq(_count(out, _eraseAt(far, far, "#fdf3e3")), 0, "no fourth finder pattern");
        }
    }

    /// @dev The complete erase rect at one origin: 7x7, the ground, no radius.
    function _eraseAt(uint256 x, uint256 y, string memory ground)
        internal
        pure
        returns (string memory)
    {
        return string.concat(_rectAt(x, y), ' fill="', ground, '"/>');
    }

    /// @dev The opening of the 7x7 erase rect at one origin. Includes the width
    /// so it cannot match some other rect that happens to start there.
    function _rectAt(uint256 x, uint256 y) internal pure returns (string memory) {
        return string.concat(
            '<rect x="', vm.toString(x), '" y="', vm.toString(y), '" width="7" height="7"'
        );
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