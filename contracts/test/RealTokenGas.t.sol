// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Test.sol";

import {Ladder} from "../src/Ladder.sol";
import {MroTestBase} from "./MroTestBase.sol";
import {WorstCase} from "./WorstCase.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {TokenView} from "../src/render/TokenView.sol";

/// @notice The gas and byte budget, measured on the contract that actually
/// ships.
///
/// @dev WHY THIS FILE EXISTS. `GasBudget.t.sol` measures `MROSpikeToken`, a
/// harness whose `setState` can place any life stage in one call. That is what
/// makes a twelve-stage sweep affordable, and it is the right tool for
/// comparing stages against each other. But every published figure -- the hard
/// limits, the regression bands, the headroom quoted in the gas-budget memory
/// -- then describes a contract nobody will ever call.
///
/// The two are NOT interchangeable, and the difference is not hypothetical:
/// `MachineReadableOnly.viewOf` reads three fields the spike's does not --
/// `sunsetDay`, which is its own cold storage slot, and `fellRun` / `fellDay`,
/// which the spike has no concept of at all. The spike therefore cannot
/// produce a LAPSED token, and a lapse is drawn.
///
/// So this file builds its tokens the only way a real one can be built -- mint,
/// check in, apply Marks, seed -- and measures the same cold external call.
/// It is deliberately small: the sweep stays where it is, and this answers the
/// one question the sweep cannot, which is what the shipping contract costs.
///
/// @dev THE WORST CASE MOVED ON 2026-09-23, AND THESE ARE NOW THE FIGURES TO
/// QUOTE. A year stops at 365 credited days, and `FrameRenderer.ringBudget`
/// gives a token one ring of its own -- so no real token can wear more than one
/// ring plus a child's echo, and the ten-ring canvas these tests used to
/// measure is unreachable. The credit that reaches 365 also gives the token a
/// PLACE, so every finished token carries the finisher's digit band.
///
/// Both of those landed together, and they pull in opposite directions: the
/// rings that went made the picture smaller, the band made it larger, and the
/// band wins. The dearest token and the largest token, which have been
/// different tokens for as long as this file has existed, are now THE SAME
/// TOKEN -- a finished child wearing every legal Mark and its place, measured
/// 2026-09-23 at 3,540,467 gas and 22,162 bytes.
///
/// BOTH SHIPPING WORST CASES ROSE, and the comparison has to be made WITHIN
/// this harness to say so honestly. Before this branch the two records sat on
/// two different tokens here: the day-364 child cost the most gas at 2,870,177
/// and the ring-cap child the most bytes at 18,249. So, like for like:
///
///   dearest   2,870,177 -> 3,540,467 gas    +670,290
///   largest      18,249 -> 22,162 bytes      +3,913
///
/// Nothing regressed. A shipping token simply could not be a finisher before,
/// so the band was a cost this harness had no way to measure; it could only be
/// projected on the spike, where the equivalent figure FELL (3,705,772 ->
/// 3,534,616 gas, 23,046 -> 22,152 bytes, `GasBudget.t.sol`) because the
/// ring-cap canvas the projection used no longer exists. A rise here and a fall
/// there are the same fact seen from two harnesses, and quoting one against the
/// other is the mistake this paragraph exists to stop. Headroom after the rise:
/// 459,533 gas and 1,838 bytes.
///
/// Every state below is the deepest the SHIPPING CONTRACT can produce.
contract RealTokenGasTest is MroTestBase {
    /// @dev The same hard limits `GasBudget.t.sol` asserts. Repeated rather
    /// than imported because they are the project's published budget, not that
    /// file's private business, and a test that silently inherited a relaxed
    /// limit would be worse than one that states it.
    /// @dev 4,000,000 since 2026-09-21. The reasoning, the survey it rests
    /// on and the measurements that justified it are in GasBudget.t.sol.
    uint256 constant GAS_LIMIT = 4_000_000;
    /// @dev 24,000 since 2026-09-22. The reasoning and the one real external
    /// ceiling it sits under (Alchemy's documented 30,000) are in GasBudget.t.sol.
    uint256 constant BYTE_LIMIT = 24_000;

    /// @dev The maximal LEGAL Mark set, one per pair: Hush, Beat, the bought
    /// Iris in its dearest shape (leaf, packed at bits 16-23), Vessel and Tint.
    /// Mirrors `GasBudget.t.sol`'s MAX_MARKS, and
    /// `test_theMarkSetMatchesWhatTheLadderWillActuallyApply` below asserts the
    /// contract agrees rather than trusting this line.
    uint256 constant MAX_MARKS = MarkRenderer.HUSH | MarkRenderer.BEAT | MarkRenderer.IRIS_BOUGHT
        | MarkRenderer.VESSEL | MarkRenderer.TINT | (uint256(2) << 16);

    /// @dev And the set a token below a whole heart can legally wear: pair four
    /// is shut on both sides until the heart seals.
    uint256 constant MAX_MARKS_UNSEALED =
        MarkRenderer.HUSH | MarkRenderer.BEAT | MarkRenderer.IRIS_BOUGHT | MarkRenderer.TINT | (uint256(2) << 16);

    /// @dev Mark ids as `Ladder.sol` numbers them, in the order applyMark will
    /// accept them for a token that qualifies.
    uint8 constant HUSH_ID = 1;
    uint8 constant BEAT_ID = 4;
    uint8 constant IRIS_ID = 5;
    uint8 constant VESSEL_ID = 7;
    uint8 constant TINT_ID = 9;
    uint8 constant LEAF = 2;

    function setUp() public {
        _deployAndMintOne();
        // THE REAL LADDER, not a stand-in: `applyMark` refuses an inactive
        // record with MarkInactive, and a test that hand-rolled its own entries
        // would be measuring a token the shipping ladder cannot produce.
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        for (uint8 i = 1; i <= 10; i++) t.setUpgrade(i, u[i]);
    }

    // -----------------------------------------------------------------------
    // Building a real token
    // -----------------------------------------------------------------------

    /// @dev Credit `n` CONSECUTIVE days to `id`, which is the only way a real
    /// token's level and run go up. In chunks, because `batchCheckIn` takes one
    /// day per entry and the chain must have reached each day before it can be
    /// credited -- so a decade is ten warps and ten calls, not one.
    ///
    /// Consecutive is load-bearing: `_credit` raises the run only when the day
    /// is exactly `lastDay + 1`. A gap is a LAPSE, which is a different token
    /// and is measured separately below.
    function _creditRun(uint32 id, uint32 n) internal {
        uint32 done;
        while (done < n) {
            uint32 batch = n - done > 364 ? 364 : n - done;
            uint32 from = t.viewOf(id).lastDay + 1;
            uint32[] memory ds = new uint32[](batch);
            uint32[] memory ids = new uint32[](batch);
            for (uint32 i = 0; i < batch; i++) {
                ds[i] = from + i;
                ids[i] = id;
            }
            _warpToDay(from + batch - 1);
            vm.prank(WARDEN);
            t.batchCheckIn(_packed(ids), ds);
            done += batch;
        }
    }

    /// @dev Apply the maximal legal set through the REAL `applyMark`, which
    /// enforces every ladder gate. A token that does not qualify is refused
    /// here, so a state this helper produces is a state the piece can reach.
    function _applyMaxMarks(uint256 id, bool sealed_) internal {
        vm.startPrank(WARDEN);
        t.applyMark(id, HUSH_ID, 0);
        t.applyMark(id, BEAT_ID, 0);
        t.applyMark(id, IRIS_ID, LEAF);
        if (sealed_) t.applyMark(id, VESSEL_ID, 0);
        t.applyMark(id, TINT_ID, 0);
        vm.stopPrank();
    }

    /// @dev The cold external call, measured exactly as `GasBudget.t.sol`
    /// measures it: `staticcall` with a zero-length output area, so the callee
    /// builds and pays for the whole string while this harness does not also
    /// pay to copy twelve kilobytes into its own memory. Copying it back read
    /// about 19,000 gas high and once turned a passing measurement into one
    /// over the hard limit.
    function _measure(string memory label, uint256 id) internal view returns (uint256 gasUsed, uint256 len) {
        bytes memory data = abi.encodeCall(MachineReadableOnly.tokenURI, (id));
        address a = address(t);
        bool ok;
        uint256 before = gasleft();
        assembly ("memory-safe") {
            ok := staticcall(gas(), a, add(data, 0x20), mload(data), 0, 0)
        }
        gasUsed = before - gasleft();
        require(ok, "tokenURI reverted");
        assembly ("memory-safe") {
            returndatacopy(0, 0x20, 0x20)
            len := mload(0)
        }
        console.log(label);
        console.log("  gas  ", gasUsed);
        console.log("  bytes", len);
        assertLt(gasUsed, GAS_LIMIT, string.concat(label, ": over the hard gas limit"));
        assertLt(len, BYTE_LIMIT, string.concat(label, ": over the hard byte limit"));
    }

    // -----------------------------------------------------------------------
    // The measurements
    // -----------------------------------------------------------------------

    /// @notice The dearest UNFINISHED token, built for real: a CHILD one day
    /// short of a whole heart, wearing every Mark its level allows.
    ///
    /// @dev A child at day 364 carries a fragmented frame AND the echo ring,
    /// which is why it is dearer than a sealed token: the frame is filled to
    /// `min(level, 365)`, so a partial frame and a founding token's rings are
    /// mutually exclusive -- but an echo ring is drawn at any level.
    ///
    /// @dev IT IS NO LONGER THE DEAREST TOKEN IN THE PIECE, and the test was
    /// renamed on 2026-09-23 rather than left to say so wrongly. This token
    /// cannot wear the finisher's digit band -- an ordinal is written by the
    /// credit that reaches 365 and this token is at 364 -- and the band costs
    /// more than the fragmented frame saves. The dearest and the largest are
    /// now the same token, measured in the test below.
    function test_theDeepestUnfinishedTokenFitsTheHardLimit() public {
        // A parent that has finished its year, which is as far as any token can
        // now go. The echo is that one year: `_echo` sums whole finished lines,
        // so a deeper number needs more GENERATIONS, not a longer parent.
        _creditRun(1, 364);
        uint256 child = _seedFrom(1);
        _creditRun(uint32(child), 363);   // the child mints at level 1

        TokenView memory v = t.viewOf(child);
        assertEq(v.level, 364, "the day before the heart seals");
        assertGt(v.echo, 0, "a child carries its line's sealed tenure");
        _applyMaxMarks(child, false);
        assertEq(v.marks | MAX_MARKS_UNSEALED, MAX_MARKS_UNSEALED | t.viewOf(child).marks, "marks were applied");

        (uint256 gasUsed, uint256 len) = _measure("REAL child, day 364, max legal marks", child);
        console.log("  headroom, gas  ", GAS_LIMIT - gasUsed);
        console.log("  headroom, bytes", BYTE_LIMIT - len);
    }

    /// @notice THE WORST CASE, on both limits at once: a child whose own year
    /// is complete, wearing the whole sealed set, carrying the echo ring and
    /// the finisher's digit band.
    ///
    /// @dev IT USED TO BE A CHILD AT THE RING CAP, ten years deep. A year now
    /// stops at 365 credited days, so `FrameRenderer.ringBudget` can never give
    /// a token more than ONE ring of its own, and the ten-ring canvas is
    /// unreachable from a token's own history. See the note at the head of this
    /// file.
    ///
    /// @dev IT IS ALSO THE DEAREST, which is new on 2026-09-23 and is the first
    /// time in this project's history that one token has held both records. The
    /// two had been split since lineage: a fragmented day-364 frame cost the
    /// most gas and a deep ring stack cost the most bytes. The finisher's band
    /// is drawn only on a token that has reached 365, and it costs more than
    /// the fragmented frame ever did, so both records moved to the same place.
    /// Every document that says "the dearest token and the largest token are
    /// different tokens" is describing the piece before this branch.
    function test_theWorstCaseRealTokenFitsBothHardLimits() public {
        _creditRun(1, 364);
        uint256 child = _seedFrom(1);
        _creditRun(uint32(child), 364);
        _applyMaxMarks(child, true);

        assertEq(t.viewOf(child).level, 365, "a whole heart, which is now the ceiling");
        assertGt(t.viewOf(child).marks >> 64, 0, "and it carries a finishing place in its marks word");
        (uint256 gasUsed, uint256 len) = _measure("REAL child, whole year, every legal mark", child);
        console.log("  headroom, gas  ", GAS_LIMIT - gasUsed);
        console.log("  headroom, bytes", BYTE_LIMIT - len);

        // AND THE PUBLISHED FIGURE IS THIS ONE. `GasProfile.t.sol` prints the
        // headroom that is left over from these two numbers and cannot measure
        // them itself -- it renders from a view in memory and deploys no token
        // -- so it read a hand-copied pair until `WorstCase.sol` gave both
        // files one source. Pinned exactly rather than banded: the bands live
        // in `GasBudget.t.sol`, and this says the number a document quotes is
        // the number the contract produces. If this goes red, re-measure, then
        // update `WorstCase.sol` and every figure quoted from it.
        assertEq(gasUsed, WorstCase.LARGEST_TOKEN_GAS, "the worst case moved: update WorstCase.sol");
        assertEq(len, WorstCase.LARGEST_TOKEN_BYTES, "the worst case moved: update WorstCase.sol");
    }

    /// @notice A LAPSED token -- a state the spike cannot represent at all.
    ///
    /// @dev `fellRun` and `fellDay` exist only on the shipping contract, and
    /// the renderer pales the heart in steps from them. Every published budget
    /// figure was measured with both pinned at zero, so this is the first
    /// measurement of a token that stopped coming back. It is not expected to
    /// be the worst case; it is measured because nothing had ever measured it.
    /// @dev SEALED MARKS ARE GONE FROM THIS CASE and cannot come back: Vessel
    /// needs a whole heart, a whole heart is 365 credited days, and a token at
    /// 365 can never be credited again -- so it can never lapse. A lapsed token
    /// therefore wears the unsealed set, which is the most it could ever wear.
    function test_aLapsedRealTokenFitsTheHardLimit() public {
        _creditRun(1, 300);
        _applyMaxMarks(1, false);

        // Miss a year, then come back for a single day: the run falls, and
        // `fellRun` records what was lost.
        _warpToDay(_today() + 400);
        // `_today()`, NEVER `t.today()`, inside these arguments: an external
        // call there is the call `vm.prank` matches, so the check-in itself
        // arrives from the test contract and is refused NotWarden. The trap is
        // documented on MroTestBase._today() and this is it happening.
        uint32 back = _today();
        vm.prank(WARDEN);
        t.batchCheckIn(_one(1), _days(back));

        TokenView memory v = t.viewOf(1);
        assertGt(v.fellRun, 0, "the fallen run must be recorded, or this measures nothing new");
        assertEq(v.streak, 1, "and the run starts again at one");

        (uint256 gasUsed,) = _measure("REAL founding token, lapsed after a 300-day run", 1);
        console.log("  headroom, gas  ", GAS_LIMIT - gasUsed);
    }

    /// @notice What the shipping contract costs OVER the spike the budget was
    /// measured on, at the same nominal state.
    ///
    /// @dev The two cannot be made identical -- a real token's mint day and day
    /// numbers come from its own history -- so this is the contract-side
    /// difference at the same level, run and Mark set, not a controlled
    /// experiment. It is worth stating because the published headroom is the
    /// spike's, and a reader should know which way the error runs.
    function test_theShippingContractIsNotCheaperThanTheSpike() public {
        _creditRun(1, 364);
        _applyMaxMarks(1, true);

        (uint256 real,) = _measure("REAL founding token, a whole year, every legal mark", 1);
        // The spike's comparable stage, from GasBudget.t.sol's ladder: a
        // founding token at three years with no marks measured 1,550,307 gas on
        // 2026-09-07. Printed rather than asserted against, because that figure
        // is a different Mark set and would be a false comparison if pinned.
        console.log("  (the spike's ladder is printed by GasBudget.t.sol -- compare there)");
        assertLt(real, GAS_LIMIT, "the shipping contract must fit the hard limit");
    }

    /// @notice The Mark constants above describe what `applyMark` actually
    /// writes, rather than being a second copy that can drift from the first.
    function test_theMarkSetMatchesWhatTheLadderWillActuallyApply() public {
        _creditRun(1, 363);
        _applyMaxMarks(1, false);
        assertEq(t.viewOf(1).marks, MAX_MARKS_UNSEALED, "the unsealed set is what the ladder applied");

        // The credit that seals the heart also FINISHES the token, so from here
        // the word carries a finisher Mark and its ordinal as well. Named here
        // rather than folded into MAX_MARKS: that constant describes what
        // `applyMark` writes, and nothing applied these -- this token is the
        // first to finish, so the bit is Apex.
        _creditRun(1, 1);
        vm.prank(WARDEN);
        t.applyMark(1, VESSEL_ID, 0);
        assertEq(
            t.viewOf(1).marks & 0xFFFFFFFF,
            MAX_MARKS | (uint256(1) << 15),
            "and pair four opens the day the heart seals"
        );
        assertEq(t.viewOf(1).marks >> 64, 1, "the place it finished in, given by the same credit");
    }
}
