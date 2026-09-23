// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CodeRenderer} from "../src/render/CodeRenderer.sol";
import {HeartMask} from "../src/render/HeartMask.sol";
import {PathParser} from "./helpers/PathParser.sol";

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
    uint256 constant SIZE = 57;
    /// @dev Derived, not restated: a synthetic code buffer must be the width
    /// the mask expects, and a literal here is what left eight tests building
    /// 37-module codes against a 57-module mask at the version raise.
    uint256 constant BYTES = (SIZE * SIZE + 7) / 8;
    uint256 constant CODE_OFF = 7;   // canvas 51, year zero
    uint256 constant HEART_CELLS = 1753;
    uint256 constant NOISE_CELLS = 579;

    string constant HEART_FILL = "#70575f";
    string constant NOISE_FILL = "#767676";

    CodeRendererHarness harness;

    function setUp() public {
        harness = new CodeRendererHarness();
    }

    function _bitmap() internal pure returns (bytes memory) {
        return
        hex"fe7f926bb8df3fc116bae8ac88906e9d1d71e35bcbb757fff47edfa5dbafffffe6f7d2ec13ebaf1bf3f107fa"
        hex"aaaaaaaaaafe00faebc7bbfb00c77fffffddfd8c5efffffffffffcafff5c61df9df8afbfaebcfbfbf9efffff"
        hex"fe7f9bb78beffffebbe9af7efff5c71df04ffefbfffffffffdff3fffffffddfddf3effffebbfbbfbfffeeefb"
        hex"bbbbfbffbfaebffb8dbfe7fffffffdc75ff7effffffffbbdf3fffdc71dfd9e9cfbfeebffbbfbbc3fffffffff"
        hex"ffff7effffebbfbbfb5fffdc6fdf9dfecf1ffffc7ffb51f7affffebddddad2c7ffff1bfba4727ffeeffbba37"
        hex"fb7bfeeb6fbbfae62e7fffbfddfcc92e7fffffffff7722dfdc7ddf9dfbd68feeb6fb9dbcecbffffdbffefbee"
        hex"0ffffffbfb727b7e7dc7ddfdfb48c93fff7ffffeb9737fffbfddfd6e4e4dffffbfbb336fadeeffbbbb6bef17"
        hex"eeb6fbbef6efa6fffbfddb4cd34b6ffffffd73f69e01c7ddf8590bf11aeb6fbbfaa8032d1bbfffabfc806401"
        hex"51beb0c7bfb0187ade0c2b905c377c5eecf11ba3096fe8120ff5d0c265706c9af2e9f2aedba037bf05c26b87"
        hex"9ae9c0fede58a39525f100";
    }

    function _heartD() internal pure returns (string memory) {
        return
        "M20 9h1v1h-1zM24 9h3v1h-3zM44 9h1v1h-1zM46 9h1v1h-1zM48 9h2v1h-2zM17 10h13v1h-13zM41 10h2v"
        "1h-2zM44 10h2v1h-2zM47 10h6v1h-6zM15 11h17v1h-17zM40 11h2v1h-2zM43 11h4v1h-4zM48 11h5v1h-5"
        "zM54 11h1v1h-1zM13 12h1v1h-1zM16 12h5v1h-5zM22 12h1v1h-1zM24 12h3v1h-3zM28 12h1v1h-1zM30 1"
        "2h3v1h-3zM38 12h1v1h-1zM40 12h6v1h-6zM48 12h6v1h-6zM57 12h1v1h-1zM12 13h2v1h-2zM15 13h1v1h"
        "-1zM17 13h1v1h-1zM19 13h1v1h-1zM21 13h1v1h-1zM23 13h1v1h-1zM25 13h1v1h-1zM27 13h1v1h-1zM29"
        " 13h1v1h-1zM31 13h1v1h-1zM33 13h1v1h-1zM37 13h1v1h-1zM39 13h1v1h-1zM41 13h1v1h-1zM43 13h1v"
        "1h-1zM45 13h1v1h-1zM47 13h1v1h-1zM49 13h1v1h-1zM51 13h1v1h-1zM53 13h1v1h-1zM55 13h1v1h-1zM"
        "57 13h2v1h-2zM16 14h5v1h-5zM22 14h1v1h-1zM24 14h3v1h-3zM28 14h1v1h-1zM30 14h4v1h-4zM37 14h"
        "4v1h-4zM42 14h3v1h-3zM46 14h7v1h-7zM54 14h2v1h-2zM12 15h3v1h-3zM16 15h25v1h-25zM42 15h3v1h"
        "-3zM46 15h7v1h-7zM54 15h2v1h-2zM59 15h1v1h-1zM10 16h3v1h-3zM14 16h46v1h-46zM10 17h11v1h-11"
        "zM22 17h1v1h-1zM24 17h3v1h-3zM30 17h2v1h-2zM36 17h3v1h-3zM40 17h6v1h-6zM48 17h3v1h-3zM52 1"
        "7h6v1h-6zM9 18h4v1h-4zM14 18h7v1h-7zM22 18h1v1h-1zM24 18h3v1h-3zM28 18h1v1h-1zM30 18h4v1h-"
        "4zM36 18h5v1h-5zM42 18h7v1h-7zM50 18h7v1h-7zM59 18h3v1h-3zM9 19h25v1h-25zM36 19h8v1h-8zM46"
        " 19h2v1h-2zM49 19h3v1h-3zM53 19h2v1h-2zM56 19h4v1h-4zM9 20h4v1h-4zM14 20h19v1h-19zM34 20h1"
        "v1h-1zM36 20h3v1h-3zM40 20h5v1h-5zM46 20h1v1h-1zM49 20h2v1h-2zM52 20h1v1h-1zM54 20h4v1h-4z"
        "M59 20h3v1h-3zM9 21h12v1h-12zM22 21h1v1h-1zM24 21h3v1h-3zM30 21h3v1h-3zM36 21h3v1h-3zM40 2"
        "1h5v1h-5zM50 21h1v1h-1zM53 21h10v1h-10zM8 22h5v1h-5zM14 22h40v1h-40zM55 22h8v1h-8zM9 23h32"
        "v1h-32zM42 23h3v1h-3zM46 23h7v1h-7zM54 23h3v1h-3zM58 23h5v1h-5zM8 24h5v1h-5zM14 24h19v1h-1"
        "9zM34 24h1v1h-1zM36 24h3v1h-3zM40 24h7v1h-7zM48 24h3v1h-3zM52 24h7v1h-7zM60 24h3v1h-3zM8 2"
        "5h12v1h-12zM21 25h3v1h-3zM25 25h3v1h-3zM29 25h5v1h-5zM35 25h3v1h-3zM39 25h3v1h-3zM43 25h3v"
        "1h-3zM47 25h3v1h-3zM51 25h7v1h-7zM59 25h4v1h-4zM8 26h5v1h-5zM14 26h7v1h-7zM22 26h1v1h-1zM2"
        "4 26h3v1h-3zM28 26h1v1h-1zM30 26h11v1h-11zM42 26h3v1h-3zM48 26h2v1h-2zM51 26h2v1h-2zM54 26"
        "h9v1h-9zM8 27h33v1h-33zM42 27h3v1h-3zM48 27h3v1h-3zM52 27h1v1h-1zM54 27h9v1h-9zM8 28h5v1h-"
        "5zM14 28h33v1h-33zM48 28h3v1h-3zM52 28h4v1h-4zM57 28h5v1h-5zM8 29h15v1h-15zM24 29h3v1h-3zM"
        "30 29h3v1h-3zM36 29h3v1h-3zM40 29h7v1h-7zM48 29h2v1h-2zM52 29h4v1h-4zM57 29h1v1h-1zM60 29h"
        "3v1h-3zM8 30h5v1h-5zM14 30h9v1h-9zM24 30h3v1h-3zM28 30h1v1h-1zM30 30h11v1h-11zM42 30h3v1h-"
        "3zM46 30h7v1h-7zM54 30h3v1h-3zM58 30h4v1h-4zM9 31h53v1h-53zM9 32h4v1h-4zM14 32h19v1h-19zM3"
        "4 32h1v1h-1zM36 32h3v1h-3zM40 32h7v1h-7zM48 32h3v1h-3zM52 32h7v1h-7zM60 32h2v1h-2zM9 33h14"
        "v1h-14zM24 33h3v1h-3zM30 33h2v1h-2zM33 33h6v1h-6zM40 33h6v1h-6zM48 33h3v1h-3zM52 33h8v1h-8"
        "zM61 33h1v1h-1zM9 34h3v1h-3zM15 34h19v1h-19zM37 34h12v1h-12zM50 34h2v1h-2zM53 34h1v1h-1zM5"
        "5 34h1v1h-1zM59 34h3v1h-3zM10 35h2v1h-2zM13 35h1v1h-1zM15 35h19v1h-19zM35 35h1v1h-1zM37 35"
        "h4v1h-4zM42 35h3v1h-3zM46 35h3v1h-3zM50 35h3v1h-3zM54 35h2v1h-2zM57 35h1v1h-1zM59 35h2v1h-"
        "2zM10 36h2v1h-2zM15 36h19v1h-19zM37 36h2v1h-2zM40 36h7v1h-7zM48 36h3v1h-3zM52 36h1v1h-1zM5"
        "5 36h1v1h-1zM59 36h2v1h-2zM10 37h14v1h-14zM25 37h3v1h-3zM29 37h9v1h-9zM39 37h3v1h-3zM43 37"
        "h3v1h-3zM47 37h1v1h-1zM51 37h2v1h-2zM54 37h7v1h-7zM11 38h2v1h-2zM14 38h9v1h-9zM24 38h3v1h-"
        "3zM28 38h1v1h-1zM30 38h2v1h-2zM33 38h2v1h-2zM36 38h5v1h-5zM42 38h3v1h-3zM46 38h7v1h-7zM54 "
        "38h1v1h-1zM56 38h3v1h-3zM11 39h3v1h-3zM16 39h16v1h-16zM33 39h8v1h-8zM42 39h3v1h-3zM46 39h7"
        "v1h-7zM55 39h2v1h-2zM59 39h1v1h-1zM12 40h1v1h-1zM15 40h39v1h-39zM55 40h3v1h-3zM13 41h2v1h-"
        "2zM16 41h7v1h-7zM24 41h3v1h-3zM30 41h5v1h-5zM36 41h3v1h-3zM40 41h6v1h-6zM48 41h3v1h-3zM52 "
        "41h6v1h-6zM16 42h7v1h-7zM24 42h3v1h-3zM28 42h1v1h-1zM30 42h2v1h-2zM33 42h2v1h-2zM36 42h5v1"
        "h-5zM42 42h3v1h-3zM47 42h3v1h-3zM51 42h2v1h-2zM54 42h4v1h-4zM14 43h19v1h-19zM34 43h2v1h-2z"
        "M37 43h13v1h-13zM51 43h5v1h-5zM14 44h25v1h-25zM40 44h7v1h-7zM48 44h2v1h-2zM51 44h3v1h-3zM5"
        "6 44h1v1h-1zM15 45h1v1h-1zM18 45h5v1h-5zM24 45h3v1h-3zM30 45h5v1h-5zM36 45h3v1h-3zM40 45h7"
        "v1h-7zM48 45h6v1h-6zM55 45h1v1h-1zM18 46h14v1h-14zM33 46h22v1h-22zM17 47h15v1h-15zM33 47h8"
        "v1h-8zM42 47h3v1h-3zM46 47h7v1h-7zM18 48h2v1h-2zM21 48h18v1h-18zM40 48h7v1h-7zM48 48h3v1h-"
        "3zM52 48h1v1h-1zM20 49h4v1h-4zM25 49h3v1h-3zM29 49h9v1h-9zM39 49h3v1h-3zM43 49h3v1h-3zM47 "
        "49h3v1h-3zM51 49h1v1h-1zM20 50h3v1h-3zM24 50h3v1h-3zM28 50h1v1h-1zM30 50h2v1h-2zM33 50h2v1"
        "h-2zM36 50h5v1h-5zM42 50h3v1h-3zM46 50h5v1h-5zM21 51h11v1h-11zM33 51h8v1h-8zM42 51h3v1h-3z"
        "M46 51h2v1h-2zM49 51h1v1h-1zM22 52h26v1h-26zM24 53h3v1h-3zM30 53h5v1h-5zM36 53h3v1h-3zM40 "
        "53h6v1h-6zM24 54h3v1h-3zM28 54h1v1h-1zM30 54h2v1h-2zM33 54h2v1h-2zM36 54h5v1h-5zM42 54h3v1"
        "h-3zM46 54h1v1h-1zM26 55h2v1h-2zM29 55h3v1h-3zM33 55h13v1h-13zM29 56h1v1h-1zM31 56h1v1h-1z"
        "M33 56h1v1h-1zM37 56h2v1h-2zM40 56h4v1h-4zM30 57h4v1h-4zM35 57h1v1h-1zM37 57h2v1h-2zM40 57"
        "h3v1h-3zM30 58h4v1h-4zM37 58h1v1h-1zM39 58h2v1h-2zM31 59h7v1h-7zM39 59h1v1h-1zM33 60h1v1h-"
        "1zM35 60h3v1h-3zM34 61h1v1h-1zM36 61h1v1h-1z";
    }

    function _noiseD() internal pure returns (string memory) {
        return
        "M7 7h7v1h-7zM16 7h8v1h-8zM26 7h1v1h-1zM29 7h1v1h-1zM32 7h2v1h-2zM35 7h1v1h-1zM37 7h3v1h-3z"
        "M41 7h3v1h-3zM47 7h2v1h-2zM50 7h5v1h-5zM57 7h7v1h-7zM7 8h1v1h-1zM13 8h1v1h-1zM17 8h1v1h-1z"
        "M19 8h2v1h-2zM22 8h1v1h-1zM24 8h3v1h-3zM28 8h1v1h-1zM30 8h3v1h-3zM34 8h1v1h-1zM38 8h1v1h-1"
        "zM40 8h1v1h-1zM42 8h2v1h-2zM46 8h1v1h-1zM50 8h1v1h-1zM54 8h1v1h-1zM57 8h1v1h-1zM63 8h1v1h-"
        "1zM7 9h1v1h-1zM9 9h3v1h-3zM13 9h1v1h-1zM16 9h3v1h-3zM28 9h1v1h-1zM30 9h3v1h-3zM36 9h4v1h-4"
        "zM43 9h1v1h-1zM51 9h4v1h-4zM57 9h1v1h-1zM59 9h3v1h-3zM63 9h1v1h-1zM7 10h1v1h-1zM9 10h3v1h-"
        "3zM13 10h1v1h-1zM15 10h1v1h-1zM30 10h2v1h-2zM33 10h1v1h-1zM37 10h4v1h-4zM54 10h1v1h-1zM57 "
        "10h1v1h-1zM59 10h3v1h-3zM63 10h1v1h-1zM7 11h1v1h-1zM9 11h3v1h-3zM13 11h1v1h-1zM32 11h6v1h-"
        "6zM57 11h1v1h-1zM59 11h3v1h-3zM63 11h1v1h-1zM7 12h1v1h-1zM33 12h1v1h-1zM37 12h1v1h-1zM63 1"
        "2h1v1h-1zM7 13h5v1h-5zM35 13h1v1h-1zM59 13h5v1h-5zM7 15h2v1h-2zM60 15h1v1h-1zM7 16h1v1h-1z"
        "M9 16h1v1h-1zM62 16h1v1h-1zM7 17h1v1h-1zM9 17h1v1h-1zM61 17h1v1h-1zM63 17h1v1h-1zM8 18h1v1"
        "h-1zM62 18h1v1h-1zM7 19h2v1h-2zM63 19h1v1h-1zM8 20h1v1h-1zM62 20h2v1h-2zM7 21h1v1h-1zM63 2"
        "1h1v1h-1zM63 22h1v1h-1zM63 24h1v1h-1zM7 25h1v1h-1zM63 25h1v1h-1zM7 26h1v1h-1zM7 28h1v1h-1z"
        "M7 29h1v1h-1zM62 31h1v1h-1zM7 32h2v1h-2zM63 32h1v1h-1zM8 33h1v1h-1zM62 33h1v1h-1zM8 34h1v1"
        "h-1zM62 34h2v1h-2zM8 35h2v1h-2zM62 35h1v1h-1zM8 36h1v1h-1zM61 36h1v1h-1zM7 37h1v1h-1zM61 3"
        "7h1v1h-1zM63 37h1v1h-1zM7 38h1v1h-1zM9 38h2v1h-2zM61 38h2v1h-2zM9 39h1v1h-1zM62 39h1v1h-1z"
        "M8 40h1v1h-1zM10 40h2v1h-2zM59 40h3v1h-3zM7 41h1v1h-1zM11 41h1v1h-1zM59 41h4v1h-4zM7 42h1v"
        "1h-1zM9 42h2v1h-2zM12 42h1v1h-1zM60 42h3v1h-3zM7 43h2v1h-2zM11 43h1v1h-1zM13 43h1v1h-1zM57"
        " 43h5v1h-5zM63 43h1v1h-1zM7 44h2v1h-2zM59 44h4v1h-4zM7 45h2v1h-2zM10 45h5v1h-5zM56 45h1v1h"
        "-1zM58 45h1v1h-1zM61 45h1v1h-1zM8 46h2v1h-2zM12 46h1v1h-1zM15 46h1v1h-1zM56 46h1v1h-1zM58 "
        "46h3v1h-3zM63 46h1v1h-1zM8 47h3v1h-3zM13 47h2v1h-2zM16 47h1v1h-1zM54 47h1v1h-1zM56 47h2v1h"
        "-2zM59 47h3v1h-3zM7 48h1v1h-1zM10 48h3v1h-3zM15 48h1v1h-1zM53 48h1v1h-1zM56 48h2v1h-2zM60 "
        "48h2v1h-2zM63 48h1v1h-1zM7 49h1v1h-1zM9 49h5v1h-5zM15 49h1v1h-1zM17 49h2v1h-2zM52 49h1v1h-"
        "1zM54 49h2v1h-2zM57 49h1v1h-1zM59 49h5v1h-5zM8 50h4v1h-4zM15 50h1v1h-1zM17 50h3v1h-3zM52 5"
        "0h4v1h-4zM57 50h2v1h-2zM60 50h3v1h-3zM7 51h5v1h-5zM13 51h1v1h-1zM16 51h2v1h-2zM19 51h2v1h-"
        "2zM50 51h1v1h-1zM52 51h1v1h-1zM55 51h2v1h-2zM59 51h2v1h-2zM62 51h1v1h-1zM8 52h2v1h-2zM11 5"
        "2h1v1h-1zM14 52h1v1h-1zM16 52h2v1h-2zM19 52h2v1h-2zM49 52h1v1h-1zM51 52h3v1h-3zM56 52h6v1h"
        "-6zM63 52h1v1h-1zM7 53h1v1h-1zM9 53h1v1h-1zM12 53h4v1h-4zM50 53h1v1h-1zM52 53h2v1h-2zM56 5"
        "3h1v1h-1zM61 53h1v1h-1zM63 53h1v1h-1zM7 54h5v1h-5zM15 54h1v1h-1zM19 54h2v1h-2zM22 54h1v1h-"
        "1zM47 54h6v1h-6zM54 54h1v1h-1zM56 54h1v1h-1zM58 54h1v1h-1zM60 54h1v1h-1zM13 55h2v1h-2zM17 "
        "55h1v1h-1zM19 55h2v1h-2zM22 55h1v1h-1zM46 55h2v1h-2zM49 55h1v1h-1zM51 55h1v1h-1zM53 55h8v1"
        "h-8zM63 55h1v1h-1zM15 56h2v1h-2zM19 56h1v1h-1zM44 56h1v1h-1zM46 56h1v1h-1zM48 56h2v1h-2zM5"
        "4 56h2v1h-2zM59 56h4v1h-4zM7 57h7v1h-7zM15 57h2v1h-2zM24 57h2v1h-2zM43 57h1v1h-1zM49 57h2v"
        "1h-2zM55 57h1v1h-1zM57 57h1v1h-1zM59 57h3v1h-3zM7 58h1v1h-1zM13 58h1v1h-1zM15 58h3v1h-3zM2"
        "2 58h2v1h-2zM25 58h3v1h-3zM29 58h1v1h-1zM41 58h2v1h-2zM44 58h3v1h-3zM48 58h2v1h-2zM52 58h4"
        "v1h-4zM59 58h1v1h-1zM63 58h1v1h-1zM7 59h1v1h-1zM9 59h3v1h-3zM13 59h1v1h-1zM17 59h2v1h-2zM2"
        "3 59h1v1h-1zM26 59h1v1h-1zM28 59h2v1h-2zM46 59h1v1h-1zM49 59h1v1h-1zM55 59h8v1h-8zM7 60h1v"
        "1h-1zM9 60h3v1h-3zM13 60h1v1h-1zM18 60h2v1h-2zM24 60h1v1h-1zM27 60h2v1h-2zM31 60h1v1h-1zM4"
        "3 60h2v1h-2zM46 60h2v1h-2zM50 60h1v1h-1zM53 60h2v1h-2zM56 60h1v1h-1zM58 60h4v1h-4zM7 61h1v"
        "1h-1zM9 61h3v1h-3zM13 61h1v1h-1zM16 61h5v1h-5zM23 61h1v1h-1zM25 61h1v1h-1zM27 61h1v1h-1zM2"
        "9 61h3v1h-3zM33 61h1v1h-1zM37 61h1v1h-1zM39 61h3v1h-3zM43 61h1v1h-1zM51 61h2v1h-2zM54 61h4"
        "v1h-4zM59 61h5v1h-5zM7 62h1v1h-1zM13 62h1v1h-1zM15 62h3v1h-3zM22 62h1v1h-1zM25 62h2v1h-2zM"
        "28 62h1v1h-1zM30 62h3v1h-3zM37 62h4v1h-4zM43 62h2v1h-2zM46 62h1v1h-1zM48 62h3v1h-3zM52 62h"
        "1v1h-1zM55 62h3v1h-3zM7 63h7v1h-7zM15 63h2v1h-2zM18 63h4v1h-4zM24 63h1v1h-1zM26 63h2v1h-2z"
        "M31 63h1v1h-1zM33 63h1v1h-1zM37 63h3v1h-3zM42 63h1v1h-1zM44 63h1v1h-1zM46 63h1v1h-1zM49 63"
        "h1v1h-1zM52 63h1v1h-1zM54 63h5v1h-5zM62 63h1v1h-1z";
    }

    function _heartDAtZero() internal pure returns (string memory) {
        return
        "M13 2h1v1h-1zM17 2h3v1h-3zM37 2h1v1h-1zM39 2h1v1h-1zM41 2h2v1h-2zM10 3h13v1h-13zM34 3h2v1h"
        "-2zM37 3h2v1h-2zM40 3h6v1h-6zM8 4h17v1h-17zM33 4h2v1h-2zM36 4h4v1h-4zM41 4h5v1h-5zM47 4h1v"
        "1h-1zM6 5h1v1h-1zM9 5h5v1h-5zM15 5h1v1h-1zM17 5h3v1h-3zM21 5h1v1h-1zM23 5h3v1h-3zM31 5h1v1"
        "h-1zM33 5h6v1h-6zM41 5h6v1h-6zM50 5h1v1h-1zM5 6h2v1h-2zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h"
        "-1zM14 6h1v1h-1zM16 6h1v1h-1zM18 6h1v1h-1zM20 6h1v1h-1zM22 6h1v1h-1zM24 6h1v1h-1zM26 6h1v1"
        "h-1zM30 6h1v1h-1zM32 6h1v1h-1zM34 6h1v1h-1zM36 6h1v1h-1zM38 6h1v1h-1zM40 6h1v1h-1zM42 6h1v"
        "1h-1zM44 6h1v1h-1zM46 6h1v1h-1zM48 6h1v1h-1zM50 6h2v1h-2zM9 7h5v1h-5zM15 7h1v1h-1zM17 7h3v"
        "1h-3zM21 7h1v1h-1zM23 7h4v1h-4zM30 7h4v1h-4zM35 7h3v1h-3zM39 7h7v1h-7zM47 7h2v1h-2zM5 8h3v"
        "1h-3zM9 8h25v1h-25zM35 8h3v1h-3zM39 8h7v1h-7zM47 8h2v1h-2zM52 8h1v1h-1zM3 9h3v1h-3zM7 9h46"
        "v1h-46zM3 10h11v1h-11zM15 10h1v1h-1zM17 10h3v1h-3zM23 10h2v1h-2zM29 10h3v1h-3zM33 10h6v1h-"
        "6zM41 10h3v1h-3zM45 10h6v1h-6zM2 11h4v1h-4zM7 11h7v1h-7zM15 11h1v1h-1zM17 11h3v1h-3zM21 11"
        "h1v1h-1zM23 11h4v1h-4zM29 11h5v1h-5zM35 11h7v1h-7zM43 11h7v1h-7zM52 11h3v1h-3zM2 12h25v1h-"
        "25zM29 12h8v1h-8zM39 12h2v1h-2zM42 12h3v1h-3zM46 12h2v1h-2zM49 12h4v1h-4zM2 13h4v1h-4zM7 1"
        "3h19v1h-19zM27 13h1v1h-1zM29 13h3v1h-3zM33 13h5v1h-5zM39 13h1v1h-1zM42 13h2v1h-2zM45 13h1v"
        "1h-1zM47 13h4v1h-4zM52 13h3v1h-3zM2 14h12v1h-12zM15 14h1v1h-1zM17 14h3v1h-3zM23 14h3v1h-3z"
        "M29 14h3v1h-3zM33 14h5v1h-5zM43 14h1v1h-1zM46 14h10v1h-10zM1 15h5v1h-5zM7 15h40v1h-40zM48 "
        "15h8v1h-8zM2 16h32v1h-32zM35 16h3v1h-3zM39 16h7v1h-7zM47 16h3v1h-3zM51 16h5v1h-5zM1 17h5v1"
        "h-5zM7 17h19v1h-19zM27 17h1v1h-1zM29 17h3v1h-3zM33 17h7v1h-7zM41 17h3v1h-3zM45 17h7v1h-7zM"
        "53 17h3v1h-3zM1 18h12v1h-12zM14 18h3v1h-3zM18 18h3v1h-3zM22 18h5v1h-5zM28 18h3v1h-3zM32 18"
        "h3v1h-3zM36 18h3v1h-3zM40 18h3v1h-3zM44 18h7v1h-7zM52 18h4v1h-4zM1 19h5v1h-5zM7 19h7v1h-7z"
        "M15 19h1v1h-1zM17 19h3v1h-3zM21 19h1v1h-1zM23 19h11v1h-11zM35 19h3v1h-3zM41 19h2v1h-2zM44 "
        "19h2v1h-2zM47 19h9v1h-9zM1 20h33v1h-33zM35 20h3v1h-3zM41 20h3v1h-3zM45 20h1v1h-1zM47 20h9v"
        "1h-9zM1 21h5v1h-5zM7 21h33v1h-33zM41 21h3v1h-3zM45 21h4v1h-4zM50 21h5v1h-5zM1 22h15v1h-15z"
        "M17 22h3v1h-3zM23 22h3v1h-3zM29 22h3v1h-3zM33 22h7v1h-7zM41 22h2v1h-2zM45 22h4v1h-4zM50 22"
        "h1v1h-1zM53 22h3v1h-3zM1 23h5v1h-5zM7 23h9v1h-9zM17 23h3v1h-3zM21 23h1v1h-1zM23 23h11v1h-1"
        "1zM35 23h3v1h-3zM39 23h7v1h-7zM47 23h3v1h-3zM51 23h4v1h-4zM2 24h53v1h-53zM2 25h4v1h-4zM7 2"
        "5h19v1h-19zM27 25h1v1h-1zM29 25h3v1h-3zM33 25h7v1h-7zM41 25h3v1h-3zM45 25h7v1h-7zM53 25h2v"
        "1h-2zM2 26h14v1h-14zM17 26h3v1h-3zM23 26h2v1h-2zM26 26h6v1h-6zM33 26h6v1h-6zM41 26h3v1h-3z"
        "M45 26h8v1h-8zM54 26h1v1h-1zM2 27h3v1h-3zM8 27h19v1h-19zM30 27h12v1h-12zM43 27h2v1h-2zM46 "
        "27h1v1h-1zM48 27h1v1h-1zM52 27h3v1h-3zM3 28h2v1h-2zM6 28h1v1h-1zM8 28h19v1h-19zM28 28h1v1h"
        "-1zM30 28h4v1h-4zM35 28h3v1h-3zM39 28h3v1h-3zM43 28h3v1h-3zM47 28h2v1h-2zM50 28h1v1h-1zM52"
        " 28h2v1h-2zM3 29h2v1h-2zM8 29h19v1h-19zM30 29h2v1h-2zM33 29h7v1h-7zM41 29h3v1h-3zM45 29h1v"
        "1h-1zM48 29h1v1h-1zM52 29h2v1h-2zM3 30h14v1h-14zM18 30h3v1h-3zM22 30h9v1h-9zM32 30h3v1h-3z"
        "M36 30h3v1h-3zM40 30h1v1h-1zM44 30h2v1h-2zM47 30h7v1h-7zM4 31h2v1h-2zM7 31h9v1h-9zM17 31h3"
        "v1h-3zM21 31h1v1h-1zM23 31h2v1h-2zM26 31h2v1h-2zM29 31h5v1h-5zM35 31h3v1h-3zM39 31h7v1h-7z"
        "M47 31h1v1h-1zM49 31h3v1h-3zM4 32h3v1h-3zM9 32h16v1h-16zM26 32h8v1h-8zM35 32h3v1h-3zM39 32"
        "h7v1h-7zM48 32h2v1h-2zM52 32h1v1h-1zM5 33h1v1h-1zM8 33h39v1h-39zM48 33h3v1h-3zM6 34h2v1h-2"
        "zM9 34h7v1h-7zM17 34h3v1h-3zM23 34h5v1h-5zM29 34h3v1h-3zM33 34h6v1h-6zM41 34h3v1h-3zM45 34"
        "h6v1h-6zM9 35h7v1h-7zM17 35h3v1h-3zM21 35h1v1h-1zM23 35h2v1h-2zM26 35h2v1h-2zM29 35h5v1h-5"
        "zM35 35h3v1h-3zM40 35h3v1h-3zM44 35h2v1h-2zM47 35h4v1h-4zM7 36h19v1h-19zM27 36h2v1h-2zM30 "
        "36h13v1h-13zM44 36h5v1h-5zM7 37h25v1h-25zM33 37h7v1h-7zM41 37h2v1h-2zM44 37h3v1h-3zM49 37h"
        "1v1h-1zM8 38h1v1h-1zM11 38h5v1h-5zM17 38h3v1h-3zM23 38h5v1h-5zM29 38h3v1h-3zM33 38h7v1h-7z"
        "M41 38h6v1h-6zM48 38h1v1h-1zM11 39h14v1h-14zM26 39h22v1h-22zM10 40h15v1h-15zM26 40h8v1h-8z"
        "M35 40h3v1h-3zM39 40h7v1h-7zM11 41h2v1h-2zM14 41h18v1h-18zM33 41h7v1h-7zM41 41h3v1h-3zM45 "
        "41h1v1h-1zM13 42h4v1h-4zM18 42h3v1h-3zM22 42h9v1h-9zM32 42h3v1h-3zM36 42h3v1h-3zM40 42h3v1"
        "h-3zM44 42h1v1h-1zM13 43h3v1h-3zM17 43h3v1h-3zM21 43h1v1h-1zM23 43h2v1h-2zM26 43h2v1h-2zM2"
        "9 43h5v1h-5zM35 43h3v1h-3zM39 43h5v1h-5zM14 44h11v1h-11zM26 44h8v1h-8zM35 44h3v1h-3zM39 44"
        "h2v1h-2zM42 44h1v1h-1zM15 45h26v1h-26zM17 46h3v1h-3zM23 46h5v1h-5zM29 46h3v1h-3zM33 46h6v1"
        "h-6zM17 47h3v1h-3zM21 47h1v1h-1zM23 47h2v1h-2zM26 47h2v1h-2zM29 47h5v1h-5zM35 47h3v1h-3zM3"
        "9 47h1v1h-1zM19 48h2v1h-2zM22 48h3v1h-3zM26 48h13v1h-13zM22 49h1v1h-1zM24 49h1v1h-1zM26 49"
        "h1v1h-1zM30 49h2v1h-2zM33 49h4v1h-4zM23 50h4v1h-4zM28 50h1v1h-1zM30 50h2v1h-2zM33 50h3v1h-"
        "3zM23 51h4v1h-4zM30 51h1v1h-1zM32 51h2v1h-2zM24 52h7v1h-7zM32 52h1v1h-1zM26 53h1v1h-1zM28 "
        "53h3v1h-3zM27 54h1v1h-1zM29 54h1v1h-1z";
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
        bytes memory code = new bytes(BYTES);
        code[0] = bytes1(uint8(0x10));   // bit 4 of byte 0 -> module 3
        bytes memory mask = new bytes(BYTES);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M3 0h1v1h-1z", "a lone module is one 1x1 cell");
    }

    function test_aRunOfFiveMergesIntoOneMove() public view {
        bytes memory code = new bytes(BYTES);
        code[0] = bytes1(uint8(0x1F));   // modules 3,4,5,6,7 -- five in a row
        bytes memory mask = new bytes(BYTES);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M3 0h5v1h-5z", "five contiguous modules merge into one run");
    }

    function test_aRunStopsAtTheEndOfItsRow() public view {
        // The last module of row 0 and the first of row 1 are adjacent in the
        // packing but sit on different rows. Merging across that boundary
        // would draw a cell outside the code.
        //
        // Derived from SIZE rather than written as byte 4 bits 4 and 5, which
        // named modules 36 and 37 and silently stopped straddling the boundary
        // the moment the version went to 57.
        uint256 last = SIZE - 1;
        uint256 first = SIZE;
        bytes memory code = new bytes(BYTES);
        code[last >> 3] = bytes1(uint8(0x80 >> (last & 7)));
        code[first >> 3] = bytes1(uint8(uint8(code[first >> 3]) | (0x80 >> (first & 7))));
        bytes memory mask = new bytes(BYTES);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(
            noiseD,
            string.concat("M", vm.toString(last), " 0h1v1h-1zM0 1h1v1h-1z"),
            "a run never wraps onto the next row"
        );
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
        drawn += _checkRuns(PathParser.parse(heartD), code, mask, true);
        drawn += _checkRuns(PathParser.parse(noiseD), code, mask, false);
        assertEq(drawn, HEART_CELLS + NOISE_CELLS, "the two paths cover every dark module, once each");
    }

    /// @dev Walks every cell of every run and checks it belongs to this class.
    /// Because a cell can only satisfy one of the two mask predicates, proving
    /// each cell is on the right side also proves the two paths never overlap.
    function _checkRuns(PathParser.Run[] memory runs, bytes memory code, bytes memory mask, bool wantHeart)
        internal
        pure
        returns (uint256 cells)
    {
        for (uint256 r; r < runs.length; ++r) {
            PathParser.Run memory run = runs[r];
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
        assertEq(PathParser.countCells(heartD), HEART_CELLS, "heart cell count");
        assertEq(PathParser.countCells(noiseD), NOISE_CELLS, "noise cell count");
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
        bytes memory code = new bytes(BYTES);
        code[0] = 0xFF;
        code[1] = 0xFF;
        code[2] = 0xFF;
        code[3] = 0xFF;
        code[4] = 0xF8;   // the last five modules of the row
        bytes memory mask = new bytes(BYTES);

        (string memory noiseD,) = _split(harness.paths(code, mask, 0, HEART_FILL, NOISE_FILL));
        assertEq(noiseD, "M0 0h37v1h-37z", "a full row is a single run");
    }

    function test_threeDigitCoordinatesAreWrittenInFull() public view {
        // A large offset pushes the code further down the canvas. Each run is
        // composed in one 32-byte word, so wider numbers are the case most
        // likely to overflow it -- "M103 100h1v1h-1z" is 16 of the 32 bytes.
        // The offset here is larger than any canvas can now produce, and
        // deliberately: it is PathWriter's word budget being tested, not the
        // ring rule.
        bytes memory code = new bytes(BYTES);
        code[0] = bytes1(uint8(0x10));   // one module at (3,0)
        bytes memory mask = new bytes(BYTES);

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
        bytes memory code = new bytes(BYTES);
        for (uint256 i; i < BYTES; ++i) {
            code[i] = 0xAA;
        }
        bytes memory mask = new bytes(BYTES);

        string memory out = harness.paths(code, mask, CODE_OFF, HEART_FILL, NOISE_FILL);
        (string memory noiseD, string memory heartD) = _split(out);
        assertEq(bytes(heartD).length, 0, "an empty mask leaves the heart empty");

        uint256 dark;
        for (uint256 k; k < SIZE * SIZE; ++k) {
            if (CodeRenderer.isDark(code, k)) ++dark;
        }
        assertEq(PathParser.countCells(noiseD), dark, "every module drawn, exactly once");
    }

    function test_anEmptyCodeDrawsNothingButStillEmitsBothPaths() public view {
        bytes memory empty = new bytes(BYTES);
        string memory out = harness.paths(empty, HeartMask.bits(), CODE_OFF, HEART_FILL, NOISE_FILL);
        string[] memory parts = vm.split(out, "<path");
        assertEq(parts.length, 3, "both paths are always present");
        (string memory noiseD, string memory heartD) = _split(out);
        assertEq(bytes(heartD).length, 0, "nothing to draw");
        assertEq(bytes(noiseD).length, 0, "nothing to draw");
    }
}
