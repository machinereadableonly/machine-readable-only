// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "../../src/MachineReadableOnly.sol";

/// @notice TEST-ONLY. The real contract with a five-minute day, so the whole
/// life of a token -- streak colours, lapses, the earned and level-gated Marks,
/// a whole heart, a seeded child -- can be rehearsed on Base Sepolia in hours
/// instead of a year. See docs/plans/2026-09-11-mro-fast-days.md.
/// @dev NEVER DEPLOY THIS TO MAINNET. It lives under script/, not src/, so no
/// production deploy script can reach it by accident, and DeployFast.s.sol
/// refuses any chain but Base Sepolia.
///
/// The one override is `today()`. Every day the contract reasons about --
/// `lastDay`, `mintDay`, the FutureDay bound, the seed budget's agent-year --
/// is derived from it, and the Renderer reads it through the token's own view,
/// so the art pales and rings on the fast day with no other change.
/// Marking the base `today()` virtual left its runtime bytecode identical
/// apart from the trailing metadata hash (`forge inspect`, compared before and
/// after, 2026-09-11).
contract MachineReadableOnlyFast is MachineReadableOnly {
    /// Seconds in a fast day.
    uint256 public constant FAST_DAY = 300;

    constructor(address renderer_, address warden_) MachineReadableOnly(renderer_, warden_) {}

    function today() public view override returns (uint32) {
        return uint32(block.timestamp / FAST_DAY);
    }
}
