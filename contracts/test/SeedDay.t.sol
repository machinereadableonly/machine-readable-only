// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// `seed` shares `mint`'s creation-day bounds through `_checkCreationDay`.
/// These pin it on `seed` itself rather than on the sharing. `BeforeDeploy` is
/// unreachable here: a parent needs 365 days, so `StaleDay` fires first.
contract SeedDayTest is MroTestBase {
    bytes32 internal parentKey;

    function setUp() public {
        _deployAndMintOne();
        _makeWhole(1);
        while (t.seedsAvailable(1) == 0) _warpToDay(t.today() + 365);
        parentKey = t.viewOf(1).agentKeyId;
    }

    function test_aSeedForAFutureDayIsRefusedByName() public {
        uint32 tomorrow = _today() + 1;
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.FutureDay.selector, tomorrow));
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code(), tomorrow, parentKey, false);
    }

    function test_aStaleSeedDayIsRefusedByName() public {
        uint32 old = _today() - 31;
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.StaleDay.selector, old));
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code(), old, parentKey, false);
    }

    function test_thirtyDaysBackIsStillASeedDay() public {
        uint32 edge = _today() - 30;
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code(), edge, parentKey, false);
        assertEq(t.viewOf(2).mintDay, edge);
    }
}
