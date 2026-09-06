// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Every operator dial emits its event, with the value it actually set.
///
/// @dev The 2026-09-04 quality review found seven events asserted nowhere:
/// `RendererSet`, `WardenSet`, `SupplyCapSet`, `WalletCapSet`, `SunsetAt`,
/// `UpgradeSet` and `VouchersEnabledSet`. The setters themselves were well
/// tested -- each has an owner test and a non-owner revert test -- but every one
/// of those asserts the STATE afterwards, so deleting the `emit` line from any
/// of the seven left the suite green.
///
/// That matters more here than it would in most contracts. This piece has no
/// human-facing surface at all: an operator dial is visible to the outside world
/// ONLY as a log. `warden/src/clock/reconcile.mjs` rebuilds the mirror by paging
/// logs, and an agent auditing whether the terms it minted under have changed
/// has nothing else to read. A silent dial is a dial that turned in private.
///
/// Each test asserts the full payload -- `expectEmit(true, true, true, true)` --
/// because a topic-only check would pass on an event carrying the wrong value,
/// which is the exact failure this file exists to catch.
contract DialEventsTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
    }

    function test_setRendererEmitsTheAddressItSet() public {
        Renderer other = new Renderer();

        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.RendererSet(address(other));
        t.setRenderer(address(other));

        assertEq(t.renderer(), address(other), "the event must describe a change that happened");
    }

    function test_setWardenEmitsTheAddressItSet() public {
        address other = address(0xDEAD1);

        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.WardenSet(other);
        t.setWarden(other);

        assertEq(t.warden(), other);
    }

    function test_setSupplyCapEmitsTheCapItSet() public {
        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.SupplyCapSet(4242);
        t.setSupplyCap(4242);

        assertEq(t.supplyCap(), 4242);
    }

    function test_setWalletCapEmitsTheCapItSet() public {
        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.WalletCapSet(9);
        t.setWalletCap(9);

        assertEq(t.walletCap(), 9);
    }

    function test_setVouchersEnabledEmitsBothWays() public {
        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.VouchersEnabledSet(true);
        t.setVouchersEnabled(true);
        assertTrue(t.vouchersEnabled());

        // Both directions: an event that only fires on the way on would leave
        // the day the voucher path was switched OFF unrecorded, and that is the
        // direction an agent would want to audit.
        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.VouchersEnabledSet(false);
        t.setVouchersEnabled(false);
        assertFalse(t.vouchersEnabled());
    }

    function test_setUpgradeEmitsTheMarkIdItWrote() public {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();

        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.UpgradeSet(3);
        t.setUpgrade(3, u[3]);

        assertEq(t.upgradeOf(3).priceUsdc6, u[3].priceUsdc6, "the record the event announced");
    }

    /// @dev `sunset()` stamps the day the operator chose to close.
    function test_sunsetEmitsTheDayItClosedOn() public {
        uint32 day = t.today();   // read before the expectation -- it is a call

        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.SunsetAt(day);
        t.sunset();

        assertEq(t.sunsetDay(), day);
    }

    /// @dev And `sunsetByAbsence()` stamps the day the piece STOPPED, which is
    /// `lastWardenDay` and not today. The two are a year apart by construction,
    /// so this is the assertion that would catch the two being swapped -- the
    /// swap that would freeze every heart at the start colour.
    function test_sunsetByAbsenceEmitsTheDayTheWritingStopped() public {
        uint32 stopped = t.lastWardenDay();
        _warpToDay(stopped + t.ABSENCE_DAYS());

        vm.expectEmit(true, true, true, true);
        emit MachineReadableOnly.SunsetAt(stopped);
        t.sunsetByAbsence();

        assertEq(t.sunsetDay(), stopped, "the day it ended, not the day somebody noticed");
        assertTrue(t.today() > stopped, "and those are genuinely different days here");
    }
}
