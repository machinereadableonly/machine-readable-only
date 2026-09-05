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

    /**
     * @notice The key that will sign, chosen by the chain rather than by habit.
     *
     * On Base mainnet the deployer becomes the PERMANENT OWNER of the piece:
     * `Ownable(msg.sender)` in the constructor, `renounceOwnership` reverts, and
     * the owner powers are setRenderer, setWarden, setSunset, pause and
     * setUpgrade. SPIKE_DEPLOYER_KEY is described in .env.example as a throwaway
     * generated for the rendering spike, and it has signed every testnet
     * deploy, soak and rehearsal since 2026-08-29. It is not a key whose
     * handling has ever been owner-grade, and there was no separate variable to
     * make anyone stop and think about that.
     *
     * So mainnet reads a DIFFERENT variable, and refuses if it holds the same
     * value as the throwaway. Prefer a hardware wallet or a Safe over either
     * (`--ledger`), and transfer ownership to a multisig once deployed --
     * Ownable2Step is in use, so that handover is two steps and recoverable.
     */
    function deployerKey() internal view returns (uint256 key) {
        if (block.chainid == BASE_MAINNET) {
            key = vm.envUint("MAINNET_DEPLOYER_KEY");
            uint256 throwaway = vm.envOr("SPIKE_DEPLOYER_KEY", uint256(0));
            require(
                key != throwaway,
                "MAINNET_DEPLOYER_KEY is the throwaway spike key -- it would become the permanent owner"
            );
            require(key != 0, "MAINNET_DEPLOYER_KEY must be set");
            console.log("signing with MAINNET_DEPLOYER_KEY", vm.addr(key));
        } else {
            key = vm.envUint("SPIKE_DEPLOYER_KEY");
        }
    }
}
