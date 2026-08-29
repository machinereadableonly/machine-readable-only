// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TokenView} from "./TokenView.sol";

/// @notice The one call the token contract makes to draw a token.
/// @dev Deliberately the whole surface. The renderer is swappable -- the token
/// contract holds an address behind this interface -- so keeping it to a single
/// pure-ish function is what makes a replacement safe to drop in. Everything the
/// renderer needs arrives in `TokenView`; it reads no storage of its own, so two
/// renderers given the same view must produce the same image.
interface IRenderer {
    function tokenURI(TokenView memory v) external view returns (string memory);
}
