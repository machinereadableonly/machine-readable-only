// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The colour table. One ladder of five tiers, plus the two ground tones.
/// @dev Two measured facts shape every choice here, both established 2026-08-28
/// against ZXing, the decoder a phone's scanner descends from:
///
/// 1. Nothing in the code block may be paler than about #767676: #828282 and up
///    fail from 500px. That sets the light end.
/// 2. A tier separates from the noise by HUE, not by weight. The deepest red is
///    only 1.30:1 against the noise in luminance and reads instantly, while a
///    neutral grey at 1.11:1 vanished into it completely. That is why the first
///    tier carries a trace of rose instead of being a pure grey.
///
/// A third fact, measured 2026-08-29 by the state soak, turned rule 2 from a
/// preference into a requirement, and cost the constant noise ink:
///
/// 3. The two inks may not separate by luminance AT ALL. Both have to binarize
///    as dark. Once a raster is large enough that ZXing's 8x8 blocks fall inside
///    a single module, a block has no local contrast and resolves against its
///    neighbours -- and the lighter ink goes to background. With the noise
///    pinned at #767676 (luma 118) against a heart running 74 to 104, a bare
///    token stopped decoding at 1200px and a fully marked one at 900px, while a
///    plain black-on-white control of the same code passed at every size to
///    1600. It is the GAP that does it, not darkness: luma 74 against 74 passes
///    at 1600, and luma 17 against 74 fails. So the noise is no longer one
///    colour. Each tier carries its own neutral grey, matched to it in
///    luminance, and PaletteNoise.t.sol asserts the match rather than the
///    values.
library Palette {
    /// @notice Rungs on the ladder. Public so callers can walk it.
    uint256 internal constant TIER_COUNT = 5;

    /// @notice The heart ink at a rung. Index 0 is the start of a life,
    /// index 4 a streak of 100 or more.
    function colourAt(uint256 index) internal pure returns (string memory) {
        if (index >= 4) return "#c8102e";   // red,   streak 100+
        if (index == 3) return "#bd2242";   // rose,  30-99
        if (index == 2) return "#a83a55";   // dusk,  7-29
        if (index == 1) return "#8e5566";   // tint,  3-6
        return "#70575f";                   // start, 0-2
    }

    /// @notice The noise ink at a rung: a neutral grey of the same luminance
    /// as the heart at that rung, so the two separate by hue alone.
    /// @dev Do not retune one of these without the other. The pairing is the
    /// whole point, and PaletteNoise.t.sol will fail if it is broken.
    function noiseAt(uint256 index) internal pure returns (string memory) {
        if (index >= 4) return "#4a4a4a";   // matches #c8102e, luma 74
        if (index == 3) return "#545454";   // matches #bd2242, luma 84
        if (index == 2) return "#5e5e5e";   // matches #a83a55, luma 94
        if (index == 1) return "#686868";   // matches #8e5566, luma 104
        return "#5f5f5f";                   // matches #70575f, luma 95
    }

    /// @notice The rung a live, unbroken streak sits on.
    function tierIndex(uint32 streak) internal pure returns (uint256) {
        if (streak >= 100) return 4;
        if (streak >= 30) return 3;
        if (streak >= 7) return 2;
        if (streak >= 3) return 1;
        return 0;
    }

    /// @notice The colour a live, unbroken streak earns.
    function tier(uint32 streak) internal pure returns (string memory) {
        return colourAt(tierIndex(streak));
    }

    /// @notice The colour once a lapse is taken into account.
    /// @dev The lapse walks BACK DOWN this same ladder rather than introducing
    /// paler tones, because paler tones are not available: anything lighter than
    /// the noise stops decoding. Reusing the ladder means every colour a lapse
    /// can produce is already proven scannable.
    ///
    /// Steps at 3, 7 and 30 days, so each step is one marketplace refresh rather
    /// than a continuous fade that would need refreshing daily. At 30 days the
    /// heart returns all the way to where it started, which is also what the
    /// spec's separate effective-streak rule implies.
    ///
    /// Callers freeze the image for a resting or sunset token by calling tier()
    /// with the stored streak instead of this. Keeping that decision out of here
    /// leaves the palette a pure function of colour, not of token lifecycle.
    function lapsed(uint32 streak, uint32 lastDay, uint32 today)
        internal
        pure
        returns (string memory)
    {
        return colourAt(lapsedIndex(streak, lastDay, today));
    }

    /// @notice The rung a token sits on once a lapse is taken into account.
    /// @dev Returned as an index rather than a colour so a caller gets the
    /// heart ink and the noise ink from the SAME rung. That is what makes it
    /// impossible to wire the two to different tiers.
    function lapsedIndex(uint32 streak, uint32 lastDay, uint32 today)
        internal
        pure
        returns (uint256)
    {
        // A clock that runs backwards is not a lapse. Guard the subtraction
        // rather than letting it wrap into a gap of four billion days.
        uint32 gap = today > lastDay ? today - lastDay : 0;
        if (gap < 3) return tierIndex(streak);
        if (gap >= 30) return 0;

        uint256 index = tierIndex(streak);
        uint256 steps = gap >= 7 ? 2 : 1;
        return steps >= index ? 0 : index - steps;
    }

    /// @notice Frame cells not yet earned.
    function ghost() internal pure returns (string memory) {
        return "#f4eef0";
    }
}
