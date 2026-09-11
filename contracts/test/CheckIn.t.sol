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
}
