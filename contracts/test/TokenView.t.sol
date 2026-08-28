// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TokenView} from "../src/render/TokenView.sol";
import {HeartMask} from "../src/render/HeartMask.sol";

/// @dev TokenView emits no artifact of its own -- it is a free-standing struct --
/// so without this nothing would prove it compiles or that its field names are
/// what the renderers will use. Task 4 exists to fix those names in place, so a
/// rename that breaks a later renderer should break here first.
contract TokenViewTest is Test {
    function _sample() internal pure returns (TokenView memory v) {
        v = TokenView({
            tokenId: 1,
            level: 365,
            streak: 140,
            lastDay: 20_000,
            mintDay: 19_635,
            generation: 0,
            seedsGiven: 0,
            resting: false,
            sunset: false,
            marks: 0,
            agentKeyId: bytes32(uint256(0xa9e)),
            code: new bytes(HeartMask.BYTES),
            today: 20_000
        });
    }

    function test_theStructCarriesEveryFieldARendererNeeds() public pure {
        TokenView memory v = _sample();
        assertEq(v.tokenId, 1);
        assertEq(v.level, 365);
        assertEq(v.streak, 140);
        assertEq(v.lastDay, 20_000);
        assertEq(v.mintDay, 19_635);
        assertEq(v.generation, 0);
        assertEq(v.seedsGiven, 0);
        assertFalse(v.resting);
        assertFalse(v.sunset);
        assertEq(v.marks, 0);
        assertEq(v.agentKeyId, bytes32(uint256(0xa9e)));
        assertEq(v.today, 20_000);
    }

    function test_theCodeIsExactlyTheWidthTheMaskExpects() public pure {
        // The bitmap and the shared heart mask are indexed by identical code, so
        // a token's code must be the same 172 bytes the mask is.
        TokenView memory v = _sample();
        assertEq(v.code.length, HeartMask.BYTES, "code is not one packed 37x37 grid");
        assertEq(HeartMask.BYTES, 172);
        assertEq(HeartMask.SIZE, 37);
        assertEq(HeartMask.bits().length, HeartMask.BYTES);
    }

    function test_marksAreOneBitPerMarkIdOneToSeven() public pure {
        // Bit n = mark id n. Id 0 is unused so a zero word means "no marks".
        TokenView memory v = _sample();
        v.marks = (1 << 1) | (1 << 7);           // Vein and Singularity
        assertTrue(v.marks & (1 << 1) != 0, "vein");
        assertTrue(v.marks & (1 << 7) != 0, "singularity");
        assertTrue(v.marks & (1 << 5) == 0, "halo not set");
        assertEq(v.marks, 130);
    }

    function test_levelYieldsCompletedYears() public pure {
        TokenView memory v = _sample();
        assertEq(v.level / 365, 1, "365 days is one completed year");
        v.level = 364;
        assertEq(v.level / 365, 0);
        v.level = 1095;
        assertEq(v.level / 365, 3);
    }
}
