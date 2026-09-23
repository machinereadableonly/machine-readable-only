// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice A token's year ends at 365 credited days, and the credit that ends
/// it gives the token its finishing place. Spec sections 10f and 10l.
contract FinishLineTest is MroTestBase {
    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), _today());
    }

    function test_aCreditPast365Reverts() public {
        _makeWhole(1);
        uint32 next = t.viewOf(1).lastDay + 1;
        _warpToDay(next);
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.AlreadyFinished.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(next));
    }

    function test_level364StillCredits() public {
        _growTo(1, 364);
        assertEq(t.viewOf(1).level, 364);
    }

    uint256 internal constant ORDINAL_SHIFT = 64;

    /// @dev Mint `n` more tokens (ids 2..n+1) under fresh keys, all on today.
    function _mintMore(uint32 n) internal {
        for (uint32 i = 2; i <= n + 1; i++) {
            vm.prank(WARDEN);
            t.mint(i, ALICE, keccak256(abi.encode("key", i)), _code(), _today());
        }
    }

    function test_theFirstFinisherIsApexAndNumberOne() public {
        _makeWhole(1);
        uint256 m = t.marksOf(1);
        assertTrue(m & (1 << 15) != 0, "apex bit");
        assertEq(uint32(m >> ORDINAL_SHIFT), 1, "place 1");
        assertEq(t.finishers(), 1);
        assertEq(t.upgradeOf(15).sold, 1);
    }

    /// @dev The table, at every boundary, written out as literals so it cannot
    /// share a mistake with the function it checks.
    function test_placeToMarkBoundaries() public view {
        uint32[10] memory place = [uint32(1), 2, 4, 5, 14, 15, 64, 65, 1000, 65535];
        uint8[10] memory mark = [uint8(15), 14, 14, 13, 13, 12, 12, 11, 11, 11];
        for (uint256 i; i < 10; i++) assertEq(t.finisherMark(place[i]), mark[i]);
    }

    /// @dev Same-day finishers take places in the order the batch lists them.
    /// The Warden sorts by token id; the contract only has to honour order.
    function test_sameBatchPlacesFollowBatchOrder() public {
        _mintMore(1);
        _growTo(1, 364);
        _growTo(2, 364);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        uint32[] memory ids = new uint32[](2);
        ids[0] = 1; ids[1] = 2;
        uint32[] memory ds = new uint32[](2);
        ds[0] = d; ds[1] = d;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds);
        assertEq(uint32(t.marksOf(1) >> ORDINAL_SHIFT), 1);
        assertEq(uint32(t.marksOf(2) >> ORDINAL_SHIFT), 2);
        assertTrue(t.marksOf(2) & (1 << 14) != 0, "second place is atrium");
    }

    function test_finishingEmitsFinished() public {
        _growTo(1, 364);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        vm.expectEmit(true, true, false, true);
        emit MachineReadableOnly.Finished(1, 1, 15);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d));
    }

    function test_applyMarkRefusesEveryFinisherId() public {
        _makeWhole(1);
        for (uint8 id = 11; id <= 15; id++) {
            vm.prank(WARDEN);
            vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkNotRequestable.selector, id));
            t.applyMark(1, id, 0);
        }
    }

    /// @dev The Upgrade records are for readers; the constants decide. They
    /// must agree, or an agent reading `upgradeOf` is told a cap that is false.
    function test_ladderCapsMatchThePlaceTable() public pure {
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        assertEq(u[15].maxSupply, 1);
        assertEq(u[14].maxSupply, 3);
        assertEq(u[13].maxSupply, 10);
        assertEq(u[12].maxSupply, 50);
        assertEq(u[11].maxSupply, 0);
    }

    /// @dev THE DEPLOY'S OWN LOOP, run against the real contract.
    ///
    /// `DeployPlan5.s.sol` and `fast/DeployFast.s.sol` both write ids 1..15 with
    /// exactly this call, and nothing else in the suite makes it. That matters
    /// because `setUpgrade` has two refusals a finisher record could trip on its
    /// own -- a Mark that excludes itself and one that requires itself -- and a
    /// group mask is built by a loop rather than written out, which is precisely
    /// the shape that gets a bit wrong. A deploy script that reverts is found on
    /// the day of the deploy, with the gas already spent.
    ///
    /// Read back off the chain rather than off `Ladder.all()`, so this also
    /// proves `setUpgrade` stored what it was given.
    function test_theDeployLoopWritesEveryRecordIncludingTheFinishers() public {
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        for (uint8 i = 1; i <= 15; i++) t.setUpgrade(i, u[i]);

        assertEq(t.upgradeOf(15).maxSupply, 1, "one Apex");
        assertEq(t.upgradeOf(14).maxSupply, 3, "three Atrium");
        assertEq(t.upgradeOf(13).maxSupply, 10, "ten Valve");
        assertEq(t.upgradeOf(12).maxSupply, 50, "fifty Chamber");
        assertEq(t.upgradeOf(11).maxSupply, 0, "and Aorta is never refused");

        // The group mask, one literal per id, so a mistake in the loop that
        // builds it cannot be shared with the expectation. Bits 11-15 are
        // 0xF800; each Mark carries that minus its own bit.
        uint16[5] memory excludes = [
            uint16(0xF000),   // 11 aorta   excludes 12, 13, 14, 15
            uint16(0xE800),   // 12 chamber excludes 11, 13, 14, 15
            uint16(0xD800),   // 13 valve   excludes 11, 12, 14, 15
            uint16(0xB800),   // 14 atrium  excludes 11, 12, 13, 15
            uint16(0x7800)    // 15 apex    excludes 11, 12, 13, 14
        ];
        for (uint8 i = 11; i <= 15; i++) {
            assertEq(t.upgradeOf(i).excludes, excludes[i - 11], "a finisher exclusion mask is wrong");
            assertEq(t.upgradeOf(i).excludes & uint16(1 << i), 0, "a Mark that excludes itself is unreachable");
            assertTrue(t.upgradeOf(i).active, "a finisher Mark ships inactive");
            assertEq(t.upgradeOf(i).priceUsdc6, 0, "a place is not for sale");
            assertTrue(t.upgradeOf(i).requiresWhole, "a place is only given at a whole heart");
        }
    }

    /// @dev Bits 32-63 are the earned Iris's run. Finishing must not touch them.
    ///
    /// @dev The earned Iris is WIRED IN HERE, unlike the brief's draft of this
    /// test: `applyMark` refuses an id whose Upgrade record is not `active`, and
    /// this file's setUp deploys the pair without running the deploy script. The
    /// record comes from Ladder.sol so the gate the Mark passes is the shipping
    /// one.
    function test_finishingLeavesTheIrisRunAlone() public {
        _growTo(1, 364);
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        t.setUpgrade(6, u[6]);
        vm.prank(WARDEN);
        t.applyMark(1, 6, 0); // earned Iris at run 364 -- _growTo credits consecutive days
        uint256 before = t.marksOf(1);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d));
        // The token really did finish, asserted FIRST. Without this the test
        // passes on a contract that never writes a place at all -- measured
        // while breaking the wiring, where it stayed green with _finish
        // unreachable. An untouched field is only evidence when something
        // beside it moved.
        assertEq(uint32(t.marksOf(1) >> ORDINAL_SHIFT), 1, "the token finished");
        assertEq((t.marksOf(1) >> 32) & 0xFFFFFFFF, (before >> 32) & 0xFFFFFFFF);
    }
}
