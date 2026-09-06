// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The Echo: the days a token's LINE had already run when it was
/// seeded, sealed at the seed and never written again.
///
/// @dev Half this file is non-goals. Section 6 of
/// docs/specs/2026-09-06-mro-lineage-design.md lists five places the Echo must
/// never reach, because each of them is a way for depth to become a discount --
/// the exact failure lineage was designed around. Three of the five are
/// contract-side and are pinned here; the other two (the heart's cells and the
/// palette rung) are the renderer's and belong with it.
contract LineageTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
        // The REAL ladder, not a hand-rolled stand-in. The Mark non-goal below
        // has to fail on the gate it names rather than on an inactive record,
        // and `vm.expectRevert(MarkGate.selector)` is what tells those two
        // apart.
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 i = 1; i <= 10; i++) t.setUpgrade(i, u[i]);
    }

    // -----------------------------------------------------------------
    // What the Echo is
    // -----------------------------------------------------------------

    /// A founding token inherits nothing.
    function test_aFoundingTokenHasNoEcho() public view {
        assertEq(t.echoOf(1), 0, "a minted token starts its own line");
        assertEq(t.viewOf(1).echo, 0, "and the renderer is told so");
    }

    /// The child is sealed with the parent's credited days.
    function test_aChildIsSealedWithTheParentsLevel() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);
        assertEq(t.echoOf(child), 365, "the line had run 365 days");
        assertEq(t.viewOf(child).echo, 365);
    }

    /// The seal accumulates down the line, and does so in O(1): each
    /// generation adds the parent's OWN days to what the parent inherited, so
    /// nothing ever walks a parent chain.
    function test_theEchoAccumulatesAcrossGenerations() public {
        _makeWhole(1);
        uint256 g1 = _seedFrom(1);
        _growTo(g1, 365); // g1 earns its own year
        uint256 g2 = _seedFrom(g1);
        assertEq(t.echoOf(g2), 730, "365 inherited plus 365 g1 earned");
        assertEq(t.viewOf(g2).generation, 2, "and it really is the third generation");
    }

    /// It is SEALED: nothing after the seed moves it.
    function test_theEchoNeverMovesAfterTheSeed() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);
        uint32 atBirth = t.echoOf(child);
        assertEq(atBirth, 365);

        _growTo(1, 500); // the parent keeps going
        _growTo(child, 30); // so does the child

        assertEq(t.echoOf(child), atBirth, "a sealed number does not move");
        assertEq(t.viewOf(child).echo, atBirth);
    }

    /// A second child, seeded later, is sealed with MORE than the first. The
    /// seal is taken at the moment of the seed, not once per line.
    function test_aLaterSiblingIsSealedWithTheLongerLine() public {
        _makeWhole(1);
        uint256 first = _seedFrom(1);
        _growTo(1, 500);
        uint256 second = _seedFrom(1);

        assertEq(t.echoOf(first), 365);
        assertEq(t.echoOf(second), 500, "the line was longer by the time this one was made");
    }

    // -----------------------------------------------------------------
    // The non-goals of section 6
    // -----------------------------------------------------------------

    /// The one that matters most: it must not reach a Mark gate. A gen-2 token
    /// buying Static on day one is depth becoming a discount.
    function test_theEchoDoesNotUnlockAMark() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);
        assertEq(t.viewOf(child).level, 1);
        assertEq(t.echoOf(child), 365);

        // Static (3) gates on level >= 30. The child is level 1 with echo 365.
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(child, 3, 0);
    }

    /// The same for the gates that read a RUN rather than a level, because the
    /// Echo is a count of days and a run is too.
    function test_theEchoDoesNotUnlockAnEarnedMark() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);

        // Beat (4) needs a run of 30; Break (8) needs 365, which is exactly
        // the number the child inherited.
        vm.startPrank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(child, 4, 0);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(child, 8, 0);
        vm.stopPrank();
    }

    /// Vessel asks for a WHOLE token. An inherited year is not one.
    function test_theEchoIsNotAWholeToken() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(child, 7, 0);
    }

    /// The seed budget is per KEY and per year of that key's tenure. Feeding
    /// inherited days into it would let a line accelerate itself.
    ///
    /// @dev Asserted as an EQUALITY with the parent's budget, not just as a
    /// zero. A zero right after the seed would also be produced by a spent
    /// budget and would prove nothing about the Echo; what has to hold is that
    /// the whole line draws on ONE number, and that a child which has since
    /// earned a year of its own has not thereby earned a second budget.
    function test_theEchoDoesNotGrantASeed() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);
        assertEq(t.echoOf(child), 365, "it really did inherit a year");
        assertEq(
            t.seedsAvailable(child),
            0,
            "the budget is per KEY per year, not per inherited day"
        );
        assertEq(
            t.seedsAvailable(child),
            t.seedsAvailable(1),
            "parent and child draw on ONE budget"
        );

        // And once the child is whole in its own right, that is still true:
        // spending the child's seed spends the parent's.
        _growTo(child, 365);
        uint32 before = t.seedsAvailable(1);
        assertEq(t.seedsAvailable(child), before, "still one budget, not two");
        assertGt(before, 0, "the key has earned a seed by now, or this proves nothing");
        _seedFrom(child);
        assertEq(
            t.seedsAvailable(1),
            before - 1,
            "a grandchild spends the budget the founding token draws on"
        );
    }

    /// The child starts at level 1 with an empty heart and a run it has not
    /// run. A pre-filled heart would destroy the point of the piece.
    function test_theEchoDoesNotFillTheHeartOrColourIt() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);
        assertEq(t.viewOf(child).level, 1, "an heir starts with an empty heart");
        assertEq(t.viewOf(child).streak, 1, "and no run it did not run");
        assertEq(t.viewOf(child).fellRun, 0, "and no run it never lost");
    }

    /// `Years` is this token's OWN completed years. The Echo is reported
    /// separately and deliberately.
    ///
    /// @dev Asserted on the rendered TEXT of the metadata, which is plain UTF-8
    /// (only the image is base64), the same way Renderer.t.sol pins the Years
    /// attribute. The `Echo` attribute itself is the renderers' job and lands
    /// with them; what this pins is that the inherited 365 does not leak into a
    /// trait that means something else.
    function test_theEchoIsNotCountedInYears() public {
        _makeWhole(1);
        uint256 child = _seedFrom(1);
        assertEq(t.echoOf(child), 365);

        string memory uri = t.tokenURI(child);
        assertTrue(
            vm.contains(uri, '{"trait_type":"Years","value":0}'),
            "an heir has completed no years of its own"
        );
        assertTrue(vm.contains(uri, '{"trait_type":"Level","value":1}'));
    }

    /// The founding token's own metadata is untouched by any of this.
    function test_aFoundingTokensMetadataStillReadsAsItDid() public {
        _makeWhole(1);
        _seedFrom(1);
        string memory uri = t.tokenURI(1);
        assertTrue(vm.contains(uri, '{"trait_type":"Years","value":1}'), "the parent completed a year");
        assertTrue(vm.contains(uri, '{"trait_type":"Children","value":1}'), "and gave one seed");
        assertEq(t.echoOf(1), 0, "and inherited nothing itself");
    }
}
