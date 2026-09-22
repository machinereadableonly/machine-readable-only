// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {PathWriter} from "../src/render/PathWriter.sol";

/// @notice WHAT A BORDER OF ACTUAL 1s AND 0s COSTS, measured -- FOR A DESIGN
/// THAT WAS NOT THE ONE ADOPTED.
///
/// SUPERSEDED 2026-09-22. This file prices a 3x5 glyph on TWO edges, 32 glyphs,
/// which is what section 10j of the finisher spec described. The design the
/// operator settled in 10k is a 3x3 glyph on FOUR edges, 64 glyphs, and it
/// measures 906,968 gas / 4,800 bytes on the real worst case -- against the
/// 584,708 / 3,360 below. Neither figure carries over.
///
/// The shipped band is `contracts/src/render/DigitBand.sol` and the measurement
/// that governs is `GasBudget.t.sol:test_theFinishersBandFitsBothHardLimits`.
/// This file is kept because the harness and the note on ink density still
/// teach, and because a superseded measurement with its successor named beside
/// it is worth more than a deleted one. DO NOT QUOTE ITS NUMBERS.
///
/// @dev The operator asked for the real digits rather than a pattern of cells, and
/// the first answer was an ESTIMATE: run count times a gas-per-run figure
/// borrowed from the echo ring. That basis has since been proven about twice
/// too pessimistic against a real measurement of the QR version raise, so the
/// ~1,000,000 gas figure it produced for the digits cannot be trusted either.
///
/// NO SVG <text>. Each digit is a 3x5 cell bitmap emitted as a path, so the
/// token carries its own letterforms and does not depend on a font existing on
/// the viewer's machine in ten years.
///
/// TOP AND BOTTOM ONLY. On the rendered sheet the horizontal edges read as
/// writing and the vertical ones collided into a dotted bar -- because a digit
/// is 3 wide but 5 TALL, so the vertical step must be 6 where the horizontal
/// one is 4, and the draft used 4 everywhere. Top and bottom is also the better
/// composition: it reads as a printed plate rather than a frame.
contract DigitBand {
    uint256 constant GW = 3;      // a digit is 3 wide
    uint256 constant GH = 5;      // and 5 tall
    uint256 constant STEP = 4;    // 3 wide plus one cell of space

    /// @dev Row r of the digit d, as 3 bits, high bit leftmost.
    ///   0 -> 111 101 101 101 111      1 -> 010 110 010 010 111
    function _glyphRow(uint256 d, uint256 r) internal pure returns (uint256) {
        if (d == 0) {
            if (r == 0 || r == 4) return 7;   // 111
            return 5;                          // 101
        }
        if (r == 0) return 2;                  // 010
        if (r == 1) return 6;                  // 110
        if (r == 4) return 7;                  // 111
        return 2;                              // 010
    }

    /// @notice One band of `count` digits, as a single `<path>`.
    /// @param word the finisher's ordinal
    /// @param bits how many bits of it to write
    /// @param count how many digits fit along the edge
    /// @param canvas the canvas width in cells
    /// @param topY the band's first row
    /// @param pad where the first digit starts
    function band(
        uint256 word,
        uint256 bits,
        uint256 count,
        uint256 canvas,
        uint256 topY,
        uint256 pad
    ) internal pure returns (bytes memory) {
        PathWriter.Buffer memory buf = PathWriter.create(canvas * GH);
        for (uint256 r; r < GH; ++r) {
            uint256 rowBits;
            for (uint256 i; i < count; ++i) {
                uint256 bit = (word >> (bits - 1 - (i % bits))) & 1;
                uint256 g = _glyphRow(bit, r);
                // Place the 3 bits so that module x sits at bit (canvas-1-x),
                // the packing PathWriter.writeRow expects.
                uint256 x = pad + i * STEP;
                rowBits |= g << (canvas - x - GW);
            }
            if (rowBits != 0) PathWriter.writeRow(buf, rowBits, canvas, 0, topY + r);
        }
        return PathWriter.seal(buf);
    }

    /// @notice The finished band: the ordinal along the top and along the bottom.
    function topAndBottom(uint256 word, uint256 bits, uint256 count, uint256 canvas)
        external pure returns (string memory)
    {
        uint256 span = count * STEP;
        uint256 pad = (canvas - span) / 2;
        return string(
            abi.encodePacked(
                '<path fill="#2f2f2f" d="',
                band(word, bits, count, canvas, 0, pad),
                band(word, bits, count, canvas, canvas - GH, pad),
                '"/>'
            )
        );
    }
}

contract DigitBandCostTest is Test {
    DigitBand b;

    uint256 constant CANVAS = 65;   // 53 plus a 6-cell band top and bottom
    uint256 constant BITS = 16;
    uint256 constant COUNT = 16;    // one full word per edge

    function setUp() public { b = new DigitBand(); }

    function test_whatARowOfRealDigitsCosts() public {
        b.topAndBottom(1, BITS, COUNT, CANVAS);   // warm

        uint256 g0 = gasleft();
        string memory one = b.topAndBottom(1, BITS, COUNT, CANVAS);
        uint256 gasOne = g0 - gasleft();

        // 0xAAAA alternates, the worst case for run merging: no two adjacent
        // digits are the same, so nothing coalesces.
        g0 = gasleft();
        string memory worst = b.topAndBottom(0xAAAA, BITS, COUNT, CANVAS);
        uint256 gasWorst = g0 - gasleft();

        console.log("digits top and bottom, 16 per edge, canvas 65");
        console.log("  finisher 1   gas", gasOne);
        console.log("               bytes", bytes(one).length);
        console.log("  alternating  gas", gasWorst);
        console.log("               bytes", bytes(worst).length);
        console.log("");
        console.log("for scale, MEASURED elsewhere:");
        console.log("  the v5 code block      667,799 gas / 4,209 bytes");
        console.log("  v10 costs OVER v5      675,863 gas / 4,285 bytes");
        console.log("  worst case today     1,641,055 gas (whole child, 1 ring + echo, max marks)");

        assertGt(bytes(one).length, 0, "a band of zero bytes means nothing was drawn");
    }
}
