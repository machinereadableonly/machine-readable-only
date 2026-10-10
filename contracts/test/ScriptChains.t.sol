// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MroScript} from "../script/MroScript.sol";
import {DeployPlan1} from "../script/DeployPlan1.s.sol";

contract TestnetOnlyHarness is MroScript {
    function key() external view returns (uint256) {
        return deployerKey();
    }

    function signer() external view returns (address who, uint256 k) {
        return deployer();
    }

    function hardware(address a, uint256 stray) external view returns (address who, uint256 k) {
        return hardwareDeployer(a, stray);
    }
}

contract MainnetHarness is MroScript {
    function key() external view returns (uint256) {
        return deployerKey();
    }

    function signer() external view returns (address who, uint256 k) {
        return deployer();
    }

    function hardware(address a, uint256 stray) external view returns (address who, uint256 k) {
        return hardwareDeployer(a, stray);
    }

    function mainnetAllowed() internal pure override returns (bool) {
        return true;
    }
}

/// A script written for testnet must never sign on Base mainnet with the key
/// that owns the piece until the Safe accepts.
contract ScriptChainsTest is Test {
    // Anvil's published accounts 0 and 1.
    uint256 constant SPIKE = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant MAINNET = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address constant LEDGER = address(0x1ED6E5);

    function setUp() public {
        vm.chainId(8453);
        vm.setEnv("EXPECTED_CHAIN_ID", "8453");
        vm.setEnv("SPIKE_DEPLOYER_KEY", vm.toString(SPIKE));
        vm.setEnv("MAINNET_DEPLOYER_KEY", vm.toString(MAINNET));
    }

    function test_aTestnetScriptRefusesToSignOnMainnet() public {
        TestnetOnlyHarness h = new TestnetOnlyHarness();
        vm.expectRevert(bytes("this script is testnet-only: it must never sign on Base mainnet"));
        h.key();
    }

    function test_aRealTestnetScriptRefusesOnMainnet() public {
        DeployPlan1 d = new DeployPlan1();
        vm.expectRevert(bytes("this script is testnet-only: it must never sign on Base mainnet"));
        d.run();
    }

    function test_aMainnetScriptGetsTheMainnetKey() public {
        assertEq(new MainnetHarness().key(), MAINNET);
    }

    function test_aHotKeyDeployerReportsItsAddressAndKey() public {
        (address who, uint256 k) = new MainnetHarness().signer();
        assertEq(k, MAINNET);
        assertEq(who, vm.addr(MAINNET));
    }

    /// D2: a hardware wallet signs; the script holds an address and no key.
    function test_aHardwareDeployerIsAnAddressWithNoKey() public {
        (address who, uint256 k) = new MainnetHarness().hardware(LEDGER, 0);
        assertEq(who, LEDGER);
        assertEq(k, 0);
    }

    function test_aHardwareDeployerRefusesAKeyBesideIt() public {
        MainnetHarness h = new MainnetHarness();
        vm.expectRevert(bytes("set MAINNET_DEPLOYER_ADDRESS or MAINNET_DEPLOYER_KEY, not both"));
        h.hardware(LEDGER, MAINNET);
    }

    function test_aTestnetScriptRefusesAHardwareDeployerOnMainnet() public {
        TestnetOnlyHarness h = new TestnetOnlyHarness();
        vm.expectRevert(bytes("this script is testnet-only: it must never sign on Base mainnet"));
        h.hardware(LEDGER, 0);
    }
}
