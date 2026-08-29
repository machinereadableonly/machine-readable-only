// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {RendererPulse} from "../src/render/RendererPulse.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";

/// @notice What the Pulse Mark actually costs, measured rather than estimated.
///
/// @dev Three tasks running have recorded the same placeholder sentence --
/// "`animation_url` is unbudgeted and unbuilt, it roughly doubles tokenURI
/// bytes". This file replaces it. Two renderers are driven over IDENTICAL token
/// state, differing only in whether they emit `animation_url`, so the delta is
/// Pulse and nothing else.
///
/// The comparison is run at the worst case the spike already found -- level
/// 364, the day BEFORE the heart seals, with every Mark set. Pulse is a paid
/// top-tier Mark, so a token carrying it is a token carrying the others too;
/// measuring it on a bare day-one token would understate what anybody pays.
contract PulseCostTest is Test {
    MROSpikeToken plain;
    MROSpikeToken pulsing;
    Renderer r;
    RendererPulse rp;

    uint256 constant GAS_LIMIT = 2_000_000;
    uint256 constant BYTE_LIMIT = 20_000;

    uint256 constant ALL_MARKS = MarkRenderer.VEIN | MarkRenderer.PULSE | MarkRenderer.VOICE
        | MarkRenderer.BLOOM | MarkRenderer.HALO | MarkRenderer.CROWN | MarkRenderer.SINGULARITY;

    /// @dev Every Mark EXCEPT Pulse, so the no-Pulse path can be checked for
    /// byte-identity against the shipped renderer on a fully marked token.
    uint256 constant NO_PULSE = ALL_MARKS ^ MarkRenderer.PULSE;

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
        rp = new RendererPulse();
        plain = new MROSpikeToken(address(r));
        pulsing = new MROSpikeToken(address(rp));
        vm.warp(86400 * 1000 + 1);   // today() == 1000, matching the fixtures
    }

    function _place(MROSpikeToken t, uint256 id, uint32 level, uint256 marks) internal {
        t.mint(id, address(0xA11CE), bytes32(uint256(0xa9e)), _code());
        t.setState(id, MROSpikeToken.Token({
            level: level, streak: 100, lastDay: 1000, mintDay: 900,
            generation: 0, seedsGiven: 0, resting: false, reserved: 0
        }));
        if (marks != 0) t.setMarks(id, marks);
    }

    /// @dev Cold storage, like GasBudget: a warmed slot is not a number anybody
    /// pays. Each measurement gets its own id so none warms another's.
    function _measure(MROSpikeToken t, string memory label, uint256 id)
        internal
        view
        returns (uint256 gasUsed, uint256 len)
    {
        uint256 before = gasleft();
        string memory uri = t.tokenURI(id);
        gasUsed = before - gasleft();
        len = bytes(uri).length;
        console.log(label);
        console.log("  gas  ", gasUsed);
        console.log("  bytes", len);
    }

    /// The headline: Pulse against no Pulse, same state, same worst case.
    function test_whatPulseCosts() public {
        _place(plain,   1, 364, ALL_MARKS);
        _place(pulsing, 1, 364, ALL_MARKS);

        (uint256 gasOff, uint256 lenOff) = _measure(plain,   "worst case, shipped renderer", 1);
        (uint256 gasOn,  uint256 lenOn)  = _measure(pulsing, "worst case, Pulse variant",    1);

        console.log("delta gas  ", gasOn - gasOff);
        console.log("delta bytes", lenOn - lenOff);
        // Signed, deliberately. An unsigned subtraction here underflowed and
        // reported a headroom of 10^77 the first time this ran, which is how a
        // budget bust can hide behind a passing-looking number.
        console.logInt(int256(GAS_LIMIT) - int256(gasOn));
        console.logInt(int256(BYTE_LIMIT) - int256(lenOn));

        // Recorded, not asserted as a target: this is the number the decision
        // is made on, and pinning it would only make the test brittle.
        assertGt(lenOn, lenOff, "Pulse must actually add animation_url");
    }

    /// @dev Pulse is rung 2 of the seven-Mark ladder, so the cheapest token that
    /// can carry it carries Vein too and nothing above. Measuring only the
    /// all-Marks token would overstate what a Pulse holder typically pays;
    /// measuring only this one would understate the ceiling. Both are reported.
    uint256 constant PULSE_ONLY = MarkRenderer.VEIN | MarkRenderer.PULSE;

    /// WHERE PULSE STANDS AGAINST THE HARD LIMIT, across the life stages that
    /// move the number. This is the table the decision is made from.
    ///
    /// Recorded, not asserted. Pulse is not adopted, so a ceiling assertion here
    /// would fail the suite over a variant nobody ships. The shipped renderer's
    /// ceiling stays asserted in GasBudget.t.sol, which is where it belongs.
    function test_pulseAgainstTheHardLimit() public {
        uint32[4] memory levels = [uint32(1), 200, 364, 365];

        for (uint256 i; i < levels.length; ++i) {
            _place(pulsing, 10 + i, levels[i], PULSE_ONLY);
            (uint256 g, uint256 b) = _measure(pulsing, "  Pulse+Vein at level:", 10 + i);
            console.log("    level", levels[i], g > GAS_LIMIT ? "OVER" : "under", b);

            _place(pulsing, 20 + i, levels[i], ALL_MARKS);
            (uint256 g2, uint256 b2) = _measure(pulsing, "  Pulse, all Marks at level:", 20 + i);
            console.log("    level", levels[i], g2 > GAS_LIMIT ? "OVER" : "under", b2);
        }
    }

    /// The variant must differ in ONE thing. Without Pulse set, its output has
    /// to be byte-identical to the shipped renderer, or the delta above is
    /// measuring two changes at once.
    function test_withoutPulseTheVariantIsByteIdentical() public {
        _place(plain,   2, 364, NO_PULSE);
        _place(pulsing, 2, 364, NO_PULSE);

        assertEq(
            keccak256(bytes(plain.tokenURI(2))),
            keccak256(bytes(pulsing.tokenURI(2))),
            "the variant changed something other than animation_url"
        );
    }

    /// The animation must be present and be an HTML data URI -- the only shape
    /// OpenSea's media documentation claims to render for this field.
    function test_theAnimationIsAnHtmlDataUri() public {
        _place(pulsing, 3, 364, ALL_MARKS);
        string memory uri = pulsing.tokenURI(3);
        assertTrue(
            vm.contains(uri, '"animation_url":"data:text/html;base64,'),
            "animation_url is missing or not an HTML data URI"
        );
    }
}
