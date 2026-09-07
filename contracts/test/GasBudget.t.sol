// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";

/// @notice The spike's headline numbers: what a marketplace pays to read
/// `tokenURI` off the token contract, at every life stage that matters.
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

    uint256 constant GAS_LIMIT = 2_000_000;
    uint256 constant BYTE_LIMIT = 20_000;
    uint256 constant GAS_TARGET = 1_000_000;
    uint256 constant BYTE_TARGET = 5_000;

    /// @dev THE REGRESSION BAND, which is a different instrument from the hard
    /// limit above. The hard limit is what the piece cannot exceed and still
    /// work; it sits 250,000 gas above where the renderer actually is, so a 14%
    /// regression would land silently inside it and nothing would go red until
    /// the next one. These two are set just above the MEASURED worst cases
    /// (1,979,442 gas and 13,482 bytes on 2026-09-07), so any real growth in
    /// the renderer has to be looked at.
    ///
    /// A failure here is NOT necessarily a bug -- it is a change asking to be
    /// noticed. Move these deliberately, in the same commit as the change that
    /// costs the gas, and say in the message what bought the increase.
    ///
    /// MOVED 2026-09-07, by lineage, and the gas half is no longer really a
    /// band. It used to sit 200,000 gas below the hard limit; the dearest token
    /// is now a seeded CHILD at day 364, whose echo ring costs 240,196 gas, and
    /// that leaves 20,558 gas of headroom in total. There is no room left to
    /// put a band in, so this one is set as close under the hard limit as a
    /// measurement can safely be pinned. THE PIECE PASSES ITS OWN HARD LIMIT BY
    /// ABOUT ONE PERCENT. Anything that adds drawing to a child needs a real
    /// budget conversation before it is written, not a band nudge afterwards.
    /// The byte half is unchanged in character: 13,482 of 20,000, 6,518 spare.
    uint256 constant GAS_BAND = 1_990_000;
    uint256 constant BYTE_BAND = 13_600;

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
    /// This was not a distinction the budget had to make until lineage: token 9
    /// has always over-approximated the day-364 case with the whole-heart set
    /// and had room to spare. A CHILD does not -- see
    /// test_theDayBeforeWholeIsOnlyAffordableBecauseTheLadderShutsPairFour,
    /// which measures the over-approximation and finds it OVER the hard limit.
    uint256 constant MAX_MARKS_UNSEALED = MarkRenderer.HUSH | MarkRenderer.BEAT
        | MarkRenderer.IRIS_BOUGHT | MarkRenderer.TINT | (uint256(2) << 16);

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs.
    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
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
    function test_theWholeLadderStaysInsideTheHardLimit() public {
        _place(1, 1, 1, 1000, false, 0);
        _place(2, 200, 45, 1000, false, 0);
        _place(3, 365, 140, 1000, false, 0);
        _place(4, 365, 140, 960, false, 0);              // forty days lapsed
        _place(5, 365 * 3, 200, 1000, false, 0);
        _place(6, 365 * 10, 400, 1000, false, 0);        // at the ring cap
        _place(7, 365 * 10, 400, 1000, false, MAX_MARKS);
        _place(8, 365 * 3, 200, 1000, true, 0);          // sealed
        _place(9, 364, 400, 1000, false, MAX_MARKS);     // the day before whole
        // The two children. A child spends one of its ten ring slots on the
        // dotted echo ring, so 11 is at NINE own rings plus the echo, and 12
        // has zero own rings and the echo alone.
        _placeChild(11, 365 * 10, 400, 1000, 3650, MAX_MARKS);
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
        (, b) = _measure("whole and lapsed", 4);            maxBytes = _max(maxBytes, b);
        (, b) = _measure("three years", 5);                 maxBytes = _max(maxBytes, b);
        (, b) = _measure("ten years, at the cap", 6);       maxBytes = _max(maxBytes, b);
        (uint256 capAndMarks, uint256 capBytes) = _measure("cap and max marks", 7);
        maxBytes = _max(maxBytes, capBytes);
        (uint256 sealedGas,) = _measure("sealed at rest", 8);
        (uint256 foundingWorstGas, uint256 lastBytes) = _measure("day 364, max marks", 9);
        maxBytes = _max(maxBytes, lastBytes);
        (, b) = _measure("ten years, a child at the cap", 11);
        maxBytes = _max(maxBytes, b);
        (uint256 worstGas,) = _measure("day 364, a child, max marks", 12);

        // A sealed token takes a branch, not extra work.
        assertLt(sealedGas, capAndMarks, "sealing must not cost more than wearing the max marks");

        // The worst case is NOT the oldest token. See the test below.
        assertGt(foundingWorstGas, capAndMarks, "day 364 is the expensive case, not the ring cap");

        // LINEAGE BROKE THE OLD MUTUAL EXCLUSION. Until the echo ring existed,
        // an unsealed frame implied level < 365 which implied zero rings, so
        // the dearest token could never also be a ringed one -- the comment on
        // test_theWorstCaseIsTheDayBeforeTheHeartSeals still says so and is
        // still right about a FOUNDING token. A child is the counter-example:
        // its echo ring is drawn for any non-zero echo, at any level, so token
        // 12 carries a fragmented frame AND a ring at once. That makes the
        // dearest token in the piece a CHILD, and it is measured here rather
        // than reasoned about.
        assertGt(worstGas, foundingWorstGas, "a child at day 364 is the dearest token, not a founding one");

        // The 1,000,000 / 5,000 target is missed and is reported as missed
        // rather than quietly dropped. Flip these the day they pass -- and
        // update docs/phase0-results.md in the same commit.
        if (_gasIsMeaningful()) {
            assertGt(worstGas, GAS_TARGET, "the gas target now passes: update the results table");
        }
        assertGt(maxBytes, BYTE_TARGET, "the byte target now passes: update the results table");

        // The regression band. Each worst case is checked against its OWN
        // band: the dearest token and the largest token are different tokens,
        // and pairing one's gas with the other's bytes is the mistake this
        // file's own comments warn about.
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
        console.log("  bytes, from a child at the ring cap with max marks", BYTE_LIMIT - maxBytes);
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
        _place(7, 365 * 10, 400, 1000, false, MAX_MARKS);

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
    /// @dev This is the first honest figure for the ring. Task 1 reported the
    /// Echo costing 148 gas, measured on a spike token that had no `_echo`
    /// mapping at all -- so that number was memory handling and nothing else.
    /// It is superseded here, and there are TWO real costs, not one:
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
    /// Limit` measures eleven tokens in ONE function; every returned tokenURI
    /// stays in that function's memory, so the eleventh call pays memory
    /// expansion for roughly 130 KB it did not allocate. Memory is priced
    /// quadratically, so the inflation grows with position in the list, and
    /// the same child measured there and here differs by about 19,000 gas.
    ///
    /// That artifact has been in the ladder test since it was written and was
    /// harmless while there were 250,000 gas of headroom. Lineage removed the
    /// headroom: before `_call` stopped copying the answer back, the ladder
    /// billed this child 2,007,226 -- OVER the 2,000,000 hard limit -- for
    /// memory its own token never touched, while the same child measured alone
    /// was under. This test is what the hard limit should be judged on.
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
            console.log("  headroom", GAS_LIMIT - gasUsed);
            assertLt(gasUsed, GAS_LIMIT, "the dearest token must fit the hard limit");
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
}
