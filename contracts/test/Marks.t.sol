// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice applyMark's gates, supply and bitmask.
contract MarksTest is MroTestBase {

    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, bytes32(uint256(1)), _code());
        // Vein: cheap, uncapped, no gates.
        t.setUpgrade(1, MachineReadableOnly.Upgrade({
            priceUsdc6: 1_000_000, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: 0, requiresAny: 0
        }));
    }

    function test_applyMarkSetsTheBitAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.MarkApplied(1, 1, 0);
        vm.prank(WARDEN);
        t.applyMark(1, 1, 0);
        assertEq(t.marksOf(1), 1 << 1);
        assertEq(t.upgradeOf(1).sold, 1);
    }

    function test_applyMarkEmitsMetadataUpdate() public {
        vm.expectEmit(false, false, false, true);
        emit IERC4906.MetadataUpdate(1);
        vm.prank(WARDEN);
        t.applyMark(1, 1, 0);
    }

    function test_applyMarkRevertsForANonWarden() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.applyMark(1, 1, 0);
    }

    function test_anInactiveMarkReverts() public {
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkInactive.selector);
        t.applyMark(1, 2, 0);
    }

    function test_theSameMarkTwiceReverts() public {
        vm.startPrank(WARDEN);
        t.applyMark(1, 1, 0);
        vm.expectRevert(MachineReadableOnly.MarkAlreadyApplied.selector);
        t.applyMark(1, 1, 0);
        vm.stopPrank();
    }

    function test_aSoldOutMarkReverts() public {
        t.setUpgrade(2, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 1, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: 0, requiresAny: 0
        }));
        vm.prank(WARDEN);
        t.mint(2, MALLORY, bytes32(uint256(2)), _code());
        vm.startPrank(WARDEN);
        t.applyMark(1, 2, 0);
        vm.expectRevert(MachineReadableOnly.MarkSoldOut.selector);
        t.applyMark(2, 2, 0);
        vm.stopPrank();
    }

    function test_theLevelGateReverts() public {
        t.setUpgrade(3, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 50, minStreak: 0, requiresWhole: false, active: true,
            excludes: 0, requiresAny: 0
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 3, 0);
    }

    function test_theStreakGateReverts() public {
        t.setUpgrade(4, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 7, requiresWhole: false, active: true,
            excludes: 0, requiresAny: 0
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 4, 0);
    }

    function test_theWholenessGateReverts() public {
        t.setUpgrade(5, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: true, active: true,
            excludes: 0, requiresAny: 0
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 5, 0);
    }

    function test_setUpgradeRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setUpgrade(9, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: 0, requiresAny: 0
        }));
    }

    function test_applyMarkIsBlockedBySunset() public {
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.applyMark(1, 1, 0);
    }

    /// @dev Task 4 built this refusal but could not test it, because nothing
    /// could set a token resting until Task 5 added `rest`.
    function test_applyMarkRefusesARestingToken() public {
        vm.prank(ALICE);
        t.rest(1);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.applyMark(1, 1, 0);
    }

    /// @dev Mark 2 excludes mark 1 and vice versa: the pair rule, in miniature.
    function _pair(uint8 a, uint8 b, uint32 minLevel, uint32 minStreak) internal {
        t.setUpgrade(a, MachineReadableOnly.Upgrade({
            priceUsdc6: 1_000_000, maxSupply: 0, sold: 0,
            minLevel: minLevel, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << b), requiresAny: 0
        }));
        t.setUpgrade(b, MachineReadableOnly.Upgrade({
            priceUsdc6: 0, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: minStreak, requiresWhole: false, active: true,
            excludes: uint16(1 << a), requiresAny: 0
        }));
    }

    function test_anExcludedMarkRevertsAndNamesWhatBlockedIt() public {
        _pair(1, 2, 0, 0);
        vm.startPrank(WARDEN);
        t.applyMark(1, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkExcluded.selector, uint8(1)));
        t.applyMark(1, 2, 0);
        vm.stopPrank();
    }

    function test_exclusionIsSymmetricInPractice() public {
        _pair(1, 2, 0, 0);
        vm.startPrank(WARDEN);
        t.applyMark(1, 2, 0);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkExcluded.selector, uint8(2)));
        t.applyMark(1, 1, 0);
        vm.stopPrank();
    }

    function test_aMarkWithNoExclusionIsUnaffected() public {
        _pair(1, 2, 0, 0);
        t.setUpgrade(3, MachineReadableOnly.Upgrade({
            priceUsdc6: 1_000_000, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: 0, requiresAny: 0
        }));
        vm.startPrank(WARDEN);
        t.applyMark(1, 1, 0);
        t.applyMark(1, 3, 0);   // the control: an unexcluded mark still lands
        vm.stopPrank();
        assertEq(t.marksOf(1) & 0xFFFE, (1 << 1) | (1 << 3));
    }

    function test_aRequirementIsAnyOfNotAllOf() public {
        _pair(5, 6, 0, 0);
        t.setUpgrade(9, MachineReadableOnly.Upgrade({
            priceUsdc6: 250_000_000, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << 10), requiresAny: uint16((1 << 5) | (1 << 6))
        }));
        vm.startPrank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkRequires.selector);
        t.applyMark(1, 9, 0);
        t.applyMark(1, 6, 0);   // the OTHER side of the pair satisfies it
        t.applyMark(1, 9, 0);
        vm.stopPrank();
        assertEq(t.marksOf(1) & (1 << 9), 1 << 9);
    }

    function test_setUpgradeRefusesAnIdThatWouldAliasTheVariantBits() public {
        MachineReadableOnly.Upgrade memory u = MachineReadableOnly.Upgrade({
            priceUsdc6: 0, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: 0, requiresAny: 0
        });
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkIdOutOfRange.selector, uint8(16)));
        t.setUpgrade(16, u);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkIdOutOfRange.selector, uint8(0)));
        t.setUpgrade(0, u);
        // Both sides of the bound: 10 is the highest legal id and must succeed.
        t.setUpgrade(10, u);
        assertTrue(t.upgradeOf(10).active);
    }

    function test_theVariantBoundIsProvokedOnBothSides() public {
        // Mark 5, the bought Iris: three shapes, so 0..2 are legal and 3 is not.
        t.setUpgrade(5, MachineReadableOnly.Upgrade({
            priceUsdc6: 25_000_000, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << 6), requiresAny: 0
        }));
        vm.startPrank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadVariant.selector, uint8(3)));
        t.applyMark(1, 5, 3);
        t.applyMark(1, 5, 2);      // the highest legal shape index succeeds
        vm.stopPrank();
        assertEq((t.marksOf(1) >> 16) & 0xFF, 2);
    }

    function test_aMarkWithNoVariantRefusesANonZeroOne() public {
        vm.startPrank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadVariant.selector, uint8(1)));
        t.applyMark(1, 1, 1);
        t.applyMark(1, 1, 0);      // the control: zero is legal for every Mark
        vm.stopPrank();
    }

    function test_tintStoresItsInkInItsOwnByte() public {
        t.setUpgrade(6, MachineReadableOnly.Upgrade({
            priceUsdc6: 0, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << 5), requiresAny: 0
        }));
        t.setUpgrade(9, MachineReadableOnly.Upgrade({
            priceUsdc6: 250_000_000, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << 10), requiresAny: uint16((1 << 5) | (1 << 6))
        }));
        vm.startPrank(WARDEN);
        t.applyMark(1, 6, 0);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadVariant.selector, uint8(2)));
        t.applyMark(1, 9, 2);      // two inks, so 2 is one past the end
        t.applyMark(1, 9, 1);
        vm.stopPrank();
        assertEq((t.marksOf(1) >> 24) & 0xFF, 1);
        assertEq((t.marksOf(1) >> 16) & 0xFF, 0, "tint must not touch the shape byte");
    }

    function test_theEarnedIrisStoresTheRunAndNotTheRungOrTheColour() public {
        // Give token 1 a real streak: 40 consecutive days.
        uint32 d = t.today();
        for (uint32 i = 1; i <= 40; i++) {
            _warpToDay(d + i);
            vm.prank(WARDEN);
            t.batchCheckIn(_one(1), _days(d + i));
        }
        assertEq(t.viewOf(1).streak, 41);
        t.setUpgrade(6, MachineReadableOnly.Upgrade({
            priceUsdc6: 0, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << 5), requiresAny: 0
        }));
        vm.prank(WARDEN);
        t.applyMark(1, 6, 0);
        // The RUN, from the token's own state. The Warden supplies nothing, so it
        // cannot be forged -- which is the class of claim cold readers said they
        // would go and verify.
        assertEq((t.marksOf(1) >> 32) & 0xFFFFFFFF, 41);
    }

    function test_aTokenWearingOnlyTheEarnedIrisIsNotMisreadAsWearingMore() public {
        t.setUpgrade(6, MachineReadableOnly.Upgrade({
            priceUsdc6: 0, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << 5), requiresAny: 0
        }));
        vm.prank(WARDEN);
        t.applyMark(1, 6, 0);
        // The high bits carry a large number. "Does this token wear any Mark" must
        // be `marks & 0xFFFE`, never `marks != 0`.
        assertEq(t.marksOf(1) & 0xFFFE, 1 << 6);
        assertGt(t.marksOf(1), 0xFFFF, "the run should be in the high bits");
    }

    function test_theMarkAppliedEventCarriesTheVariant() public {
        t.setUpgrade(5, MachineReadableOnly.Upgrade({
            priceUsdc6: 25_000_000, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true,
            excludes: uint16(1 << 6), requiresAny: 0
        }));
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.MarkApplied(1, 5, 1);
        vm.prank(WARDEN);
        t.applyMark(1, 5, 1);
    }
}
