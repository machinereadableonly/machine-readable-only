// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";

import {Renderer} from "../src/render/Renderer.sol";
import {RendererUnsized} from "../src/render/RendererUnsized.sol";
import {FrameGeometry} from "../src/render/FrameGeometry.sol";
import {TokenView} from "../src/render/TokenView.sol";

/// @notice The intrinsic pixel size the SVG declares, and what it must not touch.
///
/// @dev Adopted 2026-08-29 on a measured A/B against Alchemy's NFT API: the
/// unsized build failed 30 of 56 constructed third-party resizes, the sized
/// build 2. See docs/2026-08-29-mro-third-party-raster-finding.md.
///
/// `RendererUnsized` is the control that experiment used, kept so the comparison
/// can be re-run. These tests pin that the only difference between the two is
/// the `width`/`height` attribute -- if anything else ever diverges, the A/B was
/// measuring two changes rather than one.
contract RendererSizedTest is Test {
    Renderer shipped;
    RendererUnsized control;

    /// @dev Token 1 on example.com, the same bitmap the other render tests use.
    function _bitmap() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    function setUp() public {
        shipped = new Renderer();
        control = new RendererUnsized();
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

    /// A year-zero canvas is 53 cells, so sixteen pixels a cell is 848. This is
    /// the number a third-party rasteriser reads instead of falling back to the
    /// viewBox units, which is the whole point of declaring it.
    function test_theShippedRendererDeclaresCanvasTimesSixteen() public view {
        string memory s = shipped.svg(_view(365));
        assertTrue(_has(s, "width=\"848\" height=\"848\""), "expected 53 x 16 = 848");
        assertTrue(_has(s, "viewBox=\"0 0 53 53\""), "the viewBox must be untouched");
    }

    /// The declared size has to track the canvas, which grows with year rings --
    /// a fixed number would stretch the art the moment a token completes a year.
    function test_theDeclaredSizeGrowsWithTheCanvas() public view {
        string memory s = shipped.svg(_view(uint32(FrameGeometry.DAY_CELLS) * 10));
        assertTrue(_has(s, "viewBox=\"0 0 89 89\""), "ten rings should give an 89-cell canvas");
        assertTrue(_has(s, "width=\"1424\" height=\"1424\""), "expected 89 x 16 = 1424");
    }

    /// The control must stay what shipped before, or re-running the A/B measures
    /// something other than the intrinsic size.
    function test_theControlDeclaresNoIntrinsicSize() public view {
        string memory s = control.svg(_view(365));
        assertFalse(_has(s, "width=\"8"), "the control must not declare a width in pixels");
        assertTrue(
            _has(s, "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 53 53\""),
            "the control's open tag must be the pre-2026-08-29 bytes"
        );
    }

    /// The size must change the header and nothing else. Anything diverging past
    /// the open tag means the two builds differ in a second, accidental way.
    function test_nothingButTheOpenTagDiffers() public view {
        TokenView memory v = _view(200);
        bytes memory a = bytes(control.svg(v));
        bytes memory b = bytes(shipped.svg(v));

        // ` width="848" height="848"` is 25 characters.
        assertEq(b.length, a.length + 25, "only the intrinsic size should differ");

        uint256 tail = a.length - 40;
        for (uint256 i = 1; i <= tail; ++i) {
            assertEq(a[a.length - i], b[b.length - i], "the images diverge after the open tag");
        }
    }

    /// Both must still be reachable through the interface the token calls.
    function test_bothRenderersProduceAParseableTokenUri() public view {
        TokenView memory v = _view(365);
        assertTrue(_has(shipped.tokenURI(v), "data:application/json;utf-8,{\"name\":"), "shipped");
        assertTrue(_has(control.tokenURI(v), "data:application/json;utf-8,{\"name\":"), "control");
    }
}
