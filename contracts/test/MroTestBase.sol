// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {MachineReadableOnly} from "../src/MachineReadableOnly.sol";
import {Renderer} from "../src/render/Renderer.sol";

/// @notice What every MachineReadableOnly test needs: the contract pair, the
/// standard addresses, the code bitmap and the calldata helpers.
/// @dev Shared rather than copied. The same 172 bytes appear in six test
/// files, and a second copy is a second thing to update when the fixture is
/// regenerated.
abstract contract MroTestBase is Test {
    MachineReadableOnly internal t;
    Renderer internal r;

    address internal constant WARDEN = address(0x3A2D);
    address internal constant ALICE = address(0xA11CE);
    address internal constant MALLORY = address(0x4A11);

    bytes32 internal constant KEY = bytes32(uint256(0xa9e));

    /// @dev Token 1 on example.com, from tools/token-bitmap.mjs. The same 172
    /// bytes the renderer tests use.
    function _code() internal pure returns (bytes memory) {
        return
        hex"fe00810bfc16532d506ebd1a58bb74fffff5dbabfabfaec16ed7ed07faaaaaafe01fe9fe00d33eefebb3eeff"
        hex"fff37fff66f70afbdfedf8b7feeeeea0fefdffdf85ffef66e727bfffff6abfeefeef296ffdfff5fbfe666796"
        hex"e3fedfeb623feefee8d8ffffff86fff66f7362bdfedfd0b3eeeeea5bcfdffdda69bef66f8ac0fffff12f62ef"
        hex"ecfa0057dfec67fa66642bf04b6df716ba7aed8f95d52ffa2d2e9306943305132d230fe84883cd80";
    }

    /// @dev Ids travel as 4-byte big-endian values, which is what
    /// batchCheckIn decodes.
    function _packed(uint32[] memory ids) internal pure returns (bytes memory out) {
        for (uint256 i = 0; i < ids.length; i++) out = abi.encodePacked(out, ids[i]);
    }

    /// @dev Deploy the pair and mint token 1 to ALICE, past day zero so that
    /// `lastDay + 1` arithmetic is meaningful.
    function _deployAndMintOne() internal {
        r = new Renderer();
        t = new MachineReadableOnly(address(r), WARDEN);
        vm.warp(86_400 * 1000 + 1);
        vm.prank(WARDEN);
        t.mint(1, ALICE, KEY, _code());
    }
}
