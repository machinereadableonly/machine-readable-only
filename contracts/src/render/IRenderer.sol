// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TokenView} from "./TokenView.sol";

/// @notice The one call the token contract makes to draw a token.
/// @dev Deliberately the whole surface: the token contract holds a swappable
/// address behind this interface, and one function is what makes a replacement
/// safe to drop in. Everything a renderer needs arrives in `TokenView` and it
/// reads no storage of its own, so two renderers given the same view must
/// produce the same image.
interface IRenderer {
    function tokenURI(TokenView memory v) external view returns (string memory);
}
