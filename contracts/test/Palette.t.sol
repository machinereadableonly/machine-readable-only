// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Palette} from "../src/render/Palette.sol";

contract PaletteTest is Test {
    // The five tiers, darkest-red first. Every one of these is proven to decode
    // in the tools layer against a real strict decoder, at 900 down to 250 px.
    string constant RED   = "#c8102e";   // streak 100+
    string constant ROSE  = "#bd2242";   // 30-99
    string constant DUSK  = "#a83a55";   // 7-29
    string constant TINT  = "#8e5566";   // 3-6
    string constant START = "#70575f";   // 0-2

    function _eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    function assertColour(string memory got, string memory want, string memory what) internal pure {
        assertTrue(_eq(got, want), what);
    }

    function test_tierBoundaries() public pure {
        assertColour(Palette.tier(0), START, "streak 0");
        assertColour(Palette.tier(2), START, "streak 2");
        assertColour(Palette.tier(3), TINT, "streak 3");
        assertColour(Palette.tier(6), TINT, "streak 6");
        assertColour(Palette.tier(7), DUSK, "streak 7");
        assertColour(Palette.tier(29), DUSK, "streak 29");
        assertColour(Palette.tier(30), ROSE, "streak 30");
        assertColour(Palette.tier(99), ROSE, "streak 99");
        assertColour(Palette.tier(100), RED, "streak 100");
        assertColour(Palette.tier(type(uint32).max), RED, "streak max");
    }

    function test_theStartTierIsNotNeutral() public pure {
        // A neutral first tier is unreadable: it used to be #6f6f6f against a
        // #767676 noise, 1.11:1 apart and the same hue, so a new token showed no
        // heart at all. Every tier separates from the noise by hue, not weight --
        // and since 2026-08-29 by hue ALONE, the two being matched in luminance
        // on purpose. See Palette's header and PaletteNoise.t.sol.
        assertColour(Palette.tier(0), START, "start tier must carry a trace of rose");
        assertTrue(
            !_eq(Palette.colourAt(0), Palette.noiseAt(0)),
            "the start tier and its noise are the same ink -- no heart would show"
        );
    }

    /// @dev Every rung must have a distinct pair. Matching them in luminance is
    /// deliberate; making them the same colour would erase the heart.
    function test_noTierIsTheSameInkAsItsNoise() public pure {
        for (uint256 i; i < Palette.TIER_COUNT; ++i) {
            assertTrue(
                !_eq(Palette.colourAt(i), Palette.noiseAt(i)),
                "a tier and its noise are the same ink"
            );
        }
    }

    function test_groundTones() public pure {
        // The noise is no longer one colour; it is one per rung, matched in
        // luminance to its tier. PaletteNoise.t.sol asserts the match itself,
        // as a property. These are the values that match today.
        assertColour(Palette.noiseAt(0), "#5f5f5f", "noise at the start tier");
        assertColour(Palette.noiseAt(4), "#4a4a4a", "noise at the top tier");
        assertColour(Palette.ghost(), "#f4eef0", "ghost");
    }

    // A lapse walks BACK DOWN the same ladder rather than inventing pale tones.
    // Lighter tones are not available: measured, #767676 is the lightest ink that
    // still decodes, so any genuinely paler heart would stop scanning.
    function test_lapseIsInertUntilThreeDays() public pure {
        assertColour(Palette.lapsed(100, 1000, 1000), RED, "same day");
        assertColour(Palette.lapsed(100, 1000, 1001), RED, "one day");
        assertColour(Palette.lapsed(100, 1000, 1002), RED, "two days");
    }

    function test_lapseStepsAtThreeSevenAndThirty() public pure {
        assertColour(Palette.lapsed(100, 1000, 1003), ROSE, "3 days lapsed, one step");
        assertColour(Palette.lapsed(100, 1000, 1006), ROSE, "6 days lapsed");
        assertColour(Palette.lapsed(100, 1000, 1007), DUSK, "7 days lapsed, two steps");
        assertColour(Palette.lapsed(100, 1000, 1029), DUSK, "29 days lapsed");
        assertColour(Palette.lapsed(100, 1000, 1030), START, "30 days lapsed, back to the start");
        assertColour(Palette.lapsed(100, 1000, 9999), START, "long dead");
    }

    function test_lapseCannotFallBelowTheStartTier() public pure {
        assertColour(Palette.lapsed(0, 1000, 1003), START, "already at the start");
        assertColour(Palette.lapsed(3, 1000, 1007), START, "two steps from tier 1");
        assertColour(Palette.lapsed(7, 1000, 1030), START, "long lapse from a low streak");
    }

    function test_lapseNeverReturnsAColourOutsideTheLadder() public pure {
        // The whole reason the lapse reuses the ladder: every colour it can
        // produce is already proven scannable. A new tone would need re-proving.
        uint32[6] memory gaps = [uint32(0), 2, 3, 7, 30, 500];
        uint32[5] memory streaks = [uint32(0), 3, 7, 30, 100];
        for (uint256 s = 0; s < streaks.length; s++) {
            for (uint256 g = 0; g < gaps.length; g++) {
                string memory c = Palette.lapsed(streaks[s], 1000, 1000 + gaps[g]);
                assertTrue(
                    _eq(c, RED) || _eq(c, ROSE) || _eq(c, DUSK) || _eq(c, TINT) || _eq(c, START),
                    "lapse produced a colour outside the ladder"
                );
            }
        }
    }

    function test_aClockThatRunsBackwardsDoesNotUnderflow() public pure {
        // today < lastDay should not revert or wrap into a huge gap.
        assertColour(Palette.lapsed(100, 1000, 999), RED, "today before lastDay");
        assertColour(Palette.lapsed(100, 1000, 0), RED, "today zero");
    }
}
