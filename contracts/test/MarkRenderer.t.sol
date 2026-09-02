// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {Palette} from "../src/render/Palette.sol";

/// @notice The ten Marks, and which surface each one claims.
/// @dev Nine of the ten change the image. Iris Bought, Iris Earned and Tint
/// claim the eyes -- selection tested here (eyeInk, ground, irisShape, irisRun),
/// drawing tested in EyeRenderer.t.sol and end to end in Renderer.t.sol. Break
/// is the inversion, tested below (`inks`) -- it claims no surface of its own,
/// only which rung colour the heart and the noise take. Every colour here must
/// match the constant of the same name in tools/render-token.mjs, which the
/// Renderer differential test then checks end to end.
contract MarkRendererTest is Test {
    uint256 constant NONE = 0;
    string constant STREAK = "#c8102e";

    function _only(uint256 bit) internal pure returns (uint256) {
        return bit;
    }

    /// @dev The nine distinct-name Marks at once. Illegal for a real token --
    /// the contract excludes every pair partner -- but this library does not
    /// know about pairs, so it has to behave on a mask no token could ever
    /// actually hold.
    function _all() internal pure returns (uint256) {
        return MarkRenderer.HUSH | MarkRenderer.ACHE | MarkRenderer.STATIC
            | MarkRenderer.BEAT | MarkRenderer.IRIS_BOUGHT | MarkRenderer.VESSEL
            | MarkRenderer.BREAK | MarkRenderer.TINT | MarkRenderer.AURA;
    }

    // ---------------------------------------------------------------------
    // The bits themselves
    // ---------------------------------------------------------------------

    function test_markIdsFollowTheLadderOrder() public pure {
        // Ids 1 to 10, so bit n is mark n and bit 0 is never used. The ladder is
        // Hush, Ache, Static, Beat, Iris Bought, Iris Earned, Vessel, Break,
        // Tint, Aura.
        assertEq(MarkRenderer.HUSH, 1 << 1, "Hush is mark 1");
        assertEq(MarkRenderer.ACHE, 1 << 2, "Ache is mark 2");
        assertEq(MarkRenderer.STATIC, 1 << 3, "Static is mark 3");
        assertEq(MarkRenderer.BEAT, 1 << 4, "Beat is mark 4");
        assertEq(MarkRenderer.IRIS_BOUGHT, 1 << 5, "Iris Bought is mark 5");
        assertEq(MarkRenderer.IRIS_EARNED, 1 << 6, "Iris Earned is mark 6");
        assertEq(MarkRenderer.VESSEL, 1 << 7, "Vessel is mark 7");
        assertEq(MarkRenderer.BREAK, 1 << 8, "Break is mark 8");
        assertEq(MarkRenderer.TINT, 1 << 9, "Tint is mark 9");
        assertEq(MarkRenderer.AURA, 1 << 10, "Aura is mark 10");
    }

    function test_hasReadsOneBitAndIgnoresTheRest() public pure {
        assertTrue(MarkRenderer.has(_all(), MarkRenderer.HUSH), "every mark set");
        assertFalse(MarkRenderer.has(NONE, MarkRenderer.HUSH), "no mark set");
        assertTrue(MarkRenderer.has(MarkRenderer.VESSEL, MarkRenderer.VESSEL), "only this mark");
        assertFalse(MarkRenderer.has(MarkRenderer.VESSEL, MarkRenderer.AURA), "a different mark");
    }

    // ---------------------------------------------------------------------
    // One surface each. No two Marks may write the same one.
    // ---------------------------------------------------------------------

    function test_acheDarkensTheGhostAndNothingElse() public pure {
        assertEq(MarkRenderer.ghost(NONE), Palette.ghost(), "bare token keeps the palette ghost");
        assertEq(MarkRenderer.ghost(MarkRenderer.ACHE), "#e3ccd3", "Ache darkens the ghost");
        assertEq(MarkRenderer.field(MarkRenderer.ACHE), "#ffffff", "Ache must not touch the field");
        assertEq(
            MarkRenderer.frameFill(MarkRenderer.ACHE, STREAK), STREAK, "Ache must not touch the frame"
        );
    }

    function test_auraTintsTheFieldAndNothingElse() public pure {
        assertEq(MarkRenderer.field(NONE), "#ffffff", "bare token is on white");
        assertEq(MarkRenderer.field(MarkRenderer.AURA), "#fbeff2", "Aura tints the field");
        assertEq(MarkRenderer.ghost(MarkRenderer.AURA), Palette.ghost(), "Aura must not touch the ghost");
    }

    function test_vesselGildsTheFrameAndTheRings() public pure {
        assertEq(MarkRenderer.frameFill(NONE, STREAK), STREAK, "bare frame is the streak colour");
        assertEq(MarkRenderer.frameFill(MarkRenderer.VESSEL, STREAK), "#b8860b", "Vessel gilds the frame");
        assertEq(
            MarkRenderer.heartFill(MarkRenderer.VESSEL, STREAK), STREAK, "Vessel must not touch the heart"
        );
    }

    function test_hushTintsTheQuietZoneAndNothingElse() public pure {
        assertEq(bytes(MarkRenderer.quietTint(NONE)).length, 0, "no Hush, no tint");
        assertEq(MarkRenderer.quietTint(MarkRenderer.HUSH), "#fdf3e3", "Hush tints the quiet zone");
        assertEq(MarkRenderer.field(MarkRenderer.HUSH), "#ffffff", "Hush must not touch the field");
    }

    function test_beatReplacesTheHeartFillWithItsGradient() public pure {
        assertEq(MarkRenderer.heartFill(NONE, STREAK), STREAK, "bare heart is the streak colour");
        assertEq(MarkRenderer.heartFill(MarkRenderer.BEAT, STREAK), "url(#b)", "Beat points at the gradient");
        assertEq(bytes(MarkRenderer.defs(NONE, STREAK)).length, 0, "no Beat, no defs block");
        assertEq(
            MarkRenderer.defs(MarkRenderer.BEAT, STREAK),
            '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#c8102e"/>'
            '<stop offset="1" stop-color="#2000ff"/></linearGradient></defs>',
            "the gradient runs from the token's own colour to Beat's violet"
        );
    }

    function test_theMarksThatDrawNothingDrawNothing() public pure {
        // Iris Bought, Break and Tint: the eyes are drawn by EyeRenderer, not
        // here, and Break's exchange lives entirely in `inks`, so these three
        // must change nothing on the surfaces this test checks.
        uint256 all = MarkRenderer.IRIS_BOUGHT | MarkRenderer.BREAK | MarkRenderer.TINT;
        assertEq(MarkRenderer.field(all), "#ffffff", "field untouched");
        assertEq(MarkRenderer.ghost(all), Palette.ghost(), "ghost untouched");
        assertEq(MarkRenderer.frameFill(all, STREAK), STREAK, "frame untouched");
        assertEq(MarkRenderer.heartFill(all, STREAK), STREAK, "heart untouched");
        assertEq(bytes(MarkRenderer.quietTint(all)).length, 0, "quiet zone untouched");
        assertEq(bytes(MarkRenderer.defs(all, STREAK)).length, 0, "no defs");
    }

    function test_everyDrawnMarkClaimsADifferentSurface() public pure {
        // The whole point of the ladder: a token wearing every drawing Mark is
        // still legible because no two of them write the same thing. Illegal at
        // the token level (Hush/Ache and Static/Beat are pair partners) but
        // this library does not enforce pairing, so it must still behave.
        uint256 m = _all();
        assertEq(MarkRenderer.ghost(m), "#e3ccd3", "Ache still owns the ghost");
        assertEq(MarkRenderer.field(m), "#fbeff2", "Aura still owns the field");
        assertEq(MarkRenderer.frameFill(m, STREAK), "#b8860b", "Vessel still owns the frame");
        assertEq(MarkRenderer.heartFill(m, STREAK), "url(#b)", "Beat still owns the heart");
        assertEq(MarkRenderer.quietTint(m), "#fdf3e3", "Hush still owns the quiet zone");
    }

    // ---------------------------------------------------------------------
    // The attribute
    // ---------------------------------------------------------------------

    function test_namesFollowLadderOrderNotBitOrder() public pure {
        assertEq(MarkRenderer.names(NONE), "[]", "no marks is an empty array");
        assertEq(MarkRenderer.names(MarkRenderer.HUSH), '["hush"]', "one mark");
        assertEq(
            MarkRenderer.names(MarkRenderer.VESSEL | MarkRenderer.HUSH),
            '["hush","vessel"]',
            "ladder order, whatever order the bits were set in"
        );
    }

    function test_namesEmitsNineLiteralsInLadderOrder() public pure {
        uint256 all = MarkRenderer.HUSH | MarkRenderer.ACHE | MarkRenderer.STATIC
            | MarkRenderer.BEAT | MarkRenderer.IRIS_BOUGHT | MarkRenderer.VESSEL
            | MarkRenderer.BREAK | MarkRenderer.TINT | MarkRenderer.AURA;
        assertEq(
            MarkRenderer.names(all),
            '["hush","ache","static","beat","iris","vessel","break","tint","aura"]'
        );
    }

    function test_bothIrisIdsEmitTheSameName() public pure {
        assertEq(MarkRenderer.names(MarkRenderer.IRIS_BOUGHT), '["iris"]');
        assertEq(MarkRenderer.names(MarkRenderer.IRIS_EARNED), '["iris"]');
    }

    /// @dev A variant in the high bits must not reach the metadata as a phantom
    /// Mark name. The range moved from bits 1-7 to bits 1-10, so the property has
    /// to be re-asserted rather than assumed.
    function test_namesIgnoresEverythingAboveBitTen() public pure {
        uint256 withVariants = MarkRenderer.IRIS_EARNED
            | (uint256(2) << 16) | (uint256(1) << 24) | (uint256(365) << 32);
        assertEq(MarkRenderer.names(withVariants), '["iris"]');
    }

    function test_namesIgnoresBitZero() public pure {
        // Bit 0 is not a Mark. A token contract that ever set it must not be
        // able to inject text into the JSON through this field.
        assertEq(MarkRenderer.names(1), "[]", "bit 0 is not a mark");
    }

    function test_beatsFarStopIsViolet() public pure {
        assertEq(MarkRenderer.BEAT_TO, "#2000ff");
    }

    // ---------------------------------------------------------------------
    // Break, the inversion
    // ---------------------------------------------------------------------

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool ok = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) { ok = false; break; }
            }
            if (ok) return true;
        }
        return false;
    }

    function test_breakExchangesTheHeartAndNoiseInks() public pure {
        (string memory heart, string memory noise) = MarkRenderer.inks(MarkRenderer.BREAK, 4);
        assertEq(heart, Palette.noiseAt(4), "the heart should take the noise ink");
        assertEq(noise, Palette.colourAt(4), "the code should take the token's colour");
    }

    function test_breakWithStaticGivesAGreenHeartAndARedCode() public pure {
        uint256 m = MarkRenderer.BREAK | MarkRenderer.STATIC;
        (string memory heart, string memory noise) = MarkRenderer.inks(m, 4);
        assertEq(heart, Palette.staticAt(4));
        assertEq(noise, Palette.colourAt(4));
    }

    function test_withoutBreakTheInksAreUnchanged() public pure {
        (string memory heart, string memory noise) = MarkRenderer.inks(0, 4);
        assertEq(heart, Palette.colourAt(4));
        assertEq(noise, Palette.noiseAt(4));
    }

    /// @dev Under Break with Beat, the gradient's NEAR stop becomes the noise ink so
    /// the noise path stays flat and luminance-matched. Definition B.
    function test_breakWithBeatMovesTheGradientsNearStopAndNotTheGradient() public pure {
        uint256 m = MarkRenderer.BREAK | MarkRenderer.BEAT;
        (string memory heart,) = MarkRenderer.inks(m, 4);
        string memory d = MarkRenderer.defs(m, heart);
        assertTrue(_contains(d, Palette.noiseAt(4)), "near stop should be the noise ink");
        assertTrue(_contains(d, MarkRenderer.BEAT_TO), "far stop should still be violet");
    }
}
