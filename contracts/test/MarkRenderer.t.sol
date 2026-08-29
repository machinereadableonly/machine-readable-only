// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {Palette} from "../src/render/Palette.sol";

/// @notice The seven Marks, and which surface each one claims.
/// @dev Only five of the seven change the image. Pulse is an animation_url and
/// Singularity chooses the QArt target at mint, so both are recorded in the
/// attributes and draw nothing. Every colour here must match the constant of the
/// same name in tools/render-token.mjs, which the Renderer differential test
/// then checks end to end.
contract MarkRendererTest is Test {
    uint256 constant NONE = 0;
    string constant STREAK = "#c8102e";

    function _only(uint256 bit) internal pure returns (uint256) {
        return bit;
    }

    function _all() internal pure returns (uint256) {
        return MarkRenderer.VEIN | MarkRenderer.BLUEBLOOD | MarkRenderer.VOICE | MarkRenderer.BLOOM
            | MarkRenderer.HALO | MarkRenderer.CROWN | MarkRenderer.SINGULARITY;
    }

    // ---------------------------------------------------------------------
    // The bits themselves
    // ---------------------------------------------------------------------

    function test_markIdsFollowTheLadderOrder() public pure {
        // Ids 1 to 7, so bit n is mark n and bit 0 is never used. The ladder is
        // Vein, Pulse, Voice, Bloom, Halo, Crown, Singularity.
        assertEq(MarkRenderer.VEIN, 1 << 1, "Vein is mark 1");
        assertEq(MarkRenderer.BLUEBLOOD, 1 << 2, "Blue Blood is mark 2");
        assertEq(MarkRenderer.VOICE, 1 << 3, "Voice is mark 3");
        assertEq(MarkRenderer.BLOOM, 1 << 4, "Bloom is mark 4");
        assertEq(MarkRenderer.HALO, 1 << 5, "Halo is mark 5");
        assertEq(MarkRenderer.CROWN, 1 << 6, "Crown is mark 6");
        assertEq(MarkRenderer.SINGULARITY, 1 << 7, "Singularity is mark 7");
    }

    function test_hasReadsOneBitAndIgnoresTheRest() public pure {
        assertTrue(MarkRenderer.has(_all(), MarkRenderer.VEIN), "every mark set");
        assertFalse(MarkRenderer.has(NONE, MarkRenderer.VEIN), "no mark set");
        assertTrue(MarkRenderer.has(MarkRenderer.CROWN, MarkRenderer.CROWN), "only this mark");
        assertFalse(MarkRenderer.has(MarkRenderer.CROWN, MarkRenderer.HALO), "a different mark");
    }

    // ---------------------------------------------------------------------
    // One surface each. No two Marks may write the same one.
    // ---------------------------------------------------------------------

    function test_veinDarkensTheGhostAndNothingElse() public pure {
        assertEq(MarkRenderer.ghost(NONE), Palette.ghost(), "bare token keeps the palette ghost");
        assertEq(MarkRenderer.ghost(MarkRenderer.VEIN), "#e3ccd3", "Vein darkens the ghost");
        assertEq(MarkRenderer.field(MarkRenderer.VEIN), "#ffffff", "Vein must not touch the field");
        assertEq(
            MarkRenderer.frameFill(MarkRenderer.VEIN, STREAK), STREAK, "Vein must not touch the frame"
        );
    }

    function test_haloTintsTheFieldAndNothingElse() public pure {
        assertEq(MarkRenderer.field(NONE), "#ffffff", "bare token is on white");
        assertEq(MarkRenderer.field(MarkRenderer.HALO), "#fbeff2", "Halo tints the field");
        assertEq(MarkRenderer.ghost(MarkRenderer.HALO), Palette.ghost(), "Halo must not touch the ghost");
    }

    function test_crownGildsTheFrameAndTheRings() public pure {
        assertEq(MarkRenderer.frameFill(NONE, STREAK), STREAK, "bare frame is the streak colour");
        assertEq(MarkRenderer.frameFill(MarkRenderer.CROWN, STREAK), "#b8860b", "Crown gilds the frame");
        assertEq(
            MarkRenderer.heartFill(MarkRenderer.CROWN, STREAK), STREAK, "Crown must not touch the heart"
        );
    }

    function test_voiceTintsTheQuietZoneAndNothingElse() public pure {
        assertEq(bytes(MarkRenderer.quietTint(NONE)).length, 0, "no Voice, no tint");
        assertEq(MarkRenderer.quietTint(MarkRenderer.VOICE), "#fdf3e3", "Voice tints the quiet zone");
        assertEq(MarkRenderer.field(MarkRenderer.VOICE), "#ffffff", "Voice must not touch the field");
    }

    function test_bloomReplacesTheHeartFillWithItsGradient() public pure {
        assertEq(MarkRenderer.heartFill(NONE, STREAK), STREAK, "bare heart is the streak colour");
        assertEq(MarkRenderer.heartFill(MarkRenderer.BLOOM, STREAK), "url(#b)", "Bloom points at the gradient");
        assertEq(bytes(MarkRenderer.defs(NONE, STREAK)).length, 0, "no Bloom, no defs block");
        assertEq(
            MarkRenderer.defs(MarkRenderer.BLOOM, STREAK),
            '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="#c8102e"/>'
            '<stop offset="1" stop-color="#c8102e"/></linearGradient></defs>',
            "the gradient runs from the token's own colour to the deepest red"
        );
    }

    function test_theTwoMarksThatDrawNothingDrawNothing() public pure {
        // Pulse is an animation_url; Singularity picks the QArt target at mint.
        uint256 both = MarkRenderer.BLUEBLOOD | MarkRenderer.SINGULARITY;
        assertEq(MarkRenderer.field(both), "#ffffff", "field untouched");
        assertEq(MarkRenderer.ghost(both), Palette.ghost(), "ghost untouched");
        assertEq(MarkRenderer.frameFill(both, STREAK), STREAK, "frame untouched");
        assertEq(MarkRenderer.heartFill(both, STREAK), STREAK, "heart untouched");
        assertEq(bytes(MarkRenderer.quietTint(both)).length, 0, "quiet zone untouched");
        assertEq(bytes(MarkRenderer.defs(both, STREAK)).length, 0, "no defs");
    }

    function test_everyDrawnMarkClaimsADifferentSurface() public pure {
        // The whole point of the ladder: a token wearing all five is still
        // legible because no two of them write the same thing.
        uint256 m = _all();
        assertEq(MarkRenderer.ghost(m), "#e3ccd3", "Vein still owns the ghost");
        assertEq(MarkRenderer.field(m), "#fbeff2", "Halo still owns the field");
        assertEq(MarkRenderer.frameFill(m, STREAK), "#b8860b", "Crown still owns the frame");
        assertEq(MarkRenderer.heartFill(m, STREAK), "url(#b)", "Bloom still owns the heart");
        assertEq(MarkRenderer.quietTint(m), "#fdf3e3", "Voice still owns the quiet zone");
    }

    // ---------------------------------------------------------------------
    // The attribute
    // ---------------------------------------------------------------------

    function test_namesFollowLadderOrderNotBitOrder() public pure {
        assertEq(MarkRenderer.names(NONE), "[]", "no marks is an empty array");
        assertEq(MarkRenderer.names(MarkRenderer.VEIN), '["vein"]', "one mark");
        assertEq(
            MarkRenderer.names(MarkRenderer.CROWN | MarkRenderer.VEIN),
            '["vein","crown"]',
            "ladder order, whatever order the bits were set in"
        );
        assertEq(
            MarkRenderer.names(_all()),
            '["vein","blueblood","voice","bloom","halo","crown","singularity"]',
            "all seven, in ladder order"
        );
    }

    function test_namesIgnoresBitsOutsideTheLadder() public pure {
        // Bit 0 and anything past bit 7 are not Marks. A token contract that
        // ever set one must not be able to inject text into the JSON.
        assertEq(MarkRenderer.names(1), "[]", "bit 0 is not a mark");
        assertEq(MarkRenderer.names(1 << 8), "[]", "bit 8 is not a mark");
        assertEq(MarkRenderer.names(type(uint256).max), 
            '["vein","blueblood","voice","bloom","halo","crown","singularity"]',
            "every bit set still yields exactly the seven");
    }
}
