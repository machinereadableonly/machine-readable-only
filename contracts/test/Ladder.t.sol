// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The ladder's structure, asserted rather than trusted from a table --
/// plus the behavioural half, which needs a live token: Break's freedom.
///
/// @dev Extends MroTestBase rather than Test, because the Break tests need a
/// real token at a 365-day run and the base already knows how to build one.
contract LadderTest is MroTestBase {
    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code());
    }

    /// @dev Which pair each Mark belongs to. Pairs are (1,2) (3,4) (5,6) (7,8)
    /// (9,10), so the pair of id n is (n + 1) / 2.
    function _pairOf(uint8 id) internal pure returns (uint8) {
        return (id + 1) / 2;
    }

    function test_everyExclusionIsSymmetric() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            for (uint8 b = 1; b <= 10; b++) {
                bool aExcludesB = u[a].excludes & uint16(1 << b) != 0;
                bool bExcludesA = u[b].excludes & uint16(1 << a) != 0;
                assertEq(aExcludesB, bExcludesA, "exclusion is not symmetric");
            }
        }
    }

    /// @dev The invariant the symmetry test alone would happily pass a
    /// reintroduced cross-pair rule on. Revision 2 of the spec removed exactly
    /// such a rule, on the grounds that a tier whose optimal play is abstention
    /// is a dead tier. This is what stops it coming back through an edit to one
    /// row.
    function test_noExclusionCrossesAPairBoundary() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            for (uint8 b = 1; b <= 10; b++) {
                if (u[a].excludes & uint16(1 << b) == 0) continue;
                assertEq(_pairOf(a), _pairOf(b), "an exclusion crosses a pair");
            }
        }
    }

    function test_eachMarkExcludesExactlyItsPartner() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            uint8 partner = a % 2 == 1 ? a + 1 : a - 1;
            assertEq(u[a].excludes, uint16(1 << partner), "wrong exclusion mask");
        }
    }

    /// @dev The fix for the SECOND trap. Aura was ungated, so it was buyable on
    /// day one and silently forfeited Tint, which needs an Iris and therefore
    /// 100 days. A pair is fair when both sides open at the same time.
    function test_bothSidesOfPairFiveWaitOnAnIris() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        uint16 anIris = uint16((1 << 5) | (1 << 6));
        assertEq(u[9].requiresAny, anIris, "Tint must need an Iris");
        assertEq(u[10].requiresAny, anIris, "Aura must need an Iris too");
    }

    function test_nothingIsLimited() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            assertEq(u[a].maxSupply, 0, "a cap was reintroduced");
            assertTrue(u[a].active, "a Mark ships inactive");
        }
    }

    /// @dev Priced XOR earned. Four Marks are free; the other six carry a price.
    /// A record that is neither, or both, is a wiring error.
    function test_everyMarkIsPricedOrEarnedAndNeverBoth() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        uint8 free;
        for (uint8 a = 1; a <= 10; a++) {
            bool priced = u[a].priceUsdc6 > 0;
            bool earned = u[a].minStreak > 0;
            assertTrue(priced != earned, "a Mark is neither priced nor earned, or both");
            if (earned) free++;
        }
        assertEq(free, 4, "there should be exactly four earned Marks");
    }

    /// @dev BREAK'S FREEDOM IS THE GUARANTEE, NOT ITS EXCLUSION. All four of these
    /// cases were REFUSALS in revision 1 of the spec, so they are the tests most
    /// likely to be written backwards from a stale reading. Revision 2 removed the
    /// cross-pair rule because a day-30 choice that destroyed a day-365 Mark made
    /// abstention the optimal play, and a tier whose optimal play is abstention is
    /// a dead tier.
    ///
    /// Both orders, because an exclusion that only fires one way round would pass a
    /// single-order test.
    function test_breakComposesWithStaticInBothOrders() public {
        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(1, 3, 0);   // Static first
        t.applyMark(1, 8, 0);   // then Break
        vm.stopPrank();
        assertEq(t.marksOf(1) & 0xFFFE, (1 << 3) | (1 << 8));

        _readyBreakAndPairTwo();   // a second token, the other way round
        vm.startPrank(WARDEN);
        t.applyMark(2, 8, 0);   // Break first
        t.applyMark(2, 3, 0);   // then Static
        vm.stopPrank();
        assertEq(t.marksOf(2) & 0xFFFE, (1 << 3) | (1 << 8));
    }

    function test_breakComposesWithBeatInBothOrders() public {
        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(1, 4, 0);   // Beat first
        t.applyMark(1, 8, 0);   // then Break
        vm.stopPrank();
        assertEq(t.marksOf(1) & 0xFFFE, (1 << 4) | (1 << 8));

        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(2, 8, 0);   // Break first
        t.applyMark(2, 4, 0);   // then Beat
        vm.stopPrank();
        assertEq(t.marksOf(2) & 0xFFFE, (1 << 4) | (1 << 8));
    }

    /// @dev The control that keeps the two tests above honest: WITHIN pair 2 the
    /// exclusion still fires. Without this, a mask accidentally set to zero would
    /// make both freedom tests pass while the ladder had no exclusions at all.
    function test_pairTwoStillExcludesItselfWhileBreakIsFree() public {
        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(1, 3, 0);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkExcluded.selector, uint8(3)));
        t.applyMark(1, 4, 0);
        vm.stopPrank();
    }

    /// @dev A token that qualifies for Static, Beat AND Break at once, with the
    /// REAL records from Ladder.sol so these tests exercise the shipping masks
    /// rather than hand-rolled ones.
    ///
    /// `_makeWhole` checks a token in on 364 consecutive days after its mint, which
    /// leaves level 365 and streak 365 -- exactly Break's gate, and past Static's
    /// level 30 and Beat's run of 30. Called twice, it readies tokens 1 and 2, so
    /// each ordering above starts from a clean token.
    uint256 private _readied;
    function _readyBreakAndPairTwo() internal {
        _readied += 1;
        uint256 id = _readied;
        if (id > 1) {
            vm.prank(WARDEN);
            t.mint(id, ALICE, bytes32(id), _code());
        }
        _makeWhole(id);
        assertEq(t.viewOf(id).streak, 365, "Break's gate needs a 365-day run");

        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        t.setUpgrade(3, u[3]);
        t.setUpgrade(4, u[4]);
        t.setUpgrade(7, u[7]);
        t.setUpgrade(8, u[8]);
    }

    // THE MIRROR CHECK IS ADDED BY TASK 9, not here. It asserts this ladder
    // against the hash tools/ladder-fixture.mjs computes from the Warden's own
    // catalogue, and that catalogue does not exist until Task 9. A test written
    // now would have nothing to assert against, so it is not written now.
}
