// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Renderer} from "./Renderer.sol";

/// @notice The renderer with no intrinsic pixel size on the SVG -- the control.
///
/// @dev A test and spike fixture, never deployed to mainnet. A third party's CDN
/// rasterises an unsized SVG at its viewBox units -- one pixel per module -- then
/// interpolates up, and most of those resizes stop decoding; `Renderer` declares
/// a size to stop that. Deploying this beside it re-runs the comparison with one
/// variable moved.
contract RendererUnsized is Renderer {
    function pxPerCell() internal pure override returns (uint256) {
        return 0;
    }
}
