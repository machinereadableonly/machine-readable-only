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
        vm.startBroadcast();
        Renderer r = new Renderer();
        MachineReadableOnly t = new MachineReadableOnly(address(r), warden);
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 i = 1; i <= 10; i++) t.setUpgrade(i, u[i]);
        vm.stopBroadcast();
        console.log("renderer", address(r));
        console.log("token   ", address(t));
    }
}
