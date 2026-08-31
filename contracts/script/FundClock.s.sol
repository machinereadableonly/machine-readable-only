// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

/// @notice Send the Clock's signer its gas float.
/// @dev Plan 3, Task 1, step 2. The Clock holds ETH for gas and nothing else:
/// it is not the contract owner and it never receives USDC, which goes to
/// TREASURY_ADDRESS and has no key on this box at all.
///
/// A Foundry script rather than `cast send` for one practical reason: forge
/// loads the project's environment file itself, so the deployer's key is read
/// straight from disk into the broadcast and is never a shell variable, a
/// command-line argument, or anything a session transcript could capture.
///
/// Sizing, measured on Base Sepolia 2026-08-31 at the 0.006 gwei floor:
///   mint            322,601 gas  ~= 0.0000019 ETH
///   batchCheckIn    up to 15M    ~= 0.00009 ETH per full chunk
/// 0.01 ETH is therefore thousands of runs. It is testnet ETH; the point is to
/// not have to come back for it mid-rehearsal.
///
///   forge script script/FundClock.s.sol:FundClock \
///     --sig "run(address)" <clock-address> \
///     --rpc-url base_sepolia --broadcast
contract FundClock is Script {
    uint256 constant FLOAT = 0.01 ether;

    function run(address clock) external {
        require(clock != address(0), "clock address required");

        uint256 deployerKey = vm.envUint("SPIKE_DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        uint256 clockBefore = clock.balance;
        require(deployer.balance > FLOAT, "deployer cannot cover the float and its own gas");

        vm.startBroadcast(deployerKey);
        // A plain value transfer. The Clock is an EOA, so there is no call data
        // and nothing to revert into.
        (bool ok,) = clock.call{value: FLOAT}("");
        require(ok, "transfer failed");
        vm.stopBroadcast();

        console.log("clock balance was", clockBefore);
        console.log("clock balance now", clock.balance);
        console.log("deployer left    ", deployer.balance);
    }
}
