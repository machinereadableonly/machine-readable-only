// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";

/// @notice A seal stops the picture where it stood, under the live rules.
contract RestDayTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
        _growTo(1, 10);
    }

    function test_restFreezesThePictureAsItWasOnTheRestDay() public {
        _warpToDay(t.today() + 40);
        string memory before = r.svg(t.viewOf(1));
        vm.prank(ALICE);
        t.rest(1);
        assertEq(r.svg(t.viewOf(1)), before, "resting changed the picture");
        _warpToDay(t.today() + 400);
        assertEq(r.svg(t.viewOf(1)), before, "a rested token kept paling");
    }

    function test_restAfterSunsetChangesNothing() public {
        _warpToDay(t.today() + 5);
        t.sunset();
        _warpToDay(t.today() + 40);
        string memory before = r.svg(t.viewOf(1));
        vm.prank(ALICE);
        t.rest(1);
        assertEq(r.svg(t.viewOf(1)), before, "the earlier stop, the sunset, must win");
    }

    function test_aFinishedTokenDoesNotPaleByRestingLater() public {
        _growTo(1, 365);
        string memory before = r.svg(t.viewOf(1));
        _warpToDay(t.today() + 200);
        vm.prank(ALICE);
        t.rest(1);
        assertEq(r.svg(t.viewOf(1)), before);
    }
}
