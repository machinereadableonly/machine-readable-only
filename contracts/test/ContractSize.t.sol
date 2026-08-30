// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test, console} from "forge-std/Test.sol";

/// @notice The project's deployability rule, first half: nothing is called done
/// until its runtime bytecode is measured against the EIP-170 limit with a
/// positive margin.
///
/// @dev The second half is script/anvil-size-check.sh, and it is not optional.
/// Foundry's test EVM does not enforce the code-size cap, so a contract that
/// this file happily passes can still be rejected by a real chain. Measuring
/// here catches the number; deploying there catches the rule.
contract ContractSizeTest is Test {
    /// @dev EIP-170. Base inherits it from Ethereum unchanged.
    uint256 constant LIMIT = 24_576;

    function _check(string memory artifact) internal returns (uint256 size) {
        size = vm.getDeployedCode(artifact).length;
        console.log(artifact);
        console.log("  runtime bytes", size);
        console.log("  margin       ", LIMIT - size);
        assertGt(size, 0, string.concat(artifact, " has no runtime code at all"));
        assertLt(size, LIMIT, string.concat(artifact, " exceeds the EIP-170 limit"));
    }

    function test_everyDeployedContractFitsWithMargin() public {
        uint256 renderer = _check("Renderer.sol:Renderer");
        uint256 spike = _check("MROSpikeToken.sol:MROSpikeToken");
        uint256 real = _check("MachineReadableOnly.sol:MachineReadableOnly");

        // Both land on the same chain, so the pair is worth logging even though
        // the limit is per contract, not per deployment.
        console.log("pair total", renderer + real);
        spike; // the spike is still measured while it exists
    }
}
