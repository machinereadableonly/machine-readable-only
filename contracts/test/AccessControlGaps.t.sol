// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice The access-control gaps the 2026-09-04 security review found by
/// grepping for every custom error selector and every privileged function.
///
/// @dev Coverage was already strong -- all four `onlyWarden` functions, both
/// `onlyTokenOwner` functions and every `onlyOwner` dial had a revert test.
/// These are the holes that grep found anyway, and they are of two kinds.
///
/// FIRST, modifiers with no test at all on that function: `seed`'s
/// `whenNotPaused` and `checkInWithVoucher`'s `whenNotPaused`. Drop either
/// modifier and the suite stayed green.
///
/// SECOND, and worse: NO test anywhere asserted `Pausable.EnforcedPause` or
/// `Ownable.OwnableUnauthorizedAccount`. Every pause and non-owner test used a
/// bare `vm.expectRevert()`, which matches ANY revert -- so each of them would
/// pass if the call reverted for a completely unrelated reason. This project's
/// own foundry-test-traps note is about exactly that hazard, and these tests
/// name the selector so the assertion can only pass for the right reason.
contract AccessControlGapsTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
    }

    // -------------------------------------------------------------------
    // Modifiers with no test on that function
    // -------------------------------------------------------------------

    /// @dev `seed` carries whenNotPaused at the contract. Lifecycle.t.sol
    /// covers its sunset and supply-cap paths and never pauses.
    function test_seedIsBlockedByPause() public {
        _makeWhole(1);
        _warpOneYear();
        assertEq(t.seedsAvailable(1), 1, "the seed is available, so pause is what refuses");

        t.pause();
        vm.prank(WARDEN);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.seed(2, 1, ALICE, _code(), _today());
    }

    /// @dev CONTROL: unpausing lets the same call through, so the test above
    /// pins the pause rather than some other precondition.
    function test_seedWorksOnceUnpaused() public {
        _makeWhole(1);
        _warpOneYear();
        t.pause();
        t.unpause();

        vm.prank(WARDEN);
        t.seed(2, 1, ALICE, _code(), _today());
        assertEq(t.ownerOf(2), ALICE);
    }

    /// @dev The voucher path matters more than the others: it is the ONE write
    /// path that is not onlyWarden, so its pause is the only thing standing
    /// between a paused piece and an outside caller crediting a day.
    function test_voucherCheckInIsBlockedByPause() public {
        t.setVouchersEnabled(true);
        // READ THE DAY FIRST. `t.today()` is a call, and expectRevert matches
        // the NEXT call -- inline in the argument list it swallows the
        // expectation and the assertion silently tests nothing. This project's
        // foundry-test-traps note is about precisely this, and writing it the
        // wrong way here is what caught it.
        uint32 day = t.today();
        t.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.checkInWithVoucher(1, day, hex"00");
    }

    // -------------------------------------------------------------------
    // Guards on `seed` that were tested only on `mint`
    // -------------------------------------------------------------------

    /// @dev The spec says "seeded children are counted the same way", and the
    /// cap appeared in the test tree only on the mint path.
    function test_seedIsBlockedByWalletCap() public {
        _makeWhole(1);
        _warpOneYear();
        t.setWalletCap(1);   // ALICE already holds token 1

        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.WalletCap.selector);
        t.seed(2, 1, ALICE, _code(), _today());
    }

    /// @dev Reusing a live id through the seed path, tested only for mint.
    function test_seedRejectsAnIdThatAlreadyExists() public {
        _makeWhole(1);
        _warpOneYear();

        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.TokenExists.selector, uint256(1)));
        t.seed(1, 1, ALICE, _code(), _today());
    }

    /// @dev A short bitmap through the seed path, tested only for mint. The
    /// code is written once and never rewritten, so a wrong length here is a
    /// permanently unrenderable token.
    function test_seedRejectsACodeOfTheWrongLength() public {
        _makeWhole(1);
        _warpOneYear();

        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.BadCodeLength.selector, uint256(2)));
        t.seed(2, 1, ALICE, hex"dead", _today());
    }

    // -------------------------------------------------------------------
    // Assertions that could previously pass for the wrong reason
    // -------------------------------------------------------------------

    /// @dev Every pause test in the tree used a bare vm.expectRevert(). Naming
    /// the selector is the difference between "this reverted" and "this
    /// reverted BECAUSE the contract is paused".
    function test_pauseRevertsCarryTheEnforcedPauseSelector() public {
        uint32 day = t.today();   // before expectRevert -- see the note above
        bytes memory ids = _one(1);
        uint32[] memory days_ = _days(day);
        t.pause();

        vm.prank(WARDEN);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.mint(2, ALICE, bytes32(uint256(2)), _code(), _today());

        vm.prank(WARDEN);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.batchCheckIn(ids, days_);

        vm.prank(WARDEN);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        t.applyMark(1, 1, 0);
    }

    /// @dev Same for the owner dials: nine non-owner tests, none of which
    /// asserted WHO was refused or why.
    function test_nonOwnerRevertsNameTheUnauthorisedAccount() public {
        vm.startPrank(MALLORY);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY));
        t.pause();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY));
        t.setWalletCap(1);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, MALLORY));
        t.sunset();

        vm.stopPrank();
    }
}
