// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {Renderer} from "../src/render/Renderer.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {CombinationFixture} from "./CombinationFixture.sol";

/// @notice All 459 renderable Mark combinations, diffed against the JS
/// reference.
///
/// @dev The Mark surface was the thinnest part of the differential. Three
/// things covered Marks and none of them covered this:
///
///   RenderFixture carries 15 Mark-bearing states out of 189 legal sets, chosen
///   by hand -- so Hush + Break, Aura + Break and the bought Iris under Break
///   had no cross-language case at all.
///
///   tools/combination-sweep.mjs renders and DECODES every one of the 459, but
///   it never compares against Solidity. It answers "does this still scan",
///   which is a different question.
///
///   Renderer.t.sol and render-token.test.mjs each assert the Mark logic
///   thoroughly -- within one language. Two renderers agreeing with themselves
///   is exactly the failure a differential exists to catch.
///
/// Rendering all 459 on chain costs a few seconds and no rasterising, so this
/// is the whole set rather than a sample.
///
/// Regenerate the table with: node tools/combination-fixture.mjs
contract CombinationMatrixTest is Test {
    Renderer r;

    /// @dev Token 1 on example.com, the same bitmap the fixture was generated
    /// from -- so a mismatch is a renderer disagreement, not a different input.
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

    function test_everyLegalMarkCombinationMatchesTheJavascriptReference() public view {
        CombinationFixture.Case[] memory cases = CombinationFixture.cases();
        assertEq(cases.length, 459, "the combination fixture is not the size it should be");

        for (uint256 i; i < cases.length; ++i) {
            CombinationFixture.Case memory c = cases[i];

            TokenView memory v;
            v.tokenId = 1;
            v.mintDay = 900;
            v.code = _bitmap();
            v.marks = c.marks;
            // The state every combination shares. Mirrors STATE in the generator.
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

    /// @dev The three combinations the review named as having no differential
    /// case, asserted present BY NAME. A regenerated fixture that silently lost
    /// them would otherwise still pass the sweep above.
    function test_theThreeUncoveredCombinationsArePresent() public pure {
        CombinationFixture.Case[] memory cases = CombinationFixture.cases();

        assertTrue(_has(cases, "hush+break"), "Hush + Break");
        // Aura is never a two-Mark set: pair 5 waits on an Iris, so the
        // smallest set carrying Aura and Break also carries one.
        assertTrue(_has(cases, "iris-earned+break+aura"), "Aura + Break");
        assertTrue(_has(cases, "iris-bought(target)+break"), "the bought Iris under Break");
    }

    /// @dev And the whole point of a differential: the cases must not all
    /// render the same. Counts distinct hashes rather than asserting each pair,
    /// which at 459 cases would be 105,111 comparisons.
    function test_theCombinationsRenderDistinctly() public pure {
        CombinationFixture.Case[] memory cases = CombinationFixture.cases();
        uint256 duplicates;
        for (uint256 i; i < cases.length; ++i) {
            for (uint256 j = i + 1; j < cases.length; ++j) {
                if (cases[i].hash == cases[j].hash) duplicates += 1;
            }
        }
        // Some combinations genuinely draw the same picture -- a Mark that
        // claims no surface at this state changes nothing visible. What must
        // not happen is EVERY case collapsing to one hash, which is what a
        // renderer ignoring `marks` entirely would produce.
        assertLt(duplicates, cases.length, "the Mark set barely changes the document");
        console.log("combinations rendering identically to another:", duplicates);
    }

    function _has(CombinationFixture.Case[] memory cases, string memory label)
        internal
        pure
        returns (bool)
    {
        for (uint256 i; i < cases.length; ++i) {
            if (keccak256(bytes(cases[i].label)) == keccak256(bytes(label))) return true;
        }
        return false;
    }
}
