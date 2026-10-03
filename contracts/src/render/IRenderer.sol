// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TokenView} from "./TokenView.sol";

/// @notice Two calls: one token's image and metadata, and the collection's.
/// @dev Everything a renderer needs arrives in `TokenView` and it reads no
/// storage of its own, so two renderers given the same view must produce the
/// same image.
interface IRenderer {
    function tokenURI(TokenView memory v) external view returns (string memory);
    function contractURI() external view returns (string memory);
}
