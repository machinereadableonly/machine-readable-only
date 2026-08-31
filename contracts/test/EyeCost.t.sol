// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {LibString} from "solady/src/utils/LibString.sol";

import {HeartMask} from "../src/render/HeartMask.sol";

/// @notice COST PROBE for styling the QR's three finder patterns -- the "eyes".
///
/// @dev Not a shipping contract. This exists to answer one question with a
/// measured number instead of an estimate: what would an eighth Mark claiming
/// the eyes cost in gas and in output bytes?
///
/// WHY THE EYES ARE CHEAP. Every other surface is drawn from per-token data --
/// the code bitmap differs for every token, so the heart and noise paths must
/// be walked and merged at render time. The three finder patterns do not: a QR
/// puts them at fixed module coordinates, the same for every token that ever
/// mints. So the whole overlay is nine shapes at positions derived from one
/// runtime number, the canvas offset, which changes only with the year-ring
/// count.
///
/// The style measured is "target" -- concentric circles -- which was the
/// cheapest of six decode-tested candidates in tools/eye-shape-sheet.mjs at 635
/// bytes, and the most visually distinct.
contract EyeCostTest is Test {
    /// @dev Mirrors the JS prototype: erase the 7x7 to the field colour, then
    /// draw three concentric circles. Nine shapes for three eyes.
    function eyes(uint256 codeOff, string memory ink, string memory field)
        public
        pure
        returns (string memory out)
    {
        uint256 s = HeartMask.SIZE;
        // Top-left, top-right, bottom-left. There is no fourth finder pattern.
        uint256[3] memory xs = [uint256(0), s - 7, uint256(0)];
        uint256[3] memory ys = [uint256(0), uint256(0), s - 7];

        for (uint256 i = 0; i < 3; i++) {
            uint256 x = codeOff + xs[i];
            uint256 y = codeOff + ys[i];
            // The centre is offset by 7/2, which is not an integer, so it is
            // written as a fixed ".5" rather than carrying decimal arithmetic
            // into the renderer for one digit.
            string memory cx = string.concat(LibString.toString(x + 3), ".5");
            string memory cy = string.concat(LibString.toString(y + 3), ".5");
            out = string.concat(
                out,
                '<rect x="', LibString.toString(x), '" y="', LibString.toString(y),
                '" width="7" height="7" fill="', field, '"/>',
                '<circle cx="', cx, '" cy="', cy, '" r="3.5" fill="', ink, '"/>',
                '<circle cx="', cx, '" cy="', cy, '" r="2.5" fill="', field, '"/>',
                '<circle cx="', cx, '" cy="', cy, '" r="1.5" fill="', ink, '"/>'
            );
        }
    }

    function test_eyeOverlayCost() public view {
        uint256 before = gasleft();
        string memory out = eyes(6, "#c8102e", "#ffffff");
        uint256 used = before - gasleft();

        console.log("eye overlay (target style)");
        console.log("  gas  ", used);
        console.log("  bytes", bytes(out).length);

        // The JS prototype emitted 635 bytes for the same nine shapes. The two
        // are written independently, so a wide divergence means one of them is
        // drawing something different.
        assertGt(bytes(out).length, 500, "overlay implausibly short");
        assertLt(bytes(out).length, 800, "overlay implausibly long");

        // The budget this has to fit: 366,776 gas and 11,076 bytes of headroom
        // measured at the day-364 worst case in docs/phase0-results.md.
        assertLt(used, 366_776, "eye overlay does not fit the gas headroom");
        assertLt(bytes(out).length, 11_076, "eye overlay does not fit the byte headroom");
    }
}
