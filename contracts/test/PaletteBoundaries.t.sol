// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

import {Palette} from "../src/render/Palette.sol";
import {ColourFixture} from "./ColourFixture.sol";

/// @notice Sweep A of the state soak: every tier threshold crossed with every
/// lapse threshold, one step either side, against the JS reference.
///
/// @dev Palette.t.sol already covers the ladder's behaviour. What it does not
/// cover is AGREEMENT: Solidity and tools/render-token.mjs compute the tier and
/// the lapse independently, in two languages, and the full-render differential
/// pins a few dozen states out of hundreds. A boundary off by one -- streak 30
/// treated as tier 3 rather than tier 4, or a lapse stepping at 6 days instead
/// of 7 -- would be invisible in every image and permanent once tokens exist.
///
/// Regenerate the table with: node tools/colour-fixture.mjs
contract PaletteBoundariesTest is Test {
    function test_everyColourBoundaryMatchesTheJavascriptReference() public pure {
        ColourFixture.Case[] memory cases = ColourFixture.cases();
        assertEq(cases.length, 88, "the fixture is not the size it should be");

        for (uint256 i; i < cases.length; ++i) {
            ColourFixture.Case memory c = cases[i];
            string memory ctx = string.concat(
                "streak ", vm.toString(c.streak),
                ", gap ", vm.toString(c.today - c.lastDay)
            );

            assertEq(Palette.tier(c.streak), c.live, string.concat(ctx, ": live tier differs"));
            assertEq(
                Palette.lapsed(c.streak, c.lastDay, c.today), c.lapsed,
                string.concat(ctx, ": lapsed colour differs")
            );
        }
    }

    /// @dev The property that makes the lapse safe to ship: because a lapse
    /// walks back DOWN the existing ladder rather than fading toward white,
    /// every colour it can produce is one of the five already proven to decode.
    /// If that ever stops being true the decode guarantee is gone, so it is
    /// asserted rather than assumed.
    function test_noLapseCanProduceAnInkOutsideTheLadder() public pure {
        ColourFixture.Case[] memory cases = ColourFixture.cases();
        for (uint256 i; i < cases.length; ++i) {
            string memory got = Palette.lapsed(cases[i].streak, cases[i].lastDay, cases[i].today);
            bool onLadder;
            for (uint32 s = 0; s <= 100 && !onLadder; s += 1) {
                if (keccak256(bytes(Palette.tier(s))) == keccak256(bytes(got))) onLadder = true;
            }
            assertTrue(onLadder, "a lapse produced an ink that is not a tier colour");
        }
    }

    /// @dev A lapse may only ever make a token duller, never brighter. Stated
    /// as a rule the ladder must obey rather than as a list of expected values.
    function test_aLapseNeverMovesUpTheLadder() public pure {
        ColourFixture.Case[] memory cases = ColourFixture.cases();
        for (uint256 i; i < cases.length; ++i) {
            ColourFixture.Case memory c = cases[i];
            uint256 live = _rank(Palette.tier(c.streak));
            uint256 now_ = _rank(Palette.lapsed(c.streak, c.lastDay, c.today));
            assertLe(
                now_, live,
                string.concat("streak ", vm.toString(c.streak), ": a lapse brightened the heart")
            );
        }
    }

    /// @dev 0 is the bottom tier, 4 the top. Derived from Palette itself so a
    /// palette change cannot leave this test asserting stale colours.
    function _rank(string memory colour) private pure returns (uint256) {
        uint32[5] memory streaks = [uint32(0), 3, 7, 30, 100];
        for (uint256 i; i < 5; ++i) {
            if (keccak256(bytes(Palette.tier(streaks[i]))) == keccak256(bytes(colour))) return i;
        }
        revert("colour is not on the ladder");
    }
}
