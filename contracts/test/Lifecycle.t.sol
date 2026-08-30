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

    // -------------------------------------------------------------------
    // seed and the per-year budget
    // -------------------------------------------------------------------

    /// @dev Put a token at an arbitrary level by checking it in repeatedly is
    /// far too slow, so the budget tests warp the clock and check in once per
    /// needed day instead. 365 check-ins is affordable in a test; a decade is
    /// not, which is why seedsAvailable is asserted directly.
    function _makeWhole(uint256 id) internal {
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](364);
        uint32[] memory ds = new uint32[](364);
        for (uint32 i = 0; i < 364; i++) {
            ids[i] = uint32(id);
            ds[i] = d + 1 + i;
        }
        bytes memory packed;
        for (uint32 i = 0; i < 364; i++) packed = abi.encodePacked(packed, ids[i]);
        vm.prank(WARDEN);
        t.batchCheckIn(packed, ds);
        assertEq(t.viewOf(id).level, 365);
    }

    function test_seedRequiresAWholeParent() public {
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.ParentNotWhole.selector);
        t.seed(2, 1, ALICE, _code());
    }

    function test_seedCreatesAChildWithTheParentsKeyAndNextGeneration() public {
        _makeWhole(1);
        // One year of tenure has passed on the key, so one seed is available.
        _warpOneYear();
        assertEq(t.seedsAvailable(1), 1);

        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code());

        assertEq(t.ownerOf(2), ALICE);
        assertEq(t.viewOf(2).generation, 1);
        assertEq(t.viewOf(2).parent, 1);
        assertEq(t.viewOf(2).level, 1);
        assertEq(t.viewOf(2).streak, 1);
        assertEq(t.viewOf(2).agentKeyId, t.viewOf(1).agentKeyId);
        assertEq(t.viewOf(1).seedsGiven, 1);
    }

    /// @dev Note 4 of the task brief: batchCheckIn's NoSuchToken guard reverts
    /// when level == 0, so a child that seed() forgot to set level = 1 on
    /// would be permanently uncheckable. Prove the child is a real, live
    /// token by actually checking it in.
    function test_seedChildCanBeCheckedInAfterward() public {
        _makeWhole(1);
        _warpOneYear();
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code());

        uint32 day = t.today() + 1;
        vm.prank(WARDEN);
        t.batchCheckIn(_one(2), _days(day));

        assertEq(t.viewOf(2).level, 2);
        assertEq(t.viewOf(2).streak, 2);
    }

    function test_theBudgetIsOnePerYearOfKeyTenure() public {
        _makeWhole(1);
        _warpOneYear();
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code());

        // The second seed in the same year has no budget.
        assertEq(t.seedsAvailable(1), 0);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.NoSeedAvailable.selector);
        t.seed(3, 1, ALICE, _code());

        // A second year of tenure grants exactly one more.
        _warpOneYear();
        assertEq(t.seedsAvailable(1), 1);
        vm.prank(WARDEN);
        t.seed(3, 1, ALICE, _code());
        assertEq(t.viewOf(1).seedsGiven, 2);
    }

    /// @dev Tenure, not depth: a child cannot accelerate the lineage, because
    /// the budget is keyed by the AGENT KEY and the child shares its parent's.
    function test_aChildSharesTheParentsBudgetAndCannotAccelerate() public {
        _makeWhole(1);
        _warpOneYear();
        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code());

        // The child is on the same key, so it sees the same exhausted budget
        // even once it is itself whole.
        assertEq(t.seedsAvailable(2), 0);
    }

    function test_seedRevertsForANonWarden() public {
        _makeWhole(1);
        _warpOneYear();
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.seed(2, 1, ALICE, _code());
    }

    function test_seedRefusesARestingParent() public {
        _makeWhole(1);
        _warpOneYear();
        vm.prank(ALICE);
        t.rest(1);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.seed(2, 1, ALICE, _code());
    }

    function test_seedIsBlockedBySunsetAndBySupplyCap() public {
        _makeWhole(1);
        _warpOneYear();
        t.setSupplyCap(1);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.SupplyCap.selector);
        t.seed(2, 1, ALICE, _code());

        t.setSupplyCap(100);
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.seed(2, 1, ALICE, _code());
    }
}
