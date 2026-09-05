// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Palette} from "../src/render/Palette.sol";
import {TokenView} from "../src/render/TokenView.sol";

/// @notice The ending the piece can receive, added 2026-09-05.
///
/// @dev `sunset()` is owner-only, and the piece's most likely death is the
/// operator simply stopping -- five of six comparable projects went that way.
/// As built that ending could not be expressed: the Clock falls silent, nobody
/// but the owner can close the piece, and thirty days later every heart renders
/// at the start colour while `Sunset` still reads no. The operator's
/// abandonment drawn as every agent's, permanently, with no one able to say
/// otherwise.
///
/// `sunsetByAbsence` grants no new power. It can only do what the owner could
/// already have done, and only after a whole frame's worth of silence.
contract SunsetByAbsenceTest is MroTestBase {
    address constant STRANGER = address(0xB0B);

    function setUp() public {
        _deployAndMintOne();
    }

    function test_deploymentCountsAsAWriteSoThePieceIsNotCloseableOnDayOne() public {
        assertEq(t.lastWardenDay(), t.today(), "the constructor stamps it");
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NotAbsent.selector, uint32(0)));
        t.sunsetByAbsence();
    }

    function test_everyWardenWriteResetsTheClock() public {
        uint32 d = t.today();
        _warpToDay(d + 200);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 200));
        assertEq(t.lastWardenDay(), d + 200, "a check-in is a heartbeat");

        // 200 days of silence is not a year, so the piece stays open.
        _warpToDay(d + 400);
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NotAbsent.selector, uint32(200)));
        t.sunsetByAbsence();
    }

    function test_theGateIsExactlyThreeHundredAndSixtyFiveDays() public {
        uint32 d = t.lastWardenDay();

        _warpToDay(d + 364);
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NotAbsent.selector, uint32(364)));
        t.sunsetByAbsence();

        _warpToDay(d + 365);
        vm.prank(STRANGER);
        t.sunsetByAbsence();
        assertTrue(t.isSunset(), "one more day closes it");
    }

    function test_anyoneMayCallItAndItCannotBeCalledTwice() public {
        _warpToDay(t.lastWardenDay() + 365);
        vm.prank(STRANGER);
        t.sunsetByAbsence();

        vm.prank(STRANGER);
        vm.expectRevert(MachineReadableOnly.AlreadySunset.selector);
        t.sunsetByAbsence();
    }

    function test_anOwnerSunsetAlsoBlocksTheAbsencePath() public {
        t.sunset();
        _warpToDay(t.lastWardenDay() + 365);
        vm.prank(STRANGER);
        vm.expectRevert(MachineReadableOnly.AlreadySunset.selector);
        t.sunsetByAbsence();
    }

    /// @dev The load-bearing one. `sunsetDay` is the day the piece STOPPED, not
    /// the day someone noticed, because the renderer freezes a sunset token at
    /// `lapsedIndex(streak, lastDay, sunsetDay)`. Setting it to `today()` would
    /// give every token a gap of 365 and freeze the whole collection at the
    /// start colour -- exactly the lie this function exists to prevent.
    function test_theRecordedDayIsTheDayThePieceStoppedNotTheDayItWasClosed() public {
        uint32 d = t.today();
        _warpToDay(d + 10);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 10));
        uint32 lastWrite = t.today();

        _warpToDay(lastWrite + 400);
        vm.prank(STRANGER);
        t.sunsetByAbsence();

        assertEq(t.sunsetDay(), lastWrite, "the day it stopped");
        assertTrue(t.sunsetDay() != t.today(), "and emphatically not the day it was noticed");

        // The token therefore keeps the colour it held when the silence began.
        TokenView memory v = t.viewOf(1);
        assertEq(
            Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay),
            Palette.tierIndex(v.streak),
            "it was checked in on the closing day, so it seals at its live rung"
        );
    }

    /// @dev An owner-called sunset keeps `today()`: there the operator is
    /// choosing the moment, and that moment is the answer.
    function test_anOwnerCalledSunsetStillRecordsToday() public {
        _warpToDay(t.today() + 50);
        t.sunset();
        assertEq(t.sunsetDay(), t.today());
    }

    /// @dev A paused contract must still be closeable, or a pause plus an
    /// abandonment is a piece frozen with no ending at all.
    function test_aPausedAndAbandonedPieceStillResolves() public {
        t.pause();
        _warpToDay(t.lastWardenDay() + 365);
        vm.prank(STRANGER);
        t.sunsetByAbsence();
        assertTrue(t.isSunset());
    }

    function test_aSunsetTokenReadsAtRestRatherThanWholeOrNothing() public {
        _warpToDay(t.lastWardenDay() + 365);
        vm.prank(STRANGER);
        t.sunsetByAbsence();

        string memory uri = t.tokenURI(1);
        assertTrue(bytes(uri).length > 0, "it still renders after the piece closes");
        assertTrue(t.viewOf(1).sunset, "and the view says so");
        assertEq(t.viewOf(1).sunsetDay, t.sunsetDay(), "with the day a renderer needs");
    }
}
