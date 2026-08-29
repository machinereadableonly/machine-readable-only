// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Palette} from "./Palette.sol";

/// @notice The seven Marks, and which surface of the image each one claims.
///
/// @dev A Mark is a paid tier. The design rule that makes them composable is that
/// no two Marks write the same surface, so a token wearing every one of them is
/// still a legible, scannable image rather than a pile of overlapping effects.
///
/// Six of the seven draw. Only Singularity does not: it chooses the QArt target
/// picture at mint, so it is recorded in the attributes and changes nothing
/// about what is drawn here.
///
/// This library is almost entirely colour selection, which is why it is cheap:
/// `FrameRenderer` and `CodeRenderer` already take their fills as parameters, so
/// five of the six drawing Marks are a substituted string and nothing more.
/// Measured at the ring cap, the five that predate Blue Blood cost about 5,000
/// gas and 206 bytes between them.
///
/// Every colour here MUST match the constant of the same name in
/// `tools/render-token.mjs`. `Renderer.t.sol` diffs the two renderers byte for
/// byte, so a divergence fails the suite rather than reaching a token.
library MarkRenderer {
    /// @dev Bit n is mark n, ids 1 to 7 in ladder order. Bit 0 is never a mark.
    uint256 internal constant VEIN = 1 << 1;
    uint256 internal constant BLUEBLOOD = 1 << 2;
    uint256 internal constant VOICE = 1 << 3;
    uint256 internal constant BLOOM = 1 << 4;
    uint256 internal constant HALO = 1 << 5;
    uint256 internal constant CROWN = 1 << 6;
    uint256 internal constant SINGULARITY = 1 << 7;

    /// @dev The last stop of Bloom's gradient: the deepest tier on the ladder.
    /// Both ends of the gradient are colours the ladder already proves scannable,
    /// so no stop between them can be paler than the palest tier.
    string internal constant BLOOM_TO = "#c8102e";

    function has(uint256 marks, uint256 bit) internal pure returns (bool) {
        return marks & bit != 0;
    }

    /// @notice The page behind everything. Halo tints it.
    function field(uint256 marks) internal pure returns (string memory) {
        return has(marks, HALO) ? "#fbeff2" : "#ffffff";
    }

    /// @notice Frame cells not yet earned. Vein deepens them, so the year ahead
    /// is visible from day one rather than being almost invisible.
    function ghost(uint256 marks) internal pure returns (string memory) {
        return has(marks, VEIN) ? "#e3ccd3" : Palette.ghost();
    }

    /// @notice The earned day cells and the year rings. Crown gilds them.
    function frameFill(uint256 marks, string memory colour)
        internal
        pure
        returns (string memory)
    {
        return has(marks, CROWN) ? "#b8860b" : colour;
    }

    /// @notice The noise modules -- every lit module that is not the heart.
    /// Blue Blood tints them slate.
    ///
    /// @dev Takes the RUNG rather than a colour, because both palettes are
    /// indexed by it and the two inks of a code block must come from the same
    /// rung. Handing this a colour would let a caller pair a top-tier heart
    /// with a start-tier noise, which is exactly the wiring mistake
    /// `Palette.lapsedIndex` exists to prevent.
    function noise(uint256 marks, uint256 rung) internal pure returns (string memory) {
        return has(marks, BLUEBLOOD) ? Palette.bluebloodAt(rung) : Palette.noiseAt(rung);
    }

    /// @notice The heart modules. Bloom swaps the flat fill for a gradient
    /// reference, which is why `defs` has to be emitted alongside it.
    function heartFill(uint256 marks, string memory colour)
        internal
        pure
        returns (string memory)
    {
        return has(marks, BLOOM) ? "url(#b)" : colour;
    }

    /// @notice The quiet zone hugging the code. Voice tints it.
    /// @dev Empty when Voice is not worn, so the assembler can concatenate it
    /// unconditionally. The tint is amber rather than a deeper rose so that it
    /// stays distinguishable from Halo's field when both are worn.
    ///
    /// #fdf3e3 is decode-tested at 900, 700, 500 and 350 px. It is not near the
    /// floor by accident: #f9eaef fails at 900 and #f7e3e8 fails at three of the
    /// four sizes, so there is little room below this and none should be taken.
    function quietTint(uint256 marks) internal pure returns (string memory) {
        return has(marks, VOICE) ? "#fdf3e3" : "";
    }

    /// @notice Bloom's gradient definition, or nothing.
    /// @param colour the token's own streak colour, which the gradient runs from.
    function defs(uint256 marks, string memory colour) internal pure returns (string memory) {
        if (!has(marks, BLOOM)) return "";
        return string(
            abi.encodePacked(
                '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">',
                '<stop offset="0" stop-color="', colour, '"/>',
                '<stop offset="1" stop-color="', BLOOM_TO, '"/></linearGradient></defs>'
            )
        );
    }

    /// @notice The Marks this token wears, in ladder order, as a JSON array.
    /// @dev Ladder order, not the order the bits happened to be set in, so the
    /// attribute reads the same way the tiers are sold. Bits outside 1 to 7 are
    /// ignored: only these seven literals can ever reach the JSON, so a token
    /// contract cannot inject text into the metadata through this field.
    function names(uint256 marks) internal pure returns (string memory out) {
        string[7] memory ladder =
            ["vein", "blueblood", "voice", "bloom", "halo", "crown", "singularity"];
        bytes memory acc = "[";
        bool first = true;
        for (uint256 i; i < 7; ++i) {
            if (!has(marks, 1 << (i + 1))) continue;
            acc = abi.encodePacked(acc, first ? '"' : ',"', ladder[i], '"');
            first = false;
        }
        out = string(abi.encodePacked(acc, "]"));
    }
}
