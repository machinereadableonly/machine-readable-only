// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy the real token contract plus a renderer to Base Sepolia.
/// @dev The Warden address is read from WARDEN_ADDRESS when it is set, because
/// a contract deployed with the wrong Warden cannot be fixed by anything except
/// setWarden, and getting it right at deploy time is free. WARDEN_ADDRESS is
/// not in the project's secrets schema yet and has never been set, so this
/// script falls back to the deployer's own address for a testnet smoke deploy,
/// where the deployer acting as Warden is fine. A real deployment must set
/// WARDEN_ADDRESS explicitly rather than rely on this fallback.
contract DeployPlan1 is Script {
    function run() external {
        uint256 key = vm.envUint("SPIKE_DEPLOYER_KEY");
        address warden = vm.envOr("WARDEN_ADDRESS", address(0));

        if (warden == address(0)) {
            // Base Sepolia only. On any other chain a missing WARDEN_ADDRESS
            // must fail loudly rather than silently hand the hot deploy key
            // permanent mint, mark and seed authority over a permanent
            // contract that has no upgrade path.
            require(block.chainid == 84532, "WARDEN_ADDRESS must be set outside Base Sepolia");
            warden = vm.addr(key);
            console.log("warden (defaulted to deployer)", warden);
        } else {
            console.log("warden (from env)             ", warden);
        }

        vm.startBroadcast(key);
        Renderer r = new Renderer();
        MachineReadableOnly t = new MachineReadableOnly(address(r), warden);
        vm.stopBroadcast();

        console.log("Renderer            ", address(r));
        console.log("MachineReadableOnly ", address(t));
        console.log("warden              ", warden);
    }
}
