// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";

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
contract Erc4906 is MroScript {
    /// @notice Put token `id` into a state nothing else in the soak occupies, so
    /// a stale read is unmistakable rather than a judgement call.
    function bump(address token, uint256 id) external {
        // Guarded like every other entry point: this one has no run(), it is
        // invoked by --sig, and a --sig call is exactly as capable of landing
        // on the wrong chain as a run() is.
        guardChain();
        vm.startBroadcast(deployerKey());

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

    /// @notice Move token `id` to an ARBITRARY level, so the refresh question can
    /// be asked more than once on the same throwaway token.
    ///
    /// @dev `bump` hardcodes level 300, which is single-use: once a token sits
    /// there, a second test cannot tell a successful refresh from a cache that
    /// never moved. Isolating WHICH refresh call works needs a fresh distinct
    /// state each round, and re-using the already-sacrificed token keeps the
    /// adopted contract's soak fixtures intact.
    function bumpTo(address token, uint256 id, uint32 level, uint32 streak) external {
        // Guarded like every other entry point: this one has no run(), it is
        // invoked by --sig, and a --sig call is exactly as capable of landing
        // on the wrong chain as a run() is.
        guardChain();
        vm.startBroadcast(deployerKey());

        MROSpikeToken t = MROSpikeToken(token);
        uint32 today = t.today();

        t.setState(id, MROSpikeToken.Token({
            level: level,
            streak: streak,
            lastDay: today,
            mintDay: today - level,
            generation: 0,
            seedsGiven: 0,
            resting: false,
            reserved: 0
        }));

        vm.stopBroadcast();
        console.log("token", id, "moved to level", level);
    }
}
