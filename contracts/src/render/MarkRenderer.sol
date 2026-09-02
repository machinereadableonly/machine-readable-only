// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Palette} from "./Palette.sol";

/// @notice The ten Marks, and which surface of the image each one claims.
///
/// @dev A Mark is a paid tier, bought or earned in one of five exclusive pairs.
/// `Ladder.sol` and `MachineReadableOnly.applyMark` enforce that exclusion, not
/// this library -- a mask handed in here could in principle hold both sides of
/// a pair, and this library still has to behave, which it does because no two
/// Marks in different pairs ever write the same surface.
///
/// Six of the ten draw at this point. Hush, Ache, Static, Beat, Vessel and Aura
/// each claim one surface below. Iris Bought, Iris Earned, Tint and Break draw
/// nothing yet -- the eyes and the inversion land in later tasks -- so their
/// constants exist for `names()` and for the bit layout, and nothing in this
/// file branches on them.
///
/// This library is almost entirely colour selection, which is why it is cheap:
/// `FrameRenderer` and `CodeRenderer` already take their fills as parameters, so
/// each drawing Mark is a substituted string and nothing more.
///
/// Every colour here MUST match the constant of the same name in
/// `tools/render-token.mjs`. `Renderer.t.sol` diffs the two renderers byte for
/// byte, so a divergence fails the suite rather than reaching a token.
library MarkRenderer {
    /// @dev Bit n is mark n, ids 1 to 10 in ladder order. Bit 0 is never a mark.
    /// FIVE PAIRS: in each, one side is bought and one earned, and they exclude
    /// each other on chain. The renderer does not enforce that -- the contract
    /// does -- so this library never has to consider two partners at once.
    uint256 internal constant HUSH = 1 << 1;
    uint256 internal constant ACHE = 1 << 2;
    uint256 internal constant STATIC = 1 << 3;
    uint256 internal constant BEAT = 1 << 4;
    uint256 internal constant IRIS_BOUGHT = 1 << 5;
    uint256 internal constant IRIS_EARNED = 1 << 6;
    uint256 internal constant VESSEL = 1 << 7;
    uint256 internal constant BREAK = 1 << 8;
    uint256 internal constant TINT = 1 << 9;
    uint256 internal constant AURA = 1 << 10;

    /// @dev Either route to the eyes. Tint requires one of these, and the eye
    /// drawing is the same code for both.
    uint256 internal constant ANY_IRIS = IRIS_BOUGHT | IRIS_EARNED;

    /// @dev The last stop of Beat's gradient. VIOLET, chosen by the operator 2026-08-31
    /// from a rendered sheet: it makes the heart bi-chromatic and reads as
    /// spectrum rather than blood. Same string length as the red it replaced, so
    /// zero bytes and zero gas.
    string internal constant BEAT_TO = "#2000ff";

    string internal constant ACHE_GHOST = "#e3ccd3";
    string internal constant VESSEL_GOLD = "#b8860b";
    string internal constant HUSH_QUIET = "#fdf3e3";

    function has(uint256 marks, uint256 bit) internal pure returns (bool) {
        return marks & bit != 0;
    }

    /// @notice The page behind everything. Aura tints it.
    function field(uint256 marks) internal pure returns (string memory) {
        return has(marks, AURA) ? "#fbeff2" : "#ffffff";
    }

    /// @notice Frame cells not yet earned. Ache deepens them, so the year ahead
    /// is visible from day one rather than being almost invisible.
    function ghost(uint256 marks) internal pure returns (string memory) {
        return has(marks, ACHE) ? ACHE_GHOST : Palette.ghost();
    }

    /// @notice The earned day cells and the year rings. Vessel gilds them.
    function frameFill(uint256 marks, string memory colour)
        internal
        pure
        returns (string memory)
    {
        return has(marks, VESSEL) ? VESSEL_GOLD : colour;
    }

    /// @notice The noise modules -- every lit module that is not the heart.
    /// Static tints them slate.
    ///
    /// @dev Takes the RUNG rather than a colour, because both palettes are
    /// indexed by it and the two inks of a code block must come from the same
    /// rung. Handing this a colour would let a caller pair a top-tier heart
    /// with a start-tier noise, which is exactly the wiring mistake
    /// `Palette.lapsedIndex` exists to prevent.
    function noise(uint256 marks, uint256 rung) internal pure returns (string memory) {
        return has(marks, STATIC) ? Palette.bluebloodAt(rung) : Palette.noiseAt(rung);
    }

    /// @notice The heart modules. Beat swaps the flat fill for a gradient
    /// reference, which is why `defs` has to be emitted alongside it.
    function heartFill(uint256 marks, string memory colour)
        internal
        pure
        returns (string memory)
    {
        return has(marks, BEAT) ? "url(#b)" : colour;
    }

    /// @notice The quiet zone hugging the code. Hush tints it.
    /// @dev Empty when Hush is not worn, so the assembler can concatenate it
    /// unconditionally. The tint is amber rather than a deeper rose so that it
    /// stays distinguishable from Aura's field when both are worn.
    ///
    /// #fdf3e3 is decode-tested at 900, 700, 500 and 350 px. It is not near the
    /// floor by accident: #f9eaef fails at 900 and #f7e3e8 fails at three of the
    /// four sizes, so there is little room below this and none should be taken.
    function quietTint(uint256 marks) internal pure returns (string memory) {
        return has(marks, HUSH) ? HUSH_QUIET : "";
    }

    /// @notice Beat's gradient definition, or nothing.
    /// @param colour the token's own streak colour, which the gradient runs from.
    function defs(uint256 marks, string memory colour) internal pure returns (string memory) {
        if (!has(marks, BEAT)) return "";
        return string(
            abi.encodePacked(
                '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">',
                '<stop offset="0" stop-color="', colour, '"/>',
                '<stop offset="1" stop-color="', BEAT_TO, '"/></linearGradient></defs>'
            )
        );
    }

    /// @notice The Marks this token wears, in ladder order, as a JSON array.
    /// @dev Ladder order, not the order the bits happened to be set in. Bits
    /// outside 1 to 10 are ignored: `_marks` packs the Iris shape at bit 16, the
    /// Tint ink at bit 24 and the earned run at bit 32, and none of that may
    /// reach the metadata as a phantom Mark name. Only these ten literals can
    /// ever reach the JSON, so no token state can inject text through this field.
    ///
    /// Both Iris ids emit "iris": they claim the same surface by two routes, and
    /// the route is visible in the image rather than in the JSON.
    function names(uint256 marks) internal pure returns (string memory out) {
        string[10] memory ladder = [
            "hush", "ache", "static", "beat", "iris",
            "iris", "vessel", "break", "tint", "aura"
        ];
        bytes memory acc = "[";
        bool first = true;
        for (uint256 i; i < 10; ++i) {
            if (!has(marks, 1 << (i + 1))) continue;
            acc = abi.encodePacked(acc, first ? '"' : ',"', ladder[i], '"');
            first = false;
        }
        out = string(abi.encodePacked(acc, "]"));
    }
}
