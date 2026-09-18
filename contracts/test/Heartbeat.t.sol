// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {TokenView} from "../src/render/TokenView.sol";

/// @notice The unconditional liveness stamp, added 2026-09-18.
///
/// @dev WHY IT EXISTS, which is not the reason the review that prompted it
/// gave. That review said voucher-only operation is self-terminating; vouchers
/// are disabled on chain and the Warden holds no voucher code, so that trigger
/// cannot fire. The real hazard is wider and has nothing to do with vouchers:
/// `lastWardenDay` advances only inside `onlyWarden`, every one of those four
/// functions needs real work to do, and the Clock writes NOTHING on a day with
/// no credits, mints or mark orders. So a QUIET YEAR -- nobody returning for
/// 365 days -- lets any stranger call `sunsetByAbsence`, after which `mint` and
/// `batchCheckIn` revert `Sunset` forever and the operator is locked out of a
/// piece he is still paying to host. The comparables study makes that a
/// realistic outcome rather than an edge case: the closest project has 1 mint
/// of 5,555.
///
/// WHY NOT A MAKE-WORK CHECK-IN. A one-token `batchCheckIn` on an uncredited
/// day already restamps the clock for gas alone, burning no supply slot and no
/// key. It is rejected on meaning, not cost: it writes a check-in the agent
/// never made, forging the single thing this artwork is a record of. A
/// heartbeat that writes nothing is the only honest stamp.
///
/// WHY IT IS NOT `whenNotPaused`. The other four Warden functions each carry
/// that modifier separately, so as built a pause outlasting the absence window
/// would force the ending with no way to prevent it -- the operator present,
/// attending, and unable to say so. Liveness is exactly what a paused piece
/// still needs to assert. It writes no token state, so there is nothing a pause
/// protects against here.
contract HeartbeatTest is MroTestBase {
    address constant STRANGER = address(0xB0B);

    function setUp() public {
        _deployAndMintOne();
    }

    function test_heartbeatStampsTheDayAndWritesNothingElse() public {
        uint32 d = _today();
        TokenView memory before_ = t.viewOf(1);

        _warpToDay(d + 300);
        vm.prank(WARDEN);
        t.heartbeat();

        assertEq(t.lastWardenDay(), d + 300, "the stamp advances");

        // THE WHOLE POINT: no token gained a day, a level or a streak.
        TokenView memory after_ = t.viewOf(1);
        assertEq(after_.level, before_.level, "no level was invented");
        assertEq(after_.streak, before_.streak, "no streak was invented");
        assertEq(after_.lastDay, before_.lastDay, "no visit was forged");
        assertEq(t.totalMinted(), 1, "no supply slot was spent");
    }

    function test_onlyTheWardenCanHeartbeat() public {
        vm.prank(STRANGER);
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.heartbeat();

        vm.prank(t.owner());
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.heartbeat();
    }

    function test_aQuietYearNoLongerClosesThePiece() public {
        uint32 d = _today();

        // A year passes. One token exists; nobody returns; the Clock has
        // nothing to write. Before this function that was a closeable piece.
        _warpToDay(d + 300);
        vm.prank(WARDEN);
        t.heartbeat();

        _warpToDay(d + 400);
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NotAbsent.selector, uint32(100)));
        t.sunsetByAbsence();
    }

    function test_withoutAHeartbeatAQuietYearStillCloses() public {
        // The control. The ending must remain reachable, or the heartbeat has
        // quietly removed the ending rather than made it truthful.
        uint32 d = _today();
        _warpToDay(d + 365);
        vm.prank(STRANGER);
        t.sunsetByAbsence();
        assertTrue(t.isSunset(), "silence still ends the piece");
    }

    function test_aPausedPieceCanStillProveItIsAlive() public {
        uint32 d = _today();
        vm.prank(t.owner());
        t.pause();

        _warpToDay(d + 300);
        vm.prank(WARDEN);
        t.heartbeat();
        assertEq(t.lastWardenDay(), d + 300, "a pause does not silence the operator");

        // And the ending stays out of reach while the operator keeps saying so.
        _warpToDay(d + 400);
        vm.prank(STRANGER);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NotAbsent.selector, uint32(100)));
        t.sunsetByAbsence();
    }

    function test_aHeartbeatDoesNotReopenAClosedPiece() public {
        uint32 d = _today();
        _warpToDay(d + 365);
        vm.prank(STRANGER);
        t.sunsetByAbsence();

        uint32 closedOn = t.sunsetDay();
        vm.prank(WARDEN);
        t.heartbeat();

        assertTrue(t.isSunset(), "sunset is one-way");
        assertEq(t.sunsetDay(), closedOn, "the day it ended does not move");
    }
}
