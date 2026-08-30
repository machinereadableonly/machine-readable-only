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
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true
        }));
    }

    function test_applyMarkSetsTheBitAndEmits() public {
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.MarkApplied(1, 1);
        vm.prank(WARDEN);
        t.applyMark(1, 1);
        assertEq(t.marksOf(1), 1 << 1);
        assertEq(t.upgradeOf(1).sold, 1);
    }

    function test_applyMarkEmitsMetadataUpdate() public {
        vm.expectEmit(false, false, false, true);
        emit IERC4906.MetadataUpdate(1);
        vm.prank(WARDEN);
        t.applyMark(1, 1);
    }

    function test_applyMarkRevertsForANonWarden() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.applyMark(1, 1);
    }

    function test_anInactiveMarkReverts() public {
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkInactive.selector);
        t.applyMark(1, 2);
    }

    function test_theSameMarkTwiceReverts() public {
        vm.startPrank(WARDEN);
        t.applyMark(1, 1);
        vm.expectRevert(MachineReadableOnly.MarkAlreadyApplied.selector);
        t.applyMark(1, 1);
        vm.stopPrank();
    }

    function test_aSoldOutMarkReverts() public {
        t.setUpgrade(2, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 1, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true
        }));
        vm.prank(WARDEN);
        t.mint(2, MALLORY, bytes32(uint256(2)), _code());
        vm.startPrank(WARDEN);
        t.applyMark(1, 2);
        vm.expectRevert(MachineReadableOnly.MarkSoldOut.selector);
        t.applyMark(2, 2);
        vm.stopPrank();
    }

    function test_theLevelGateReverts() public {
        t.setUpgrade(3, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 50, minStreak: 0, requiresWhole: false, active: true
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 3);
    }

    function test_theStreakGateReverts() public {
        t.setUpgrade(4, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 7, requiresWhole: false, active: true
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 4);
    }

    function test_theWholenessGateReverts() public {
        t.setUpgrade(5, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: true, active: true
        }));
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 5);
    }

    function test_setUpgradeRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setUpgrade(9, MachineReadableOnly.Upgrade({
            priceUsdc6: 1, maxSupply: 0, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: false, active: true
        }));
    }

    function test_applyMarkIsBlockedBySunset() public {
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.applyMark(1, 1);
    }

    /// @dev Task 4 built this refusal but could not test it, because nothing
    /// could set a token resting until Task 5 added `rest`.
    function test_applyMarkRefusesARestingToken() public {
        vm.prank(ALICE);
        t.rest(1);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.applyMark(1, 1);
    }
}
