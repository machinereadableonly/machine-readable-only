// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Base64} from "solady/src/utils/Base64.sol";
import {LibString} from "solady/src/utils/LibString.sol";

import {Renderer} from "./Renderer.sol";
import {MarkRenderer} from "./MarkRenderer.sol";
import {TokenView} from "./TokenView.sol";

/// @notice The Pulse Mark: a costed variant, NOT the shipped renderer.
///
/// @dev Pulse is the one Mark in the seven-rung ladder that the spike never
/// built. The spec asks for an `animation_url` carrying an HTML page in which
/// the heart's opacity breathes at about 60 bpm, and every prior task recorded
/// the same sentence -- "unbudgeted and unbuilt, it roughly doubles tokenURI
/// bytes". This contract exists to replace that adjective with two numbers.
///
/// IT IS A VARIANT ON PURPOSE. `Renderer` is untouched, so every existing
/// fixture stays byte-identical while this is being judged. If Pulse is
/// adopted, the override folds into `Renderer`; if it is not, this file is
/// deleted and nothing else moves.
///
/// WHY HTML AND NOT SVG. Verified against OpenSea's live media documentation on
/// 2026-08-29: `animation_url` supports GLTF, GLB, WEBM, MP4, M4V, OGV, OGG,
/// MP3, WAV and OGA, "or it can point to an HTML page". SVG is supported for
/// `image` only. An `animation_url` holding an SVG data URI would therefore be
/// a format the marketplace does not claim to render, so the cheap-looking
/// option is not a workable one.
/// <https://docs.opensea.io/docs/media-and-traits>
///
/// WHERE THE SAVING COMES FROM. The obvious implementation renders the image
/// twice -- once for `image`, once inside the HTML -- and `svg()` is the
/// expensive half of `tokenURI`. This renders it ONCE and spends the second
/// copy only on encoding. That is the difference between a variant that busts
/// the gas ceiling and one that does not, and it is why the measurement is
/// worth taking rather than estimating.
contract RendererPulse is Renderer {
    /// @dev The animation, as a CSS rule over the inlined SVG.
    ///
    /// It targets the LAST path in the document rather than an id, because the
    /// draw order is fixed and asserted (ghost, frame, noise, heart), so the
    /// heart is always last. The alternative -- giving the heart path an id --
    /// would put bytes on EVERY token to serve the one Mark that uses them.
    ///
    /// 0.55 is the spec's floor and 1s the spec's period, about 60 bpm. The
    /// animation touches `fill-opacity` only; nothing moves, so a rasteriser
    /// that samples a frame gets the artwork at a lighter ink rather than a
    /// displaced one.
    string internal constant STYLE =
        "<style>body{margin:0;background:#fff}svg{width:100vmin;height:100vmin;display:block;margin:auto}"
        "path:last-of-type{animation:b 1s ease-in-out infinite}"
        "@keyframes b{0%,100%{fill-opacity:1}50%{fill-opacity:.55}}</style>";

    /// @inheritdoc Renderer
    function tokenURI(TokenView memory v) external pure override returns (string memory) {
        // Rendered once and reused. `svg()` dominates this call's gas, so the
        // second copy must never be a second render.
        string memory image = svg(v);

        return string(
            abi.encodePacked(
                "data:application/json;utf-8,",
                '{"name":"', NAME, " %23", LibString.toString(v.tokenId), _suffix(v),
                '","description":"', DESCRIPTION,
                '","image":"data:image/svg+xml;base64,', Base64.encode(bytes(image)),
                '"', _animation(v.marks, image),
                ',"attributes":[', _attributes(v), "]}"
            )
        );
    }

    /// @dev The whole cost of Pulse, and nothing when the Mark is absent.
    ///
    /// Emitted as a leading comma so an unmarked token's JSON is byte-identical
    /// to the shipped renderer's -- the variant must differ in ONE thing, or the
    /// measurement is of two changes at once.
    function _animation(uint256 marks, string memory image) private pure returns (string memory) {
        if (marks & MarkRenderer.PULSE == 0) return "";
        return string(
            abi.encodePacked(
                ',"animation_url":"data:text/html;base64,',
                Base64.encode(abi.encodePacked("<!doctype html><meta charset=utf-8>", STYLE, image)),
                '"'
            )
        );
    }
}
