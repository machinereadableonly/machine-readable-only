// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";

/// @notice Mirrors tools/test/frame-geometry.test.mjs against the generated
/// Solidity, so the constant in the contract is checked by the same rules that
/// checked the generator that produced it.
contract FrameGeometryTest is Test {
    function _cell(bytes memory cells, uint256 i) internal pure returns (uint256 x, uint256 y) {
        x = uint8(cells[2 * i]);
        y = uint8(cells[2 * i + 1]);
    }

    /// @dev How far a cell sits from the nearest edge of the local grid. Below
    /// THICK means it is in one of the two frame rings; at or above, it is inside
    /// the code block, where the frame must never intrude.
    function _ring(uint256 x, uint256 y) internal pure returns (uint256 r) {
        r = x;
        if (y < r) r = y;
        if (FrameGeometry.LOCAL - 1 - x < r) r = FrameGeometry.LOCAL - 1 - x;
        if (FrameGeometry.LOCAL - 1 - y < r) r = FrameGeometry.LOCAL - 1 - y;
    }

    function test_theConstantCarriesTwoBytesForEveryCell() public pure {
        assertEq(FrameGeometry.CELL_COUNT, 376, "376 cells");
        assertEq(FrameGeometry.cells().length, FrameGeometry.CELL_COUNT * 2, "two bytes each");
        assertEq(
            FrameGeometry.CELL_COUNT,
            FrameGeometry.LOCAL * FrameGeometry.LOCAL - FrameGeometry.BLOCK * FrameGeometry.BLOCK,
            "the cells are exactly the two rings outside the block"
        );
    }

    function test_everyCellIsOnTheGridInTheTwoRingsAndAppearsOnce() public pure {
        bytes memory cells = FrameGeometry.cells();
        bool[49][49] memory seen;
        for (uint256 i; i < FrameGeometry.CELL_COUNT; ++i) {
            (uint256 x, uint256 y) = _cell(cells, i);
            assertLt(x, FrameGeometry.LOCAL, "x off grid");
            assertLt(y, FrameGeometry.LOCAL, "y off grid");
            assertLt(_ring(x, y), FrameGeometry.THICK, "cell is inside the block");
            assertFalse(seen[y][x], "duplicate cell");
            seen[y][x] = true;
        }
    }

    function test_theBlockInteriorIsNeverTouched() public pure {
        // The quiet zone around the code is part of the block. A frame cell inside
        // it would sit next to the modules and could break the scan.
        bytes memory cells = FrameGeometry.cells();
        for (uint256 i; i < FrameGeometry.CELL_COUNT; ++i) {
            (uint256 x, uint256 y) = _cell(cells, i);
            bool insideBlock = x >= FrameGeometry.THICK && x < FrameGeometry.THICK + FrameGeometry.BLOCK
                && y >= FrameGeometry.THICK && y < FrameGeometry.THICK + FrameGeometry.BLOCK;
            assertFalse(insideBlock, "frame intrudes into the block");
        }
    }

    function test_fillStartsAtTheTopCentre() public pure {
        bytes memory cells = FrameGeometry.cells();
        (uint256 x, uint256 y) = _cell(cells, 0);
        assertEq(y, 0, "the first cell is on the top row");
        uint256 mid = (FrameGeometry.LOCAL - 1) / 2;
        assertLe(x > mid ? x - mid : mid - x, 1, "the first cell is at the top centre");
    }

    function test_theTwoArmsDescendTogether() public pure {
        // The ring is meant to read as two arms closing, not as one arm crawling
        // round. If the fill order ever loses that, the picture stops telling the
        // time even though every count still adds up.
        bytes memory cells = FrameGeometry.cells();
        uint256 mid = (FrameGeometry.LOCAL - 1) / 2;
        uint256 left;
        uint256 right;
        for (uint256 i; i < FrameGeometry.DAY_CELLS; ++i) {
            (uint256 x,) = _cell(cells, i);
            if (x < mid) ++left;
            else ++right;
        }
        uint256 skew = left > right ? left - right : right - left;
        assertLt(skew, 20, "arms badly unbalanced");
    }

    function test_theSurplusThatSealsOnWholenessSitsLow() public pure {
        // 365 is odd and two concentric rings always hold an even count, so the
        // frame cannot fit the year exactly. The 11 spare cells sit at the bottom,
        // where the ring stays visibly open until the heart is whole.
        bytes memory cells = FrameGeometry.cells();
        assertEq(FrameGeometry.CELL_COUNT - FrameGeometry.DAY_CELLS, 11, "11 sealing cells");
        for (uint256 i = FrameGeometry.DAY_CELLS; i < FrameGeometry.CELL_COUNT; ++i) {
            (, uint256 y) = _cell(cells, i);
            assertGt(y * 2, FrameGeometry.LOCAL, "a sealing cell should be low on the grid");
        }
    }

    function test_theRowBitmapHoldsExactlyTheCellsTheListDoes() public pure {
        // Two representations of the same 376 cells, and the renderer trusts both:
        // the list for the fill order, the bitmap for lighting a whole frame at
        // once. If they ever disagree, a whole frame would draw different cells
        // from a nearly-whole one.
        bytes memory cells = FrameGeometry.cells();
        bytes memory rows = FrameGeometry.rows();
        assertEq(rows.length, FrameGeometry.LOCAL * 8, "eight bytes per local row");

        uint256 bits;
        for (uint256 y; y < FrameGeometry.LOCAL; ++y) {
            uint256 row = _row(rows, y);
            // forge-lint: disable-next-line(incorrect-shift)
            assertLt(row, 1 << FrameGeometry.LOCAL, "a bit is set off the grid");
            while (row != 0) {
                row &= row - 1;   // clear the lowest set bit
                ++bits;
            }
        }
        assertEq(bits, FrameGeometry.CELL_COUNT, "bitmap and list disagree on the count");

        for (uint256 i; i < FrameGeometry.CELL_COUNT; ++i) {
            (uint256 x, uint256 y) = _cell(cells, i);
            // forge-lint: disable-next-line(incorrect-shift)
            uint256 bit = 1 << (FrameGeometry.LOCAL - 1 - x);
            assertTrue(_row(rows, y) & bit != 0, "a listed cell is missing from the bitmap");
        }
    }

    function _row(bytes memory rows, uint256 y) internal pure returns (uint256 r) {
        for (uint256 b; b < 8; ++b) {
            r = (r << 8) | uint8(rows[y * 8 + b]);
        }
    }
}
