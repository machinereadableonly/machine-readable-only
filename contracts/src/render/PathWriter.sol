// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {LibBit} from "solady/src/utils/LibBit.sol";

/// @notice Turns rows of filled cells into SVG path data, merging horizontal runs.
///
/// @dev Shared by every renderer so the two of them cannot drift apart in syntax
/// or in rounding. `CodeRenderer` and `FrameRenderer` draw completely different
/// things, but both draw them as filled unit cells on the same grid, and a run of
/// adjacent cells is written the same way in both.
///
/// Run merging is the mechanism that makes the image affordable at all: measured
/// on the code block, one `<rect>` per cell came to 70,298 bytes and merged runs
/// inside one path came to 4,986.
///
/// The gas shape of this library was measured rather than assumed, and two of its
/// choices come straight out of that (see docs/phase0-results.md):
///
/// - **Runs are found by jumping, not by scanning.** Testing all 37 bits of every
///   row cost 954,000 gas on the code block alone. Jumping from run to run with
///   `LibBit.fls` visits each run once instead.
/// - **Nothing is allocated per run.** A run is composed in a register and written
///   with one `mstore` into a buffer reserved up front.
library PathWriter {
    /// @dev The longest a single run can be: "M<x> <y>h<w>v1h-<w>z" with three
    /// digits in every position is 18 bytes, rounded up for headroom.
    uint256 internal constant MAX_RUN_BYTES = 20;

    /// @dev Each run is written as a full 32-byte word, so the last one reaches
    /// past its own end. Every buffer carries a spare word for it.
    uint256 private constant SLACK = 32;

    /// @dev A run is composed in one word, so its text must fit in 32 bytes.
    /// Holding every coordinate below 1000 is what guarantees that. The canvas is
    /// 51 cells at year zero and grows by two a year, so nothing can reach it.
    uint256 private constant MAX_COORD = 1000;

    /// @notice A path under construction: the bytes, and how many are written.
    /// @dev The length in `data` stays at full capacity while writing and is cut
    /// down to `len` by `seal`, so nothing downstream sees the unused tail.
    struct Buffer {
        bytes data;
        uint256 len;
    }

    /// @notice A buffer with room for `maxRuns` runs.
    /// @dev Callers must bound `maxRuns` by what their geometry can actually
    /// produce, not by what it typically does. A row of alternating cells is a
    /// separate run for every other cell, which is the worst case and the one the
    /// buffer has to survive: sizing to a measured figure instead would let such a
    /// pattern write past the end into whatever memory follows.
    function create(uint256 maxRuns) internal pure returns (Buffer memory buf) {
        buf.data = new bytes(maxRuns * MAX_RUN_BYTES + SLACK);
    }

    /// @notice Appends one row of cells as merged horizontal runs.
    /// @param row   bit `width - 1 - x` set means the cell at `x` is filled
    /// @param width how many cells the row spans
    /// @param x0    canvas x of the row's first cell
    /// @param y     canvas y of the row
    /// @dev Runs never cross rows: each call draws one row and nothing else, so
    /// two cells at opposite edges of the picture can never merge.
    function writeRow(Buffer memory buf, uint256 row, uint256 width, uint256 x0, uint256 y)
        internal
        pure
    {
        if (row == 0) return;
        require(y < MAX_COORD && x0 + width < MAX_COORD, "PathWriter: coordinate too large");

        bytes memory data = buf.data;
        uint256 ptr;
        /// @solidity memory-safe-assembly
        assembly {
            ptr := add(data, 0x20)
        }
        uint256 limit = data.length - SLACK;
        uint256 len = buf.len;

        while (row != 0) {
            uint256 high = LibBit.fls(row);              // leftmost cell still to draw
            // The run ends at the first gap below `high`. Inverting the row turns
            // that gap into the highest set bit of what remains below it.
            // forge-lint: disable-next-line(incorrect-shift)
            uint256 hole = ~row & ((1 << high) - 1);
            uint256 low = hole == 0 ? 0 : LibBit.fls(hole) + 1;
            // Cheap next to what this function costs, and it turns any future
            // miscalculation of `maxRuns` into a revert rather than a silent write
            // into whatever memory follows the buffer.
            require(len + MAX_RUN_BYTES <= limit, "PathWriter: path overflow");
            len = _writeRun(ptr, len, x0 + width - 1 - high, y, high - low + 1);
            // forge-lint: disable-next-line(incorrect-shift)
            row &= (1 << low) - 1;                       // drop the run just drawn
        }
        buf.len = len;
    }

    /// @notice Cuts the buffer down to what was written and returns it.
    function seal(Buffer memory buf) internal pure returns (bytes memory data) {
        data = buf.data;
        uint256 len = buf.len;
        /// @solidity memory-safe-assembly
        assembly {
            mstore(data, len)
        }
    }

    /// @dev Composes "M<x> <y>h<w>v1h-<w>z" in a register and writes it with one
    /// `mstore`, returning the new length. Writing 32 bytes for a run of 12 is
    /// deliberate: the surplus is overwritten by the next run, and the buffer
    /// carries a spare word for the last one.
    function _writeRun(uint256 ptr, uint256 len, uint256 x, uint256 y, uint256 w)
        private
        pure
        returns (uint256)
    {
        uint256 acc = 0x4D;                            // "M"
        uint256 n = 1;
        (acc, n) = _digits(acc, n, x);
        acc = acc << 8 | 0x20;                         // " "
        (acc, n) = _digits(acc, n + 1, y);
        acc = acc << 8 | 0x68;                         // "h"
        (acc, n) = _digits(acc, n + 1, w);
        acc = acc << 32 | 0x7631682D;                  // "v1h-"
        (acc, n) = _digits(acc, n + 4, w);
        acc = acc << 8 | 0x7A;                         // "z"
        unchecked {
            ++n;
        }
        /// @solidity memory-safe-assembly
        assembly {
            mstore(add(ptr, len), shl(shl(3, sub(32, n)), acc))
        }
        return len + n;
    }

    /// @dev Appends the decimal digits of `v` (below 1000) to the accumulator.
    function _digits(uint256 acc, uint256 n, uint256 v) private pure returns (uint256, uint256) {
        if (v >= 100) {
            (acc, n) = (acc << 8 | (0x30 + v / 100), n + 1);
        }
        if (v >= 10) {
            (acc, n) = (acc << 8 | (0x30 + (v / 10) % 10), n + 1);
        }
        return (acc << 8 | (0x30 + v % 10), n + 1);
    }
}
