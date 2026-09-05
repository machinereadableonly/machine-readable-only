// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {MroScript} from "./MroScript.sol";

import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";

/// @notice Point the contract's `warden` at the Clock's dedicated key.
/// @dev Plan 3, Task 1. The contract deployed on 2026-08-30 has `warden` and
/// `owner` set to the SAME address -- the deployer. `onlyWarden` gates mint,
/// batchCheckIn, applyMark and seed; `onlyOwner` gates setRenderer, setWarden,
/// setSunset, pause and ownership transfer. A Clock signing with that one key
/// could therefore close the piece permanently, which is not a power a daily
/// cron job should hold.
///
/// After this runs the Clock holds warden powers and a gas balance, nothing
/// more. The owner key stays where it is and is not on the Clock's path.
///
/// REVERSIBLE: the owner can call setWarden again at any time, so a lost or
/// rotated Clock key is recoverable. That is also why the Clock must never be
/// the owner -- an owner key lost to a compromised cron job is not.
///
/// The contract refuses address(0) (ZeroWarden), so a missing environment
/// variable fails on chain rather than silently disabling every write.
///
///   forge script script/SetClockWarden.s.sol:SetClockWarden \
///     --sig "run(address,address)" <token-address> <clock-address> \
///     --rpc-url base_sepolia --broadcast
contract SetClockWarden is MroScript {
    function run(address token, address clock) external {
        // FIRST, before anything is read or sent: the operator has to have
        // stated which chain this is, and been right. See MroScript.
        guardChain();
        require(clock != address(0), "clock address required");

        uint256 ownerKey = deployerKey();
        MachineReadableOnly mro = MachineReadableOnly(token);

        address ownerBefore = mro.owner();
        address wardenBefore = mro.warden();
        require(vm.addr(ownerKey) == ownerBefore, "signer is not the contract owner");

        vm.startBroadcast(ownerKey);
        mro.setWarden(clock);
        vm.stopBroadcast();

        console.log("warden was ", wardenBefore);
        console.log("warden now ", mro.warden());
        console.log("owner still", mro.owner());

        // The whole point of the change: the two must now differ.
        require(mro.warden() == clock, "setWarden did not take effect");
        require(mro.owner() == ownerBefore, "owner must not have changed");
        require(mro.warden() != mro.owner(), "warden and owner must be separate");
    }
}
