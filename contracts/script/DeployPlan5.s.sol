// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";
import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy the pair, write the ladder and fix the split anchor, in one broadcast.
contract DeployPlan5 is MroScript {
    function run() external returns (Renderer r, MachineReadableOnly t) {
        // First, before anything is read or sent. See MroScript.
        guardChain();
        // No fallback: only setWarden can correct a wrong value afterwards.
        address warden = vm.envAddress("WARDEN_ADDRESS");
        // A bare startBroadcast() has no sender, and forge refuses it only after the simulation passes.
        uint256 key = deployerKey();
        // The Warden signs no owner call and the owner signs no Warden call.
        require(warden != vm.addr(key), "WARDEN_ADDRESS must not be the deployer");
        // Set in the same broadcast so no deployed contract is ever without its anchor.
        bytes32 anchor = vm.envOr("SPLIT_ANCHOR", bytes32(0));
        require(anchor != bytes32(0), "SPLIT_ANCHOR must be set: run warden/tools/split-seed.mjs first");
        vm.startBroadcast(key);
        r = new Renderer();
        t = new MachineReadableOnly(address(r), warden);
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        for (uint8 i = 1; i <= 15; i++) t.setUpgrade(i, u[i]);
        t.setSplitAnchor(anchor);
        vm.stopBroadcast();
        console.log("renderer", address(r));
        console.log("token   ", address(t));
        console.log("anchor  ");
        console.logBytes32(anchor);
    }
}
