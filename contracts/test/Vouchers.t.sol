// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The durability path. Ships present and OFF, so a token can outlive
/// the Warden if the operator ever switches to voucher-only mode.
contract VouchersTest is MroTestBase {
    /// @dev This suite cannot use the base's `_deployAndMintOne`, because the
    /// Warden here has to be an address we hold the private key for -- the
    /// whole point is signing vouchers as it. Everything else comes from the
    /// base.
    uint256 internal constant WARDEN_KEY = 0xA11CE5EED;
    address internal wardenAddr;

    function setUp() public {
        wardenAddr = vm.addr(WARDEN_KEY);
        r = new Renderer();
        t = new MachineReadableOnly(address(r), wardenAddr);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(wardenAddr);
        t.mint(1, ALICE, KEY, _code(), _today());
    }

    function _sign(uint256 id, uint32 day) internal view returns (bytes memory) {
        bytes32 digest = t.voucherHash(id, day);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(WARDEN_KEY, digest);
        return abi.encodePacked(rr, s, v);
    }

    function test_vouchersAreOffAtLaunch() public {
        assertFalse(t.vouchersEnabled());
        uint32 d = t.today() + 1;
        // Hoisted: _sign() itself calls t.voucherHash() externally. Computing
        // it after arming expectRevert/prank would let that external call
        // consume them instead of the checkInWithVoucher call under test.
        bytes memory sig = _sign(1, d);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.VouchersDisabled.selector);
        t.checkInWithVoucher(1, d, sig);
    }

    function test_anyoneCanSubmitAValidVoucherOnceEnabled() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        bytes memory sig = _sign(1, d);
        // Mallory pays the gas; the signature is what authorises it.
        vm.prank(MALLORY);
        t.checkInWithVoucher(1, d, sig);
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
    }

    function test_aVoucherSignedByTheWrongKeyIsRejected() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        bytes32 digest = t.voucherHash(1, d);
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(0xBAD5EED, digest);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(1, d, abi.encodePacked(rr, s, v));
    }

    /// @dev The signature covers the day, so a voucher cannot be replayed onto
    /// a different day.
    function test_aVoucherCannotBeReplayedOntoAnotherDay() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        bytes memory sig = _sign(1, d);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(1, d + 1, sig);
    }

    /// @dev And the same voucher twice fails on the day rule, not the signature.
    function test_theSameVoucherTwiceFailsOnTheDayRule() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        bytes memory sig = _sign(1, d);
        vm.startPrank(MALLORY);
        t.checkInWithVoucher(1, d, sig);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.DayNotAdvanced.selector, uint256(1)));
        t.checkInWithVoucher(1, d, sig);
        vm.stopPrank();
    }

    /// @dev The durability path carries the same upper bound on `day` as
    /// batchCheckIn. It ships disabled, but it can never be ADDED later either,
    /// so it cannot be left with a hole: a voucher for a nonsense future day
    /// would set lastDay beyond any reachable day and brick the token forever.
    function test_aVoucherForAFutureDayIsRejected() public {
        t.setVouchersEnabled(true);
        uint32 far = t.today() + 5_000;
        bytes memory sig = _sign(1, far);
        vm.prank(MALLORY);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.FutureDay.selector, far));
        t.checkInWithVoucher(1, far, sig);
        assertEq(t.viewOf(1).lastDay, t.today(), "lastDay was never corrupted");
    }

    function test_setVouchersEnabledRevertsForANonOwner() public {
        vm.prank(MALLORY);
        vm.expectRevert();
        t.setVouchersEnabled(true);
    }

    function test_vouchersAreBlockedByResting() public {
        t.setVouchersEnabled(true);
        vm.prank(ALICE);
        t.rest(1);
        uint32 d = t.today() + 1;
        bytes memory sig = _sign(1, d);
        vm.prank(MALLORY);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, uint256(1)));
        t.checkInWithVoucher(1, d, sig);
    }

    function test_vouchersAreBlockedBySunset() public {
        t.setVouchersEnabled(true);
        t.sunset();
        uint32 d = t.today() + 1;
        bytes memory sig = _sign(1, d);
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.checkInWithVoucher(1, d, sig);
    }

    /// @dev An id with no mint has a zero Token struct -- lastDay 0, level 0 --
    /// so without an explicit existence check a voucher for it would pass the
    /// day rule and silently write phantom state for a token nobody owns.
    function test_aVoucherForAnUnmintedTokenIsRejected() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        bytes memory sig = _sign(99, d);
        vm.prank(MALLORY);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NoSuchToken.selector, uint256(99)));
        t.checkInWithVoucher(99, d, sig);
    }

    /// @dev The signer is read from `warden` at call time, not cached at
    /// signing time, so rotating the Warden invalidates every voucher the old
    /// key already signed.
    function test_rotatingTheWardenInvalidatesOldVouchers() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        bytes memory sig = _sign(1, d);

        address newWarden = vm.addr(0xF00D);
        t.setWarden(newWarden);

        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(1, d, sig);
    }

    /// @dev ECDSA.recoverCalldata reverts on a malformed signature (wrong
    /// length here) rather than resolving to address(0), so a garbage
    /// signature can never be mistaken for a valid one.
    function test_aMalformedSignatureReverts() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        vm.prank(MALLORY);
        vm.expectRevert();
        t.checkInWithVoucher(1, d, hex"deadbeef");
    }

    /// @dev The digest covers the token id, so a voucher earned by one token
    /// cannot be spent on another. Pinned by test rather than left to the
    /// typehash's construction: if `id` were ever dropped from
    /// VOUCHER_TYPEHASH, every other voucher test here would still pass.
    function test_aVoucherCannotBeReplayedOntoAnotherToken() public {
        t.setVouchersEnabled(true);
        vm.prank(wardenAddr);
        t.mint(2, MALLORY, bytes32(uint256(2)), _code(), _today());

        uint32 d = t.today() + 1;
        _warpToDay(d);
        bytes memory sigForToken1 = _sign(1, d);

        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(2, d, sigForToken1);

        // And the same voucher still works on the token it was signed for,
        // which is what proves the revert above was about the id and not
        // about the voucher being invalid in general.
        vm.prank(MALLORY);
        t.checkInWithVoucher(1, d, sigForToken1);
        assertEq(t.viewOf(1).level, 2);
    }
}
