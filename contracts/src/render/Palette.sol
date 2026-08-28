// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice The colour table. One ladder of five tiers, plus the two ground tones.
/// @dev Two measured facts shape every choice here, both established 2026-08-28
/// against ZXing, the decoder a phone's scanner descends from:
///
/// 1. The noise ink is pinned at #767676. It is the LIGHTEST tone that still
///    decodes; #828282 and up fail from 500px. Nothing can be made paler to make
///    room for anything else.
/// 2. A tier separates from the noise by HUE, not by weight. The deepest red is
///    only 1.30:1 against the noise in luminance and reads instantly, while a
///    neutral grey at 1.11:1 vanished into it completely. That is why the first
///    tier carries a trace of rose instead of being a pure grey.
library Palette {
    uint256 private constant TIERS = 5;

    /// @dev Index 0 is the start of a life, index 4 a streak of 100 or more.
    function _colourAt(uint256 index) private pure returns (string memory) {
        if (index >= 4) return "#c8102e";   // red,   streak 100+
        if (index == 3) return "#bd2242";   // rose,  30-99
        if (index == 2) return "#a83a55";   // dusk,  7-29
        if (index == 1) return "#8e5566";   // tint,  3-6
        return "#70575f";                   // start, 0-2
    }

    function _tierIndex(uint32 streak) private pure returns (uint256) {
        if (streak >= 100) return 4;
        if (streak >= 30) return 3;
        if (streak >= 7) return 2;
        if (streak >= 3) return 1;
        return 0;
    }

    /// @notice The colour a live, unbroken streak earns.
    function tier(uint32 streak) internal pure returns (string memory) {
        return _colourAt(_tierIndex(streak));
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
        // A clock that runs backwards is not a lapse. Guard the subtraction
        // rather than letting it wrap into a gap of four billion days.
        uint32 gap = today > lastDay ? today - lastDay : 0;
        if (gap < 3) return tier(streak);
        if (gap >= 30) return _colourAt(0);

        uint256 index = _tierIndex(streak);
        uint256 steps = gap >= 7 ? 2 : 1;
        return _colourAt(steps >= index ? 0 : index - steps);
    }

    /// @notice Modules that did not land on the heart.
    function noise() internal pure returns (string memory) {
        return "#767676";
    }

    /// @notice Frame cells not yet earned.
    function ghost() internal pure returns (string memory) {
        return "#f4eef0";
    }
}
