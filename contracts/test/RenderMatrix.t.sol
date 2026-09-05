// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {Renderer} from "../src/render/Renderer.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {RenderFixture} from "./RenderFixture.sol";

/// @notice Sweep B of the state soak: the complete tokenURI diffed against the
/// JS reference at every state in the matrix, not just the seven in
/// Renderer.t.sol.
///
/// @dev Renderer.t.sol keeps its seven hand-written cases because they are the
/// ones worth reading in a diff. This file is the breadth: every tier live and
/// lapsed, every ring count including one past the cap, five heart fills, each
/// drawing Mark alone, all of them together, and the two frozen lifecycles.
///
/// Regenerate the table with: node tools/render-fixture.mjs
contract RenderMatrixTest is Test {
    Renderer r;

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs. The fixture is
    /// generated from the same bitmap, so a mismatch here is a renderer
    /// disagreement rather than a different input.
    function _bitmap() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        r = new Renderer();
    }

    function test_everyStateInTheMatrixMatchesTheJavascriptReference() public view {
        RenderFixture.Case[] memory cases = RenderFixture.cases();
        assertEq(cases.length, 49, "the fixture is not the size it should be");

        for (uint256 i; i < cases.length; ++i) {
            RenderFixture.Case memory c = cases[i];

            TokenView memory v;
            v.tokenId = 1;
            v.level = c.level;
            v.streak = c.streak;
            v.lastDay = c.lastDay;
            v.today = c.today;
            v.mintDay = 900;
            v.marks = c.marks;
            v.resting = c.resting;
            v.sunset = c.sunset;
            v.sunsetDay = c.sunsetDay;
            v.fellRun = c.fellRun;
            v.fellDay = c.fellDay;
            v.code = _bitmap();

            string memory uri = r.tokenURI(v);
            assertEq(
                bytes(uri).length, c.bytesLen,
                string.concat(c.label, ": byte length differs from the reference")
            );
            assertEq(
                keccak256(bytes(uri)), c.hash,
                string.concat(c.label, ": content differs from the reference")
            );
        }
    }

    /// @dev Every state in the matrix must also fit the budget, not just the
    /// nine in GasBudget.t.sol. Logged so the widest state is visible.
    function test_noStateInTheMatrixOverrunsTheByteLimit() public pure {
        RenderFixture.Case[] memory cases = RenderFixture.cases();
        uint256 widest;
        string memory widestLabel;
        for (uint256 i; i < cases.length; ++i) {
            assertLt(cases[i].bytesLen, 20_000, string.concat(cases[i].label, ": over the byte limit"));
            if (cases[i].bytesLen > widest) {
                widest = cases[i].bytesLen;
                widestLabel = cases[i].label;
            }
        }
        console.log("widest state in the matrix");
        console.log("  ", widestLabel);
        console.log("  ", widest, "bytes");
    }
}
