// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice batchCheckIn semantics: the daily overwrite, streak rules, and the
/// per-token ERC-4906 emits that replaced the impossible range form.
contract CheckInTest is MroTestBase {

    /// The Clock's chunk size, CHECKIN_CHUNK in warden/src/clock/run.mjs.
    /// warden/test/clock-run.test.mjs reads this line and fails if the two
    /// disagree, so a change to either one cannot go untested.
    uint32 internal constant CHECKIN_CHUNK = 1400;

    /// The Clock's ceiling on a padded estimate, MAX_TX_GAS in write.mjs.
    uint256 internal constant MAX_TX_GAS = 15_000_000;

    /// What a full chunk must leave under MAX_TX_GAS once padded -- the rule
    /// CHECKIN_CHUNK was chosen by (run.mjs). 1,500 passes the guard itself by
    /// only 177,808, so without this a bump back to it would stay green.
    uint256 internal constant CHUNK_MARGIN = 500_000;

    function setUp() public {
        _deployAndMintOne();
    }

    function test_checkInIncrementsLevelAndContinuesTheStreak() public {
        uint32 d = t.today();
        _warpToDay(d + 1);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 1));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 2);
        assertEq(t.viewOf(1).lastDay, d + 1);
    }

    function test_aGapResetsTheStreakButNotTheLevel() public {
        uint32 d = t.today();
        _warpToDay(d + 5);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 5));
        assertEq(t.viewOf(1).level, 2);
        assertEq(t.viewOf(1).streak, 1);
    }

    function test_theSameDayTwiceReverts() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.DayNotAdvanced.selector, uint256(1)));
        t.batchCheckIn(_one(1), _days(d));
    }

    /// @dev Late writes after an outage: several days for one token in one
    /// call, ascending, are legal and each counts.
    function test_multiDayLateWritesInOneCall() public {
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](3);
        ids[0] = 1; ids[1] = 1; ids[2] = 1;
        uint32[] memory ds = new uint32[](3);
        ds[0] = d + 1; ds[1] = d + 2; ds[2] = d + 3;
        _warpToDay(d + 3);
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(ids), ds);
        assertEq(t.viewOf(1).level, 4);
        assertEq(t.viewOf(1).streak, 4);
    }

    /// @dev The decision from the design doc: one MetadataUpdate per token
    /// written, never a range. A range would claim untouched tokens changed.
    function test_emitsOneMetadataUpdatePerTokenWritten() public {
        uint32 d = t.today();
        _warpToDay(d + 1);
        vm.expectEmit(false, false, false, true);
        emit IERC4906.MetadataUpdate(1);
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(d + 1));
    }

    function test_checkInRevertsForANonWarden() public {
        uint32 d = t.today() + 1;
        vm.expectRevert(MachineReadableOnly.NotWarden.selector);
        t.batchCheckIn(_one(1), _days(d));
    }

    function test_mismatchedLengthsRevert() public {
        uint32[] memory ids = new uint32[](2);
        ids[0] = 1; ids[1] = 1;
        uint32 d = t.today() + 1;
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.LengthMismatch.selector);
        t.batchCheckIn(_packed(ids), _days(d));
    }

    function test_checkInIsBlockedByPauseAndBySunset() public {
        uint32 d = t.today() + 1;
        t.pause();
        vm.prank(WARDEN);
        vm.expectRevert();
        t.batchCheckIn(_one(1), _days(d));
        t.unpause();
        t.sunset();
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.Sunset.selector);
        t.batchCheckIn(_one(1), _days(d));
    }

    function test_checkInRevertsForAnUnmintedToken() public {
        uint32 d = t.today() + 1;
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.NoSuchToken.selector, uint256(999)));
        t.batchCheckIn(_one(999), _days(d));
    }

    function test_anEmptyBatchReverts() public {
        uint32[] memory none = new uint32[](0);
        vm.prank(WARDEN);
        vm.expectRevert(MachineReadableOnly.EmptyBatch.selector);
        t.batchCheckIn("", none);
    }

    /// @dev The review noted nothing asserted this event's payload.
    function test_batchCheckedInReportsTheDayRangeAndCount() public {
        uint32 d = t.today();
        vm.prank(WARDEN);
        t.mint(2, MALLORY, bytes32(uint256(2)), _code(), _today());
        uint32[] memory ids = new uint32[](2);
        ids[0] = 1; ids[1] = 2;
        uint32[] memory ds = new uint32[](2);
        ds[0] = d + 1; ds[1] = d + 3;
        _warpToDay(d + 3);
        bytes memory packed = _packed(ids);
        vm.expectEmit(false, false, false, true);
        emit MachineReadableOnly.BatchCheckedIn(d + 1, d + 3, 2);
        vm.prank(WARDEN);
        t.batchCheckIn(packed, ds);
    }

    /// @notice A full chunk, per-token emits included, must pass the SAME check
    /// the Clock makes before it sends: the estimate padded by 12.5% must stay
    /// under MAX_TX_GAS (warden/src/clock/write.mjs). EIP-7825's 16,777,216 is
    /// the chain's own cap, above that.
    /// @dev This is the number the whole batching design rests on. If it fails,
    /// the chunk size changes, not the emit policy.
    ///
    /// TWO THINGS MAKE THIS NUMBER TRUE, and each was missing once. The truth
    /// is a real node's receipt: 13,175,282 gas at 1,500 entries, measured
    /// 2026-09-11 by warden/tools/chunk-rehearsal.sh.
    ///
    ///   ISOLATION. Without it the whole test function is ONE transaction, so
    ///   the slots `mint` has just written are warm and dirty when batchCheckIn
    ///   touches them -- 100 gas to read and 100 to write, against 2,100 and
    ///   2,900 on chain. That read 6,836,778, half the truth. Isolation also
    ///   charges the 21,000 base and the calldata, as the Clock's estimate does.
    ///
    ///   PRE-ENCODED CALLDATA. `t.batchCheckIn(packed, ds)` ABI-encodes both
    ///   arrays in THIS contract, after gasleft() is read, and that loop is
    ///   harness work. With it inside the window the isolated figure read
    ///   14,353,906 -- 1,178,624 over the node -- and made 1,500 look like a
    ///   size the Clock refuses. It is not; it passes by 177,808.
    /// forge-config: default.isolate = true
    function test_aFullChunkFitsTheGasGuard() public {
        uint32 n = CHECKIN_CHUNK;
        vm.startPrank(WARDEN);
        for (uint32 i = 2; i < 2 + n; i++) {
            t.mint(i, address(uint160(0x10000 + i)), bytes32(uint256(i)), _code(), _today());
        }
        vm.stopPrank();

        uint32[] memory ids = new uint32[](n);
        uint32[] memory ds = new uint32[](n);
        uint32 d = t.today() + 1;
        for (uint32 i = 0; i < n; i++) {
            ids[i] = 2 + i;
            ds[i] = d;
        }

        // Build the packed calldata bytes BEFORE the gas measurement starts.
        // _packed() concatenates via abi.encodePacked in a loop, an O(n^2)
        // memory copy in the test harness itself -- if left inside the
        // gasleft() window it swamps the number with test-only overhead that
        // has nothing to do with what batchCheckIn actually costs on chain.
        bytes memory packed = _packed(ids);
        // And the call's own ABI encoding, for the same reason: a high-level
        // call encodes its arguments after gasleft() has been read.
        bytes memory callData = abi.encodeCall(MachineReadableOnly.batchCheckIn, (packed, ds));

        // Outside the gasleft() window: this is harness setup, not contract work.
        _warpToDay(d);

        vm.prank(WARDEN);
        uint256 before = gasleft();
        (bool ok,) = address(t).call(callData);
        uint256 used = before - gasleft();
        assertTrue(ok, "a full chunk must not revert");

        // The Clock pads its estimate by 12.5% and refuses anything over
        // MAX_TX_GAS AFTER padding (write.mjs), so the raw figure alone would
        // pass a chunk the Clock never sends.
        uint256 padded = (used * 1125) / 1000;
        emit log_named_uint("chunk size", n);
        emit log_named_uint("gas for a full chunk", used);
        emit log_named_uint("padded as the Clock pads it", padded);
        assertLe(padded, MAX_TX_GAS - CHUNK_MARGIN, "a full chunk, padded, must leave CHUNK_MARGIN under the Clock's guard");
    }

    // -----------------------------------------------------------------
    // ALL-OR-NOTHING IS THE DESIGN, not an oversight
    //
    // The 2026-09-17 review asked for skip-and-continue per entry. Declined,
    // 2026-09-18, and this pins the reasoning so it is not re-raised as new:
    //
    //   1. `batchCheckIn` is `onlyWarden`, so it has exactly ONE caller, and
    //      that caller already does better than skipping. The contract's custom
    //      errors NAME the offending entry (NoSuchToken(id), Resting(id)), so
    //      `warden/src/clock/batch.mjs` re-chunks with that id removed --
    //      precisely, not by bisecting -- and reports each dropped entry.
    //   2. Skipping on chain would make those failures SILENT. The caller would
    //      have to diff what it asked for against what happened, and a day that
    //      quietly went missing is exactly the class of defect this project has
    //      twice found the expensive way. A token's record IS the artwork.
    //   3. Nothing is lost by reverting. A queued credit is re-offered on later
    //      nights (`day <= today()` is the only upper bound), so a batch that
    //      reverts is a night delayed, not a day destroyed.
    //   4. It is the gas-critical loop, and every added branch is permanent
    //      bytecode with no upgrade path.
    //
    // What an owner CAN do is make one batch revert by resting mid-flight.
    // That is bounded: the Clock re-chunks without them and the night lands.
    // -----------------------------------------------------------------

    /// @dev The revert an owner can cause, and the proof it costs nobody a day.
    function test_oneRestingTokenRevertsTheWholeBatchAndTheRestAreRetryable() public {
        vm.prank(WARDEN);
        t.mint(2, MALLORY, bytes32(uint256(0xb0b)), _code(), _today());

        // Mallory seals their own token between the batch being built and sent.
        vm.prank(MALLORY);
        t.rest(2);

        uint32 d = _today() + 1;
        _warpToDay(d);

        uint32[] memory ids = new uint32[](2);
        ids[0] = 1;
        ids[1] = 2;
        uint32[] memory ds = new uint32[](2);
        ds[0] = d;
        ds[1] = d;

        // The WHOLE batch reverts, and the error NAMES the entry to drop --
        // which is what makes the Warden's re-chunk precise rather than a
        // bisect.
        vm.prank(WARDEN);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.Resting.selector, 2));
        t.batchCheckIn(_packed(ids), ds);

        assertEq(t.viewOf(1).lastDay, d - 1, "token 1 was not credited by the reverted batch");

        // Re-chunked without the resting id: the day lands, unchanged.
        uint32[] memory good = new uint32[](1);
        good[0] = 1;
        vm.prank(WARDEN);
        t.batchCheckIn(_packed(good), _days(d));
        assertEq(t.viewOf(1).lastDay, d, "the day is credited on the re-chunk");
        assertEq(t.viewOf(1).streak, 2, "and the run is unbroken, so nothing was lost");
    }

    /// @dev And the day survives a night being missed entirely: a past day is
    /// creditable for as long as the token has not passed it, which is why a
    /// reverted batch is a delay rather than a loss.
    function test_aDayMissedEntirelyCanStillBeCreditedLater() public {
        uint32 missed = _today() + 1;
        _warpToDay(missed + 5);          // five nights go by with nothing sent

        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(missed));
        assertEq(t.viewOf(1).lastDay, missed, "the missed day is still creditable");
    }
}
