// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy a new Renderer and point an EXISTING token contract at it.
/// @dev The renderer is the one part of the piece built to be replaced: the
/// token contract has no proxy and no upgrade path, and `setRenderer` is how
/// the picture changes without touching a token's record. Every token already
/// minted is drawn by the new renderer from the next `tokenURI` read.
///
/// First used 2026-09-26, when the digit band lost its row of air
/// (`DigitBand.MIN_BAND`) because the old band made every finished token fail
/// to decode at 350px.
///
/// REVERSIBLE: the owner can call `setRenderer` again with the old address.
///
///   forge script script/SwapRenderer.s.sol:SwapRenderer \
///     --sig "run(address)" <token-address> --rpc-url <rpc> [--broadcast]
contract SwapRenderer is MroScript {
    function run(address token) external {
        // FIRST, before anything is read or sent. See MroScript.
        guardChain();
        require(token != address(0), "token address required");

        uint256 ownerKey = deployerKey();
        MachineReadableOnly mro = MachineReadableOnly(token);
        require(vm.addr(ownerKey) == mro.owner(), "signer is not the contract owner");

        address before = mro.renderer();

        vm.startBroadcast(ownerKey);
        Renderer next = new Renderer();
        mro.setRenderer(address(next));
        vm.stopBroadcast();

        console.log("renderer was", before);
        console.log("renderer now", mro.renderer());
        require(mro.renderer() == address(next), "setRenderer did not take effect");
        require(address(next).code.length > 0, "the new renderer has no code");

        // One real read through the new renderer, so a swap that broke drawing
        // fails here rather than on the first viewer.
        string memory uri = mro.tokenURI(1);
        console.log("tokenURI(1) length", bytes(uri).length);
        require(bytes(uri).length > 0, "tokenURI(1) came back empty");
    }
}
