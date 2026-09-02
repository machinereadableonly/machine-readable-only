// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {Palette} from "../src/render/Palette.sol";

/// @notice The invariant that came out of the state soak: the code's two inks
/// must not separate by LUMINANCE, only by hue.
///
/// @dev Measured 2026-08-29. The code carries a heart ink and a noise ink, and
/// both have to binarize as dark. Once a raster is large enough that ZXing's
/// 8x8 blocks fall inside a single module, a block has no local contrast and
/// resolves against its neighbours -- and the lighter of the two inks goes to
/// background. With the noise pinned at #767676 (luma 118) against a heart
/// running 74 to 104, a bare token stopped decoding at 1200px and a fully
/// marked one at 900px, while a plain black-on-white control of the same code
/// passed at every size to 1600.
///
/// The gap is what matters, not darkness: luma 74 against 74 passes at 1600,
/// and luma 17 against 74 fails. So a darker heart is not a fix -- matching is.
///
/// This is a property, not a table. If someone adds a tier or retunes a colour,
/// the test fails unless they match its grey, which is the whole point.
contract PaletteNoiseTest is Test {
    /// @dev ITU-R BT.601, the weighting ZXing's RGBLuminanceSource uses.
    /// Scaled by 1000 to stay in integers.
    function _luma(string memory hexColour) internal pure returns (uint256) {
        bytes memory b = bytes(hexColour);
        assertEq(b.length, 7, "not a #rrggbb colour");
        assertEq(b[0], "#", "not a #rrggbb colour");
        uint256 r = _byteAt(b, 1);
        uint256 g = _byteAt(b, 3);
        uint256 bl = _byteAt(b, 5);
        return (299 * r + 587 * g + 114 * bl) / 1000;
    }

    function _byteAt(bytes memory b, uint256 i) private pure returns (uint256) {
        return _nibble(b[i]) * 16 + _nibble(b[i + 1]);
    }

    function _nibble(bytes1 c) private pure returns (uint256) {
        if (c >= "0" && c <= "9") return uint8(c) - uint8(bytes1("0"));
        if (c >= "a" && c <= "f") return 10 + uint8(c) - uint8(bytes1("a"));
        revert("hex colours must be lower case");
    }

    function test_everyNoiseInkMatchesItsTierInLuminance() public pure {
        for (uint256 i; i < Palette.TIER_COUNT; ++i) {
            uint256 heart = _luma(Palette.colourAt(i));
            uint256 noise = _luma(Palette.noiseAt(i));
            console.log("tier", i);
            console.log("  heart luma", heart);
            console.log("  noise luma", noise);
            uint256 gap = heart > noise ? heart - noise : noise - heart;
            assertLe(
                gap, 1,
                "the noise ink must match its tier in luminance -- see the header"
            );
        }
    }

    /// @dev The UNMARKED noise is a neutral grey by construction: it carries no
    /// hue of its own, so the heart is the only chromatic thing in the code
    /// block. Blue Blood is the one Mark that changes this, and it gets its own
    /// pair of assertions below rather than a relaxation of this one.
    function test_everyNoiseInkIsANeutralGrey() public pure {
        for (uint256 i; i < Palette.TIER_COUNT; ++i) {
            bytes memory n = bytes(Palette.noiseAt(i));
            assertEq(n.length, 7);
            assertEq(n[1], n[3], "noise red and green channels differ");
            assertEq(n[2], n[4], "noise red and green channels differ");
            assertEq(n[3], n[5], "noise green and blue channels differ");
            assertEq(n[4], n[6], "noise green and blue channels differ");
        }
    }

    /// @dev The index a caller derives for the heart is the index it must use
    /// for the noise. Asserted so the two cannot be wired to different tiers.
    function test_theLapsedIndexDrivesBothInks() public pure {
        // Forty days lapsed from the top tier lands at the bottom of the ladder.
        uint256 idx = Palette.lapsedIndex(400, 1000, 1040);
        assertEq(idx, 0, "a 30-day lapse returns to the start tier");
        assertEq(Palette.colourAt(idx), Palette.tier(0));
        assertEq(_luma(Palette.noiseAt(idx)), _luma(Palette.colourAt(idx)));
    }

    /// @dev The pairing rule does not bend for a Mark: the binarizer does not care
    /// WHY an ink is lighter. Only the hue moves. Asserted rather than eyeballed,
    /// because five values picked by eye would be five chances to break the match.
    function test_staticMatchesTheHeartsLuminanceAtEveryRung() public pure {
        for (uint256 rung = 0; rung < Palette.TIER_COUNT; rung++) {
            uint256 heart = _luma(Palette.colourAt(rung));
            uint256 green = _luma(Palette.staticAt(rung));
            assertApproxEqAbs(green, heart, 1, "Static's green is off its rung's luma");
        }
    }

    /// @dev The rule that is NOT about decoding: the noise must stay less saturated
    /// than the heart it surrounds, or the noise becomes the subject of the picture.
    /// The start rung binds it hardest, 16 against 25.
    function test_staticStaysLessSaturatedThanTheHeart() public pure {
        for (uint256 rung = 0; rung < Palette.TIER_COUNT; rung++) {
            assertLt(
                _chroma(Palette.staticAt(rung)),
                _chroma(Palette.colourAt(rung)),
                "the noise is more saturated than the heart"
            );
        }
    }

    /// @dev Max channel minus min channel -- the same cheap measure the JS
    /// suite uses, so the two languages agree on what "more saturated" means.
    function _chroma(string memory hexColour) internal pure returns (uint256) {
        bytes memory b = bytes(hexColour);
        uint256 r = _byteAt(b, 1);
        uint256 g = _byteAt(b, 3);
        uint256 bl = _byteAt(b, 5);
        uint256 hi = r > g ? r : g;
        if (bl > hi) hi = bl;
        uint256 lo = r < g ? r : g;
        if (bl < lo) lo = bl;
        return hi - lo;
    }
}
