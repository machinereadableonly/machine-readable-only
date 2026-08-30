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

    /// @dev A single packed id, for the common one-token batchCheckIn call.
    function _one(uint32 id) internal pure returns (bytes memory) {
        uint32[] memory ids = new uint32[](1);
        ids[0] = id;
        return _packed(ids);
    }

    /// @dev A single-element day array, for the common one-token batchCheckIn call.
    function _days(uint32 day) internal pure returns (uint32[] memory out) {
        out = new uint32[](1);
        out[0] = day;
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

    /// @dev Advance the clock by one year. NEVER write `vm.warp(block.timestamp
    /// + 365 days)` inline a second time in the same test function -- under
    /// this project's `via_ir = true` (foundry.toml, load-bearing for gas),
    /// solc's Yul common-subexpression pass treats `block.timestamp` as
    /// invariant across a function body, which is true of the real opcode but
    /// not of the out-of-band patch `vm.warp` performs. Two textually
    /// identical `block.timestamp + 365 days` expressions in one function
    /// collapse to the SAME computed value, so the second warp silently does
    /// nothing -- confirmed with a minimal standalone repro (two bare
    /// `vm.warp(block.timestamp + 365 days)` calls with nothing between them
    /// still coalesce). Wrapping the expression in this helper and calling it
    /// per year avoids the trap, because each call recomputes it fresh.
    function _warpOneYear() internal {
        vm.warp(block.timestamp + 365 days);
    }

    /// @dev Put a token at an arbitrary level by checking it in repeatedly is
    /// far too slow, so the budget tests warp the clock and check in once per
    /// needed day instead. 365 check-ins is affordable in a test; a decade is
    /// not, which is why seedsAvailable is asserted directly.
    /// @dev Moved here from Lifecycle.t.sol so a second test file (the golden
    /// tokenURI test) can share it rather than keep a second copy.
    function _makeWhole(uint256 id) internal {
        uint32 d = t.today();
        uint32[] memory ids = new uint32[](364);
        uint32[] memory ds = new uint32[](364);
        for (uint32 i = 0; i < 364; i++) {
            ids[i] = uint32(id);
            ds[i] = d + 1 + i;
        }
        bytes memory packed;
        for (uint32 i = 0; i < 364; i++) packed = abi.encodePacked(packed, ids[i]);
        vm.prank(WARDEN);
        t.batchCheckIn(packed, ds);
        assertEq(t.viewOf(id).level, 365);
    }
}
