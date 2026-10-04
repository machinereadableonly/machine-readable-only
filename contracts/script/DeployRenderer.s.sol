// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy a new Renderer and draw token 1 through it. Pointing the token
/// at it is the owner's call, made through the Safe: see swap-renderer.sh.
contract DeployRenderer is MroScript {
    function run(address token) external returns (Renderer next) {
        // FIRST, before anything is read or sent. See MroScript.
        guardChain();
        MachineReadableOnly mro = MachineReadableOnly(token);
        vm.startBroadcast(deployerKey());
        next = new Renderer();
        vm.stopBroadcast();
        require(address(next).code.length > 0, "the new renderer has no code");
        console.log("renderer", address(next));

        // A renderer that cannot draw must fail here, before the Safe points
        // every token at it. tokenURI(1) is unreadable on an empty collection.
        if (mro.totalMinted() == 0) {
            console.log("no token minted yet; skipping the tokenURI read");
        } else {
            uint256 len = bytes(next.tokenURI(mro.viewOf(1))).length;
            console.log("tokenURI(1) through the new renderer, length", len);
            require(len > 0, "the new renderer drew token 1 as nothing");
        }
    }
}
