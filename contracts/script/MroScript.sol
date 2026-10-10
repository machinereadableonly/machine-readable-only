// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";

/**
 * @notice The two things every broadcasting script in this project must settle
 *         before it sends a transaction: which chain it is on, and whose key is
 *         signing.
 *
 * WHY THIS EXISTS. Before it, the chain was chosen entirely by a command-line
 * flag. `--rpc-url base` and `--rpc-url base_sepolia` differ by seven
 * characters, both aliases are defined in foundry.toml, and nothing in any
 * script looked at `block.chainid` -- with one exception that sat inside an
 * `if` branch and was skipped whenever WARDEN_ADDRESS was set. Hard Rule 1 says
 * a mainnet deploy is permanent and cannot be moved, so a mistyped flag is not
 * a mistake anyone gets to correct.
 *
 * THE GUARD IS AN ENV VAR WITH NO DEFAULT, on purpose. A default is a value
 * nobody had to think about, and the whole point is that the operator states
 * the chain and the script refuses if reality disagrees. Two independent
 * statements have to line up -- EXPECTED_CHAIN_ID and --rpc-url -- and a typo
 * in either one is caught rather than executed.
 */
abstract contract MroScript is Script {
    uint256 internal constant BASE_MAINNET = 8453;
    uint256 internal constant BASE_SEPOLIA = 84532;

    /**
     * @notice Refuse to run unless the operator said which chain this is, and
     *         was right.
     *
     * Call it FIRST in run(), before any state is read and long before any
     * broadcast. A revert here costs nothing; a revert after a broadcast has
     * begun can leave a half-finished deploy on a permanent chain.
     */
    function guardChain() internal view {
        uint256 expected = vm.envUint("EXPECTED_CHAIN_ID");
        if (expected != block.chainid) {
            console.log("EXPECTED_CHAIN_ID", expected);
            console.log("actual block.chainid", block.chainid);
        }
        require(
            expected == block.chainid,
            "EXPECTED_CHAIN_ID does not match the chain this RPC is on -- check --rpc-url"
        );
    }

    /// @notice Whether this script may sign on Base mainnet. Only the scripts
    /// written for it say yes; every other one is testnet-only.
    function mainnetAllowed() internal pure virtual returns (bool) {
        return false;
    }

    /**
     * @notice The key that will sign, chosen by the chain rather than by habit.
     *
     * On Base mainnet the deployer owns the piece from the constructor until
     * the Safe accepts the ownership DeployPlan5 offers it, and it signs the
     * owner-only setup in between. SPIKE_DEPLOYER_KEY is a throwaway that has
     * signed every testnet run, so mainnet reads a DIFFERENT variable and
     * refuses if it holds the same value.
     */
    function deployerKey() internal view returns (uint256 key) {
        if (block.chainid == BASE_MAINNET) {
            require(mainnetAllowed(), "this script is testnet-only: it must never sign on Base mainnet");
            key = vm.envUint("MAINNET_DEPLOYER_KEY");
            uint256 throwaway = vm.envOr("SPIKE_DEPLOYER_KEY", uint256(0));
            // UNSET IS CHECKED FIRST, and the order is the whole point. With
            // the throwaway comparison first, a zero MAINNET_DEPLOYER_KEY and
            // an unset SPIKE_DEPLOYER_KEY (envOr returns 0) compared equal, so
            // the gate before a permanent mainnet owner reported "it is the
            // throwaway spike key" about a key that was simply never set.
            require(key != 0, "MAINNET_DEPLOYER_KEY must be set");
            require(
                key != throwaway,
                "MAINNET_DEPLOYER_KEY is the throwaway spike key -- it would own the mainnet deploy"
            );
            console.log("signing with MAINNET_DEPLOYER_KEY", vm.addr(key));
        } else {
            key = vm.envUint("SPIKE_DEPLOYER_KEY");
        }
    }

    /// @notice Who signs: on Base mainnet a hardware wallet when
    /// MAINNET_DEPLOYER_ADDRESS is set (`key` 0; forge --ledger signs for it),
    /// otherwise the key from `deployerKey`.
    function deployer() internal view returns (address who, uint256 key) {
        address hardware = vm.envOr("MAINNET_DEPLOYER_ADDRESS", address(0));
        if (block.chainid == BASE_MAINNET && hardware != address(0)) {
            return hardwareDeployer(hardware, vm.envOr("MAINNET_DEPLOYER_KEY", uint256(0)));
        }
        key = deployerKey();
        who = vm.addr(key);
    }

    /// @notice The hardware-wallet case of `deployer`, refusing a key set beside it.
    function hardwareDeployer(address hardware, uint256 strayKey) internal view returns (address, uint256) {
        require(mainnetAllowed(), "this script is testnet-only: it must never sign on Base mainnet");
        require(strayKey == 0, "set MAINNET_DEPLOYER_ADDRESS or MAINNET_DEPLOYER_KEY, not both");
        console.log("signing with the hardware wallet", hardware);
        return (hardware, 0);
    }

    /// @notice Start the broadcast as `deployer` returned it.
    function startBroadcastAs(address who, uint256 key) internal {
        if (key == 0) vm.startBroadcast(who);
        else vm.startBroadcast(key);
    }
}
