// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";

/// @notice The spike's headline numbers: what a marketplace pays to read
/// `tokenURI` off the token contract, at every life stage that matters.
///
/// @dev THESE ARE THE SPIKE'S NUMBERS, NOT THE SHIPPING CONTRACT'S, and the
/// difference is about 5,300 gas -- `MachineReadableOnly.viewOf` also reads
/// `sunsetDay`, `fellRun` and `fellDay`, none of which `MROSpikeToken` has.
/// This file stays because a twelve-stage sweep is only affordable against
/// `setState`. `RealTokenGas.t.sol` measures the real thing, and is what any
/// published figure must come from.
///
/// @dev Every earlier gas figure on this spike measured the renderer alone,
/// with its TokenView already sitting in memory. This file measures the call a
/// marketplace actually makes, which has to read storage first.
///
/// Measured through an external call on a token whose slots are cold, so the
/// SLOADs are billed at 2,100 rather than 100. Warming them first would flatter
/// the result and would not be a number anybody pays. Each stage gets its own
/// token id for the same reason -- no stage may warm another's storage.
contract GasBudgetTest is Test {
    MROSpikeToken t;
    Renderer r;

    /// @dev RAISED TO 4,000,000 on 2026-09-21, by the operator, and this is the
    /// SECOND raise that day: 2,000,000 to 3,000,000 to pay for QR version 10
    /// and the finisher's digit band, then to 4,000,000 once version 10 was
    /// actually built and MEASURED at 2,867,756 -- leaving 132,244 against a
    /// digit band measured at 584,708. The first raise was sized from a
    /// component estimate; this one is sized from the built thing.
    ///
    /// The BYTE limit did not move with it. Bytes are what protect the decode
    /// and what a marketplace actually fetches, so 20,000 stands until a
    /// decode sweep says otherwise.
    ///
    /// The 2,000,000 was set on 2026-08-27 at roughly the Uniswap V3 line
    /// (1.98M), from a survey of on-chain NFTs: Loot 572k, OnChainMonkey 836k,
    /// Anonymice 24M, Terraforms 28M. It was never a protocol rule. `tokenURI`
    /// is a READ -- nobody pays it -- and the real ceiling is what a node will
    /// execute for one eth_call, which is around 50M by default.
    ///
    /// What it bought was compatibility with unusually strict providers, and
    /// the spec's own survey names the failure mode: Nouns and Moonbirds could
    /// not be estimated on five public RPCs. That is a real cost and it is
    /// unmeasurable, which is why the number moves deliberately and not far.
    ///
    /// What it cost was the artwork. Two changes the operator wanted were blocked by
    /// it and by nothing else, and BOTH were measured at about half what the
    /// estimates claimed:
    ///
    ///   a finer QR (version 10)   +675,863 gas  +4,285 bytes
    ///   a border of real digits   +584,708 gas  +3,360 bytes
    ///
    /// THE DIGIT BAND LINE ABOVE IS A RECORD OF A DESIGN THAT WAS NOT BUILT,
    /// and it is kept only because the 4,000,000 was sized against it.
    /// `DigitBandCost.t.sol` priced a 3x5 glyph on TWO edges, 32 glyphs; what
    /// shipped is a 3x3 glyph on FOUR, which is 64. Re-measured 2026-09-23 by
    /// `test_theFinishersBandFitsBothHardLimits` below, on the real thing:
    ///
    ///   a border of real digits   +871,911 gas  +4,636 bytes
    ///
    /// Half as much again in gas and a third more in bytes than the figure the
    /// limit was set from. It still fits -- see the headroom that test prints --
    /// and the limit has not moved for it.
    ///
    /// This paragraph used to end "THE BYTE LIMIT DOES NOT MOVE: at 20,000 it
    /// is never threatened by either change (18,854 with both)". That was an
    /// ESTIMATE and it was wrong. Version 10 alone measured 18,246 at the byte
    /// worst case, so both changes together do not fit 20,000 and the limit
    /// moved to 24,000 on 2026-09-22. See BYTE_LIMIT below.
    uint256 constant GAS_LIMIT = 4_000_000;
    /// @dev 24,000 SINCE 2026-09-22, raised from 20,000 by the operator.
    ///
    /// THE 20,000 WAS CHOSEN, NOT DERIVED. It was a Phase 0 pass criterion in
    /// the spec and this file justified it as "bytes are what every viewer
    /// actually downloads" -- a quality argument, not a limit anyone imposes.
    /// QR version 10 measured 18,246 at the byte worst case and the finisher's
    /// digit band was then thought to need another 3,360, so the chosen number
    /// was about to decide a design question it was never derived to answer.
    /// The band as built needs 4,636 (measured 2026-09-23, below), which is
    /// more than the raise was argued from and still inside it.
    ///
    /// THERE IS ONE REAL EXTERNAL CEILING AND IT IS 30,000. Alchemy's NFT API
    /// docs: "This can also happen if the content length of the response is
    /// larger than 30 000 bytes." That matters here more than it would
    /// elsewhere, because Alchemy is the ONLY third-party metadata consumer
    /// this piece has ever had working -- Basescan ingests none on Base
    /// Sepolia and OpenSea is untested. 24,000 fits version 10 plus the digit
    /// band: measured 2026-09-23, the largest token the shipping contract can
    /// produce is 22,162 bytes (`RealTokenGas.t.sol`), which leaves 1,838 under
    /// this limit and 7,838 under Alchemy's 30,000.
    ///
    /// UNTESTED, AND SAY SO: Alchemy's sentence sits among reasons an
    /// HTTP-hosted metadata URL fails to FETCH. This tokenURI is a data URI
    /// and nothing is fetched, so whether the cap applies to inline metadata
    /// has never been measured. tools/alchemy-nft.mjs exists to measure it and
    /// MUST be run against a real token before the mainnet mint.
    ///
    /// Gas is not the constraint: Base's own guidance puts the practical
    /// tokenURI ceiling near 300M read gas and this token spends 3.54M.
    uint256 constant BYTE_LIMIT = 24_000;
    uint256 constant GAS_TARGET = 1_000_000;
    uint256 constant BYTE_TARGET = 5_000;

    /// @dev THE REGRESSION BAND, which is a different instrument from the hard
    /// limit above. The hard limit is what the piece cannot exceed and still
    /// work; it sits 250,000 gas above where the renderer actually is, so a 14%
    /// regression would land silently inside it and nothing would go red until
    /// the next one. These two are set just above the MEASURED worst cases
    /// (1,884,779 gas and 12,546 bytes on 2026-09-07), so any real growth in
    /// the renderer has to be looked at.
    ///
    /// A failure here is NOT necessarily a bug -- it is a change asking to be
    /// noticed. Move these deliberately, in the same commit as the change that
    /// costs the gas, and say in the message what bought the increase.
    ///
    /// MOVED TWICE ON 2026-09-07, and the second move is the one that matters.
    /// Lineage first took the dearest token to 1,983,942 -- 16,058 under the
    /// hard limit -- and the gas band had to be pinned just below the ceiling
    /// because there was nothing left to put a band inside. The echo ring was
    /// then changed from a dot to a DASH, which halved its run count, and the
    /// headroom came back: the dearest token is 1,889,279 measured cold, so
    /// there are 110,721 gas to spare. These are real bands again, set about
    /// 2.8% above each measured worst case, the same margin they carried before
    /// lineage. Each still sits well under its hard limit -- 60,000 gas and
    /// 7,100 bytes -- so a regression trips a band long before it trips the
    /// thing that actually breaks the piece.
    /// MOVED AGAIN 2026-09-21, for QR version 10. The dearest token measured
    /// 2,867,756 gas and the largest 18,246 bytes, so both bands are set about
    /// 2.8% above their new worst case, the same margin they have always
    /// carried.
    ///
    /// WHAT THESE TWO BANDS COVER, SINCE 2026-09-23, AND WHAT THEY DO NOT.
    /// They are checked against `test_theWholeLadderStaysInsideTheHardLimit`,
    /// and every stage in that ladder is UNBANDED. Re-measured on this branch,
    /// the ladder's worst cases are 2,868,412 gas and 17,516 bytes, so the
    /// bands still sit about 2.7% and 7% above what they watch and either can
    /// still fail.
    ///
    /// THE PIECE'S ACTUAL WORST CASE IS BIGGER THAN BOTH BANDS AND IS NOT
    /// WATCHED BY THEM. A real token that reaches 365 is given a place in the
    /// same credit, so every finished token carries the digit band, and the
    /// largest one measures 3,540,467 gas / 22,162 bytes
    /// (`RealTokenGas.t.sol`). Those are governed by the HARD LIMITS alone --
    /// by `test_theFinishersBandFitsBothHardLimits` here and by
    /// `RealTokenGas.t.sol` there. A band round the banded worst case is worth
    /// having and is a deliberate decision with a number in it, which is the
    /// operator's to make, not this file's to assume.
    ///
    /// The old paragraph here said the byte band left 1,200 under a 20,000
    /// limit and that the digit band "does not fit". The limit moved to 24,000
    /// on 2026-09-22 and the band does fit: measured, it costs 4,636 bytes and
    /// the largest token lands 1,838 under. Both halves of that sentence were
    /// superseded within a day of being written.
    uint256 constant GAS_BAND = 2_945_000;
    uint256 constant BYTE_BAND = 18_800;

    /// @dev The maximal LEGAL token under the ten-Mark ladder: at most one Mark
    /// per pair -- (1,2) (3,4) (5,6) (7,8) (9,10) -- so "every Mark" is no
    /// longer a state any token can reach. This is the pair-by-pair selection
    /// that draws the most: Hush, BEAT, the BOUGHT Iris in its costliest
    /// shape (leaf), Vessel, and Tint. Static and Break sit in the excluded
    /// halves of their pairs and are never worn alongside this set.
    ///
    /// FIX ROUND 1: this used to say Static, not Beat. That was wrong, and the
    /// evidence was already in hand: Static is a same-length ink SWAP (zero
    /// extra bytes), while Beat replaces the heart's flat fill with a gradient
    /// reference and adds an entire `<defs><linearGradient>...</linearGradient>
    /// </defs>` block. Measured, same day-364 state:
    ///   Hush + Static + Iris(leaf) + Vessel + Tint   1,728,964 gas / 10,441 B
    ///   Hush + Beat   + Iris(leaf) + Vessel + Tint   1,738,180 gas / 10,651 B
    /// Beat costs 9,216 more gas and 210 more bytes. `combination-sweep.mjs`'s
    /// own sweep already showed this -- its largest SVG among all 459 is a Beat
    /// combination, not a Static one -- and that sweep is the more trustworthy
    /// source: it measured every combination rather than assuming which pair
    /// side costs more. See that file's MAX_LEGAL for the cross-check that now
    /// ties the two together.
    ///
    /// The Iris shape is packed at bits 16-23 of the same word applyMark writes
    /// it to (MachineReadableOnly.applyMark, upgradeId == 5); 2 is leaf, per
    /// render-token.mjs's IRIS_SHAPE_NAMES order (target, squircle, leaf).
    uint256 constant MAX_MARKS = MarkRenderer.HUSH | MarkRenderer.BEAT | MarkRenderer.IRIS_BOUGHT
        | MarkRenderer.VESSEL | MarkRenderer.TINT | (uint256(2) << 16);

    /// @dev The maximal legal set for a token whose heart is NOT yet whole,
    /// which is pair 4 removed and nothing put back. Both of that pair's sides
    /// are shut below a whole heart, and `Ladder.sol` is where both facts live:
    ///   Vessel (id 7) sets `requiresWhole`, and applyMark refuses it while
    ///     `level < 365`;
    ///   Break (id 8) asks for a completed run of 365, and `_credit` raises
    ///     `level` on every day it raises the run, so a run of 365 implies a
    ///     level of at least 365.
    /// So a token at level 364 wears at most four Marks, and MAX_MARKS above is
    /// legal only from the day the heart seals.
    ///
    /// THE REASON IS LEGALITY, NOT AFFORDABILITY. An earlier draft of this
    /// comment claimed the whole-heart set on a day-364 child busts the hard
    /// limit, and cited a test that was never written. Both were wrong: with
    /// the dashed ring the illegal five-Mark version measures 873 gas dearer
    /// and is comfortably inside the limit. It is excluded because the
    /// ladder cannot produce it, and the budget should not rest on a token that
    /// cannot exist. test_theLadderShutsBothSidesOfPairFourBelowAWholeHeart
    /// asserts both gates against Ladder.sol and measures what the difference
    /// is actually worth.
    uint256 constant MAX_MARKS_UNSEALED = MarkRenderer.HUSH | MarkRenderer.BEAT
        | MarkRenderer.IRIS_BOUGHT | MarkRenderer.TINT | (uint256(2) << 16);

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs.
    function _code() internal pure returns (bytes memory) {
        return
        hex"fe7f926bb8df3fc116bae8ac88906e9d1d71e35bcbb757fff47edfa5dbafffffe6f7d2ec13ebaf1bf3f107fa"
        hex"aaaaaaaaaafe00faebc7bbfb00c77fffffddfd8c5efffffffffffcafff5c61df9df8afbfaebcfbfbf9efffff"
        hex"fe7f9bb78beffffebbe9af7efff5c71df04ffefbfffffffffdff3fffffffddfddf3effffebbfbbfbfffeeefb"
        hex"bbbbfbffbfaebffb8dbfe7fffffffdc75ff7effffffffbbdf3fffdc71dfd9e9cfbfeebffbbfbbc3fffffffff"
        hex"ffff7effffebbfbbfb5fffdc6fdf9dfecf1ffffc7ffb51f7affffebddddad2c7ffff1bfba4727ffeeffbba37"
        hex"fb7bfeeb6fbbfae62e7fffbfddfcc92e7fffffffff7722dfdc7ddf9dfbd68feeb6fb9dbcecbffffdbffefbee"
        hex"0ffffffbfb727b7e7dc7ddfdfb48c93fff7ffffeb9737fffbfddfd6e4e4dffffbfbb336fadeeffbbbb6bef17"
        hex"eeb6fbbef6efa6fffbfddb4cd34b6ffffffd73f69e01c7ddf8590bf11aeb6fbbfaa8032d1bbfffabfc806401"
        hex"51beb0c7bfb0187ade0c2b905c377c5eecf11ba3096fe8120ff5d0c265706c9af2e9f2aedba037bf05c26b87"
        hex"9ae9c0fede58a39525f100";
    }

    function setUp() public {
        r = new Renderer();
        t = new MROSpikeToken(address(r));
        vm.warp(86400 * 1000 + 1);   // today() == 1000, matching the fixtures
    }

    function _place(
        uint256 id,
        uint32 level,
        uint32 streak,
        uint32 lastDay,
        bool resting,
        uint256 marks
    ) internal {
        t.mint(id, address(0xA11CE), bytes32(uint256(0xa9e)), _code());
        t.setState(id, MROSpikeToken.Token({
            level: level, streak: streak, lastDay: lastDay, mintDay: 900,
            generation: 0, seedsGiven: 0, resting: resting, reserved: 0
        }));
        if (marks != 0) t.setMarks(id, marks);
    }

    /// @dev The same placement for a SEEDED CHILD: a parent, a generation, and
    /// the inherited days that draw the echo ring. Separate from `_place`
    /// rather than six more arguments on it, because every founding-token case
    /// above would then carry three zeros that mean nothing.
    function _placeChild(
        uint256 id,
        uint32 level,
        uint32 streak,
        uint32 lastDay,
        uint32 echo,
        uint256 marks
    ) internal {
        t.mint(id, address(0xA11CE), bytes32(uint256(0xa9e)), _code());
        t.setState(id, MROSpikeToken.Token({
            level: level, streak: streak, lastDay: lastDay, mintDay: 900,
            generation: 1, seedsGiven: 0, resting: false, reserved: 0
        }));
        t.setParent(id, 1);
        t.setEcho(id, echo);
        if (marks != 0) t.setMarks(id, marks);
    }

    /// @dev THE CALL IS MADE WITHOUT COPYING THE ANSWER BACK.
    ///
    /// `string memory uri = t.tokenURI(id)` -- what this file did until Task 3
    /// -- copies twelve kilobytes into the CALLING test's memory and keeps it
    /// there for the rest of the function. Memory is priced quadratically, so
    /// every later stage in `test_theWholeLadderStaysInsideTheHardLimit` was
    /// billed for expansion its own token never caused: measured, the eleventh
    /// stage read about 19,000 gas high, and the same token measured alone read
    /// 1,990,703 while the ladder called it 2,007,226. The second of those is
    /// over the hard limit and the first is not, so the artifact had stopped
    /// being cosmetic.
    ///
    /// `staticcall` with `out` and `outsize` both zero leaves the return data
    /// where it is. The callee still builds the whole string in ITS memory and
    /// still pays for it -- that cost is the token's and is what we are after --
    /// but the harness stops adding its own. The length is then read out of the
    /// return buffer through scratch space, after the clock has stopped.
    function _call(uint256 id) internal view returns (uint256 gasUsed, uint256 len) {
        bytes memory data = abi.encodeCall(MROSpikeToken.tokenURI, (id));
        address a = address(t);
        bool ok;
        uint256 before = gasleft();
        assembly ("memory-safe") {
            ok := staticcall(gas(), a, add(data, 0x20), mload(data), 0, 0)
        }
        gasUsed = before - gasleft();
        require(ok, "tokenURI reverted");
        // An ABI-encoded string: a 32-byte offset, then the length, then the
        // body. Word 1 is the length.
        assembly ("memory-safe") {
            returndatacopy(0, 0x20, 0x20)
            len := mload(0)
        }
    }

    function _measure(string memory label, uint256 id)
        internal
        view
        returns (uint256 gasUsed, uint256 len)
    {
        (gasUsed, len) = _call(id);
        console.log(label);
        console.log("  gas  ", gasUsed);
        console.log("  bytes", len);
        if (_gasIsMeaningful()) {
            assertLt(gasUsed, GAS_LIMIT, string.concat(label, ": over the hard gas limit"));
        }
        assertLt(len, BYTE_LIMIT, string.concat(label, ": over the hard byte limit"));
    }

    /// @dev The whole ladder in one test so the numbers appear together and can
    /// be copied straight into the results table. Run with -vv.
    ///
    /// EVERY STAGE HERE IS UNBANDED, and since 2026-09-23 four of them are
    /// therefore states the chain cannot produce: tokens 3, 7, 8 and 11 stand
    /// at level 365, and a real token reaching 365 is given a PLACE by the same
    /// credit, so it carries the finisher's digit band from that moment. They
    /// are kept, and kept unbanded, because this ladder's job is to compare
    /// STAGES with each other -- day one against day 200 against the day before
    /// the heart seals -- and a band would add a constant 4,636 bytes to the
    /// tail of the list and tell nobody anything. Read them as the picture
    /// WITHOUT the band. What a finished token really costs is measured in
    /// `test_theFinishersBandFitsBothHardLimits` below, and on the shipping
    /// contract in `RealTokenGas.t.sol`.
    function test_theWholeLadderStaysInsideTheHardLimit() public {
        _place(1, 1, 1, 1000, false, 0);
        _place(2, 200, 45, 1000, false, 0);
        _place(3, 365, 140, 1000, false, 0);
        // Forty days lapsed, ONE DAY SHORT of whole: a finished token's colour
        // is the one it finished with, so at 365 there would be no lapse to bill.
        _place(4, 364, 140, 960, false, 0);
        _place(7, 365, 400, 1000, false, MAX_MARKS);
        _place(8, 365, 200, 1000, true, 0);              // sealed
        _place(9, 364, 400, 1000, false, MAX_MARKS);     // the day before whole
        // The two children. A child draws its own finished-year ring and one
        // more for the line it came from, so 11 is at TWO rings and 12 has the
        // echo alone.
        _placeChild(11, 365, 400, 1000, 3650, MAX_MARKS);
        // 12 wears the UNSEALED set: at level 364 the ladder shuts both sides
        // of pair 4, so Vessel is not a Mark this token could be wearing. Its
        // run is 364 rather than the 400 the founding cases carry, for the same
        // reason -- `_credit` raises the level on every day it raises the run,
        // so a run cannot exceed the level. Neither choice moves the gas (both
        // runs sit on the top rung and both print three digits); they are made
        // because this case is the one the hard limit now rests on, and it
        // should be a token that can exist.
        _placeChild(12, 364, 364, 1000, 3650, MAX_MARKS_UNSEALED);

        // The dearest stage and the largest stage are NOT the same token, so
        // each limit is tracked against its own worst case.
        uint256 maxBytes;
        uint256 b;

        (, b) = _measure("day one", 1);                     maxBytes = _max(maxBytes, b);
        (, b) = _measure("day 200", 2);                     maxBytes = _max(maxBytes, b);
        (, b) = _measure("whole, one ring", 3);             maxBytes = _max(maxBytes, b);
        (, b) = _measure("lapsed, one day short", 4);       maxBytes = _max(maxBytes, b);
        (uint256 capAndMarks, uint256 capBytes) = _measure("finished, max marks", 7);
        maxBytes = _max(maxBytes, capBytes);
        (uint256 sealedGas,) = _measure("sealed at rest", 8);
        (uint256 foundingWorstGas, uint256 lastBytes) = _measure("day 364, max marks", 9);
        maxBytes = _max(maxBytes, lastBytes);
        (, b) = _measure("a finished child, max marks", 11);
        maxBytes = _max(maxBytes, b);
        // Token 12's byte count is FED IN as well, though it is not today's
        // largest. This file's discipline is that each limit tracks its own
        // worst case; dropping a candidate from the byte side because it
        // happens to lose is how a file like this stops being able to see a
        // change that reorders them.
        (uint256 worstGas, uint256 childBytes) = _measure("day 364, a child, max marks", 12);
        maxBytes = _max(maxBytes, childBytes);

        // A sealed token takes a branch, not extra work.
        assertLt(sealedGas, capAndMarks, "sealing must not cost more than wearing the max marks");

        // The worst case is NOT the oldest token. See the test below.
        assertGt(foundingWorstGas, capAndMarks, "day 364 is the expensive case, not the finished token");

        // LINEAGE BROKE THE OLD MUTUAL EXCLUSION. Until the echo ring existed,
        // an unsealed frame implied level < 365 which implied zero rings, so
        // the dearest token could never also be a ringed one -- the comment on
        // test_theWorstCaseIsTheDayBeforeTheHeartSeals still says so and is
        // still right about a FOUNDING token. A child is the counter-example:
        // its echo ring is drawn for any non-zero echo, at any level, so token
        // 12 carries a fragmented frame AND a ring at once. That makes the
        // dearest token in the piece a CHILD, and it is measured here rather
        // than reasoned about.
        assertGt(worstGas, foundingWorstGas,
            "a child at day 364 is the dearest token, not a founding one");

        // The 1,000,000 / 5,000 target is missed and is reported as missed
        // rather than quietly dropped. Flip these the day they pass -- and
        // update docs/phase0-results.md in the same commit.
        if (_gasIsMeaningful()) {
            assertGt(worstGas, GAS_TARGET, "the gas target now passes: update the results table");
        }
        assertGt(maxBytes, BYTE_TARGET, "the byte target now passes: update the results table");

        // The regression band. Each worst case is checked against its OWN
        // band: WITHIN THIS LADDER the dearest token and the largest token are
        // still different tokens -- the day-364 child costs the most gas and
        // the finished child the most bytes -- and pairing one's gas with the
        // other's bytes is the mistake this file's own comments warn about.
        // (Add the band and they become one token; see the finisher test.)
        if (_gasIsMeaningful()) {
            assertLt(worstGas, GAS_BAND, "gas grew past the band: see GAS_BAND before moving it");
        }
        assertLt(maxBytes, BYTE_BAND, "bytes grew past the band: see BYTE_BAND before moving it");

        console.log("headroom against the hard limit");
        // Guarded, not just skipped: on the coverage profile worstGas exceeds
        // the limit and this subtraction would underflow into a panic.
        if (_gasIsMeaningful()) {
            console.log("  gas, from a child at day 364 with max marks", GAS_LIMIT - worstGas);
        }
        console.log("  bytes, from a finished child with max marks", BYTE_LIMIT - maxBytes);
    }

    function _max(uint256 a, uint256 c) private pure returns (uint256) {
        return a > c ? a : c;
    }

    /// @dev Gas is only meaningful on the profile that ships. `forge coverage`
    /// cannot use the IR pipeline (foundry-rs/foundry#13001), so [profile.coverage]
    /// turns off both via_ir and the optimiser -- and the same source then costs
    /// roughly two and a half times as much. Asserting a gas ceiling against that
    /// build measures the coverage profile, not the contract, so the ceiling is
    /// skipped there. The numbers are still logged, and byte lengths, which the
    /// optimiser does not touch, are still asserted.
    function _gasIsMeaningful() internal view returns (bool) {
        return keccak256(bytes(vm.envOr("FOUNDRY_PROFILE", string("default"))))
            != keccak256(bytes("coverage"));
    }


    /// @notice The worst case is the day BEFORE the heart seals, not the oldest
    /// token -- which is the opposite of what the budget was planned around.
    ///
    /// @dev The day frame is drawn as two paths, lit and ghost. At level 364
    /// there are 364 lit cells and 12 ghost ones threaded through them, so both
    /// paths fragment into many short runs. At 365 the ghost path vanishes and
    /// the lit one seals into a handful of long runs, and the cost falls off a
    /// cliff. Measured here rather than asserted from the shape of the code.
    ///
    /// Rings cannot make this worse: the frame is filled to `min(level, 365)`,
    /// so a partial frame implies level < 365, which implies zero rings. The
    /// two expensive cases are mutually exclusive.
    ///
    /// THAT LAST PARAGRAPH IS TRUE OF FOUNDING TOKENS ONLY, since lineage. A
    /// child's echo ring is drawn for any non-zero echo at any level, so a
    /// child at day 364 carries a fragmented frame AND a ring, and it is the
    /// dearest token in the piece. See the ladder test's token 12.
    function test_theWorstCaseIsTheDayBeforeTheHeartSeals() public {
        _place(10, 364, 400, 1000, false, MAX_MARKS);
        _place(11, 365, 400, 1000, false, MAX_MARKS);

        (uint256 almost,) = _measure("level 364, max marks", 10);
        (uint256 whole,) = _measure("level 365, max marks", 11);

        assertGt(almost, whole, "an unsealed frame must be the dearer of the two");
        console.log("the seal is worth", almost - whole);
        if (_gasIsMeaningful()) {
            assertLt(almost, GAS_LIMIT, "even the worst case must fit the hard limit");
        }
    }

    /// @dev What the token contract itself adds, isolated. The renderer was
    /// measured alone at Task 7; the difference is the storage read, and it is
    /// the one quantity this whole task exists to find.
    function test_theTokenContractsOwnOverheadIsSmall() public {
        _place(7, 365, 400, 1000, false, MAX_MARKS);

        uint256 before = gasleft();
        t.tokenURI(7);
        uint256 throughToken = before - gasleft();

        before = gasleft();
        r.tokenURI(t.viewOf(7));
        uint256 rendererOnly = before - gasleft();

        console.log("through the token contract", throughToken);
        console.log("renderer alone (warm view) ", rendererOnly);
        if (_gasIsMeaningful()) {
            assertLt(throughToken, GAS_LIMIT, "the real call must fit the hard limit");
        }
    }

    /// @notice What the echo ring costs, isolated: the same token, the same
    /// Marks, the same day, differing only in whether it was seeded.
    ///
    /// @dev This is the honest figure for the ring. Task 1 reported the Echo
    /// costing 148 gas, measured on a spike token that had no `_echo` mapping
    /// at all -- so that number was memory handling and nothing else. It is
    /// superseded here, and there are TWO real costs, not one:
    ///
    ///   the STORAGE READ, paid by every token in the piece including founding
    ///   ones, because `viewOf` reads `_echo[id]` whether or not it is set; and
    ///
    ///   the RING, paid only by a child, which is where the money is.
    ///
    /// A child's canvas also grows by two cells, because the ring takes a ring
    /// slot a level-364 token did not previously have. The two are measured
    /// together on purpose: "what a child costs" is the quantity the budget
    /// has to defend, and no token can have one without the other.
    function test_whatTheEchoRingCosts() public {
        _place(20, 364, 364, 1000, false, MAX_MARKS_UNSEALED);
        _placeChild(21, 364, 364, 1000, 3650, MAX_MARKS_UNSEALED);

        (uint256 founding, uint256 foundingBytes) = _call(20);
        (uint256 child, uint256 childBytes) = _call(21);

        console.log("day 364, a founding token");
        console.log("  gas  ", founding);
        console.log("  bytes", foundingBytes);
        console.log("day 364, the same token seeded");
        console.log("  gas  ", child);
        console.log("  bytes", childBytes);
        console.log("the echo ring costs");
        console.log("  gas  ", child - founding);
        console.log("  bytes", childBytes - foundingBytes);

        assertGt(child, founding, "a child must be the dearer of the two");
    }

    /// @notice ONE call, in a function that has measured nothing else: what a
    /// marketplace's `eth_call` actually pays for the dearest token in the
    /// piece.
    ///
    /// @dev THE LADDER TEST ABOVE IS NOT THAT NUMBER, and the gap is bigger
    /// than anything the echo ring did. `test_theWholeLadderStaysInsideTheHard
    /// Limit` measures every stage in ONE function; every returned tokenURI
    /// stays in that function's memory, so the last call pays memory
    /// expansion for roughly 130 KB it did not allocate. Memory is priced
    /// quadratically, so the inflation grows with position in the list, and
    /// the same child measured there and here differs by about 19,000 gas.
    ///
    /// That artifact has been in the ladder test since it was written and was
    /// harmless while there were 250,000 gas of headroom. Lineage removed the
    /// headroom and made it matter: measured under the ORIGINAL dotted ring,
    /// before `_call` stopped copying the answer back, the ladder billed this
    /// child 2,007,226 -- OVER the 2,000,000 hard limit -- for memory its own
    /// token never touched, while the same child measured alone was under. The
    /// dash has since bought the headroom back, but the artifact was real and
    /// the fix stands. This test is what the hard limit should be judged on.
    ///
    /// It reads about 4,500 gas HIGHER than the same token in the ladder, and
    /// that difference is real rather than a second artifact: this function
    /// touches the Renderer for the first time, so it pays the 2,600 cold
    /// account access and the cold SLOAD of `renderer` that the ladder's
    /// eleven calls warm for each other. A marketplace's `eth_call` arrives
    /// cold in exactly this way, so this is the dearer and the truer figure.
    function test_theDearestTokenAloneInAFreshCall() public {
        _placeChild(30, 364, 364, 1000, 3650, MAX_MARKS_UNSEALED);

        (uint256 gasUsed, uint256 len) = _call(30);
        console.log("the dearest token, measured alone");
        console.log("  gas  ", gasUsed);
        console.log("  bytes", len);
        if (_gasIsMeaningful()) {
            // Ordered so a token OVER the limit reports the overrun and fails
            // the assertion, rather than panicking on the subtraction before it
            // gets there. Found the hard way: an experiment that made the ring
            // dearer turned this test into an unsigned underflow, which says
            // nothing about the number that caused it.
            if (gasUsed < GAS_LIMIT) console.log("  headroom", GAS_LIMIT - gasUsed);
            else console.log("  OVER THE HARD LIMIT BY", gasUsed - GAS_LIMIT);
            assertLt(gasUsed, GAS_LIMIT, "the dearest token must fit the hard limit");
        }
    }

    /// @notice Why MAX_MARKS_UNSEALED exists: the ladder shuts BOTH sides of
    /// pair 4 below a whole heart, so a day-364 token wears at most four Marks.
    ///
    /// @dev Asserted against `Ladder.sol` itself rather than restated in a
    /// comment, because the whole point is that the budget's worst case must be
    /// a token the ladder can actually produce. If either gate is ever turned
    /// down, this test goes red and the day-364 cases have to be revisited --
    /// which is the only warning the budget would otherwise get.
    ///
    /// The two gates, and why each shuts:
    ///   Vessel (id 7) sets `requiresWhole`, and applyMark refuses it while
    ///     `level < 365`.
    ///   Break (id 8) asks for a completed run of 365, and `_credit` raises the
    ///     level on every day it raises the run, so a run of 365 implies a level
    ///     of at least 365. `bestRun` is only ever written on the way up, so it
    ///     cannot exceed the level either.
    ///
    /// IT IS NOT AN AFFORDABILITY ARGUMENT, and an earlier comment wrongly said
    /// it was. The measurement below is what settles that: the illegal
    /// five-Mark version is dearer, but only by 873 gas -- it was 1,020 under
    /// the dotted ring -- and it sits inside the hard limit. Vessel is a
    /// same-length hex substitution, so it buys almost no bytes. The four-Mark
    /// set is used because it is the legal one, not because it is the cheap one.
    function test_theLadderShutsBothSidesOfPairFourBelowAWholeHeart() public {
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        assertTrue(u[7].requiresWhole, "Vessel must still require a whole heart");
        assertEq(u[8].minStreak, 365, "Break must still require a run of 365");

        _placeChild(50, 364, 364, 1000, 3650, MAX_MARKS_UNSEALED);
        _placeChild(51, 364, 364, 1000, 3650, MAX_MARKS);

        // WARM THE RENDERER BEFORE COMPARING. Whichever token is measured first
        // pays the 2,600 cold account access and the cold SLOAD of `renderer`,
        // which is about 4,500 gas and four times the difference being looked
        // for -- measured, it made the FIVE-Mark token read 3,627 gas cheaper
        // than the four-Mark one, which is the opposite of the truth. Each
        // token still has its own cold storage; only the shared renderer is
        // warmed, and it is warmed for both equally.
        _placeChild(52, 364, 364, 1000, 3650, 0);
        _call(52);

        (uint256 legal,) = _call(50);
        (uint256 illegal,) = _call(51);

        console.log("day 364 child, the four Marks it can wear", legal);
        console.log("day 364 child, the illegal five           ", illegal);
        console.log("what the unreachable Mark would have cost ", illegal - legal);

        // Both gas assertions sit behind the same guard as every other one in
        // this file. The direction happens to hold under the coverage profile
        // too, but a gas assertion that is true there by luck is exactly the
        // kind that stops being true after an unrelated change.
        if (_gasIsMeaningful()) {
            assertGt(illegal, legal, "the excluded Mark is not free, merely unreachable");
            assertLt(illegal, GAS_LIMIT,
                "even the impossible five-Mark day-364 child fits: the reason for the "
                "four-Mark set is legality, not the budget");
        }
    }

    /// @notice What Static costs, measured against the same token without it.
    ///
    /// @dev The Mark it replaced cost 469,027 gas and pushed the day-364 worst
    /// case over the 2,000,000 hard limit, which is why Pulse was dropped. This
    /// is the number that has to be seen beside that one: Static claims the
    /// noise ink, which `CodeRenderer.paths` already takes as a parameter, so it
    /// substitutes one seven-character colour for another. The image bytes must
    /// therefore be IDENTICAL, and only the branch costs gas.
    /// @dev FIX ROUND 1: this used to XOR MarkRenderer.STATIC onto MAX_MARKS to
    /// get "everything except Static". That broke the moment MAX_MARKS itself
    /// stopped containing Static (it wears Beat instead -- see MAX_MARKS's own
    /// doc comment): the XOR then ADDED Static on top of Beat rather than
    /// removing it, comparing two illegal, mislabelled states that both carried
    /// Beat, one of them also carrying Static. Isolating what Static costs needs
    /// a base that carries NEITHER pair-2 Mark, so the only difference between
    /// the two measured tokens is Static itself.
    function test_whatStaticCosts() public {
        uint256 withoutPairTwo = MarkRenderer.HUSH | MarkRenderer.IRIS_BOUGHT
            | MarkRenderer.VESSEL | MarkRenderer.TINT | (uint256(2) << 16);

        _place(40, 364, 100, 1000, false, withoutPairTwo);
        _place(41, 364, 100, 1000, false, withoutPairTwo | MarkRenderer.STATIC);

        (uint256 gasOff, uint256 lenOff) = _measure("day 364, without Static", 40);
        (uint256 gasOn, uint256 lenOn) = _measure("day 364, with Static", 41);

        // Signed: the Mark turned out to be CHEAPER than the branch it replaced,
        // and an unsigned subtraction underflows rather than saying so.
        console.log("delta gas (negative means cheaper)");
        console.logInt(int256(gasOn) - int256(gasOff));
        // 9 bytes exactly: `,"static"` in the Marks attribute. The IMAGE is
        // unchanged -- one seven-character hex colour swapped for another -- and
        // Renderer.t.sol asserts that half directly on `svg()`. Every Mark pays
        // this same name cost; it is the ladder's, not this Mark's.
        assertEq(lenOn - lenOff, 9, "the only byte cost may be the Mark's name");
        assertLt(gasOn, GAS_LIMIT, "Static must stay inside the hard limit");
    }

    // -----------------------------------------------------------------------
    // THE FINISHER'S DIGIT BAND
    // -----------------------------------------------------------------------

    /// @dev The dearest ordinal to DRAW is the one with the most zeros, because
    /// a 0 glyph carries more ink than a 1 -- 111/101/111 against 110/010/111.
    /// Sixteen bits with a single 1 is therefore the worst case, and it is also
    /// the first finisher, which is the one token certain to exist.
    uint256 constant WORST_ORDINAL = uint256(1) << 64;

    /// @notice What the finisher's digit band costs, on the token that will
    /// actually carry one and on a bound that no ladder can produce.
    ///
    /// @dev THE FIGURE ON RECORD BEFORE THIS TEST WAS FOR A DIFFERENT DESIGN.
    /// `DigitBandCost.t.sol` priced a 3x5 glyph on TWO edges, 32 glyphs; the
    /// design the operator settled in section 10k is a 3x3 glyph on FOUR, which
    /// is 64. Neither the gas nor the byte figure carries over, and this file
    /// measures the shipped one.
    ///
    /// A FINISHER IS WHOLE, so the band's real worst case is the largest WHOLE
    /// token -- a finished child wearing every Mark -- and not the day-364
    /// child the unbanded budget rests on. Both are measured anyway:
    /// the renderer draws the band on the ordinal alone and does not ask
    /// whether the heart is whole, so the day-364 figure is the bound if that
    /// ever stopped being true. It is a bound, not a case: the ladder cannot
    /// produce it, because an ordinal is only written when a finisher Mark is
    /// claimed and a finisher Mark needs 365 days.
    function test_theFinishersBandFitsBothHardLimits() public {
        // The two whole children, finished and wearing every Mark, with and
        // without the band. Nothing else differs between them.
        _placeChild(50, 365, 400, 1000, 3650, MAX_MARKS);
        _placeChild(51, 365, 400, 1000, 3650, MAX_MARKS | WORST_ORDINAL);
        // The bound: the day before whole, which cannot be a finisher.
        _placeChild(52, 364, 364, 1000, 3650, MAX_MARKS_UNSEALED);
        _placeChild(53, 364, 364, 1000, 3650, MAX_MARKS_UNSEALED | WORST_ORDINAL);

        (uint256 wholeGas, uint256 wholeBytes) = _measure("finished child, max marks", 50);
        (uint256 bandGas, uint256 bandBytes) = _measure("the same token, finisher 1", 51);
        (uint256 boundOffGas, uint256 boundOffBytes) = _measure("day 364 child (a bound)", 52);
        (uint256 boundGas, uint256 boundBytes) = _measure("day 364 child, banded (a bound)", 53);

        console.log("the finisher's digit band costs");
        console.log("  on a whole child   gas", bandGas - wholeGas);
        console.log("                   bytes", bandBytes - wholeBytes);
        console.log("  on the bound       gas", boundGas - boundOffGas);
        console.log("                   bytes", boundBytes - boundOffBytes);
        console.log("headroom left, banded");
        if (bandGas < GAS_LIMIT) console.log("  gas  ", GAS_LIMIT - bandGas);
        else console.log("  OVER THE HARD GAS LIMIT BY", bandGas - GAS_LIMIT);
        if (bandBytes < BYTE_LIMIT) console.log("  bytes", BYTE_LIMIT - bandBytes);
        else console.log("  OVER THE HARD BYTE LIMIT BY", bandBytes - BYTE_LIMIT);

        // BOTH limits, on BOTH tokens, and the habit is kept even though the
        // reason for it changed on 2026-09-23. The dearest token and the
        // largest token WERE different tokens, and every document in this
        // project collapsed them at least once; since the finisher's band they
        // are the SAME token, because only a token past 365 carries a band and
        // the band costs more than a fragmented day-364 frame saves. Asserting
        // both anyway is what would notice them coming apart again -- a Mark
        // that buys bytes without gas, or the reverse, would do it -- and
        // costs nothing while they agree.
        assertLt(bandBytes, BYTE_LIMIT, "a finisher must fit the hard byte limit");
        assertLt(boundBytes, BYTE_LIMIT, "so must the bound");
        if (_gasIsMeaningful()) {
            assertLt(bandGas, GAS_LIMIT, "a finisher must fit the hard gas limit");
            assertLt(boundGas, GAS_LIMIT, "so must the bound");
        }
    }

    /// @notice The band's cost varies with the NUMBER, which is unusual enough
    /// to pin: a reader who takes one gas figure for "the band" will be wrong
    /// for every other finisher.
    function test_theOrdinalFullOfZerosIsTheDearestBand() public {
        _placeChild(60, 365, 400, 1000, 3650, MAX_MARKS | WORST_ORDINAL);
        _placeChild(61, 365, 400, 1000, 3650, MAX_MARKS | (uint256(0xFFFF) << 64));

        (uint256 zerosGas, uint256 zerosBytes) = _measure("finisher 1 (fifteen zeros)", 60);
        (uint256 onesGas, uint256 onesBytes) = _measure("finisher 65535 (all ones)", 61);

        assertGt(zerosBytes, onesBytes, "a 0 glyph carries more ink than a 1");
        if (_gasIsMeaningful()) {
            assertGt(zerosGas, onesGas, "and therefore costs more to draw");
        }
    }
}
