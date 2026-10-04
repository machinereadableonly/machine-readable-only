// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {DeployPlan5} from "../script/DeployPlan5.s.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";

/// @notice The deploy script, run as the deploy runs it: the pair, the ladder
/// and the split anchor in one broadcast.
contract DeployPlan5Test is Test {
    // Anvil's accounts 0 and 1: published, throwaway, local only.
    uint256 constant KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant WARDEN = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    bytes32 constant ANCHOR = keccak256("a test anchor");
    address constant SAFE = address(0x5AFE);

    function setUp() public {
        vm.setEnv("EXPECTED_CHAIN_ID", vm.toString(block.chainid));
        vm.setEnv("WARDEN_ADDRESS", vm.toString(WARDEN));
        vm.setEnv("SPIKE_DEPLOYER_KEY", vm.toString(KEY));
        vm.deal(vm.addr(KEY), 10 ether);
    }

    function test_theDeploySetsTheAnchorInTheSameBroadcast() public {
        vm.setEnv("SPLIT_ANCHOR", vm.toString(ANCHOR));
        (, MachineReadableOnly t) = new DeployPlan5().run();
        assertEq(t.splitAnchor(), ANCHOR);
        assertEq(t.splitAnchorDay(), t.today());
        assertEq(t.upgradeOf(15).maxSupply, 1, "and the ladder is written");
    }

    // Called directly: setting a zero anchor in the shared environment would
    // race the other tests' deploys.
    function test_aZeroAnchorIsRefusedBeforeAnythingIsSent() public {
        DeployPlan5 d = new DeployPlan5();
        vm.expectRevert(bytes("SPLIT_ANCHOR must be set: run warden/tools/split-seed.mjs first"));
        d.requireAnchor(bytes32(0));
    }

    // Owners are arguments, not environment variables: forge runs these tests
    // in parallel and the environment is shared by all of them. Every test that
    // sets SPLIT_ANCHOR sets the same value.
    function test_withNoOwnerTheDeployerStaysOwner() public {
        vm.setEnv("SPLIT_ANCHOR", vm.toString(ANCHOR));
        (, MachineReadableOnly t) = new DeployPlan5().run();
        assertEq(t.owner(), vm.addr(KEY));
        assertEq(t.pendingOwner(), address(0));
    }

    function test_theDeployOffersOwnershipToTheSafeInTheSameBroadcast() public {
        vm.setEnv("SPLIT_ANCHOR", vm.toString(ANCHOR));
        vm.etch(SAFE, hex"00");
        (, MachineReadableOnly t) = new DeployPlan5().run(SAFE);
        assertEq(t.owner(), vm.addr(KEY), "the deployer owns it until the Safe accepts");
        assertEq(t.pendingOwner(), SAFE);
        vm.prank(SAFE);
        t.acceptOwnership();
        assertEq(t.owner(), SAFE);
    }

    function test_anOwnerWithNoCodeIsRefused() public {
        DeployPlan5 d = new DeployPlan5();
        vm.expectRevert(bytes("the owner has no code: it must be the deployed Safe"));
        d.run(address(0xBEEF));
    }

    function test_theOwnerCannotBeTheWarden() public {
        vm.etch(WARDEN, hex"00");
        DeployPlan5 d = new DeployPlan5();
        vm.expectRevert(bytes("the owner must not be the warden"));
        d.run(WARDEN);
    }

    function test_mainnetRefusesADeployWithNoOwner() public {
        vm.chainId(8453);
        DeployPlan5 d = new DeployPlan5();
        vm.expectRevert(bytes("Base mainnet needs an owner: run(address) with the Safe"));
        d.run();
    }
}
