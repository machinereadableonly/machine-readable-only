// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Renderer} from "./Renderer.sol";

/// @notice The renderer with no intrinsic pixel size on the SVG -- the control.
///
/// @dev This is what shipped before 2026-08-29, kept so the decision that
/// replaced it can be re-measured rather than taken on trust. It is a test and
/// spike fixture; it is not deployed to mainnet.
///
/// The measurement it exists to reproduce, from
/// docs/2026-08-29-mro-third-party-raster-finding.md: pointed at Alchemy's NFT
/// API, the unsized build failed 30 of 56 constructed resizes against the sized
/// build's 2, because their CDN rasterised at the viewBox units and interpolated
/// up. If a CDN ever changes how it treats an intrinsic size, deploying this
/// alongside `Renderer` re-runs that comparison with one variable moved.
contract RendererUnsized is Renderer {
    function pxPerCell() internal pure override returns (uint256) {
        return 0;
    }
}
