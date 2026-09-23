// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";

/// @notice The echo ring: the days a token's line had already run when it was
/// seeded, drawn as one dashed ring at the core of the ghost fill.
///
/// @dev The arithmetic pins here are the cheap half. The expensive half is the
/// cross-language one: `test_theEchoRingMatchesTheJavaScriptByteForByte` holds
/// the exact bytes `tools/render-token.mjs`'s `echoRingBars` produces, so the
/// two renderers cannot drift on the dashed ring even though the render matrix
/// has no echo-bearing case in it. Regenerate both pins together with
/// `node tools/echo-ring-fixture.mjs` if the path format ever changes.
contract EchoRingTest is MroTestBase {
    /// A founding token draws its own ring and nothing else.
    function test_aFoundingTokenDrawsNoEchoRing() public pure {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(365, 0);
        assertEq(own, 1, "the ring for the year it finished");
        assertEq(echo, 0, "and no echo ring");
        assertEq(FrameRenderer.rings(365, 0), 1);
    }

    /// A child adds a ring rather than sharing one: since Spec 10f there is
    /// only ever one own ring, so there is nothing to share.
    function test_aFinishedChildDrawsTwoRings() public pure {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(365, 365);
        assertEq(own, 1, "its own finished year");
        assertEq(echo, 1, "plus the echo ring");
        assertEq(FrameRenderer.rings(365, 365), 2, "never more than two");
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
    function test_oneEchoDayIsEnoughToDrawTheRing() public pure {
        (uint256 own, uint256 echo) = FrameRenderer.ringBudget(365, 1);
        assertEq(own, 1);
        assertEq(echo, 1);
    }

    /// The constant that makes the cost predictable.
    function test_theEchoRingIsAlways53CellsOnASide() public pure {
        // Both ring counts a child can have: the echo alone, and the echo
        // inside its own finished ring.
        for (uint32 level = 1; level <= 365; level += 364) {
            uint256 total = FrameRenderer.rings(level, 365);
            uint256 size = FrameRenderer.canvas(total);
            uint256 o = 2 * (total - 1);
            assertEq(size - 2 * o, 53, "the depth cancels at every ring count");
        }
    }

    /// The drawn output: dashed, in the ghost element, 54 runs.
    /// @dev The ink is the same NUMBER of cells the dot rule drew, 104, but not
    /// the same cells: the two rules agree only on offsets divisible by 4, so
    /// 52 are shared and the other half moved. What halved is the number of
    /// RUNS those cells are written as, which is the whole point of the
    /// revision. The cell count is asserted on the JavaScript side, where
    /// parsing a run is cheap; see tools/test/echo-ring.test.mjs.
    function test_theEchoRingDrawsAsFiftyFourRuns() public pure {
        bytes memory d = FrameRenderer.echoRingBars(0, 53);
        assertEq(_countRuns(d), 54, "14 + 14 + 13 + 13");
    }

    /// The dash rule on a short ring, where the whole string is readable, and
    /// mirrored verbatim in tools/test/echo-ring.test.mjs. At len 9 the ink
    /// offsets are 0, 1, 4, 5 and 8: two full groups and the clipped one that
    /// anchors the far end. The vertical edges then draw offset 1 alone -- its
    /// partner at offset 0 is the corner, already drawn -- and the 4-5 group.
    function test_theEchoRingMatchesTheJavaScriptByteForByte() public pure {
        assertEq(
            string(FrameRenderer.echoRingBars(0, 9)),
            "M0 0h2v1h-2zM0 8h2v1h-2zM4 0h2v1h-2zM4 8h2v1h-2zM8 0h1v1h-1zM8 8h1v1h-1z"
            "M0 1h1v1h-1zM8 1h1v1h-1zM0 4h1v2h-1zM8 4h1v2h-1z",
            "the short ring, in full"
        );

        // The real ones are 717 and 756 bytes, too long to read, so
        // they are held by hash. The same hashes are asserted in
        // tools/test/echo-ring.test.mjs against the JavaScript's own output,
        // which is what makes this a differential rather than a
        // self-consistency check.
        bytes memory d = FrameRenderer.echoRingBars(0, 53);
        assertEq(d.length, 717, "a newborn child's echo ring");
        assertEq(
            keccak256(d),
            0x72ad6bd54c11077cd08247296099dfa08ba0cd6c2ebc366e0895d97c6dcf1fe4,
            "byte for byte with the JavaScript"
        );

        // And at the other extreme: a FINISHED child draws the same 54 runs one
        // slot deeper, inside its own ring. Spec 10f made that depth 2 rather
        // than the 18 a nine-ring child used to reach.
        bytes memory deep = FrameRenderer.echoRingBars(2 * 1, 53);
        assertEq(_countRuns(deep), 54);
        assertEq(deep.length, 721, "the deepest echo ring");
        assertEq(
            keccak256(deep),
            0x224bf74265fd2922b70cb1567538e4ef019b87b8260e5ba371fccbf01068b5c8,
            "byte for byte on a finished child too"
        );
    }

    /// The ring is drawn at the depth the innermost slot sits at, whatever the
    /// token's own ring count, and it never overlaps a solid ring.
    function test_theEchoRingSitsInsideEveryEarnedRing() public pure {
        (uint256 own,) = FrameRenderer.ringBudget(365, 365);
        uint256 size = FrameRenderer.canvas(FrameRenderer.rings(365, 365));
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
        assertEq(FrameRenderer.echoRingBars(0, 2).length, 24, "two cells is one run per edge");

        // len 6 IS THE ONLY SHORT RING THAT EXERCISES THE VERTICAL CLIP. That
        // branch -- `run = (len - 1) - i >= 2 ? 2 : 1` -- is DEAD at the shipped
        // len of 53, and fires only when len is 2 mod 4. An untested branch in
        // a function that must stay byte-identical across two languages is
        // exactly where a future edit diverges with every suite green, so it is
        // pinned here and in tools/test/echo-ring.test.mjs with the same string.
        // At len 6 the vertical group starting at offset 4 has only offset 4 in
        // range, since offset 5 is the corner the horizontal edge already drew.
        assertEq(
            string(FrameRenderer.echoRingBars(0, 6)),
            "M0 0h2v1h-2zM0 5h2v1h-2zM4 0h2v1h-2zM4 5h2v1h-2z"
            "M0 1h1v1h-1zM5 1h1v1h-1zM0 4h1v1h-1zM5 4h1v1h-1z",
            "the vertical clip, at the only length that reaches it"
        );
    }

    /// @dev Counts the runs in a path string: one "M" starts each one.
    function _countRuns(bytes memory d) private pure returns (uint256 n) {
        for (uint256 i; i < d.length; ++i) {
            if (d[i] == "M") ++n;
        }
    }
}
