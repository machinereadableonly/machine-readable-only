// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The colour table. One ladder of five tiers, plus the two ground tones.
/// @dev Two decode rules constrain every value here:
///
/// 1. Nothing in the code block may be paler than about #767676, or the code
///    stops decoding. That sets the light end.
/// 2. The heart ink and the noise ink must not separate by LUMINANCE at all.
///    Once a raster is large enough that a decoder's local-contrast blocks fall
///    inside one module, the lighter of the two inks resolves as background. So
///    the noise is not one colour: each rung carries its own neutral grey,
///    matched to that rung's heart ink in luminance, and the two inks separate
///    by hue alone. PaletteNoise.t.sol asserts the match, not the values.
library Palette {
    /// @notice Rungs on the ladder, so a caller can walk it.
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
    /// @dev Never retune one of these without its heart ink. PaletteNoise.t.sol
    /// fails if the luminance pairing is broken.
    function noiseAt(uint256 index) internal pure returns (string memory) {
        if (index >= 4) return "#4a4a4a";   // matches #c8102e, luma 74
        if (index == 3) return "#545454";   // matches #bd2242, luma 84
        if (index == 2) return "#5e5e5e";   // matches #a83a55, luma 94
        if (index == 1) return "#686868";   // matches #8e5566, luma 104
        return "#5f5f5f";                   // matches #70575f, luma 95
    }

    /// @notice The noise ink at a rung when the token wears Static.
    /// @dev Green, because it is the only hue that can hold high chroma at the
    /// dark luma a deep streak forces, so the Mark strengthens as the run
    /// deepens rather than dulling.
    ///
    /// Derived, not chosen: a green direction [0, 124, 8] pulled toward its own
    /// grey until its chroma is 60% of that rung's heart, then scaled onto that
    /// rung's exact BT.601 luma -- the SAME luma as `noiseAt`, since rule 2
    /// above applies to this ink too. PaletteNoise.t.sol asserts both rules
    /// rather than these values.
    function staticAt(uint256 index) internal pure returns (string memory) {
        if (index >= 4) return "#08770f";   // matches #c8102e, luma 74
        if (index == 3) return "#1d7a23";   // matches #bd2242, luma 84
        if (index == 2) return "#37793b";   // matches #a83a55, luma 94
        if (index == 1) return "#537655";   // matches #8e5566, luma 104
        return "#556557";                   // matches #70575f, luma 95
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
    /// @dev A lapse walks BACK DOWN this same ladder rather than introducing
    /// paler tones: anything lighter than the noise stops decoding, so reusing
    /// the ladder keeps every colour a lapse can produce proven scannable.
    /// It steps at 3, 7 and 30 days, and at 30 the heart is back where it
    /// started.
    ///
    /// A resting, sunset or finished token is frozen by the CALLER, which passes
    /// the day its picture stopped as `today`. That keeps the palette a pure
    /// function of colour, not of token lifecycle.
    function lapsed(uint32 streak, uint32 lastDay, uint32 today)
        internal
        pure
        returns (string memory)
    {
        return colourAt(lapsedIndex(streak, lastDay, today));
    }

    /// @notice The rung a token sits on once a lapse is taken into account.
    /// @dev An index rather than a colour, so a caller takes the heart ink and
    /// the noise ink from the SAME rung.
    function lapsedIndex(uint32 streak, uint32 lastDay, uint32 today)
        internal
        pure
        returns (uint256)
    {
        // A clock that runs backwards is not a lapse: guard the subtraction
        // rather than letting it wrap.
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
