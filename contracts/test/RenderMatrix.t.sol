// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {Renderer} from "../src/render/Renderer.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {IdentityFixture} from "./IdentityFixture.sol";
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
        // 50 until C4.10 added the six absence states (the three fade steps,
        // plus Ache and Aura against the last one), then 63 when seven seeded
        // children were added so the echo ring stopped being invisible here.
        // The count is asserted so a fixture that silently regenerates SMALLER
        // -- a matrix case dropped by an edit -- fails here rather than passing
        // with less coverage.
        assertEq(cases.length, 63, "the fixture is not the size it should be");

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
            // The lineage three. Zero on every founding case, so the cases that
            // came before these existed render exactly as they always did.
            v.echo = c.echo;
            v.parent = c.parent;
            v.generation = c.generation;
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

    /// @notice The same state at four token identities, diffed against the JS
    /// reference.
    ///
    /// @dev The matrix above varies STATE and holds identity fixed: every case
    /// is token 1, mint day 900, on one bitmap -- necessarily, because they
    /// share a single `_bitmap()`. So `LibString.toString(v.tokenId)` and the
    /// JS template literal that mirrors it were compared at exactly one value,
    /// one digit long, and the `%23` in front of it with them.
    ///
    /// Four identities here: one digit, two, four, and 2**32 - 1, which is the
    /// widest id `mint` will accept. Each carries its own bitmap, because the
    /// payload a code encodes is `https://<domain>/t/<id>#` -- token 4242's
    /// code is not token 1's, and pretending otherwise would test nothing.
    ///
    /// Regenerate with: node tools/identity-fixture.mjs
    function test_everyIdentityMatchesTheJavascriptReference() public view {
        IdentityFixture.Case[] memory cases = IdentityFixture.cases();
        assertEq(cases.length, 4, "the identity fixture is not the size it should be");

        for (uint256 i; i < cases.length; ++i) {
            IdentityFixture.Case memory c = cases[i];

            TokenView memory v;
            v.tokenId = c.tokenId;
            v.mintDay = c.mintDay;
            v.code = c.code;
            // The state every identity shares. Mirrors STATE in the generator.
            v.level = 365;
            v.streak = 400;
            v.lastDay = 1000;
            v.today = 1000;

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

    /// @dev The control the test above needs to mean anything: the four cases
    /// must actually RENDER DIFFERENTLY. They share every state field, so if
    /// the id and mint day reached the document nowhere, all four hashes would
    /// be equal and the test above would pass on a renderer that ignored both.
    function test_theFourIdentitiesRenderDifferently() public pure {
        IdentityFixture.Case[] memory cases = IdentityFixture.cases();
        for (uint256 i; i < cases.length; ++i) {
            for (uint256 j = i + 1; j < cases.length; ++j) {
                assertTrue(
                    cases[i].hash != cases[j].hash,
                    string.concat(cases[i].label, " and ", cases[j].label, " render identically")
                );
            }
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