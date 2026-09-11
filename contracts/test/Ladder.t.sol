// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {MroTestBase} from "./MroTestBase.sol";

/// @notice The ladder's structure, asserted rather than trusted from a table --
/// plus the behavioural half, which needs a live token: Break's freedom.
///
/// @dev Extends MroTestBase rather than Test, because the Break tests need a
/// real token at a 365-day run and the base already knows how to build one.
contract LadderTest is MroTestBase {
    function setUp() public {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code(), _today());
    }

    /// @dev Which pair each Mark belongs to. Pairs are (1,2) (3,4) (5,6) (7,8)
    /// (9,10), so the pair of id n is (n + 1) / 2.
    function _pairOf(uint8 id) internal pure returns (uint8) {
        return (id + 1) / 2;
    }

    function test_everyExclusionIsSymmetric() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            for (uint8 b = 1; b <= 10; b++) {
                bool aExcludesB = u[a].excludes & uint16(1 << b) != 0;
                bool bExcludesA = u[b].excludes & uint16(1 << a) != 0;
                assertEq(aExcludesB, bExcludesA, "exclusion is not symmetric");
            }
        }
    }

    /// @dev The invariant the symmetry test alone would happily pass a
    /// reintroduced cross-pair rule on. Revision 2 of the spec removed exactly
    /// such a rule, on the grounds that a tier whose optimal play is abstention
    /// is a dead tier. This is what stops it coming back through an edit to one
    /// row.
    function test_noExclusionCrossesAPairBoundary() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            for (uint8 b = 1; b <= 10; b++) {
                if (u[a].excludes & uint16(1 << b) == 0) continue;
                assertEq(_pairOf(a), _pairOf(b), "an exclusion crosses a pair");
            }
        }
    }

    /// @dev 12.8. The three tests around this one all derive their expectation
    /// with `1 << n` -- the SAME expression Ladder.sol uses to build the value
    /// -- so any shared arithmetic mistake cancels out and all three pass. The
    /// verifier proved it: set every `excludes` to zero and the symmetry, the
    /// no-cross-pair and the exactly-its-partner tests are all still green.
    ///
    /// So this one writes the numbers out. A literal table cannot share a bug
    /// with the code it checks, and it is the only test here that fails when
    /// the masks are simply absent.
    function test_theExclusionMasksAreTheseExactNumbers() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        uint16[11] memory expected = [
            uint16(0),      // 0 is not a Mark
            uint16(4),      // 1 hush   excludes 2 ache      -> 1 << 2
            uint16(2),      // 2 ache   excludes 1 hush      -> 1 << 1
            uint16(16),     // 3 static excludes 4 beat      -> 1 << 4
            uint16(8),      // 4 beat   excludes 3 static    -> 1 << 3
            uint16(64),     // 5 iris   excludes 6 iris      -> 1 << 6
            uint16(32),     // 6 iris   excludes 5 iris      -> 1 << 5
            uint16(256),    // 7 vessel excludes 8 break     -> 1 << 8
            uint16(128),    // 8 break  excludes 7 vessel    -> 1 << 7
            uint16(1024),   // 9 tint   excludes 10 aura     -> 1 << 10
            uint16(512)     // 10 aura  excludes 9 tint      -> 1 << 9
        ];
        for (uint8 a = 1; a <= 10; a++) {
            assertEq(u[a].excludes, expected[a], "an exclusion mask is not the number it must be");
        }
    }

    function test_eachMarkExcludesExactlyItsPartner() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            uint8 partner = a % 2 == 1 ? a + 1 : a - 1;
            assertEq(u[a].excludes, uint16(1 << partner), "wrong exclusion mask");
        }
    }

    /// @dev The fix for the SECOND trap. Aura was ungated, so it was buyable on
    /// day one and silently forfeited Tint, which needs an Iris and therefore
    /// 100 days. A pair is fair when both sides open at the same time.
    function test_bothSidesOfPairFiveWaitOnAnIris() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        uint16 anIris = uint16((1 << 5) | (1 << 6));
        assertEq(u[9].requiresAny, anIris, "Tint must need an Iris");
        assertEq(u[10].requiresAny, anIris, "Aura must need an Iris too");
    }

    function test_nothingIsLimited() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 a = 1; a <= 10; a++) {
            assertEq(u[a].maxSupply, 0, "a cap was reintroduced");
            assertTrue(u[a].active, "a Mark ships inactive");
        }
    }

    /// @dev Priced XOR earned. Four Marks are free; the other six carry a price.
    /// A record that is neither, or both, is a wiring error.
    function test_everyMarkIsPricedOrEarnedAndNeverBoth() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        uint8 free;
        for (uint8 a = 1; a <= 10; a++) {
            bool priced = u[a].priceUsdc6 > 0;
            bool earned = u[a].minStreak > 0;
            assertTrue(priced != earned, "a Mark is neither priced nor earned, or both");
            if (earned) free++;
        }
        assertEq(free, 4, "there should be exactly four earned Marks");
    }

    /// @dev BREAK'S FREEDOM IS THE GUARANTEE, NOT ITS EXCLUSION. All four of these
    /// cases were REFUSALS in revision 1 of the spec, so they are the tests most
    /// likely to be written backwards from a stale reading. Revision 2 removed the
    /// cross-pair rule because a day-30 choice that destroyed a day-365 Mark made
    /// abstention the optimal play, and a tier whose optimal play is abstention is
    /// a dead tier.
    ///
    /// Both orders, because an exclusion that only fires one way round would pass a
    /// single-order test.
    function test_breakComposesWithStaticInBothOrders() public {
        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(1, 3, 0);   // Static first
        t.applyMark(1, 8, 0);   // then Break
        vm.stopPrank();
        assertEq(t.marksOf(1) & 0xFFFE, (1 << 3) | (1 << 8));

        _readyBreakAndPairTwo();   // a second token, the other way round
        vm.startPrank(WARDEN);
        t.applyMark(2, 8, 0);   // Break first
        t.applyMark(2, 3, 0);   // then Static
        vm.stopPrank();
        assertEq(t.marksOf(2) & 0xFFFE, (1 << 3) | (1 << 8));
    }

    function test_breakComposesWithBeatInBothOrders() public {
        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(1, 4, 0);   // Beat first
        t.applyMark(1, 8, 0);   // then Break
        vm.stopPrank();
        assertEq(t.marksOf(1) & 0xFFFE, (1 << 4) | (1 << 8));

        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(2, 8, 0);   // Break first
        t.applyMark(2, 4, 0);   // then Beat
        vm.stopPrank();
        assertEq(t.marksOf(2) & 0xFFFE, (1 << 4) | (1 << 8));
    }

    /// @dev The control that keeps the two tests above honest: WITHIN pair 2 the
    /// exclusion still fires. Without this, a mask accidentally set to zero would
    /// make both freedom tests pass while the ladder had no exclusions at all.
    function test_pairTwoStillExcludesItselfWhileBreakIsFree() public {
        _readyBreakAndPairTwo();
        vm.startPrank(WARDEN);
        t.applyMark(1, 3, 0);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkExcluded.selector, uint8(3)));
        t.applyMark(1, 4, 0);
        vm.stopPrank();
    }

    /// @dev A token that qualifies for Static, Beat AND Break at once, with the
    /// REAL records from Ladder.sol so these tests exercise the shipping masks
    /// rather than hand-rolled ones.
    ///
    /// `_makeWhole` checks a token in on 364 consecutive days after its mint, which
    /// leaves level 365 and streak 365 -- exactly Break's gate, and past Static's
    /// level 30 and Beat's run of 30. Called twice, it readies tokens 1 and 2, so
    /// each ordering above starts from a clean token.
    uint256 private _readied;
    function _readyBreakAndPairTwo() internal {
        _readied += 1;
        uint256 id = _readied;
        if (id > 1) {
            vm.prank(WARDEN);
            t.mint(id, ALICE, bytes32(id), _code(), _today());
        }
        _makeWhole(id);
        assertEq(t.viewOf(id).streak, 365, "Break's gate needs a 365-day run");

        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        t.setUpgrade(3, u[3]);
        t.setUpgrade(4, u[4]);
        t.setUpgrade(7, u[7]);
        t.setUpgrade(8, u[8]);
    }

    /// @dev The mirror check. The hash comes from tools/ladder-fixture.mjs,
    /// which computes it from the WARDEN's catalogue -- so this asserts two
    /// independently written ladders agree, which is the same idiom
    /// tools/token-uri-fixture.mjs uses for the two renderers.
    ///
    /// A catalogue that drifts from the chain sells an agent something the
    /// chain will refuse, AFTER it has paid. That is the failure mode
    /// gates.mjs exists to prevent.
    ///
    /// Regenerate with: node tools/ladder-fixture.mjs
    function test_theLadderMatchesTheJavascriptMirror() public pure {
        assertEq(
            keccak256(abi.encode(Ladder.all())),
            0xe48dfa7ee05a90c1ec7fc9cd15d400587161909c02f9f327ef3b106c74e15408,
            "the Warden's catalogue and the contract's ladder disagree"
        );
    }

    // -------------------------------------------------------------------
    // The ten rows, by value
    // -------------------------------------------------------------------

    /// @dev Every other structural test here asserts a RELATIONSHIP -- symmetry,
    /// pair-internality, priced-XOR-earned, no caps -- and the mirror test pins
    /// a keccak of the whole array. All of that survives a coordinated edit: move
    /// Iris from level 100 to level 10 in `Ladder.sol`, make the same edit in
    /// `warden/src/mcp/ladder.mjs`, regenerate the fixture hash, and all four
    /// suites stay green while the piece quietly sells its centrepiece at a
    /// tenth of the run it is meant to cost.
    ///
    /// This is the only test that would go red, because it is the only one that
    /// knows what the numbers ARE. The values come from
    /// `docs/specs/2026-09-02-mro-mark-ladder-design.md`, not from the code.
    /// If this fails, the question is whether the SPEC changed -- not whether
    /// to update the expectation.
    function test_theLadderMatchesTheSpecTable() public pure {
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();

        //         id  price (USDC, 6dp)  minLevel  minStreak  whole  excludes
        _row(u[1],  1,     1_000_000,           0,         0,  false,  2);   // Hush
        _row(u[2],  2,             0,           0,         7,  false,  1);   // Ache
        _row(u[3],  3,     5_000_000,          30,         0,  false,  4);   // Static
        _row(u[4],  4,             0,           0,        30,  false,  3);   // Beat
        _row(u[5],  5,    25_000_000,         100,         0,  false,  6);   // Iris, bought
        _row(u[6],  6,             0,           0,       100,  false,  5);   // Iris, earned
        _row(u[7],  7, 1_250_000_000,           0,         0,  true,   8);   // Vessel
        _row(u[8],  8,             0,           0,       365,  false,  7);   // Break
        _row(u[9],  9,   250_000_000,           0,         0,  false, 10);   // Tint
        _row(u[10], 10,   25_000_000,           0,         0,  false,  9);   // Aura

        // The dollar prices the agent-facing copy quotes, restated in the unit
        // a human reads, so a misplaced zero is visible here as well.
        assertEq(u[1].priceUsdc6 / 1e6, 1,     "Hush is $1");
        assertEq(u[3].priceUsdc6 / 1e6, 5,     "Static is $5");
        assertEq(u[5].priceUsdc6 / 1e6, 25,    "the bought Iris is $25");
        assertEq(u[7].priceUsdc6 / 1e6, 1250,  "Vessel is $1250");
        assertEq(u[9].priceUsdc6 / 1e6, 250,   "Tint is $250");
        assertEq(u[10].priceUsdc6 / 1e6, 25,   "Aura is $25");
    }

    /// @dev One row of the table above. Written as a helper so a missing field
    /// is a compile error rather than a silently unasserted value.
    function _row(
        MachineReadableOnly.Upgrade memory got,
        uint8 id,
        uint64 price,
        uint32 minLevel,
        uint32 minStreak,
        bool whole,
        uint8 excludes
    ) internal pure {
        string memory at = string.concat("Mark ", vm.toString(id), ": ");
        assertEq(got.priceUsdc6, price, string.concat(at, "price"));
        assertEq(got.minLevel, minLevel, string.concat(at, "minLevel"));
        assertEq(got.minStreak, minStreak, string.concat(at, "minStreak"));
        assertEq(got.requiresWhole, whole, string.concat(at, "requiresWhole"));
        assertEq(got.excludes, uint16(1) << excludes, string.concat(at, "excludes"));
        assertTrue(got.active, string.concat(at, "must ship active"));
        assertEq(got.maxSupply, 0, string.concat(at, "nothing is limited"));
        assertEq(got.sold, 0, string.concat(at, "ships unsold"));
    }

    // -------------------------------------------------------------------
    // The shipping masks, driven through applyMark
    // -------------------------------------------------------------------

    /// @dev THE MAXIMAL LEGAL SET, written one Mark at a time through the real
    /// `applyMark` with the real records. `GasBudget.t.sol` reaches the same
    /// five-Mark state, but it writes the mask into storage directly to price
    /// the renderer -- so nothing anywhere proved the chain would actually
    /// ACCEPT that combination. Five is the ceiling: the pairs are exclusive,
    /// so no token can ever wear six.
    function test_theMaximalLegalSetIsAcceptedOneMarkAtATime() public {
        _readyEveryPair(1);

        vm.startPrank(WARDEN);
        t.applyMark(1, 1, 0);   // Hush,   pair 1 bought
        t.applyMark(1, 4, 0);   // Beat,   pair 2 earned
        t.applyMark(1, 5, 2);   // Iris,   pair 3 bought, in leaf
        t.applyMark(1, 7, 0);   // Vessel, pair 4 bought
        t.applyMark(1, 9, 0);   // Tint,   pair 5, which needed the Iris
        vm.stopPrank();

        uint256 expected = (1 << 1) | (1 << 4) | (1 << 5) | (1 << 7) | (1 << 9);
        assertEq(t.marksOf(1) & 0xFFFE, expected, "the five Marks a token can hold at once");
        assertEq((t.marksOf(1) >> 16) & 0xFF, 2, "the Iris keeps the leaf it was bought in");

        // And the ceiling holds: every remaining id is now closed by its partner.
        uint8[5] memory closed = [uint8(2), 3, 6, 8, 10];
        for (uint256 i = 0; i < closed.length; i++) {
            vm.prank(WARDEN);
            vm.expectRevert();
            t.applyMark(1, closed[i], 0);
        }
    }

    /// @dev Pairs 1, 3 and 5 with the SHIPPING records. The exclusion tests
    /// above wire only ids 3, 4, 7 and 8, so a mask typo in any other pair --
    /// including one that left a pair with no exclusion at all -- was caught
    /// only by the structural assertions and never by the chain refusing.
    ///
    /// Both directions per pair, because an exclusion written one way round
    /// passes a single-order test.
    function test_pairsOneThreeAndFiveExcludeInBothDirections() public {
        // Pair 1: Hush (1) and Ache (2).
        _readyEveryPair(1);
        _excludesBothWays(1, 1, 2, 0, 0);

        // Pair 3: the bought Iris (5) and the earned Iris (6). The bought side
        // carries a variant, so the second half starts from a clean token.
        _excludesBothWays(3, 5, 6, 2, 0);

        // Pair 5: Tint (9) and Aura (10). Both are bought, and both wait on an
        // Iris -- so each token takes the EARNED Iris (6) first, which a whole
        // token has already run for. That prerequisite is the pair's own rule,
        // not a fixture convenience: without it the refusal below would be
        // `MarkRequires` and would prove nothing about the exclusion.
        _prerequisite = 6;
        _excludesBothWays(5, 9, 10, 0, 0);
        _prerequisite = 0;
    }

    /// @dev Take `a`, prove `b` is refused BY `a`; then on a fresh token take
    /// `b` and prove `a` is refused by `b`. `MarkExcluded` names the blocker,
    /// which is what the `ladder` tool reads back to the agent, so the argument
    /// is asserted and not just the selector.
    uint8 private _prerequisite;

    function _excludesBothWays(uint8 pair, uint8 a, uint8 b, uint8 variantA, uint8 variantB) internal {
        uint256 first = _readyEveryPair(pair * 10);
        vm.startPrank(WARDEN);
        if (_prerequisite != 0) t.applyMark(first, _prerequisite, 0);
        t.applyMark(first, a, variantA);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkExcluded.selector, a));
        t.applyMark(first, b, variantB);
        vm.stopPrank();

        uint256 second = _readyEveryPair(pair * 10 + 1);
        vm.startPrank(WARDEN);
        if (_prerequisite != 0) t.applyMark(second, _prerequisite, 0);
        t.applyMark(second, b, variantB);
        vm.expectRevert(abi.encodeWithSelector(MachineReadableOnly.MarkExcluded.selector, b));
        t.applyMark(second, a, variantA);
        vm.stopPrank();
    }

    /// @dev A token at level 365 and a 365-day run, with ALL TEN shipping
    /// records loaded -- so every gate and every mask in play is the one that
    /// deploys. Pair 5 additionally needs an Iris held, which the callers that
    /// need it take first.
    function _readyEveryPair(uint256 id) internal returns (uint256) {
        if (id != 1) {
            vm.prank(WARDEN);
            t.mint(id, ALICE, bytes32(id), _code(), _today());
        }
        _makeWhole(id);

        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 m = 1; m <= 10; m++) t.setUpgrade(m, u[m]);
        return id;
    }
}
