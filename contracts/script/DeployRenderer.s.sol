// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";

import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy a new Renderer. Pointing the token at it is the owner's call,
/// made through the Safe: see swap-renderer.sh.
contract DeployRenderer is MroScript {
    function run() external returns (Renderer next) {
        // FIRST, before anything is read or sent. See MroScript.
        guardChain();
        vm.startBroadcast(deployerKey());
        next = new Renderer();
        vm.stopBroadcast();
        require(address(next).code.length > 0, "the new renderer has no code");
        console.log("renderer", address(next));
    }
}
