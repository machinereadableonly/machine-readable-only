// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";
import {LibString} from "solady/src/utils/LibString.sol";

import {DigitBand} from "../src/render/DigitBand.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";
import {FrameRenderer} from "../src/render/FrameRenderer.sol";
import {MarkRenderer} from "../src/render/MarkRenderer.sol";
import {Renderer} from "../src/render/Renderer.sol";
import {TokenView} from "../src/render/TokenView.sol";

/// @notice The finisher's digit band through the whole renderer: that it
/// changes nothing for a token without one, and exactly one thing for a token
/// with one.
contract DigitBandRenderTest is Test {
    Renderer r;

    /// @dev Bits 64-95 of the marks word. Section 5 of the finisher spec, which
    /// corrects section 8's table -- 32-63 hold the earned Iris run.
    uint256 constant ORDINAL_SHIFT = 64;

    function setUp() public {
        r = new Renderer();
    }

    /// @dev Token 1 on example.com, the bitmap every renderer test uses.
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

    /// @dev A whole token with one year behind it -- the token a finisher is.
    function _finished() internal pure returns (TokenView memory v) {
        v.tokenId = 1;
        v.level = 365;
        v.streak = 365;
        v.lastDay = 1000;
        v.today = 1000;
        v.mintDay = 635;
        v.code = _bitmap();
    }

    // ---------------------------------------------------------------------
    // THE CONTROL
    // ---------------------------------------------------------------------

    /// This is why the band is safe to ship before the finisher Marks exist.
    /// Nothing can set an ordinal yet, so every token that exists must render
    /// the bytes it rendered before the band was written. `TokenUriGolden` and
    /// `RenderMatrix` prove that across the whole state matrix; this says what
    /// the mechanism is, so a failure points at the cause.
    function test_aTokenWithNoOrdinalCarriesNoBandAndNoShift() public view {
        string memory plain = r.svg(_finished());

        assertFalse(LibString.contains(plain, "translate(0 0)"), "an empty shift, not a zero one");
        assertEq(
            LibString.indexOf(plain, 'transform="scale(13)"') == LibString.NOT_FOUND,
            false,
            "the cell group keeps the exact transform it has always had"
        );
    }

    // ---------------------------------------------------------------------
    // THE BAND
    // ---------------------------------------------------------------------

    /// The canvas grows by exactly one band at each edge, and by nothing else.
    function test_anOrdinalGrowsTheCanvasByExactlyTwoBands() public view {
        TokenView memory v = _finished();
        uint256 cells = FrameRenderer.canvas(FrameRenderer.rings(v.level, v.echo));
        v.marks = uint256(7) << ORDINAL_SHIFT;

        string memory banded = r.svg(v);
        string memory want = LibString.toString(DigitBand.canvasUnits(cells));

        assertTrue(
            LibString.contains(banded, string.concat('viewBox="0 0 ', want, " ", want, '"')),
            "the viewBox must be the banded canvas"
        );
        assertTrue(
            LibString.contains(
                banded, string.concat("translate(", LibString.toString(DigitBand.bandUnits(cells)))
            ),
            "the inner picture shifts in by exactly one band"
        );
    }

    /// The intrinsic size keeps pace with the canvas, so a third party's CDN
    /// still rasterises a crisp source rather than interpolating 53 pixels up.
    /// That finding cost a measured A/B on two live Sepolia contracts.
    function test_theDeclaredSizeGrowsWithTheBandedCanvas() public view {
        TokenView memory v = _finished();
        string memory plain = r.svg(v);
        v.marks = uint256(1) << ORDINAL_SHIFT;
        string memory banded = r.svg(v);

        assertTrue(LibString.contains(plain, 'width="848"'), "one ring is 848px unbanded");
        assertFalse(LibString.contains(banded, 'width="848"'), "a banded token is wider than that");
        // 747 units at 16px per 13-unit cell is 919px.
        assertTrue(LibString.contains(banded, 'width="919"'), "and 747 units declares 919px");
    }

    /// The band is the ONLY difference. Everything inside the picture is
    /// untouched, so the code block's path data must appear in the banded
    /// render verbatim -- only the group carrying it moves.
    function test_theBandChangesNothingInsideThePicture() public view {
        TokenView memory v = _finished();
        string memory plain = r.svg(v);
        v.marks = uint256(42) << ORDINAL_SHIFT;
        string memory banded = r.svg(v);

        assertGt(bytes(banded).length, bytes(plain).length, "the band costs bytes");

        uint256 cut = LibString.indexOf(plain, 'scale(9)"><path');
        assertTrue(cut != LibString.NOT_FOUND, "the module group must be present");
        assertTrue(
            LibString.contains(banded, LibString.slice(plain, cut)),
            "the code block must be drawn identically, byte for byte"
        );
    }

    /// Two finishers must be visibly different objects. That is the whole
    /// reason a number beat a colour: five inks were peers, and a number ranks.
    function test_twoFinishersRenderDifferently() public view {
        TokenView memory v = _finished();
        v.marks = uint256(1) << ORDINAL_SHIFT;
        bytes32 first = keccak256(bytes(r.svg(v)));
        v.marks = uint256(365) << ORDINAL_SHIFT;
        bytes32 later = keccak256(bytes(r.svg(v)));

        assertTrue(first != later, "the border IS the rank");
    }

    /// @dev The band group, with the ink it is expected to be written in.
    function _bandIn(string memory ink) internal pure returns (string memory) {
        return string.concat('<g transform="scale(9)"><path fill="', ink);
    }

    /// The Mark IS the ink: each of the five finisher Marks writes the number
    /// in its own colour, end to end through the renderer rather than only in
    /// MarkRenderer's selector.
    function test_eachFinisherMarkWritesTheNumberInItsOwnInk() public view {
        TokenView memory v = _finished();
        uint256 ordinal = uint256(42) << ORDINAL_SHIFT;

        v.marks = MarkRenderer.APEX | ordinal;
        assertTrue(LibString.contains(r.svg(v), _bandIn(MarkRenderer.APEX_GOLD)), "apex: gold");
        v.marks = MarkRenderer.ATRIUM | ordinal;
        assertTrue(
            LibString.contains(r.svg(v), _bandIn(MarkRenderer.ATRIUM_SILVER)), "atrium: silver"
        );
        v.marks = MarkRenderer.VALVE | ordinal;
        assertTrue(
            LibString.contains(r.svg(v), _bandIn(MarkRenderer.VALVE_BRONZE)), "valve: bronze"
        );
        v.marks = MarkRenderer.CHAMBER | ordinal;
        assertTrue(
            LibString.contains(r.svg(v), _bandIn(MarkRenderer.CHAMBER_BLUE)), "chamber: blue"
        );
        v.marks = MarkRenderer.AORTA | ordinal;
        assertTrue(LibString.contains(r.svg(v), _bandIn(MarkRenderer.AORTA_RED)), "aorta: red");
    }

    /// The band is written in its Mark's ink and nothing else the token's state
    /// does moves it. A Vessel token's frame turns gold; the number keeps the
    /// colour its PLACE earned, which is the one thing about it that is fixed
    /// for ever.
    function test_theBandsInkIsFixedAgainstEverythingElseMoving() public view {
        TokenView memory v = _finished();
        string memory want = _bandIn(MarkRenderer.VALVE_BRONZE);

        v.marks = MarkRenderer.VALVE | (uint256(9) << ORDINAL_SHIFT);
        assertTrue(LibString.contains(r.svg(v), want), "plain: the band is in its Mark's ink");

        // Vessel turns the frame and the rings gold.
        v.marks = MarkRenderer.VESSEL | MarkRenderer.VALVE | (uint256(9) << ORDINAL_SHIFT);
        assertTrue(LibString.contains(r.svg(v), want), "Vessel: still the Mark's ink");
        assertTrue(
            LibString.contains(r.svg(v), MarkRenderer.frameFill(v.marks, "#000000")),
            "and the frame really did go gold, so this is not a vacuous check"
        );

        // Beat's far stop is the same string as Chamber's blue, and Vessel's
        // gold the same as Apex's. A Mark that shares an ink must not be able
        // to write the band, because only the PLACE may choose that colour.
        v.marks = MarkRenderer.BEAT | (uint256(9) << ORDINAL_SHIFT);
        assertTrue(
            LibString.contains(r.svg(v), _bandIn(DigitBand.INK)),
            "Beat shares Chamber's string and still does not colour the number"
        );
    }

    /// An ordinal with no finisher Mark cannot be reached on chain -- `_finish`
    /// writes both in one word -- so this is what the renderer does when it is
    /// handed a state the chain cannot produce: the near-black it always had.
    function test_anOrdinalWithNoFinisherMarkKeepsTheNearBlack() public view {
        TokenView memory v = _finished();
        v.marks = uint256(1) << ORDINAL_SHIFT;
        assertTrue(LibString.contains(r.svg(v), _bandIn(DigitBand.INK)));
    }

    // ---------------------------------------------------------------------
    // THE METADATA
    // ---------------------------------------------------------------------

    /// The place is a trait, so an agent can read the rank without rasterising
    /// the image and decoding a border. `Finisher` is emitted ALWAYS, 0
    /// included, so a reader can filter on it rather than special-casing
    /// absence -- the same rule `Echo` follows.
    function test_theFinishersPlaceIsATrait() public view {
        TokenView memory v = _finished();
        v.marks = MarkRenderer.CHAMBER | (uint256(42) << ORDINAL_SHIFT);
        assertTrue(
            LibString.contains(r.tokenURI(v), '{"trait_type":"Finisher","value":42}'),
            "the ordinal must reach the metadata"
        );
        assertTrue(
            LibString.contains(r.tokenURI(v), '"chamber"'),
            "and so must the Mark the place earned"
        );

        v.marks = 0;
        assertTrue(
            LibString.contains(r.tokenURI(v), '{"trait_type":"Finisher","value":0}'),
            "a token that has not finished says so with a 0"
        );
    }

    /// The whole ordinal range draws, and the dearest ordinal is the one full
    /// of zeros -- a 0 glyph carries more ink than a 1. Pinned because the cost
    /// varies with the NUMBER, which is unusual and easy to forget when reading
    /// a single gas figure.
    function test_theOrdinalFullOfZerosIsTheDearestToDraw() public view {
        TokenView memory v = _finished();
        v.marks = uint256(0xFFFF) << ORDINAL_SHIFT;
        uint256 allOnes = bytes(r.svg(v)).length;
        v.marks = uint256(1) << ORDINAL_SHIFT;
        uint256 mostlyZeros = bytes(r.svg(v)).length;

        assertGt(mostlyZeros, allOnes, "fifteen zeros draw more than sixteen ones");
    }
}
