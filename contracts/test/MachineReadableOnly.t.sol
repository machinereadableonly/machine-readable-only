// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Vm} from "forge-std/Vm.sol";
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

    /// @dev unpause() is guarded by nothing but onlyOwner, so if that modifier
    /// were ever dropped this is the only test that would notice.
    function test_unpauseRevertsForANonOwner() public {
        t.pause();
        vm.prank(MALLORY);
        vm.expectRevert();
        t.unpause();
        // Still paused: the failed call changed nothing.
        assertTrue(t.paused());
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

    function _mint(uint256 id, address to, bytes32 key) internal {
        vm.prank(WARDEN);
        t.mint(id, to, key, _code());
    }

    function test_mintSetsDayOneState() public {
        _mint(1, ALICE, KEY);
        assertEq(t.ownerOf(1), ALICE);
        assertEq(t.viewOf(1).level, 1);
        assertEq(t.viewOf(1).streak, 1);
        assertEq(t.viewOf(1).lastDay, t.today());
        assertEq(t.viewOf(1).mintDay, t.today());
        assertEq(t.viewOf(1).agentKeyId, KEY);
        assertEq(t.viewOf(1).code.length, 172);
        assertEq(t.totalMinted(), 1);
        assertEq(t.mintedTo(ALICE), 1);
    }

    /// 1.L4: this was `test_mintEmitsMintedAndMetadataUpdate`, and it asserted
    /// only the first half. `mint` emits NO MetadataUpdate and should not --
    /// ERC-4906 announces a change to metadata a consumer may already hold, and
    /// there is nothing to have held for a token being created. The name is now
    /// what the test does; the absence is asserted below rather than implied.
    function test_mintEmitsMinted() public {
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.Minted(1, KEY);
        _mint(1, ALICE, KEY);
    }

    /// The other half, said out loud: a mint announces no metadata UPDATE,
    /// because nothing could have read this token's metadata before it existed.
    function test_mintEmitsNoMetadataUpdate() public {
        vm.recordLogs();
        _mint(1, ALICE, KEY);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("MetadataUpdate(uint256)");
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != topic, "mint must not emit MetadataUpdate");
        }
    }

    function test_mintRevertsForANonWarden() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.mint(1, ALICE, KEY, _code());
    }

    function test_oneMintPerKeyEver() public {
        _mint(1, ALICE, KEY);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.AlreadyMinted.selector);
        t.mint(2, ALICE, KEY, _code());
    }

    function test_mintRejectsATakenId() public {
        _mint(1, ALICE, KEY);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.TokenExists.selector, uint256(1)));
        t.mint(1, ALICE, bytes32(uint256(2)), _code());
    }

    function test_mintRejectsAWrongLengthCode() public {
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadCodeLength.selector, uint256(3)));
        t.mint(1, ALICE, KEY, hex"010203");
    }

    function test_mintEnforcesTheSupplyCap() public {
        t.setSupplyCap(1);
        _mint(1, ALICE, KEY);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.SupplyCap.selector);
        t.mint(2, ALICE, bytes32(uint256(2)), _code());
    }

    /// @dev The cap counts tokens ever minted to an address, not tokens held,
    /// so transferring one out does not free a slot. Spec conflict 12.
    function test_walletCapCountsMintsNotHoldings() public {
        t.setWalletCap(1);
        _mint(1, ALICE, KEY);
        vm.prank(ALICE);
        t.transferFrom(ALICE, MALLORY, 1);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.WalletCap.selector);
        t.mint(2, ALICE, bytes32(uint256(2)), _code());
    }

    function test_mintIsBlockedByPause() public {
        t.pause();
        vm.prank(WARDEN);
        vm.expectRevert();
        t.mint(1, ALICE, KEY, _code());
    }

    function test_mintIsBlockedBySunset() public {
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.mint(1, ALICE, KEY, _code());
    }

    function test_transferStillWorksWhenPaused() public {
        _mint(1, ALICE, KEY);
        t.pause();
        vm.prank(ALICE);
        t.transferFrom(ALICE, MALLORY, 1);
        assertEq(t.ownerOf(1), MALLORY);
    }
}
