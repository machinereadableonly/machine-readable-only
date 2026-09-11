// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MachineReadableOnlyFast} from "../script/fast/MachineReadableOnlyFast.sol";

/// @notice The fast-days test copy: its day is five minutes, and the real
/// contract's day is still a day. The second half is the one that matters --
/// `today()` became virtual so the fast copy could exist, and nothing about
/// the permanent contract may move because of it.
contract FastDaysTest is Test {
    address constant WARDEN = address(0xC10C);

    MachineReadableOnly real;
    MachineReadableOnlyFast fast;

    function setUp() public {
        Renderer r = new Renderer();
        real = new MachineReadableOnly(address(r), WARDEN);
        fast = new MachineReadableOnlyFast(address(r), WARDEN);
        vm.warp(1_789_000_000);
    }

    function test_theFastDayIsFiveMinutes() public {
        uint32 d = fast.today();
        assertEq(d, uint32(block.timestamp / 300));
        vm.warp(block.timestamp + 300);
        assertEq(fast.today(), d + 1, "one fast day per 300 seconds");
    }

    function test_theRealDayIsStillADay() public {
        uint32 d = real.today();
        assertEq(d, uint32(block.timestamp / 1 days));
        vm.warp(block.timestamp + 300);
        assertEq(real.today(), d, "five minutes is not a day on the real contract");
        vm.warp(block.timestamp + 1 days);
        assertEq(real.today(), d + 1);
    }

    /// The override reaches the contract's own reasoning, not just the getter:
    /// a mint records the fast day, and a check-in one fast day later is
    /// accepted where the real contract would call it FutureDay.
    function test_theContractReasonsOnTheFastDay() public {
        // CODE_BYTES is internal; 172 is its value (MachineReadableOnly.sol),
        // and mint reverts BadCodeLength on anything else.
        bytes memory code = new bytes(172);
        vm.prank(WARDEN);
        fast.mint(1, address(0xA11), bytes32(uint256(1)), code);
        uint32 d = fast.today();
        assertEq(fast.viewOf(1).lastDay, d);

        vm.warp(block.timestamp + 300);
        uint32[] memory days_ = new uint32[](1);
        days_[0] = d + 1;
        vm.prank(WARDEN);
        fast.batchCheckIn(abi.encodePacked(uint32(1)), days_);
        assertEq(fast.viewOf(1).level, 2);
        assertEq(fast.viewOf(1).streak, 2);
    }
}
