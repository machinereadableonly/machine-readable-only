// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice batchCheckIn semantics: the daily overwrite, streak rules, and the
/// per-token ERC-4906 emits that replaced the impossible range form.
contract CheckInTest is MroTestBase {

    function setUp() public {
        _deployAndMintOne();
    }

    function test_checkInIncrementsLevelAndContinuesTheStreak() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 1));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
        assertEq(t.viewOf(1).lastDay, d + 1);
    }

    function test_aGapResetsTheStreakButNotTheLevel() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 5));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 1);
    }

    function test_theSameDayTwiceReverts() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.DayNotAdvanced.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(d));
    }

    /// @dev Late writes after an outage: several days for one token in one
    /// call, ascending, are legal and each counts.
    function test_multiDayLateWritesInOneCall() public {
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](3);
        ids[0] = 1; ids[1] = 1; ids[2] = 1;
        uint32[] memory ds = new uint32[](3);
        ds[0] = d + 1; ds[1] = d + 2; ds[2] = d + 3;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds);
        assertEq(t.viewOf(1).level, 4);
        assertEq(t.viewOf(1).streak, 4);
    }

    /// @dev The decision from the design doc: one MetadataUpdate per token
    /// written, never a range. A range would claim untouched tokens changed.
    function test_emitsOneMetadataUpdatePerTokenWritten() public {
        uint32 d = t.today();
        vm.expectEmit(false, false, false, true);
        emit IERC4906.MetadataUpdate(1);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 1));
    }

    function test_checkInRevertsForANonWarden() public {
        uint32 d = t.today() + 1;
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.batchCheckIn(_one(1), _days(d));
    }

    function test_mismatchedLengthsRevert() public {
        uint32[] memory ids = new uint32[](2);
        ids[0] = 1; ids[1] = 1;
        uint32 d = t.today() + 1;
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.LengthMismatch.selector);
        t.batchCheckIn(_packed(ids), _days(d));
    }

    function test_checkInIsBlockedByPauseAndBySunset() public {
        uint32 d = t.today() + 1;
        t.pause();
        vm.prank(WARDEN);
        vm.expectRevert();
        t.batchCheckIn(_one(1), _days(d));
        t.unpause();
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.batchCheckIn(_one(1), _days(d));
    }

    /// @notice A full 1,500-token chunk, per-token emits included, must fit the
    /// 15M guard the Clock uses -- and well inside EIP-7825's 16,777,216 cap.
    /// @dev This is the number the whole batching design rests on. If it fails,
    /// the chunk size changes, not the emit policy.
    function test_aFullChunkFitsTheGasGuard() public {
        uint32 n = 1500;
        vm.startPrank(WARDEN);
        for (uint32 i = 2; i < 2 + n; i++) {
            t.mint(i, address(uint160(0x10000 + i)), bytes32(uint256(i)), _code());
        }
        vm.stopPrank();

        uint32[] memory ids = new uint32[](n);
        uint32[] memory ds = new uint32[](n);
        uint32 d = t.today() + 1;
        for (uint32 i = 0; i < n; i++) {
            ids[i] = 2 + i;
            ds[i] = d;
        }

        // Build the packed calldata bytes BEFORE the gas measurement starts.
        // _packed() concatenates via abi.encodePacked in a loop, an O(n^2)
        // memory copy in the test harness itself -- if left inside the
        // gasleft() window it swamps the number with test-only overhead that
        // has nothing to do with what batchCheckIn actually costs on chain.
        bytes memory packed = _packed(ids);

        vm.prank(WARDEN);
        uint256 before = gasleft();
        t.batchCheckIn(packed, ds);
        uint256 used = before - gasleft();

        emit log_named_uint("gas for a 1500-token chunk", used);
        assertLt(used, 15_000_000, "a full chunk must fit the Clock's 15M guard");
    }
}
