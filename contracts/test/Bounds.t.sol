// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";

/// @notice The bounds on Warden-supplied inputs, and the two owner-power fixes
/// that go with them.
///
/// @dev Every test here began life as a probe in the final whole-branch review,
/// which demonstrated the DEFECT. Each is now inverted to pin the FIX. They are
/// gathered in one file rather than scattered because they share one cause: the
/// per-function tests all used well-formed inputs, so ten task-level reviews
/// passed them and only a whole-branch read found them.
///
/// Three of these are unfixable after deploy -- the contract has no upgrade
/// path -- which is why they are pinned rather than merely noted.
contract BoundsTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
    }

    function _upg(uint32 minLevel) internal pure returns (MachineReadableOnly.Upgrade memory u) {
        u = MachineReadableOnly.Upgrade({
            priceUsdc6: 1,
            maxSupply: 10,
            sold: 0,
            minLevel: minLevel,
            minStreak: 0,
            requiresWhole: false,
            active: true
        });
    }

    // -------------------------------------------------------------------
    // I1: a day index is bounded above as well as below
    // -------------------------------------------------------------------

    /// @dev The unfixable one. A Warden passing a TIMESTAMP where a day index
    /// belongs used to set lastDay to about 4.7M -- year ~14,700 -- after which
    /// every real check-in reverted DayNotAdvanced forever with no admin path
    /// to reset it. The token was bricked, permanently, by one unit mistake.
    function test_aFutureDayIsRejectedRatherThanBrickingTheToken() public {
        uint32 wrongUnit = uint32(block.timestamp); // seconds, not a day index
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.FutureDay.selector, wrongUnit));
        t.batchCheckIn(_one(1), _days(wrongUnit));

        // The token is untouched, so the next real check-in still works.
        assertEq(t.viewOf(1).lastDay, t.today(), "lastDay was never corrupted");

        uint32 tomorrow = t.today() + 1;
        _warpToDay(tomorrow);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(tomorrow));
        assertEq(t.viewOf(1).level, 2, "and the token still checks in normally");
    }

    /// @dev Today itself is not a future day. The boundary matters: the Clock
    /// credits the day it runs in, so an off-by-one here would break every
    /// same-day check-in rather than only the malformed ones.
    function test_todayIsAcceptedAndOnlyStrictlyLaterIsRejected() public {
        uint32 tomorrow = t.today() + 1;
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.FutureDay.selector, tomorrow));
        t.batchCheckIn(_one(1), _days(tomorrow));

        _warpToDay(tomorrow);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(tomorrow));
        assertEq(t.viewOf(1).lastDay, tomorrow, "the same day is legal once reached");
    }

    // The voucher path carries the same day bound. Its test lives in
    // Vouchers.t.sol, which holds the Warden private key needed to sign one.

    // -------------------------------------------------------------------
    // I2: token ids must fit the 32 bits batchCheckIn addresses
    // -------------------------------------------------------------------

    /// @dev The second unfixable one. batchCheckIn decodes ids from 4 packed
    /// bytes, so a token above 2**32 minted, rendered and was owned -- but
    /// could never be checked in, and vouchers ship disabled, so there was no
    /// second path. The artwork is a record of check-ins, so such a token is
    /// permanently blank by construction.
    function test_mintRejectsAnIdAboveThirtyTwoBits() public {
        uint256 big = uint256(type(uint32).max) + 5;
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.IdTooLarge.selector, big));
        t.mint(big, ALICE, bytes32(uint256(0xcafe)), _code());
    }

    function test_theLargestLegalIdStillMints() public {
        uint256 max = uint256(type(uint32).max);
        vm.prank(WARDEN);
        t.mint(max, ALICE, bytes32(uint256(0xcafe)), _code());
        assertEq(t.ownerOf(max), ALICE, "2**32 - 1 is legal");

        uint32 tomorrow = t.today() + 1;
        _warpToDay(tomorrow);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(type(uint32).max), _days(tomorrow));
        assertEq(t.viewOf(max).level, 2, "and it can be checked in");
    }

    /// @dev seed is the other creation path and carries the same ceiling.
    function test_seedRejectsAChildIdAboveThirtyTwoBits() public {
        _makeWhole(1);
        _warpOneYear();
        uint256 big = uint256(type(uint32).max) + 1;
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.IdTooLarge.selector, big));
        t.seed(big, 1, ALICE, _code());
    }

    // -------------------------------------------------------------------
    // I3 and I4: applyMark
    // -------------------------------------------------------------------

    /// @dev The third unfixable one. minLevel is an owner-settable dial, and at
    /// 0 a mark could be written to an id nobody had ever minted: it consumed a
    /// capped supply slot, and because mint does not clear _marks, that id
    /// would later mint already marked.
    function test_applyMarkRejectsAnIdThatWasNeverMinted() public {
        t.setUpgrade(2, _upg(0)); // minLevel 0 -- the dial value that exposed it
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NoSuchToken.selector, uint256(999)));
        t.applyMark(999, 2);

        assertEq(t.marksOf(999), 0, "no phantom mark");
        assertEq(t.upgradeOf(2).sold, 0, "and no capped supply slot consumed");
    }

    /// @dev applyMark was the only Warden write function without whenNotPaused,
    /// contradicting the spec. Mark bits are unclearable, so a compromised
    /// Warden could permanently deface every token while the contract read as
    /// paused -- the one state the operator reaches for in that emergency.
    function test_applyMarkIsBlockedByPause() public {
        t.setUpgrade(1, _upg(1));
        t.pause();
        vm.prank(WARDEN);
        vm.expectRevert();
        t.applyMark(1, 1);
        assertEq(t.marksOf(1), 0, "no mark applied while paused");

        t.unpause();
        vm.prank(WARDEN);
        t.applyMark(1, 1);
        assertEq(t.marksOf(1), 2, "and it works again once unpaused");
    }

    // -------------------------------------------------------------------
    // I5: setUpgrade must not reset scarcity
    // -------------------------------------------------------------------

    /// @dev `sold` is owned by applyMark. Taking it from calldata meant an
    /// owner editing a price had to re-supply the current count by hand, and
    /// getting it wrong silently re-opened a sold-out Mark. Scarcity -- Halo
    /// x1000, Crown x100, Singularity x10 -- is a stated product property.
    function test_editingAnUpgradePreservesSold() public {
        MachineReadableOnly.Upgrade memory u = _upg(1);
        u.maxSupply = 1;
        t.setUpgrade(3, u);

        vm.prank(WARDEN);
        t.applyMark(1, 3);
        assertEq(t.upgradeOf(3).sold, 1, "sold out");

        // The owner edits the price, supplying sold = 0 as calldata naturally
        // would. The count must survive.
        u.priceUsdc6 = 999;
        u.sold = 0;
        t.setUpgrade(3, u);
        assertEq(t.upgradeOf(3).sold, 1, "sold survives an edit");
        assertEq(t.upgradeOf(3).priceUsdc6, 999, "and the edit still applied");

        // Still sold out, rather than silently re-opened.
        vm.prank(WARDEN);
        t.mint(2, MALLORY, bytes32(uint256(2)), _code());
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkSoldOut.selector);
        t.applyMark(2, 3);
    }

    // -------------------------------------------------------------------
    // The zero key
    // -------------------------------------------------------------------

    /// @dev A Warden serialising a missing thumbprint to zero would burn the
    /// zero key permanently (one mint per key, forever) and create a shared
    /// seed budget that any token owner could rebind into for free.
    function test_mintRejectsTheZeroKey() public {
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.ZeroKeyId.selector);
        t.mint(2, ALICE, bytes32(0), _code());
    }

    // -------------------------------------------------------------------
    // Ownership cannot be abandoned
    // -------------------------------------------------------------------

    /// @dev OpenZeppelin ships renounceOwnership live and Ownable2Step does not
    /// override it. Renouncing WHILE PAUSED would freeze the piece forever: no
    /// mint, no check-in, no seed, no unpause, and no upgrade path to fix it.
    function test_renounceOwnershipReverts() public {
        vm.expectRevert(MachineReadableOnly.RenounceDisabled.selector);
        t.renounceOwnership();
        assertEq(t.owner(), address(this), "ownership is intact");
    }

    /// @dev The remedy that DOES exist still works, which is what makes
    /// disabling renounce safe rather than merely restrictive.
    function test_ownershipCanStillBeTransferred() public {
        t.transferOwnership(ALICE);
        vm.prank(ALICE);
        t.acceptOwnership();
        assertEq(t.owner(), ALICE, "Ownable2Step transfer is unaffected");
    }
}
