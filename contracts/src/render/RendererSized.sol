// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Renderer} from "./Renderer.sol";

/// @notice The renderer with an intrinsic pixel size declared on the SVG.
///
/// @dev EXPERIMENTAL, and deployed only alongside the plain `Renderer` so the
/// two can be measured against each other on Base Sepolia. It exists to settle
/// one question with a number instead of an argument: does declaring
/// `width`/`height` stop a third-party CDN interpolating the artwork into
/// something that will not decode?
///
/// The evidence that prompted it, measured 2026-08-29 in
/// docs/2026-08-29-mro-third-party-raster-finding.md: Alchemy's CDN rasterised
/// the unsized SVG at 53 pixels -- its viewBox units -- and upscaled that bitmap
/// to the requested width, producing 170 to 205 grey levels where the artwork
/// has 3, and failing to decode in 41% of constructed resizes.
///
/// SIXTEEN is the multiplier because it is the one this project already uses as
/// its "exact multiple" control everywhere else (`canvasFor(years) * 16` in the
/// offline sweeps), and because it puts a year-zero token at 848px and a
/// ten-ring token at 1,424px -- both comfortably above the sizes third parties
/// ask for, so their scaling is a downscale rather than an upscale.
contract RendererSized is Renderer {
    function pxPerCell() internal pure override returns (uint256) {
        return 16;
    }
}
