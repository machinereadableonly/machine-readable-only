// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Ladder} from "../src/Ladder.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

contract RedeployFixesTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
    }

    // rest

    function test_restStoresItsDay() public {
        _warpToDay(_today() + 9);
        uint32 d = _today();
        vm.prank(ALICE);
        t.rest(1);
        assertEq(t.viewOf(1).restDay, d);
    }

    function test_aSecondRestIsRefused() public {
        vm.prank(ALICE);
        t.rest(1);
        vm.prank(ALICE);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.rest(1);
    }

    function test_restDayIsZeroWhileNotResting() public view {
        assertEq(t.viewOf(1).restDay, 0);
    }

    // bestRunOf

    function test_bestRunOfReadsTheLongestRunEver() public {
        uint32 d0 = _today();
        uint32[] memory ids = new uint32[](3);
        uint32[] memory ds = new uint32[](3);
        ids[0] = 1; ids[1] = 1; ids[2] = 1;
        ds[0] = d0 + 1; ds[1] = d0 + 2; ds[2] = d0 + 5;
        _warpToDay(d0 + 5);
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds, _noBits(ds), _silent(ds));
        assertEq(t.viewOf(1).streak, 1, "the run fell");
        assertEq(t.bestRunOf(1), 3, "the run of three is kept");
    }

    function test_bestRunOfAnUnmintedTokenIsZero() public view {
        assertEq(t.bestRunOf(999), 0);
    }

    // heartbeat

    function test_heartbeatIsRefusedAfterSunset() public {
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.heartbeat();
    }

    // finisher records

    function test_aFinisherRecordIsWrittenOnce() public {
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        t.setUpgrade(15, u[15]);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.FinisherRecordSet.selector, uint8(15)));
        t.setUpgrade(15, u[15]);
    }

    function test_aLadderRecordCanStillBeEdited() public {
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        t.setUpgrade(1, u[1]);
        t.setUpgrade(1, u[1]);
        assertTrue(t.upgradeOf(1).active);
    }

    // _mint

    function test_mintToAContractWithoutAReceiverHookLands() public {
        address noHook = address(r);
        uint32 day = _today();
        bytes memory code = _code();
        vm.prank(WARDEN);
        t.mint(2, noHook, bytes32(uint256(2)), code, day, false);
        assertEq(t.ownerOf(2), noHook);
    }

    // freezeRenderer

    function test_freezeRendererStopsEverySwap() public {
        t.freezeRenderer();
        assertTrue(t.rendererFrozen());
        Renderer r2 = new Renderer();
        vm.expectRevert(MachineReadableOnly.RendererIsFrozen.selector);
        t.setRenderer(address(r2));
        assertEq(t.renderer(), address(r));
    }

    function test_freezeRendererEmits() public {
        vm.expectEmit(address(t));
        emit MachineReadableOnly.RendererFrozen(address(r));
        t.freezeRenderer();
    }

    function test_aSecondFreezeIsRefused() public {
        t.freezeRenderer();
        vm.expectRevert(MachineReadableOnly.RendererIsFrozen.selector);
        t.freezeRenderer();
    }

    function test_onlyTheOwnerCanFreezeTheRenderer() public {
        vm.prank(MALLORY);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY));
        t.freezeRenderer();
    }

    function test_theRendererCanBeSwappedUntilFrozen() public {
        Renderer r2 = new Renderer();
        t.setRenderer(address(r2));
        assertEq(t.renderer(), address(r2));
    }
}
