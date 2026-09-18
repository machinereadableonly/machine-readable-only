// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";
import {ECDSA} from "../lib/openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";


/// @notice The smallest honest ERC-1271 wallet: it answers "yes" for exactly
/// the signatures its own owner made.
/// @dev Stands in for a Safe or a 4337 account. Those are contracts, and a
/// contract has no private key -- so `ECDSA.recover` on a signature "from" one
/// can never return its address. A contract signs by being ASKED, which is
/// what ERC-1271 is.
contract ERC1271Wallet {
    address public immutable owner;

    constructor(address o) {
        owner = o;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == owner) return 0x1626ba7e;
        return 0xffffffff;
    }
}

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
    /// @dev NAMED, not a blanket `vm.expectRevert()`. This used to accept any
    /// revert at all, which meant it could not see the change of 2026-09-18:
    /// under `ECDSA.recoverCalldata` a four-byte signature reverted
    /// `ECDSAInvalidSignatureLength`, and under SignatureChecker it reverts
    /// `BadVoucher` -- because `tryRecover` returns its error rather than
    /// throwing it. Same refusal, one error instead of four, and the three
    /// ECDSA errors have left the ABI. A caller now handles exactly one.
    function test_aMalformedSignatureRevertsAsBadVoucher() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
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

    // -----------------------------------------------------------------
    // A WARDEN THAT IS A CONTRACT
    //
    // The durability path exists so the piece can outlive the Warden, and the
    // Warden most likely to outlive a person is a Safe or a 4337 account --
    // not the single key this box holds. Both are CONTRACTS, and a contract
    // cannot produce a signature that `ECDSA.recover` resolves to its own
    // address; it signs by being asked, through ERC-1271.
    //
    // Until 2026-09-18 `checkInWithVoucher` recovered an address and compared
    // it, so rotating the warden to either would have silently broken every
    // voucher that will ever be signed -- in bytecode with no upgrade path,
    // on the one path whose entire purpose is surviving the operator.
    // -----------------------------------------------------------------

    /// @dev The whole point: a Safe-shaped warden can authorise a voucher.
    function test_aContractWardenCanSignAVoucher() public {
        ERC1271Wallet safe = new ERC1271Wallet(vm.addr(WARDEN_KEY));
        t.setWarden(address(safe));
        t.setVouchersEnabled(true);

        uint32 d = t.today() + 1;
        _warpToDay(d);
        bytes memory sig = _sign(1, d);   // signed by the safe's OWNER

        vm.prank(MALLORY);
        t.checkInWithVoucher(1, d, sig);

        assertEq(t.viewOf(1).level, 2, "the day must be credited");
        assertEq(t.viewOf(1).streak, 2);
    }

    /// @dev And the refusal that proves the acceptance means something: the
    /// wallet is asked, and it says no to a signature its owner did not make.
    function test_aContractWardenRefusesAStrangersSignature() public {
        ERC1271Wallet safe = new ERC1271Wallet(vm.addr(WARDEN_KEY));
        t.setWarden(address(safe));
        t.setVouchersEnabled(true);

        uint32 d = t.today() + 1;
        _warpToDay(d);
        bytes32 digest = t.voucherHash(1, d);
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(0xBADBEEF, digest);
        bytes memory sig = abi.encodePacked(rr, ss, v);

        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(1, d, sig);
    }

    /// @dev A warden contract that answers NOTHING useful -- any contract that
    /// is not ERC-1271 at all -- must refuse rather than pass. This is the
    /// case that would otherwise turn a misconfigured rotation into an open
    /// door.
    function test_aWardenContractThatIsNotERC1271RefusesEverything() public {
        // The renderer is a contract with no isValidSignature at all.
        t.setWarden(address(r));
        t.setVouchersEnabled(true);

        uint32 d = t.today() + 1;
        _warpToDay(d);
        bytes memory sig = _sign(1, d);

        vm.prank(MALLORY);
        vm.expectRevert(MachineReadableOnly.BadVoucher.selector);
        t.checkInWithVoucher(1, d, sig);
    }

    /// @dev THE CONTROL. An EOA warden must keep working exactly as before --
    /// which is what the rest of this file asserts, and is restated here
    /// beside the new path so the two are read together.
    function test_anEoaWardenStillSignsVouchers() public {
        t.setVouchersEnabled(true);
        uint32 d = t.today() + 1;
        _warpToDay(d);
        bytes memory sig = _sign(1, d);
        vm.prank(MALLORY);
        t.checkInWithVoucher(1, d, sig);
        assertEq(t.viewOf(1).level, 2);
    }
}
