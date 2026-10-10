// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";
import {Ladder} from "../src/Ladder.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice Deploy the pair, write the ladder and fix the split anchor, in one broadcast.
contract DeployPlan5 is MroScript {
    /// @notice Deploy with the deployer as owner. Refused on Base mainnet.
    function mainnetAllowed() internal pure override returns (bool) {
        return true;
    }

    function run() external returns (Renderer r, MachineReadableOnly t) {
        return deploy(address(0));
    }

    /// @notice Deploy and, as the broadcast's last call, offer ownership to
    /// `owner`, which must be the Safe. The deployer stays owner until the
    /// Safe calls acceptOwnership.
    function run(address owner) external returns (Renderer r, MachineReadableOnly t) {
        return deploy(owner);
    }

    function requireAnchor(bytes32 anchor) public pure returns (bytes32) {
        require(anchor != bytes32(0), "SPLIT_ANCHOR must be set: run warden/tools/split-seed.mjs first");
        return anchor;
    }

    function deploy(address owner) internal returns (Renderer r, MachineReadableOnly t) {
        require(owner != address(0) || block.chainid != 8453, "Base mainnet needs an owner: run(address) with the Safe");
        // First, before anything is read or sent. See MroScript.
        guardChain();
        // No fallback: only setWarden can correct a wrong value afterwards.
        address warden = vm.envAddress("WARDEN_ADDRESS");
        if (owner != address(0)) {
            // A Safe is a contract, so an address with no code is a typo or an EOA.
            require(owner.code.length > 0, "the owner has no code: it must be the deployed Safe");
            require(owner != warden, "the owner must not be the warden");
        }
        // A bare startBroadcast() has no sender, and forge refuses it only after the simulation passes.
        (address deployerAddress, uint256 key) = deployer();
        // The Warden signs no owner call and the owner signs no Warden call.
        require(warden != deployerAddress, "WARDEN_ADDRESS must not be the deployer");
        // Set in the same broadcast so no deployed contract is ever without its anchor.
        bytes32 anchor = requireAnchor(vm.envOr("SPLIT_ANCHOR", bytes32(0)));
        startBroadcastAs(deployerAddress, key);
        r = new Renderer();
        t = new MachineReadableOnly(address(r), warden);
        MachineReadableOnly.Upgrade[16] memory u = Ladder.all();
        for (uint8 i = 1; i <= 15; i++) t.setUpgrade(i, u[i]);
        t.setSplitAnchor(anchor);
        // Last: setUpgrade and setSplitAnchor above are owner-only.
        if (owner != address(0)) t.transferOwnership(owner);
        vm.stopBroadcast();
        console.log("renderer", address(r));
        console.log("token   ", address(t));
        console.log("anchor  ");
        console.logBytes32(anchor);
        if (owner != address(0)) console.log("pending owner", owner);
    }
}
