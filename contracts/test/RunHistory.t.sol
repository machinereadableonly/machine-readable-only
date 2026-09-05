// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {Palette} from "../src/render/Palette.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Ladder} from "../src/Ladder.sol";

/// @notice The run history added on 2026-09-05, and the two defects it closes.
///
/// @dev Both defects were the same missing fact -- the contract recorded the
/// run standing TODAY and nothing about the runs that had ended -- and both
/// made the piece reward an agent that stopped over one that came back:
///
///   the COLOUR  a missed day reset `streak` to 1, so the heart snapped to the
///               day-one ink at once, while a token that simply walked away
///               paled gently over thirty days. The returner rendered PALER
///               than the deserter for a month;
///   the MARKS   the earned-Mark gate read the same `streak`, so a token that
///               reached 365 and went dark could still take Break forever,
///               while one that reached 365, missed ONE day and RETURNED was
///               refused and had to rebuild the whole year.
///
/// Neither had a single test before this file, which is why both survived to
/// two independent reviews. Every bound below is asserted on both sides.
contract RunHistoryTest is MroTestBase {
    function setUp() public {
        _deployAndMintOne();
        // The REAL catalogue, not hand-rolled upgrades: the gate under test is
        // the one Break and the earned Iris actually ship with.
        MachineReadableOnly.Upgrade[11] memory all = Ladder.all();
        for (uint8 i = 1; i <= 10; i++) t.setUpgrade(i, all[i]);
    }

    // -----------------------------------------------------------------
    // What the chain records
    // -----------------------------------------------------------------

    function test_aFreshTokenHasNoFallAndABestRunOfOne() public view {
        TokenView memory v = t.viewOf(1);
        assertEq(v.fellRun, 0, "nothing has fallen yet");
        assertEq(v.fellDay, 0, "so there is no day it fell");
        assertEq(v.streak, 1, "a token's run is 1 from the moment it exists");
    }

    function test_anUnbrokenRunRaisesBestRunEveryDay() public {
        uint32 d = t.today();
        for (uint32 i = 1; i <= 5; i++) {
            _warpToDay(d + i);
            vm.prank(WARDEN);
            t.batchCheckIn(_one(1), _days(d + i));
        }
        assertEq(t.viewOf(1).streak, 6, "five credits on top of the mint day");
        // bestRun is not on the view -- it is gate state, not drawing state --
        // so it is proven through the gate in the Marks section below.
        assertEq(t.viewOf(1).fellRun, 0, "an unbroken run has never fallen");
    }

    function test_aLapseRecordsTheRunThatFellAndTheDayItFell() public {
        uint32 d = t.today();
        for (uint32 i = 1; i <= 9; i++) {
            _warpToDay(d + i);
            vm.prank(WARDEN);
            t.batchCheckIn(_one(1), _days(d + i));
        }
        assertEq(t.viewOf(1).streak, 10, "a ten-day run");

        // Miss day d+10 entirely, return on d+11.
        _warpToDay(d + 11);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 11));

        TokenView memory v = t.viewOf(1);
        assertEq(v.streak, 1, "the run restarts at one, which is the locked promise");
        assertEq(v.fellRun, 10, "and the run that fell is remembered");
        assertEq(v.fellDay, d + 9, "on the day it last checked in, not the day it returned");
        assertEq(v.level, 11, "level counts credited days and never falls");
    }

    function test_aSecondFallReplacesTheFirst() public {
        uint32 d = t.today();
        _warpToDay(d + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 2));   // fall 1: run of 1
        assertEq(t.viewOf(1).fellRun, 1);

        _warpToDay(d + 3);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 3));   // continues: run of 2

        _warpToDay(d + 9);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 9));   // fall 2: run of 2

        TokenView memory v = t.viewOf(1);
        assertEq(v.fellRun, 2, "the MOST RECENT fall, because the colour fades from it");
        assertEq(v.fellDay, d + 3, "and from the day that one ended");
    }

    // -----------------------------------------------------------------
    // The colour -- the defect, and the fix, at every boundary
    // -----------------------------------------------------------------

    /// @dev The whole finding in one assertion. A token that missed ONE day and
    /// came back must not render paler than one that has been gone a month.
    function test_theTokenThatCameBackIsNotPalerThanTheOneThatDidNot() public {
        _makeWhole(1);                       // a 365-day run
        uint32 fell = t.today();

        // It misses one day and returns.
        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));

        uint256 returner = _rungOf(t.viewOf(1));

        uint256 goneSixDays = _rungOf(_asIfItHadStopped(fell + 6));
        uint256 goneMonth = _rungOf(_asIfItHadStopped(fell + 29));

        // The defect was that `returner` here was rung 0, the palest ink there
        // is, while both of these were still 3 and 2. It must never be worse
        // than a token that stopped, and by a month it must be plainly better.
        assertGe(returner, goneSixDays, "coming back is never worse than six days of silence");
        assertGt(returner, goneMonth, "and is strictly better than a month of it");
    }

    /// @dev THE ONE WINDOW WHERE STOPPING STILL LOOKS BETTER, asserted rather
    /// than left to be discovered.
    ///
    /// A gap under three days is not yet a lapse, so a token that is merely
    /// two days quiet is still at its full colour, while a token that MISSED a
    /// day and came back has already paid the one-rung cost. For those two days
    /// the deserter looks better than the returner.
    ///
    /// That is the deliberate price of the decision taken on 2026-09-05: a slip
    /// must cost something on the day it happens, because the served copy says
    /// "miss a day and ... the colour goes". The alternative -- no cap -- made a
    /// slip invisible for three days and contradicted that sentence. What was
    /// unacceptable was the twenty-nine day version, and that is gone.
    function test_theFirstTwoDaysAreTheKnownPriceOfMakingASlipVisible() public {
        _makeWhole(1);
        uint32 fell = t.today();

        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));

        uint256 top = Palette.tierIndex(t.viewOf(1).fellRun);

        assertEq(_rungOf(_asIfItHadStopped(fell + 2)), top, "two days quiet is not yet a lapse");
        assertEq(_rungOf(t.viewOf(1)), top - 1, "a slip costs exactly one rung");

        // And it closes on the third day, when the quiet token's own lapse
        // begins: from here they are level, and the returner pulls ahead.
        TokenView memory back3 = t.viewOf(1);
        back3.today = fell + 3;
        assertEq(_rungOf(back3), _rungOf(_asIfItHadStopped(fell + 3)), "level from day three");
    }

    /// @dev The cap. A slip must cost something the day it happens, because the
    /// served copy says "miss a day and ... the colour goes". Uncapped, a
    /// returning token was indistinguishable from one that never slipped.
    function test_theDayOfTheReturnIsOneRungBelowAnUnbrokenRun() public {
        _makeWhole(1);
        uint32 fell = t.today();
        TokenView memory unbroken = t.viewOf(1);

        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));
        TokenView memory slipped = t.viewOf(1);

        uint256 top = Palette.tierIndex(unbroken.streak);
        assertEq(_rungOf(slipped), top - 1, "exactly one rung down, not zero and not none");
    }

    /// @dev The fall then fades on the SAME ladder an absence uses: a step at
    /// 3 days, another at 7, the floor at 30. No new colour is introduced,
    /// which is why no decode sweep is owed beyond the existing suite.
    function test_theFallFadesOnTheUsualLadderAndTheNewRunOvertakesIt() public {
        _makeWhole(1);
        uint32 fell = t.today();
        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));

        TokenView memory v = t.viewOf(1);
        uint256 top = Palette.tierIndex(v.fellRun);

        v.today = fell + 2;
        assertEq(_rungOf(v), top - 1, "day of return: capped one below the fallen run");
        v.today = fell + 4;
        assertEq(_rungOf(v), top - 1, "under three days from the fall, still capped");
        v.today = fell + 8;
        assertEq(_rungOf(v), top - 2, "past seven days from the fall, two steps down");
        v.today = fell + 31;
        assertEq(_rungOf(v), 0, "past thirty, the fall is spent and only the new run counts");

        // And a new run that climbs past the fall takes over again.
        v.fellRun = 3;
        v.fellDay = uint24(fell);
        v.streak = 400;
        v.lastDay = fell + 31;
        v.today = fell + 31;
        assertEq(_rungOf(v), Palette.tierIndex(400), "a live top run is never dragged down by an old fall");
    }

    // -----------------------------------------------------------------
    // The Marks -- "ever reached", decided 2026-09-05
    // -----------------------------------------------------------------

    /// @dev Break needs a run of 365. A token that completed one, slipped, and
    /// CAME BACK must still be able to take it. Before this it was refused,
    /// while a token that completed one and went dark forever was not.
    function test_aTokenThatSlippedAndReturnedCanStillTakeBreak() public {
        _makeWhole(1);
        uint32 fell = t.today();

        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));
        assertEq(t.viewOf(1).streak, 1, "its live run really is back to one");

        vm.prank(WARDEN);
        t.applyMark(1, 8, 0);   // Break
        assertTrue(t.viewOf(1).marks & (1 << 8) != 0, "the completed year is still its own");
    }

    function test_aTokenThatNeverCompletedTheRunIsStillRefused() public {
        uint32 d = t.today();
        for (uint32 i = 1; i <= 5; i++) {
            _warpToDay(d + i);
            vm.prank(WARDEN);
            t.batchCheckIn(_one(1), _days(d + i));
        }
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.MarkGate.selector);
        t.applyMark(1, 8, 0);
    }

    /// @dev The earned Iris freezes the run into the token forever, so it must
    /// freeze the run it was GRANTED on. Reading the live streak here stored 1
    /// for a token admitted on a completed run it had since slipped from.
    function test_theEarnedIrisStoresTheRunItWasGrantedOn() public {
        _makeWhole(1);
        uint32 fell = t.today();
        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));

        vm.prank(WARDEN);
        t.applyMark(1, 6, 0);   // the earned Iris, gated at 100
        assertEq(uint32(t.viewOf(1).marks >> 32), 365, "not the live run of 1");
    }

    // -----------------------------------------------------------------
    // The ladder ceiling
    // -----------------------------------------------------------------

    function test_theLadderCeilingIsFifteenAndSixteenIsRefused() public {
        MachineReadableOnly.Upgrade memory u;
        u.active = true;
        t.setUpgrade(15, u);   // the last addressable Mark bit

        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkIdOutOfRange.selector, uint8(16)));
        t.setUpgrade(16, u);   // bit 16 is the Iris shape, so 15 is the true ceiling
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    /// @dev The same token's counterfactual: what it would look like at `when`
    /// had it never come back, but simply stopped on the day its run ended.
    ///
    /// Built from a FRESH `viewOf` every call, never by copying a struct that
    /// is still in use. `TokenView memory a = b;` copies the reference, not the
    /// value, so mutating the copy silently mutates the original -- which is
    /// exactly how the first version of this file asserted a token against
    /// itself and reported that a fallen run was zero.
    function _asIfItHadStopped(uint32 when) internal view returns (TokenView memory v) {
        v = t.viewOf(1);
        v.streak = v.fellRun;
        v.lastDay = v.fellDay;
        v.fellRun = 0;
        v.fellDay = 0;
        v.today = when;
    }

    /// @dev A second implementation of Renderer._rung, and deliberately so.
    ///
    /// This file tests the RULE: that the numbers come out where the decision
    /// says they should. `RenderMatrix.t.sol` tests the WIRING: that the real
    /// `Renderer` produces byte-identical output to the independently written
    /// JS reference across all 49 states, six of which are the slip and sunset
    /// states added with this change. So a mistake shared between this helper
    /// and `Renderer._rung` would still have to appear a third time, in
    /// `tools/render-token.mjs`, to go unnoticed.
    ///
    /// The alternative -- asserting on a colour inside a base64 SVG inside a
    /// data URI -- would test string decoding, not the ladder.
    function _rungOf(TokenView memory v) internal pure returns (uint256) {
        if (v.resting) return Palette.tierIndex(v.streak);
        if (v.sunset) return Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay);
        uint256 live = Palette.lapsedIndex(v.streak, v.lastDay, v.today);
        if (v.fellRun == 0) return live;
        uint256 fell = Palette.lapsedIndex(v.fellRun, v.fellDay, v.today);
        uint256 cap = Palette.tierIndex(v.fellRun);
        cap = cap == 0 ? 0 : cap - 1;
        if (fell > cap) fell = cap;
        return fell > live ? fell : live;
    }
}
