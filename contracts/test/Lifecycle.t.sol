// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice rebind and rest. Both are token-owner functions, not Warden ones.
contract LifecycleTest is MroTestBase {

    function setUp() public {
        _deployAndMintOne();
    }

    function test_rebindByTheTokenOwnerKeepsLevelAndStreak() public {
        uint32 day = t.today() + 1;
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(day));

        vm.prank(ALICE);
        t.rebind(1, bytes32(uint256(0xBEEF)));

        assertEq(t.viewOf(1).agentKeyId, bytes32(uint256(0xBEEF)));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
    }

    function test_rebindRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotTokenOwner.selector);
        t.rebind(1, bytes32(uint256(2)));
    }

    /// @dev Binding is unlimited even though minting is once per key: a key
    /// that already minted can be bound to a second token it was given.
    function test_aKeyCanBeBoundToSeveralTokens() public {
        vm.prank(WARDEN);
        t.mint(2, ALICE, bytes32(uint256(2)), _code());
        vm.startPrank(ALICE);
        t.rebind(1, bytes32(uint256(0xAAA)));
        t.rebind(2, bytes32(uint256(0xAAA)));
        vm.stopPrank();
        assertEq(t.viewOf(1).agentKeyId, bytes32(uint256(0xAAA)));
        assertEq(t.viewOf(2).agentKeyId, bytes32(uint256(0xAAA)));
    }

    /// @dev Rebinding to a key that already minted must NOT free that key's
    /// mint. hasMinted is permanent.
    function test_rebindDoesNotResurrectAMint() public {
        vm.prank(ALICE);
        t.rebind(1, bytes32(uint256(0xCAFE)));
        // The original key already minted, so it still cannot mint again.
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.AlreadyMinted.selector);
        t.mint(3, MALLORY, KEY, _code());
    }

    function test_restSealsTheTokenAndEmits() public {
        vm.expectEmit(true, false, false, false);
        emit MachineReadableOnly.Rested(1, 0, 0, 0);
        vm.prank(ALICE);
        t.rest(1);
        assertTrue(t.viewOf(1).resting);
    }

    function test_restRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.NotTokenOwner.selector);
        t.rest(1);
    }

    function test_restingBlocksCheckInAndMarksButNotTransferOrRebind() public {
        vm.prank(ALICE);
        t.rest(1);

        uint32 day = t.today() + 1;
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(day));

        // Transfer still works.
        vm.prank(ALICE);
        t.transferFrom(ALICE, MALLORY, 1);
        assertEq(t.ownerOf(1), MALLORY);

        // And so does rebind, by the NEW owner.
        vm.prank(MALLORY);
        t.rebind(1, bytes32(uint256(0xD00D)));
        assertEq(t.viewOf(1).agentKeyId, bytes32(uint256(0xD00D)));
    }

    function test_restIsIrreversible() public {
        vm.startPrank(ALICE);
        t.rest(1);
        // There is no unrest function; resting again is a no-op that still
        // leaves it sealed.
        t.rest(1);
        vm.stopPrank();
        assertTrue(t.viewOf(1).resting);
    }
}
