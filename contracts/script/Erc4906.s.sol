// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

import {MROSpikeToken} from "../src/spike/MROSpikeToken.sol";

/// @notice Moves one token to a visibly different state so an indexer's reaction
/// to `MetadataUpdate` can be watched end to end.
///
/// @dev This is the rehearsal for the sequence that has to be right on a real
/// marketplace: write, THEN emit the event with the exact token range, then ask
/// for a refresh. Getting the order wrong there means an indexer caches the
/// pre-write image and a redeploy is the only fix. `MROSpikeToken.setState`
/// already emits `MetadataUpdate(id)` after the write; this script exists so the
/// other half -- what a third party actually does about it -- can be measured
/// rather than assumed.
///
///   forge script script/Erc4906.s.sol:Erc4906 --sig "bump(address,uint256)" <token> <id> \
///     --rpc-url base_sepolia --broadcast
contract Erc4906 is Script {
    /// @notice Put token `id` into a state nothing else in the soak occupies, so
    /// a stale read is unmistakable rather than a judgement call.
    function bump(address token, uint256 id) external {
        vm.startBroadcast(vm.envUint("SPIKE_DEPLOYER_KEY"));

        MROSpikeToken t = MROSpikeToken(token);
        uint32 today = t.today();

        t.setState(id, MROSpikeToken.Token({
            level: 300,
            streak: 77,
            lastDay: today,
            mintDay: today - 300,
            generation: 0,
            seedsGiven: 0,
            resting: false,
            reserved: 0
        }));

        vm.stopBroadcast();
        console.log("token", id, "moved to level 300, streak 77");
    }
}
