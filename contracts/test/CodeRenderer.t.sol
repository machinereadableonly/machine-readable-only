// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CodeRenderer} from "../src/render/CodeRenderer.sol";
import {HeartMask} from "../src/render/HeartMask.sol";

/// @notice Exposes the library externally so `forge test --gas-report` can bill it.
/// @dev An internal library function is inlined into its caller and never shows up
/// in a gas report on its own. Gas is the one number Phase 0 has not measured, so
/// this harness exists purely to make it measurable.
contract CodeRendererHarness {
    function paths(
        bytes memory code,
        bytes memory mask,
        uint256 offset,
        string memory heartFill,
        string memory noiseFill
    ) external pure returns (string memory) {
        return CodeRenderer.paths(code, mask, offset, heartFill, noiseFill);
    }
}

contract CodeRendererTest is Test {
    // ---------------------------------------------------------------------
    // Fixture: token 1 on example.com, the same bitmap tools/token-bitmap.mjs
    // produces, and the paths tools/render-token.mjs draws from it at the real
    // year-zero offset. Embedded rather than read from tools/out because that
    // directory is gitignored; a test that read it would fail on a clean clone.
    // Regenerate with `node tools/code-path-fixture.mjs` and paste the output back
    // here if the QArt solver, the heart target or the path format ever changes.
    // ---------------------------------------------------------------------
    uint256 constant SIZE = 37;
    uint256 constant CODE_OFF = 7;   // canvas 51, year zero
    uint256 constant HEART_CELLS = 660;
    uint256 constant NOISE_CELLS = 234;

    string constant HEART_FILL = "#70575f";
    string constant NOISE_FILL = "#767676";

    CodeRendererHarness harness;

    function setUp() public {
        harness = new CodeRendererHarness();
    }

    function _bitmap() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function _heartD() internal pure returns (string memory) {
        return
        "M16 8h1v1h-1zM33 8h1v1h-1zM13 9h1v1h-1zM15 9h4v1h-4zM20 9h1v1h-1zM30 9h1v1h-1zM32 9h2v1h-2"
        "zM37 9h1v1h-1zM11 10h1v1h-1zM13 10h1v1h-1zM16 10h8v1h-8zM27 10h9v1h-9zM37 10h1v1h-1zM39 10"
        "h1v1h-1zM10 11h2v1h-2zM13 11h1v1h-1zM15 11h1v1h-1zM17 11h7v1h-7zM27 11h1v1h-1zM29 11h7v1h-"
        "7zM37 11h1v1h-1zM39 11h2v1h-2zM13 12h1v1h-1zM15 12h2v1h-2zM18 12h3v1h-3zM22 12h2v1h-2zM25 "
        "12h1v1h-1zM27 12h6v1h-6zM34 12h2v1h-2zM37 12h1v1h-1zM9 13h5v1h-5zM15 13h1v1h-1zM17 13h1v1h"
        "-1zM19 13h1v1h-1zM21 13h1v1h-1zM23 13h1v1h-1zM25 13h1v1h-1zM27 13h1v1h-1zM29 13h1v1h-1zM31"
        " 13h1v1h-1zM33 13h1v1h-1zM35 13h1v1h-1zM37 13h5v1h-5zM15 14h8v1h-8zM24 14h1v1h-1zM27 14h8v"
        "1h-8zM8 15h1v1h-1zM10 15h1v1h-1zM13 15h2v1h-2zM17 15h5v1h-5zM23 15h3v1h-3zM27 15h7v1h-7zM3"
        "5 15h1v1h-1zM37 15h3v1h-3zM41 15h2v1h-2zM8 16h5v1h-5zM14 16h3v1h-3zM18 16h20v1h-20zM40 16h"
        "2v1h-2zM8 17h13v1h-13zM22 17h2v1h-2zM26 17h2v1h-2zM29 17h4v1h-4zM34 17h3v1h-3zM41 17h1v1h-"
        "1zM8 18h5v1h-5zM14 18h4v1h-4zM19 18h8v1h-8zM28 18h2v1h-2zM31 18h6v1h-6zM40 18h1v1h-1zM42 1"
        "8h1v1h-1zM8 19h10v1h-10zM19 19h3v1h-3zM23 19h3v1h-3zM27 19h3v1h-3zM31 19h3v1h-3zM35 19h1v1"
        "h-1zM37 19h1v1h-1zM8 20h5v1h-5zM14 20h6v1h-6zM21 20h11v1h-11zM33 20h6v1h-6zM8 21h12v1h-12z"
        "M21 21h4v1h-4zM26 21h2v1h-2zM30 21h2v1h-2zM33 21h3v1h-3zM38 21h3v1h-3zM9 22h4v1h-4zM14 22h"
        "22v1h-22zM37 22h2v1h-2zM40 22h1v1h-1zM42 22h1v1h-1zM9 23h9v1h-9zM19 23h3v1h-3zM23 23h7v1h-"
        "7zM31 23h3v1h-3zM35 23h4v1h-4zM41 23h1v1h-1zM9 24h1v1h-1zM11 24h2v1h-2zM14 24h10v1h-10zM25"
        " 24h13v1h-13zM39 24h1v1h-1zM41 24h2v1h-2zM9 25h1v1h-1zM11 25h9v1h-9zM22 25h2v1h-2zM26 25h2"
        "v1h-2zM30 25h2v1h-2zM34 25h4v1h-4zM40 25h1v1h-1zM9 26h2v1h-2zM14 26h9v1h-9zM24 26h2v1h-2zM"
        "27 26h8v1h-8zM36 26h1v1h-1zM38 26h2v1h-2zM41 26h1v1h-1zM13 27h9v1h-9zM23 27h3v1h-3zM27 27h"
        "7v1h-7zM35 27h3v1h-3zM39 27h1v1h-1zM10 28h1v1h-1zM14 28h25v1h-25zM11 29h10v1h-10zM22 29h2v"
        "1h-2zM26 29h2v1h-2zM29 29h4v1h-4zM34 29h3v1h-3zM39 29h1v1h-1zM12 30h1v1h-1zM14 30h4v1h-4zM"
        "19 30h8v1h-8zM28 30h2v1h-2zM31 30h7v1h-7zM39 30h1v1h-1zM13 31h5v1h-5zM19 31h3v1h-3zM23 31h"
        "3v1h-3zM27 31h3v1h-3zM31 31h3v1h-3zM35 31h1v1h-1zM37 31h1v1h-1zM14 32h6v1h-6zM21 32h11v1h-"
        "11zM33 32h3v1h-3zM37 32h1v1h-1zM15 33h5v1h-5zM21 33h4v1h-4zM26 33h2v1h-2zM30 33h2v1h-2zM33"
        " 33h4v1h-4zM16 34h20v1h-20zM17 35h1v1h-1zM19 35h3v1h-3zM23 35h7v1h-7zM31 35h2v1h-2zM35 35h"
        "1v1h-1zM17 36h1v1h-1zM19 36h5v1h-5zM25 36h8v1h-8zM18 37h2v1h-2zM22 37h2v1h-2zM26 37h2v1h-2"
        "zM30 37h1v1h-1zM19 38h1v1h-1zM21 38h2v1h-2zM24 38h2v1h-2zM27 38h5v1h-5zM21 39h1v1h-1zM23 3"
        "9h3v1h-3zM27 39h2v1h-2zM30 39h1v1h-1zM22 40h7v1h-7zM26 41h2v1h-2z";
    }

    function _noiseD() internal pure returns (string memory) {
        return
        "M7 7h7v1h-7zM23 7h1v1h-1zM30 7h1v1h-1zM35 7h1v1h-1zM37 7h7v1h-7zM7 8h1v1h-1zM13 8h1v1h-1zM"
        "15 8h1v1h-1zM19 8h1v1h-1zM21 8h1v1h-1zM24 8h2v1h-2zM28 8h1v1h-1zM30 8h2v1h-2zM35 8h1v1h-1z"
        "M37 8h1v1h-1zM43 8h1v1h-1zM7 9h1v1h-1zM9 9h3v1h-3zM24 9h2v1h-2zM27 9h1v1h-1zM39 9h3v1h-3zM"
        "43 9h1v1h-1zM7 10h1v1h-1zM9 10h2v1h-2zM24 10h3v1h-3zM40 10h2v1h-2zM43 10h1v1h-1zM7 11h1v1h"
        "-1zM9 11h1v1h-1zM25 11h1v1h-1zM41 11h1v1h-1zM43 11h1v1h-1zM7 12h1v1h-1zM43 12h1v1h-1zM7 13"
        "h2v1h-2zM42 13h2v1h-2zM7 15h1v1h-1zM43 16h1v1h-1zM7 17h1v1h-1zM43 17h1v1h-1zM43 18h1v1h-1z"
        "M43 19h1v1h-1zM7 20h1v1h-1zM43 20h1v1h-1zM43 21h1v1h-1zM7 23h1v1h-1zM43 23h1v1h-1zM43 24h1"
        "v1h-1zM7 25h2v1h-2zM42 25h2v1h-2zM8 26h1v1h-1zM42 26h1v1h-1zM9 27h1v1h-1zM43 27h1v1h-1zM7 "
        "28h1v1h-1zM9 28h1v1h-1zM43 28h1v1h-1zM7 29h1v1h-1zM9 29h2v1h-2zM40 29h1v1h-1zM42 29h2v1h-2"
        "zM10 30h1v1h-1zM7 31h1v1h-1zM9 31h2v1h-2zM40 31h1v1h-1zM42 31h2v1h-2zM8 32h4v1h-4zM38 32h1"
        "v1h-1zM40 32h1v1h-1zM43 32h1v1h-1zM7 33h1v1h-1zM9 33h1v1h-1zM12 33h2v1h-2zM37 33h1v1h-1zM4"
        "1 33h1v1h-1zM43 33h1v1h-1zM8 34h2v1h-2zM39 34h1v1h-1zM42 34h1v1h-1zM7 35h4v1h-4zM12 35h2v1"
        "h-2zM36 35h4v1h-4zM41 35h1v1h-1zM15 36h1v1h-1zM34 36h2v1h-2zM39 36h2v1h-2zM43 36h1v1h-1zM7"
        " 37h7v1h-7zM15 37h1v1h-1zM35 37h1v1h-1zM37 37h1v1h-1zM39 37h5v1h-5zM7 38h1v1h-1zM13 38h1v1"
        "h-1zM16 38h1v1h-1zM18 38h1v1h-1zM33 38h3v1h-3zM39 38h1v1h-1zM41 38h2v1h-2zM7 39h1v1h-1zM9 "
        "39h3v1h-3zM13 39h1v1h-1zM16 39h4v1h-4zM31 39h1v1h-1zM35 39h5v1h-5zM42 39h1v1h-1zM7 40h1v1h"
        "-1zM9 40h3v1h-3zM13 40h1v1h-1zM15 40h1v1h-1zM17 40h1v1h-1zM20 40h1v1h-1zM29 40h2v1h-2zM32 "
        "40h1v1h-1zM36 40h1v1h-1zM38 40h2v1h-2zM41 40h1v1h-1zM7 41h1v1h-1zM9 41h3v1h-3zM13 41h1v1h-"
        "1zM16 41h1v1h-1zM19 41h2v1h-2zM29 41h1v1h-1zM32 41h1v1h-1zM34 41h1v1h-1zM39 41h2v1h-2zM43 "
        "41h1v1h-1zM7 42h1v1h-1zM13 42h1v1h-1zM15 42h1v1h-1zM19 42h1v1h-1zM22 42h2v1h-2zM26 42h1v1h"
        "-1zM28 42h2v1h-2zM31 42h1v1h-1zM34 42h1v1h-1zM38 42h2v1h-2zM7 43h7v1h-7zM15 43h1v1h-1zM20 "
        "43h1v1h-1zM23 43h1v1h-1zM27 43h1v1h-1zM33 43h4v1h-4zM39 43h2v1h-2zM42 43h2v1h-2z";
    }

    function _heartDAtZero() internal pure returns (string memory) {
        return
        "M9 1h1v1h-1zM26 1h1v1h-1zM6 2h1v1h-1zM8 2h4v1h-4zM13 2h1v1h-1zM23 2h1v1h-1zM25 2h2v1h-2zM3"
        "0 2h1v1h-1zM4 3h1v1h-1zM6 3h1v1h-1zM9 3h8v1h-8zM20 3h9v1h-9zM30 3h1v1h-1zM32 3h1v1h-1zM3 4"
        "h2v1h-2zM6 4h1v1h-1zM8 4h1v1h-1zM10 4h7v1h-7zM20 4h1v1h-1zM22 4h7v1h-7zM30 4h1v1h-1zM32 4h"
        "2v1h-2zM6 5h1v1h-1zM8 5h2v1h-2zM11 5h3v1h-3zM15 5h2v1h-2zM18 5h1v1h-1zM20 5h6v1h-6zM27 5h2"
        "v1h-2zM30 5h1v1h-1zM2 6h5v1h-5zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM14 6h1v1h-1zM16 6h1v"
        "1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h1v1h-1zM28 6h1v1h-1zM30 6h5"
        "v1h-5zM8 7h8v1h-8zM17 7h1v1h-1zM20 7h8v1h-8zM1 8h1v1h-1zM3 8h1v1h-1zM6 8h2v1h-2zM10 8h5v1h"
        "-5zM16 8h3v1h-3zM20 8h7v1h-7zM28 8h1v1h-1zM30 8h3v1h-3zM34 8h2v1h-2zM1 9h5v1h-5zM7 9h3v1h-"
        "3zM11 9h20v1h-20zM33 9h2v1h-2zM1 10h13v1h-13zM15 10h2v1h-2zM19 10h2v1h-2zM22 10h4v1h-4zM27"
        " 10h3v1h-3zM34 10h1v1h-1zM1 11h5v1h-5zM7 11h4v1h-4zM12 11h8v1h-8zM21 11h2v1h-2zM24 11h6v1h"
        "-6zM33 11h1v1h-1zM35 11h1v1h-1zM1 12h10v1h-10zM12 12h3v1h-3zM16 12h3v1h-3zM20 12h3v1h-3zM2"
        "4 12h3v1h-3zM28 12h1v1h-1zM30 12h1v1h-1zM1 13h5v1h-5zM7 13h6v1h-6zM14 13h11v1h-11zM26 13h6"
        "v1h-6zM1 14h12v1h-12zM14 14h4v1h-4zM19 14h2v1h-2zM23 14h2v1h-2zM26 14h3v1h-3zM31 14h3v1h-3"
        "zM2 15h4v1h-4zM7 15h22v1h-22zM30 15h2v1h-2zM33 15h1v1h-1zM35 15h1v1h-1zM2 16h9v1h-9zM12 16"
        "h3v1h-3zM16 16h7v1h-7zM24 16h3v1h-3zM28 16h4v1h-4zM34 16h1v1h-1zM2 17h1v1h-1zM4 17h2v1h-2z"
        "M7 17h10v1h-10zM18 17h13v1h-13zM32 17h1v1h-1zM34 17h2v1h-2zM2 18h1v1h-1zM4 18h9v1h-9zM15 1"
        "8h2v1h-2zM19 18h2v1h-2zM23 18h2v1h-2zM27 18h4v1h-4zM33 18h1v1h-1zM2 19h2v1h-2zM7 19h9v1h-9"
        "zM17 19h2v1h-2zM20 19h8v1h-8zM29 19h1v1h-1zM31 19h2v1h-2zM34 19h1v1h-1zM6 20h9v1h-9zM16 20"
        "h3v1h-3zM20 20h7v1h-7zM28 20h3v1h-3zM32 20h1v1h-1zM3 21h1v1h-1zM7 21h25v1h-25zM4 22h10v1h-"
        "10zM15 22h2v1h-2zM19 22h2v1h-2zM22 22h4v1h-4zM27 22h3v1h-3zM32 22h1v1h-1zM5 23h1v1h-1zM7 2"
        "3h4v1h-4zM12 23h8v1h-8zM21 23h2v1h-2zM24 23h7v1h-7zM32 23h1v1h-1zM6 24h5v1h-5zM12 24h3v1h-"
        "3zM16 24h3v1h-3zM20 24h3v1h-3zM24 24h3v1h-3zM28 24h1v1h-1zM30 24h1v1h-1zM7 25h6v1h-6zM14 2"
        "5h11v1h-11zM26 25h3v1h-3zM30 25h1v1h-1zM8 26h5v1h-5zM14 26h4v1h-4zM19 26h2v1h-2zM23 26h2v1"
        "h-2zM26 26h4v1h-4zM9 27h20v1h-20zM10 28h1v1h-1zM12 28h3v1h-3zM16 28h7v1h-7zM24 28h2v1h-2zM"
        "28 28h1v1h-1zM10 29h1v1h-1zM12 29h5v1h-5zM18 29h8v1h-8zM11 30h2v1h-2zM15 30h2v1h-2zM19 30h"
        "2v1h-2zM23 30h1v1h-1zM12 31h1v1h-1zM14 31h2v1h-2zM17 31h2v1h-2zM20 31h5v1h-5zM14 32h1v1h-1"
        "zM16 32h3v1h-3zM20 32h2v1h-2zM23 32h1v1h-1zM15 33h7v1h-7zM19 34h2v1h-2z";
    }

    // ---------------------------------------------------------------------
    // A tiny parser for the emitted path data. Every run is written exactly as
    // "M<x> <y>h<w>v1h-<w>z", so the test can read back which cells were drawn
    // instead of trusting the string blind.
    // ---------------------------------------------------------------------
    struct Run {
        uint256 x;
        uint256 y;
        uint256 w;
    }

    function _parseRuns(string memory d) internal pure returns (Run[] memory runs) {
        bytes memory b = bytes(d);
        uint256 count;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == "M") ++count;
        }
        runs = new Run[](count);

        uint256 n;
        uint256 p;
        while (p < b.length) {
            require(b[p] == "M", "expected M");
            ++p;
            uint256 x;
            (x, p) = _readUint(b, p);
            require(b[p] == " ", "expected space after x");
            ++p;
            uint256 y;
            (y, p) = _readUint(b, p);
            require(b[p] == "h", "expected h after y");
            ++p;
            uint256 w;
            (w, p) = _readUint(b, p);
            // The closing "v1h-<w>z" must mirror the width exactly, or the cell
            // outline does not close and the fill is undefined.
            require(b[p] == "v" && b[p + 1] == "1" && b[p + 2] == "h" && b[p + 3] == "-", "malformed run tail");
            p += 4;
            uint256 back;
            (back, p) = _readUint(b, p);
            require(back == w, "the closing width does not mirror the opening one");
            require(b[p] == "z", "a run is not closed");
            ++p;
            runs[n++] = Run(x, y, w);
        }
    }

    function _readUint(bytes memory b, uint256 p) internal pure returns (uint256 v, uint256 q) {
        q = p;
        while (q < b.length && b[q] >= "0" && b[q] <= "9") {
            v = v * 10 + (uint8(b[q]) - 48);
            ++q;
        }
        require(q > p, "expected a number");
    }

    /// @dev Pulls the two d attributes out of the assembled output.
    function _split(string memory out) internal pure returns (string memory first, string memory second) {
        string[] memory parts = vm.split(out, "\"");
        // <path fill=" C " d=" D "/><path fill=" C " d=" D "/>
        // quote-delimited fields land at odd indices: 1 fill, 3 d, 5 fill, 7 d.
        require(parts.length >= 9, "expected two fill/d pairs");
        first = parts[3];
        second = parts[7];
    }

    function _out() internal view returns (string memory) {
        return harness.paths(_bitmap(), HeartMask.bits(), CODE_OFF, HEART_FILL, NOISE_FILL);
    }

    // ---------------------------------------------------------------------
    // isDark
    // ---------------------------------------------------------------------

    function test_isDarkReadsBitSevenOfByteZeroAsModuleZero() public pure {
        // The packing every tool in the repo agrees on: row major, one bit per
        // module, bit 7 of byte 0 is module (0,0).
        bytes memory one = hex"8000";
        assertTrue(CodeRenderer.isDark(one, 0), "bit 7 of byte 0 is module 0");
        for (uint256 k = 1; k < 16; ++k) {
            assertFalse(CodeRenderer.isDark(one, k), "no other module is set");
        }

        bytes memory last = hex"0001";
        assertTrue(CodeRenderer.isDark(last, 15), "bit 0 of byte 1 is module 15");
        for (uint256 k; k < 15; ++k) {
            assertFalse(CodeRenderer.isDark(last, k), "no other module is set");
        }
    }

    function test_isDarkAgreesWithTheFixtureModuleCount() public pure {
        bytes memory code = _bitmap();
        uint256 dark;
        for (uint256 k; k < SIZE * SIZE; ++k) {
            if (CodeRenderer.isDark(code, k)) ++dark;
        }
        assertEq(dark, HEART_CELLS + NOISE_CELLS, "every dark module lands in exactly one class");
    }

    // ---------------------------------------------------------------------
    // Run merging
    // ---------------------------------------------------------------------

    function test_aLoneModuleEmitsASingleCell() public view {
        // One module at (3,0), nothing else, and an empty mask so it counts as noise.
        bytes memory code = new bytes(172);
        code[0] = bytes1(uint8(0x10));   // bit 4 of byte 0 -> module 3
        bytes memory mask = new bytes(172);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M3 0h1v1h-1z", "a lone module is one 1x1 cell");
    }

    function test_aRunOfFiveMergesIntoOneMove() public view {
        bytes memory code = new bytes(172);
        code[0] = bytes1(uint8(0x1F));   // modules 3,4,5,6,7 -- five in a row
        bytes memory mask = new bytes(172);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M3 0h5v1h-5z", "five contiguous modules merge into one run");
    }

    function test_aRunStopsAtTheEndOfItsRow() public view {
        // Modules 36 and 37 are adjacent in the packing but sit on different rows.
        // Merging across that boundary would draw a cell outside the code.
        bytes memory code = new bytes(172);
        code[4] = bytes1(uint8(0x0C));   // bits 4 and 5 of byte 4 -> modules 36 and 37
        bytes memory mask = new bytes(172);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M36 0h1v1h-1zM0 1h1v1h-1z", "a run never wraps onto the next row");
    }

    // ---------------------------------------------------------------------
    // Structure
    // ---------------------------------------------------------------------

    function test_exactlyTwoPathElementsInTheGivenFills() public view {
        string memory out = _out();
        string[] memory parts = vm.split(out, "<path");
        assertEq(parts.length, 3, "exactly two path elements");

        string[] memory fields = vm.split(out, "\"");
        assertEq(fields[1], NOISE_FILL, "the noise path is emitted first");
        assertEq(fields[5], HEART_FILL, "the heart path is emitted second");
    }

    function test_everyDrawnCellIsADarkModuleOnTheRightSideOfTheMask() public view {
        bytes memory code = _bitmap();
        bytes memory mask = HeartMask.bits();
        (string memory noiseD, string memory heartD) = _split(_out());

        uint256 drawn;
        drawn += _checkRuns(_parseRuns(heartD), code, mask, true);
        drawn += _checkRuns(_parseRuns(noiseD), code, mask, false);
        assertEq(drawn, HEART_CELLS + NOISE_CELLS, "the two paths cover every dark module, once each");
    }

    /// @dev Walks every cell of every run and checks it belongs to this class.
    /// Because a cell can only satisfy one of the two mask predicates, proving
    /// each cell is on the right side also proves the two paths never overlap.
    function _checkRuns(Run[] memory runs, bytes memory code, bytes memory mask, bool wantHeart)
        internal
        pure
        returns (uint256 cells)
    {
        for (uint256 r; r < runs.length; ++r) {
            Run memory run = runs[r];
            assertGt(run.w, 0, "a run is never empty");
            uint256 y = run.y - CODE_OFF;
            assertLt(y, SIZE, "a run sits inside the code");
            for (uint256 i; i < run.w; ++i) {
                uint256 x = run.x + i - CODE_OFF;
                assertLt(x, SIZE, "a run never leaves the code");
                uint256 k = y * SIZE + x;
                assertTrue(CodeRenderer.isDark(code, k), "only dark modules are drawn");
                assertEq(CodeRenderer.isDark(mask, k), wantHeart, "the module is in the right class");
                ++cells;
            }
        }
    }

    function test_theHeartHoldsTheCellsTheMaskClaims() public view {
        (string memory noiseD, string memory heartD) = _split(_out());
        assertEq(_countCells(_parseRuns(heartD)), HEART_CELLS, "heart cell count");
        assertEq(_countCells(_parseRuns(noiseD)), NOISE_CELLS, "noise cell count");
    }

    function _countCells(Run[] memory runs) internal pure returns (uint256 n) {
        for (uint256 r; r < runs.length; ++r) n += runs[r].w;
    }

    // ---------------------------------------------------------------------
    // The differential check: this must match the JS reference exactly
    // ---------------------------------------------------------------------

    function test_matchesTheJavascriptReferenceByteForByte() public view {
        (string memory noiseD, string memory heartD) = _split(_out());
        assertEq(heartD, _heartD(), "heart path differs from tools/render-token.mjs");
        assertEq(noiseD, _noiseD(), "noise path differs from tools/render-token.mjs");
    }

    function test_theOffsetShiftsTheDrawingAndNothingElse() public view {
        (, string memory heartD) = _split(harness.paths(_bitmap(), HeartMask.bits(), 0, HEART_FILL, NOISE_FILL));
        assertEq(heartD, _heartDAtZero(), "the offset is applied, not baked in");
    }

    // ---------------------------------------------------------------------
    // Edges the token fixture never reaches
    // ---------------------------------------------------------------------

    function test_aFullRowIsOneRunFromEdgeToEdge() public view {
        // Every module in row zero set. The run has no zero below it to stop at,
        // which is the one case the run finder handles separately.
        bytes memory code = new bytes(172);
        code[0] = 0xFF;
        code[1] = 0xFF;
        code[2] = 0xFF;
        code[3] = 0xFF;
        code[4] = 0xF8;   // the last five modules of the row
        bytes memory mask = new bytes(172);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M0 0h37v1h-37z", "a full row is a single run");
    }

    function test_threeDigitCoordinatesAreWrittenInFull() public view {
        // A token with many year rings pushes the code further down the canvas.
        // Each run is composed in one 32-byte word, so wider numbers are the case
        // most likely to overflow it -- "M103 100h1v1h-1z" is 16 of the 32 bytes.
        bytes memory code = new bytes(172);
        code[0] = bytes1(uint8(0x10));   // one module at (3,0)
        bytes memory mask = new bytes(172);

        (string memory noiseD,) = _split(harness.paths(code, mask, 100, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M103 100h1v1h-1z", "three-digit coordinates survive intact");
    }

    function test_anOffsetThatCouldOverflowARunIsRejected() public {
        // Beyond this the run text could exceed the single word it is built in,
        // and it would be silently truncated rather than wrong in an obvious way.
        vm.expectRevert("CodeRenderer: offset too large");
        harness.paths(_bitmap(), HeartMask.bits(), 963, HEART_FILL, NOISE_FILL);
    }

    function test_aDegenerateCodeCannotOverrunTheBuffer() public view {
        // Alternating modules are the worst case for run count: 19 separate runs
        // per row instead of the handful a real code produces. The buffer is sized
        // for this, and the point of the test is that it stays inside it and still
        // draws every module exactly once.
        bytes memory code = new bytes(172);
        for (uint256 i; i < 172; ++i) {
            code[i] = 0xAA;
        }
        bytes memory mask = new bytes(172);

        string memory out = harness.paths(code, mask, CODE_OFF, HEART_FILL, NOISE_FILL);
        (string memory noiseD, string memory heartD) = _split(out);
        assertEq(bytes(heartD).length, 0, "an empty mask leaves the heart empty");

        uint256 dark;
        for (uint256 k; k < SIZE * SIZE; ++k) {
            if (CodeRenderer.isDark(code, k)) ++dark;
        }
        assertEq(_countCells(_parseRuns(noiseD)), dark, "every module drawn, exactly once");
    }

    function test_anEmptyCodeDrawsNothingButStillEmitsBothPaths() public view {
        bytes memory empty = new bytes(172);
        string memory out = harness.paths(empty, HeartMask.bits(), CODE_OFF, HEART_FILL, NOISE_FILL);
        string[] memory parts = vm.split(out, "<path");
        assertEq(parts.length, 3, "both paths are always present");
        (string memory noiseD, string memory heartD) = _split(out);
        assertEq(bytes(heartD).length, 0, "nothing to draw");
        assertEq(bytes(noiseD).length, 0, "nothing to draw");
    }
}
