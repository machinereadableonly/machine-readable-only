// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {console} from "forge-std/Script.sol";
import {MroScript} from "../MroScript.sol";
import {Ladder} from "../../src/Ladder.sol";
import {MachineReadableOnly} from "../../src/MachineReadableOnly.sol";
import {Renderer} from "../../src/render/Renderer.sol";
import {MachineReadableOnlyFast} from "./MachineReadableOnlyFast.sol";

/// @notice Deploy the TEST-ONLY fast-days pair to Base Sepolia and write the
/// ten Marks. The same three steps as DeployPlan5, with the fast token.
/// @dev Base Sepolia or nothing: guardChain() checks the operator's stated
/// chain, and the require below refuses every other chain outright, whatever
/// was stated -- this contract must never exist anywhere else.
contract DeployFast is MroScript {
    function run() external {
        guardChain();
        require(block.chainid == BASE_SEPOLIA, "the fast-days copy is Base Sepolia only");
        address warden = vm.envAddress("WARDEN_ADDRESS");
        uint256 key = deployerKey();
        vm.startBroadcast(key);
        Renderer r = new Renderer();
        MachineReadableOnlyFast t = new MachineReadableOnlyFast(address(r), warden);
        MachineReadableOnly.Upgrade[11] memory u = Ladder.all();
        for (uint8 i = 1; i <= 10; i++) t.setUpgrade(i, u[i]);
        vm.stopBroadcast();
        console.log("renderer", address(r));
        console.log("token   ", address(t));
    }
}
