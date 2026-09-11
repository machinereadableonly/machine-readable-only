// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

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
            active: true,
            excludes: 0,
            requiresAny: 0
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
        t.mint(big, ALICE, bytes32(uint256(0xcafe)), _code(), _today());
    }

    function test_theLargestLegalIdStillMints() public {
        uint256 max = uint256(type(uint32).max);
        vm.prank(WARDEN);
        t.mint(max, ALICE, bytes32(uint256(0xcafe)), _code(), _today());
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
        t.seed(big, 1, ALICE, _code(), _today());
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
        t.applyMark(999, 2, 0);

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
        t.applyMark(1, 1, 0);
        assertEq(t.marksOf(1), 0, "no mark applied while paused");

        t.unpause();
        vm.prank(WARDEN);
        t.applyMark(1, 1, 0);
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
        t.applyMark(1, 3, 0);
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
        t.mint(2, MALLORY, bytes32(uint256(2)), _code(), _today());
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkSoldOut.selector);
        t.applyMark(2, 3, 0);
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
        t.mint(2, ALICE, bytes32(0), _code(), _today());
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

    // -------------------------------------------------------------------
    // 12.4: applyMark bounds the id it shifts by
    // -------------------------------------------------------------------

    /// @dev `1 << upgradeId` was unbounded here. Nothing could reach it today,
    /// because setUpgrade is the only writer of _upgrades and IT bounds the id,
    /// so no out-of-range entry can be `active`. That is an argument about a
    /// different function, and a second writer added later would make it false
    /// silently. A shift of 256 or more is not a revert in Solidity -- it
    /// wraps -- so the failure would be a Mark written to the wrong bit.
    function test_applyMarkRejectsAnIdItCouldNeverShiftSafely() public {
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkIdOutOfRange.selector, uint8(16)));
        t.applyMark(1, 16, 0);

        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkIdOutOfRange.selector, uint8(0)));
        t.applyMark(1, 0, 0);
    }

    /// @dev The boundary, provoked from both sides: 15 is in range and fails
    /// later on `MarkInactive`, which is the guard AFTER the bound. Without
    /// this the test above would pass on a bound that was off by one.
    function test_theMarkIdBoundIsExactlyMaxMarkId() public {
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkInactive.selector);
        t.applyMark(1, 15, 0);
    }

    // -------------------------------------------------------------------
    // 12.5: rebind refuses the one value mint refuses
    // -------------------------------------------------------------------

    /// @dev mint rejects the zero key explicitly and rebind did not, so the
    /// state the piece refuses to start in was reachable in one further call.
    /// A token bound to zero can never be signed for again: no agent can prove
    /// possession of a key that is not a key, so the record simply stops.
    function test_rebindRejectsTheZeroKey() public {
        vm.prank(ALICE);
        vm.expectRevert(MachineReadableOnly.ZeroKeyId.selector);
        t.rebind(1, bytes32(0));

        assertEq(t.viewOf(1).agentKeyId, KEY, "the binding is untouched");
    }

    /// @dev CONTROL: a real key still rebinds, so the guard above is a bound
    /// and not a ban.
    function test_rebindStillAcceptsARealKey() public {
        bytes32 next = bytes32(uint256(0xbeef));
        vm.prank(ALICE);
        t.rebind(1, next);
        assertEq(t.viewOf(1).agentKeyId, next);
    }

    // -------------------------------------------------------------------
    // 12.6: a renderer has to be a contract
    // -------------------------------------------------------------------

    /// @dev tokenURI STATICCALLs the renderer for every token, so an EOA here
    /// returns empty data and bricks the metadata of the whole collection at
    /// once. Non-zero was the only check; a mistyped address is non-zero.
    function test_setRendererRejectsAnAddressWithNoCode() public {
        vm.expectRevert(MachineReadableOnly.RendererNotContract.selector);
        t.setRenderer(ALICE);
        assertEq(t.renderer(), address(r), "the working renderer is untouched");
    }

    /// @dev CONTROL: a real renderer still installs, and the token still
    /// renders through it afterwards. Code size cannot prove it is the RIGHT
    /// contract; it rules out the class of mistake that has no code at all.
    function test_setRendererStillAcceptsAContract() public {
        Renderer next = new Renderer();
        t.setRenderer(address(next));
        assertEq(t.renderer(), address(next));
        assertGt(bytes(t.tokenURI(1)).length, 0, "the collection still renders");
    }

    // --- 1.L3: the two ladder invariants a single entry can break alone ------

    /// @dev A minimal active Upgrade, so each test below changes exactly one
    /// field and the failure names the field rather than the fixture.
    function _plainUpgrade() internal pure returns (MachineReadableOnly.Upgrade memory u) {
        u = MachineReadableOnly.Upgrade({
            priceUsdc6: 1_000_000, maxSupply: 0, sold: 0, minLevel: 0, minStreak: 0,
            requiresWhole: false, active: true, excludes: 0, requiresAny: 0
        });
    }

    /// @dev A Mark whose own bit is in its own `excludes` mask can never be
    /// applied twice and closes nothing but itself -- the first application
    /// satisfies its own exclusion. setUpgrade accepted it, and the entry is on
    /// chain by the time anyone finds out.
    function test_setUpgradeRejectsAMarkThatExcludesItself() public {
        MachineReadableOnly.Upgrade memory u = _plainUpgrade();
        u.excludes = uint16(1) << 3;
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkExcludesItself.selector, uint8(3)));
        t.setUpgrade(3, u);
    }

    /// @dev A Mark that requires itself can never be applied at all:
    /// `requiresAny` is read against the marks already held, and this one
    /// cannot be held before it is applied.
    function test_setUpgradeRejectsAMarkThatRequiresItself() public {
        MachineReadableOnly.Upgrade memory u = _plainUpgrade();
        u.requiresAny = uint16(1) << 4;
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkRequiresItself.selector, uint8(4)));
        t.setUpgrade(4, u);
    }

    /// @dev CONTROL, and it is the assertion that matters: a mask naming the
    /// OTHER side of the pair is exactly what the ladder is made of, and it
    /// still installs. A guard that refused this would refuse every real Mark.
    function test_setUpgradeStillAcceptsAMaskNamingAnotherMark() public {
        MachineReadableOnly.Upgrade memory u = _plainUpgrade();
        u.excludes = uint16(1) << 4;
        u.requiresAny = uint16(1) << 5;
        t.setUpgrade(3, u);
        MachineReadableOnly.Upgrade memory back = t.upgradeOf(3);
        assertEq(back.excludes, uint16(1) << 4);
        assertEq(back.requiresAny, uint16(1) << 5);
    }
}
