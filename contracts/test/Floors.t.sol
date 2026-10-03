// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The two floors on a day: none before deployment, and no credit more
/// than MAX_LAG days late.
contract FloorsTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
    }

    function test_aCheckInThirtyDaysLateIsAccepted() public {
        uint32 d0 = _today();
        _warpToDay(d0 + 31);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d0 + 1), _noBits(_days(d0 + 1)), _silent(_days(d0 + 1)));
        assertEq(t.viewOf(1).level, 2);
    }

    function test_aCheckInThirtyOneDaysLateIsRefused() public {
        uint32 d0 = _today();
        uint32 late = d0 + 1;
        _warpToDay(d0 + 32);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.StaleDay.selector, late));
        t.batchCheckIn(_one(1), _days(late), _noBits(_days(late)), _silent(_days(late)));
    }

    function test_deployDayIsTheDayOfDeployment() public {
        vm.warp(86_400 * 5000 + 7);
        MachineReadableOnly fresh = new MachineReadableOnly(address(r), WARDEN);
        assertEq(fresh.DEPLOY_DAY(), 5000);
    }

    function test_aMintDatedBeforeDeploymentIsRefused() public {
        vm.warp(86_400 * 5000 + 7);
        MachineReadableOnly fresh = new MachineReadableOnly(address(r), WARDEN);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BeforeDeploy.selector, uint32(4999)));
        fresh.mint(7, ALICE, bytes32(uint256(7)), _code(), 4999, false);
    }

    function test_aMintOnDeploymentDayIsAccepted() public {
        vm.warp(86_400 * 5000 + 7);
        MachineReadableOnly fresh = new MachineReadableOnly(address(r), WARDEN);
        vm.prank(WARDEN);
        fresh.mint(7, ALICE, bytes32(uint256(7)), _code(), 5000, false);
        assertEq(fresh.viewOf(7).mintDay, 5000);
    }
}
