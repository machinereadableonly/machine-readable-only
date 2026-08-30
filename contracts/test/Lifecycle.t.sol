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
        _warpToDay(day);
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

    /// @dev Resting twice and finding it still set is exactly what a NO-OP
    /// looks like, so that alone proves nothing. What makes rest irreversible
    /// is that the contract exposes no path that clears the flag, and that
    /// every write path stays closed afterwards -- including the ones a future
    /// operator might reach for. That is what this asserts.
    function test_restIsIrreversible() public {
        vm.prank(ALICE);
        t.rest(1);
        assertTrue(t.viewOf(1).resting, "sealed");

        // No selector on the ABI clears it. `unrest` and `setResting` do not
        // exist; a call to either is dispatched to the fallback and reverts.
        (bool okA,) = address(t).call(abi.encodeWithSignature("unrest(uint256)", uint256(1)));
        (bool okB,) = address(t).call(abi.encodeWithSignature("setResting(uint256,bool)", uint256(1), false));
        assertFalse(okA, "no unrest function exists");
        assertFalse(okB, "no resting setter exists");

        // The owner's dials, pause and unpause included, do not reopen it.
        t.pause();
        t.unpause();
        assertTrue(t.viewOf(1).resting, "owner powers do not reopen a rested token");

        // Transferring the token does not clear it either -- a new owner
        // inherits a sealed token, which is the point of the ending.
        vm.prank(ALICE);
        t.transferFrom(ALICE, MALLORY, 1);
        assertTrue(t.viewOf(1).resting, "a new owner inherits the seal");

        // And every write path stays shut for the new owner.
        uint32 tomorrow = t.today() + 1;
        _warpToDay(tomorrow);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(tomorrow));

        vm.prank(MALLORY);
        t.rest(1);
        assertTrue(t.viewOf(1).resting, "and resting again is a harmless no-op");
    }

    // -------------------------------------------------------------------
    // seed and the per-year budget
    // -------------------------------------------------------------------

    /// @notice ACCEPTED BEHAVIOUR, pinned so it is not re-audited as a defect.
    ///
    /// @dev `rebind` takes any bytes32 with no proof the caller holds that key,
    /// and `seedsAvailable` is keyed on the agent key, so a token owner CAN
    /// point a token at another key's earned seed budget and spend it.
    ///
    /// This is a decided trust boundary, not an oversight. `seed` is
    /// `onlyWarden`, and the Warden re-checks the RFC 9421 signature against
    /// the CURRENT ON-CHAIN binding before calling -- the same trust boundary
    /// as mint, check-in and marks. The rejected alternatives both fail worse:
    /// EIP-712 proof-of-possession strands a token whose agent lost its key,
    /// and Warden-only rebind means a token could never be rebound if the
    /// Warden died.
    ///
    /// What this test pins for Plan 3: the Warden's re-check is FRONT-RUNNABLE.
    /// Rebinding one block before the Warden's `seed` lands means the Warden
    /// validated a binding that no longer holds. The Warden must therefore
    /// submit `seed` with the key it expects and have the contract check it, or
    /// the operator accepts the front-run knowingly. The Warden's re-check must
    /// read the CHAIN, never its own database.
    function test_rebindCanSpendAnotherKeysSeedBudget_acceptedTrustBoundary() public {
        bytes32 victimKey = bytes32(uint256(0x171c7));
        vm.prank(WARDEN);
        t.mint(2, ALICE, victimKey, _code());   // the victim, minted today

        _warpOneYear();                          // the victim's key earns a seed

        bytes32 freshKey = bytes32(uint256(0xf5e5));
        vm.prank(WARDEN);
        t.mint(3, MALLORY, freshKey, _code());  // Mallory mints with no tenure
        _makeWhole(3);

        assertEq(t.seedsAvailable(2), 1, "the victim's key earned a seed");
        assertEq(t.seedsAvailable(3), 0, "a fresh key has earned nothing");

        // Mallory owns token 3 and points it at the victim's key. No proof asked.
        vm.prank(MALLORY);
        t.rebind(3, victimKey);
        assertEq(t.seedsAvailable(3), 1, "token 3 now draws on the victim's budget");

        // An honest Warden whose check ran before the rebind landed now seeds.
        vm.prank(WARDEN);
        t.seed(77, 3, MALLORY, _code());

        assertEq(t.seedsAvailable(2), 0, "and the victim's earned seed is spent");
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
        _warpToDay(day);
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
