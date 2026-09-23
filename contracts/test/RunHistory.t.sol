// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MroTestBase} from "./MroTestBase.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";
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
        MachineReadableOnly.Upgrade[16] memory all = Ladder.all();
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
    //
    // EVERY TEST IN THIS SECTION GROWS A 200-DAY RUN, NOT A 364-DAY ONE, and the
    // difference is Spec 10f. A token that runs 364 days, misses one and
    // returns is credited to 365 by that return -- so it FINISHES, and a
    // finished token's colour is read on its last credited day for ever. At 364
    // these tests were driving `today` forward against a frozen picture: three
    // of the four broke outright when the freeze landed, and the fourth passed
    // only because it asserts on the day of the return, where a stopped clock
    // and a live one give the same answer.
    //
    // The fade ladder is a MID-LIFE rule now. 200 is the smallest round run
    // that still sits on the top tier (the ladder's last threshold is 100), so
    // every `tierIndex(fellRun)` below is the same rung it always was, and the
    // token stays under 365 through the whole scenario. That the fade stops at
    // the finish is asserted where it belongs, in
    // `Renderer.t.sol::test_aFinishedTokenDoesNotFade`.

    /// @dev The whole finding in one assertion. A token that missed ONE day and
    /// came back must not render paler than one that has been gone a month.
    function test_theTokenThatCameBackIsNotPalerThanTheOneThatDidNot() public {
        _growTo(1, 200);                     // a 200-day run
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
        _growTo(1, 200);
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
        _growTo(1, 200);
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
        _growTo(1, 200);
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

    /// @dev A token that completed a run, slipped, and CAME BACK must still be
    /// able to take the Mark that run earned. Before 2026-09-05 it was refused,
    /// while a token that completed the same run and went dark forever was not.
    ///
    /// @dev IT USED TO ASK THIS OF BREAK, at a run of 365, and it no longer can.
    /// A year now stops at 365 credited days (spec 10f), so a run of 365 is only
    /// ever reached by a token that never slipped, on the credit that finishes
    /// it -- and that token can never be credited again, so it can never slip
    /// afterwards either. Break is therefore reachable only at the finish line.
    /// Beat asks the same question of the same field one rung down, where a slip
    /// and a return are still possible, so the property this test protects is
    /// unchanged; Break's own admission is driven through `applyMark` in
    /// `Ladder.t.sol` (`_readyBreakAndPairTwo`).
    function test_aTokenThatSlippedAndReturnedCanStillTakeTheMarkItEarned() public {
        _growTo(1, 364);
        uint32 fell = t.today();

        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));
        assertEq(t.viewOf(1).streak, 1, "its live run really is back to one");

        vm.prank(WARDEN);
        t.applyMark(1, 4, 0);   // Beat, earned by a run of 30
        assertTrue(t.viewOf(1).marks & (1 << 4) != 0, "the completed run is still its own");
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
        _growTo(1, 364);
        uint32 fell = t.today();
        _warpToDay(fell + 2);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(fell + 2));

        vm.prank(WARDEN);
        t.applyMark(1, 6, 0);   // the earned Iris, gated at 100
        assertEq(uint32(t.viewOf(1).marks >> 32), 364, "not the live run of 1");
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
    /// JS reference across all 64 states, six of which are the slip and sunset
    /// states added with this change. So a mistake shared between this helper
    /// and `Renderer._rung` would still have to appear a third time, in
    /// `tools/render-token.mjs`, to go unnoticed.
    ///
    /// BEING A SECOND IMPLEMENTATION IS THE POINT, and it is also the cost: it
    /// has to be brought in line by hand every time the shipped rule moves, and
    /// nothing fails if it is not. It gained the `whole` branch with Spec 10f.
    ///
    /// The alternative -- asserting on a colour inside a base64 SVG inside a
    /// data URI -- would test string decoding, not the ladder.
    function _rungOf(TokenView memory v) internal pure returns (uint256) {
        if (v.resting) return Palette.tierIndex(v.streak);
        // A token that reached 365 is FINISHED: the clock stops at its last
        // credited day, and a sunset after that point has nothing left to seal.
        bool whole = v.level >= FrameGeometry.DAY_CELLS;
        if (v.sunset && !whole) return Palette.lapsedIndex(v.streak, v.lastDay, v.sunsetDay);
        uint32 at = whole ? v.lastDay : v.today;
        uint256 live = Palette.lapsedIndex(v.streak, v.lastDay, at);
        if (v.fellRun == 0) return live;
        uint256 fell = Palette.lapsedIndex(v.fellRun, v.fellDay, at);
        uint256 cap = Palette.tierIndex(v.fellRun);
        cap = cap == 0 ? 0 : cap - 1;
        if (fell > cap) fell = cap;
        return fell > live ? fell : live;
    }
}
