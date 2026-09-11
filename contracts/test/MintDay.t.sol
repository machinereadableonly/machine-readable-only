// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice A token's first day is the day it was PAID for, carried by the
/// Warden, not the day the Clock happens to write it.
/// @dev THE BUG THIS PINS, found by the fast-days copy on 2026-09-11: `mint`
/// and `seed` took `today()` at the moment of the write. The Clock writes at
/// 00:05 UTC the day AFTER payment, so on chain every token began a day later
/// than the Warden recorded -- the agent's next-day check-in landed ON the
/// token's first day, was refused DayNotAdvanced, and was healed away as
/// "already on chain", leaving the mirror one level ahead of the artwork for
/// good. Measured on fast token 1: chain level 1, mirror level 2.
contract MintDayTest is MroTestBase {
    uint32 internal constant GRACE = 30;

    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
    }

    function test_theRecordedDayIsTheTokensFirstDay() public {
        uint32 paid = _today() - 1;
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), paid);
        assertEq(t.viewOf(1).mintDay, paid);
        assertEq(t.viewOf(1).lastDay, paid);
        assertEq(t.viewOf(1).level, 1);
    }

    /// The regression itself: paid yesterday, written today, and today's
    /// check-in is the SECOND day, not a refused duplicate of the first.
    function test_aNextDayCheckInCountsWhenTheMintLandsLate() public {
        uint32 paid = _today() - 1;
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), paid);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(paid + 1));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
    }

    function test_aFutureDayIsRefusedByName() public {
        uint32 tomorrow = _today() + 1;
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.FutureDay.selector, tomorrow));
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), tomorrow);
    }

    function test_aStaleDayIsRefusedByName() public {
        uint32 old = _today() - GRACE - 1;
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.StaleDay.selector, old));
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), old);
    }

    /// Both sides of the floor: exactly GRACE days back is still accepted.
    function test_theGraceBoundaryIsInclusive() public {
        uint32 edge = _today() - GRACE;
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), edge);
        assertEq(t.viewOf(1).mintDay, edge);
    }

    /// Today is still a valid day: a mint written the same day it was paid.
    function test_todayIsAValidDay() public {
        uint32 d = _today();
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), d);
        assertEq(t.viewOf(1).mintDay, d);
    }
}
