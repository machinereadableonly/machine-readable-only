// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice Construction, dials, pause and Ownable2Step for the real contract.
/// @dev Per the project's smart-contract rules, every owner function has an
/// explicit test and every access-control revert has one too.
contract MachineReadableOnlyTest is MroTestBase {
    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
    }

    function test_constructorSetsRendererWardenAndDials() public view {
        assertEq(t.renderer(), address(r));
        assertEq(t.warden(), WARDEN);
        assertEq(t.supplyCap(), 10_000);
        assertEq(t.walletCap(), 20);
        assertEq(t.totalMinted(), 0);
        assertFalse(t.isSunset());
        assertFalse(t.vouchersEnabled());
    }

    function test_constructorRejectsAZeroRenderer() public {
        vm.expectRevert(MachineReadableOnly.ZeroRenderer.selector);
        new MachineReadableOnly(address(0), WARDEN);
    }

    function test_constructorRejectsAZeroWarden() public {
        vm.expectRevert(MachineReadableOnly.ZeroWarden.selector);
        new MachineReadableOnly(address(r), address(0));
    }

    function test_todayIsTheUtcDayIndex() public {
        vm.warp(86_400 * 20_000 + 5);
        assertEq(t.today(), 20_000);
    }

    function test_setRendererByOwner() public {
        Renderer r2 = new Renderer();
        t.setRenderer(address(r2));
        assertEq(t.renderer(), address(r2));
    }

    function test_setRendererRejectsZero() public {
        vm.expectRevert(MachineReadableOnly.ZeroRenderer.selector);
        t.setRenderer(address(0));
    }

    function test_setRendererRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setRenderer(address(r));
    }

    function test_setWardenByOwnerAndRejectsZero() public {
        t.setWarden(address(0xBEEF));
        assertEq(t.warden(), address(0xBEEF));
        vm.expectRevert(MachineReadableOnly.ZeroWarden.selector);
        t.setWarden(address(0));
    }

    function test_setWardenRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setWarden(MALLORY);
    }

    function test_setSupplyCapAndWalletCap() public {
        t.setSupplyCap(50);
        t.setWalletCap(3);
        assertEq(t.supplyCap(), 50);
        assertEq(t.walletCap(), 3);
    }

    function test_setSupplyCapRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setSupplyCap(1);
    }

    function test_setWalletCapRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setWalletCap(1);
    }

    function test_pauseAndUnpauseByOwner() public {
        t.pause();
        assertTrue(t.paused());
        t.unpause();
        assertFalse(t.paused());
    }

    function test_pauseRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.pause();
    }

    function test_sunsetSetsTheDayAndIsIrreversible() public {
        vm.warp(86_400 * 1234 + 1);
        t.sunset();
        assertTrue(t.isSunset());
        assertEq(t.sunsetDay(), 1234);
        vm.expectRevert(MachineReadableOnly.AlreadySunset.selector);
        t.sunset();
    }

    /// @dev The regression behind spec conflict 3. Foundry's clock starts at
    /// timestamp 1, so today() is genuinely 0 and a zero sentinel would fail.
    function test_sunsetOnDayZeroIsStillSunset() public {
        assertEq(t.today(), 0);
        t.sunset();
        assertTrue(t.isSunset());
        assertEq(t.sunsetDay(), 0);
    }

    function test_sunsetRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.sunset();
    }

    function test_ownable2StepHandover() public {
        t.transferOwnership(ALICE);
        // The old owner still holds control until the new one accepts.
        assertEq(t.owner(), address(this));
        vm.prank(ALICE);
        t.acceptOwnership();
        assertEq(t.owner(), ALICE);
    }

    function test_supportsErc4906AndErc721() public view {
        assertTrue(t.supportsInterface(0x49064906), "ERC-4906");
        assertTrue(t.supportsInterface(0x80ac58cd), "ERC-721");
    }
}
