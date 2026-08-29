// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {Renderer} from "../src/render/Renderer.sol";
import {RendererSized} from "../src/render/RendererSized.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";
import {TokenView} from "../src/render/TokenView.sol";

/// @notice The intrinsic-size experiment: what `RendererSized` changes, and
/// everything it must leave alone.
///
/// @dev This variant exists to answer one measured question on Base Sepolia --
/// whether declaring `width`/`height` stops a third-party CDN interpolating the
/// artwork into something that will not decode. See
/// docs/2026-08-29-mro-third-party-raster-finding.md. Until that measurement is
/// in, the plain `Renderer` is what ships, and the tests below are what stop the
/// experiment leaking into it.
contract RendererSizedTest is Test {
    Renderer plain;
    RendererSized sized;

    /// @dev Token 1 on example.com, the same bitmap the other render tests use.
    function _bitmap() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        plain = new Renderer();
        sized = new RendererSized();
    }

    function _view(uint32 level) internal pure returns (TokenView memory v) {
        v.tokenId = 1;
        v.level = level;
        v.streak = 100;
        v.lastDay = 1000;
        v.today = 1000;
        v.mintDay = 900;
        v.code = _bitmap();
    }

    function _has(string memory haystack, string memory needle) internal pure returns (bool) {
        return vm.indexOf(haystack, needle) != type(uint256).max;
    }

    /// The shipped renderer must not have gained an intrinsic size. This is the
    /// test that would fail if the experiment were ever switched on by accident.
    function test_thePlainRendererStillDeclaresNoIntrinsicSize() public view {
        string memory s = plain.svg(_view(365));
        assertFalse(_has(s, "width=\"8"), "plain renderer must not declare a width in pixels");
        assertTrue(
            _has(s, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 53 53\""),
            "the plain open tag must be byte-identical to what shipped"
        );
    }

    /// A year-zero canvas is 53 cells, so sixteen pixels a cell is 848.
    function test_theSizedRendererDeclaresCanvasTimesSixteen() public view {
        string memory s = sized.svg(_view(365));
        assertTrue(_has(s, "width=\"848\" height=\"848\""), "expected 53 x 16 = 848");
        assertTrue(_has(s, "viewBox=\"0 0 53 53\""), "the viewBox must be untouched");
    }

    /// The declared size has to track the canvas, which grows with year rings --
    /// a fixed number would stretch the art the moment a token completes a year.
    function test_theDeclaredSizeGrowsWithTheCanvas() public view {
        string memory s = sized.svg(_view(uint32(FrameGeometry.DAY_CELLS) * 10));
        assertTrue(_has(s, "viewBox=\"0 0 89 89\""), "ten rings should give an 89-cell canvas");
        assertTrue(_has(s, "width=\"1424\" height=\"1424\""), "expected 89 x 16 = 1424");
    }

    /// The experiment must change the header and nothing else. If the two images
    /// differ anywhere past the open tag, the variant is not measuring the
    /// intrinsic size -- it is measuring a second, accidental change.
    function test_nothingButTheOpenTagDiffers() public view {
        TokenView memory v = _view(200);
        bytes memory a = bytes(plain.svg(v));
        bytes memory b = bytes(sized.svg(v));

        // ` width="848" height="848"` is 25 characters.
        assertEq(b.length, a.length + 25, "only the intrinsic size should have been added");

        uint256 tail = a.length - 40;
        for (uint256 i = 1; i <= tail; ++i) {
            assertEq(a[a.length - i], b[b.length - i], "the images diverge after the open tag");
        }
    }

    /// Both must still be reachable through the interface the token calls.
    function test_bothRenderersProduceAParseableTokenUri() public view {
        TokenView memory v = _view(365);
        assertTrue(_has(plain.tokenURI(v), "data:application/json;utf-8,{\"name\":"), "plain");
        assertTrue(_has(sized.tokenURI(v), "data:application/json;utf-8,{\"name\":"), "sized");
    }
}
