// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";

/// @notice The echo ring: the days a token's line had already run when it was
/// seeded, drawn as one dotted ring at the core of the ghost fill.
///
/// @dev The arithmetic pins here are the cheap half. The expensive half is the
/// cross-language one: `test_theEchoRingMatchesTheJavaScriptByteForByte` holds
/// the exact bytes `tools/render-token.mjs`'s `echoRingBars` produces, so the
/// two renderers cannot drift on the dotted ring even though the render matrix
/// has no echo-bearing case in it. Regenerate both pins together with
/// `node tools/echo-ring-fixture.mjs` if the path format ever changes.
contract EchoRingTest is MroTestBase {
    /// The property that protects every existing token.
    function test_aFoundingTokenIsDrawnExactlyAsBefore() public pure {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(3650, 0);
        assertEq(own, 10, "ten own rings, unchanged");
        assertEq(echo, 0, "and no echo ring");
        assertEq(FrameRenderer.rings(3650, 0), 10);
    }

    /// A child gives up one slot, permanently.
    function test_aChildsOwnRingsCapAtNine() public pure {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(3650, 365);
        assertEq(own, 9, "nine of its own");
        assertEq(echo, 1, "plus the echo ring");
        assertEq(FrameRenderer.rings(3650, 365), 10, "never more than ten");
    }

    /// A newborn child is one ring, not zero.
    function test_aNewbornChildHasOnlyTheEchoRing() public pure {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(1, 365);
        assertEq(own, 0);
        assertEq(echo, 1);
        assertEq(FrameRenderer.canvas(1), 53, "canvas 53 at one ring");
    }

    /// One echo day is as much an echo as a thousand: the ring is a fact about
    /// the line existing, not a measure of how long it ran.
    function test_oneEchoDayIsEnoughToTakeTheSlot() public pure {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(3650, 1);
        assertEq(own, 9);
        assertEq(echo, 1);
    }

    /// The constant that makes the cost predictable.
    function test_theEchoRingIsAlways53CellsOnASide() public pure {
        for (uint32 y = 1; y <= 10; y++) {
            uint256 total = FrameRenderer.rings(y * 365, 365);
            uint256 size = FrameRenderer.canvas(total);
            uint256 o = 2 * (total - 1);
            assertEq(size - 2 * o, 53, "the depth cancels at every ring count");
        }
    }

    /// The drawn output: dotted, in the ghost element, 104 dots.
    function test_theEchoRingDrawsAsOneHundredAndFourDots() public pure {
        bytes memory d = FrameRenderer.echoRingBars(0, 53);
        assertEq(_countRuns(d), 104, "27 + 27 + 25 + 25");
    }

    /// A dot per side is (len + 1) / 2 on the horizontals and (len - 1) / 2 on
    /// the verticals, whose corners are already drawn. Held on a short ring so
    /// the whole string is readable, and mirrored verbatim in
    /// tools/test/echo-ring.test.mjs.
    function test_theEchoRingMatchesTheJavaScriptByteForByte() public pure {
        assertEq(
            string(FrameRenderer.echoRingBars(0, 9)),
            "M0 0h1v1h-1zM0 8h1v1h-1zM2 0h1v1h-1zM2 8h1v1h-1zM4 0h1v1h-1zM4 8h1v1h-1z"
            "M6 0h1v1h-1zM6 8h1v1h-1zM8 0h1v1h-1zM8 8h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1z"
            "M0 4h1v1h-1zM8 4h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1z",
            "the short ring, in full"
        );

        // The real ones are 1,386 and 1,456 bytes, too long to read, so
        // they are held by hash. The same hashes are asserted in
        // tools/test/echo-ring.test.mjs against the JavaScript's own output,
        // which is what makes this a differential rather than a
        // self-consistency check.
        bytes memory d = FrameRenderer.echoRingBars(0, 53);
        assertEq(d.length, 1386, "a newborn child's echo ring");
        assertEq(
            keccak256(d),
            0x1e94a853465cdc221019c2f535613bb2b5382b538e57ed7f758bab68f76961aa,
            "byte for byte with the JavaScript"
        );

        // And at the other extreme: a child at the cap draws the same 104 dots
        // one slot deeper, where every coordinate is two digits.
        bytes memory deep = FrameRenderer.echoRingBars(2 * 9, 53);
        assertEq(_countRuns(deep), 104);
        assertEq(deep.length, 1456, "the deepest echo ring, all two-digit");
        assertEq(
            keccak256(deep),
            0x42c520135d88294bc8feb6c15db972f1d48e84efdd3fd7df11f1d720ac64a046,
            "byte for byte at the cap too"
        );
    }

    /// The ring is drawn at the depth the innermost slot sits at, whatever the
    /// token's own ring count, and it never overlaps a solid ring.
    function test_theEchoRingSitsInsideEveryEarnedRing() public pure {
        (uint256 own,) = FrameRenderer.ringBudget(3650, 365);
        uint256 size = FrameRenderer.canvas(FrameRenderer.rings(3650, 365));
        // The innermost SOLID ring is at depth 2 * (own - 1), so the echo ring
        // at depth 2 * own is one slot further in with the usual one-cell gap.
        // Only the side length is worth asserting: the depth relation is
        // arithmetic on two constants and would hold whatever the renderer did.
        assertEq(size - 2 * (2 * own), 53, "and it is still 53 on a side");
    }

    /// A ring too small to have edges draws nothing rather than looping
    /// forever on an unsigned underflow.
    function test_aRingUnderTwoCellsDrawsNothing() public pure {
        assertEq(FrameRenderer.echoRingBars(0, 0).length, 0);
        assertEq(FrameRenderer.echoRingBars(7, 1).length, 0);
        assertEq(FrameRenderer.echoRingBars(0, 2).length, 24, "two cells is two dots");
    }

    /// @dev Counts the runs in a path string: one "M" starts each one.
    function _countRuns(bytes memory d) private pure returns (uint256 n) {
        for (uint256 i; i < d.length; ++i) {
            if (d[i] == "M") ++n;
        }
    }
}
