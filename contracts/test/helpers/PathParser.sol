// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Reads back the path data a renderer emitted, so tests can check which
/// cells were actually drawn instead of trusting a string blind.
/// @dev Every run is written as "M<x> <y>h<w>v<h>h-<w>z" and nothing else, which
/// is what makes a parser this small sufficient. Row runs are one cell tall and
/// the year-ring bars are one cell wide, so both shapes fall out of the same
/// grammar. It is strict on purpose: a malformed run fails here rather than
/// being quietly skipped.
library PathParser {
    struct Run {
        uint256 x;
        uint256 y;
        uint256 w;
        uint256 h;
    }

    function parse(string memory d) internal pure returns (Run[] memory runs) {
        bytes memory b = bytes(d);
        uint256 count;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == "M") ++count;
        }
        runs = new Run[](count);

        uint256 n;
        uint256 p;
        while (p < b.length) {
            require(b[p] == "M", "PathParser: expected M");
            ++p;
            uint256 x;
            (x, p) = _readUint(b, p);
            require(b[p] == " ", "PathParser: expected space after x");
            ++p;
            uint256 y;
            (y, p) = _readUint(b, p);
            require(b[p] == "h", "PathParser: expected h after y");
            ++p;
            uint256 w;
            (w, p) = _readUint(b, p);
            require(b[p] == "v", "PathParser: expected v after width");
            ++p;
            uint256 h;
            (h, p) = _readUint(b, p);
            // The closing "h-<w>z" must mirror the width exactly, or the outline
            // does not close and the fill is undefined.
            require(b[p] == "h" && b[p + 1] == "-", "PathParser: malformed run tail");
            p += 2;
            uint256 back;
            (back, p) = _readUint(b, p);
            require(back == w, "PathParser: closing width does not mirror the opening one");
            require(b[p] == "z", "PathParser: run is not closed");
            ++p;
            require(w > 0 && h > 0, "PathParser: empty run");
            runs[n++] = Run(x, y, w, h);
        }
    }

    /// @notice How many cells the whole path covers.
    function countCells(string memory d) internal pure returns (uint256 cells) {
        Run[] memory runs = parse(d);
        for (uint256 i; i < runs.length; ++i) cells += runs[i].w * runs[i].h;
    }

    function _readUint(bytes memory b, uint256 p) internal pure returns (uint256 v, uint256 q) {
        q = p;
        while (q < b.length && b[q] >= "0" && b[q] <= "9") {
            v = v * 10 + (uint8(b[q]) - 48);
            ++q;
        }
        require(q > p, "PathParser: expected a number");
    }
}
