// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy the pair and write all ten Marks. Modelled on DeployPlan1.s.sol.
contract DeployPlan5 is Script {
    function run() external {
        address warden = vm.envAddress("WARDEN_ADDRESS");
        // THE DEPLOYER KEY, the same way DeployPlan1 and DeploySpike take it.
        // A bare startBroadcast() has no sender, so forge refuses the broadcast
        // with "You seem to be using Foundry's default sender" -- after the
        // simulation has passed, which is exactly late enough to look like a
        // wallet problem rather than a script one. Found on the first real run,
        // 2026-09-03; this script was written at Task 3 and never executed.
        //
        // No WARDEN_ADDRESS fallback here, deliberately, unlike DeployPlan1:
        // only setWarden can correct a wrong value afterwards, and this
        // contract is meant to outlive the person running the script.
        uint256 key = vm.envUint("SPIKE_DEPLOYER_KEY");
        vm.startBroadcast(key);
        Renderer r = new Renderer();
        MachineReadableOnly t = new MachineReadableOnly(address(r), warden);
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 i = 1; i <= 10; i++) t.setUpgrade(i, u[i]);
        vm.stopBroadcast();
        console.log("renderer", address(r));
        console.log("token   ", address(t));
    }
}
