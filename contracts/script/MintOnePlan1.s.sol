// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {SpikeBitmaps} from "./SpikeBitmaps.sol";

/// @notice Verification-only helper for Task 9 Step 5: mint token 1 on the
/// deployed Plan 1 contract so tokenURI can be read back over RPC.
/// @dev Not part of the Plan 1 deliverable. It exists only to put one real
/// token on a deployed contract so its tokenURI can be read back through a
/// real provider rather than through Foundry. Kept because that read-back is
/// worth repeating after every redeploy. It reuses
/// SpikeBitmaps.code(1), which encodes https://example.com/t/1#, because
/// MRO_DOMAIN is still example.com (the real domain is undecided) and
/// CODE_BYTES (172) matches SpikeBitmaps.BYTES.
///
///   forge script script/MintOnePlan1.s.sol:MintOnePlan1 \
///     --sig "run(address)" <token-address> --rpc-url base_sepolia --broadcast
contract MintOnePlan1 is MroScript {
    function run(address token) external {
        // FIRST, before anything is read or sent: the operator has to have
        // stated which chain this is, and been right. See MroScript.
        guardChain();
        uint256 key = deployerKey();
        address to = vm.addr(key);

        vm.startBroadcast(key);
        MachineReadableOnly(token).mint(1, to, bytes32(uint256(0xa9e1)), SpikeBitmaps.code(1), uint32(block.timestamp / 1 days));
        vm.stopBroadcast();

        console.log("minted token 1 to", to);
    }
}
