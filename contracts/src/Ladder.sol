// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {MachineReadableOnly} from "./MachineReadableOnly.sol";

/// @notice The fifteen Marks, in one place, as the deploy script and the tests
/// both read them.
///
/// @dev The single definition. `warden/src/mcp/ladder.mjs` is the only mirror,
/// and `Ladder.t.sol` asserts the two agree by hash.
///
/// Ids 1-10 are five pairs. In each pair one side is bought and one is earned by
/// a run of days; taking either closes the other, permanently and symmetrically;
/// and a token may take neither. Every exclusion is pair-internal, and nothing
/// in the five pairs is limited (`maxSupply = 0`).
///
/// Ids 11-15 are the five finisher Marks and cannot be bought: the token
/// contract gives one at 365 credited days, by the place the token finished in,
/// and `applyMark` refuses the whole range. Their caps are the sizes of the
/// place bands, recorded here for readers of `upgradeOf`;
/// `MachineReadableOnly.finisherMark` is the authority, and FinishLine.t.sol
/// pins the two together.
library Ladder {
    /// @dev Indexed by Mark id. Index 0 is unused: bit 0 is never a Mark.
    function all() internal pure returns (MachineReadableOnly.Upgrade[16] memory u) {
        u[1]  = _mark(1_000_000,     0,   0, false, 2);      // Hush,   pair 1 bought
        u[2]  = _earned(0,           0,   7, false, 1);      // Ache,   pair 1 earned
        u[3]  = _mark(5_000_000,    30,   0, false, 4);      // Static, pair 2 bought
        u[4]  = _earned(0,           0,  30, false, 3);      // Beat,   pair 2 earned
        u[5]  = _mark(25_000_000,  100,   0, false, 6);      // Iris,   pair 3 bought
        u[6]  = _earned(0,           0, 100, false, 5);      // Iris,   pair 3 earned
        u[7]  = _mark(1_250_000_000, 0,   0, true,  8);      // Vessel, pair 4 bought
        u[8]  = _earned(0,           0, 365, false, 7);      // Break,  pair 4 earned
        u[9]  = _mark(250_000_000,   0,   0, false, 10);     // Tint,   pair 5
        u[10] = _mark(25_000_000,    0,   0, false, 9);      // Aura,   pair 5
        // Pair 5 is the one pair whose two sides are both bought, and both open
        // at the same moment: when the token holds an Iris by either route.
        u[9].requiresAny  = uint16((1 << 5) | (1 << 6));
        u[10].requiresAny = uint16((1 << 5) | (1 << 6));

        // The five finisher Marks: given at 365 by the token contract's own
        // place table, never applied. The caps must match that table.
        u[11] = _finisher(0);   // Aorta,   65th on, never refused
        u[12] = _finisher(50);  // Chamber, 15th-64th
        u[13] = _finisher(10);  // Valve,   5th-14th
        u[14] = _finisher(3);   // Atrium,  2nd-4th
        u[15] = _finisher(1);   // Apex,    1st

        // Each one excludes the other four, because a token finishes once. The
        // Mark's own bit is cleared: setUpgrade refuses a self-exclusion.
        uint16 group = uint16((1 << 11) | (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15));
        for (uint8 i = 11; i <= 15; i++) u[i].excludes = group & ~(uint16(1) << i);
    }

    function _mark(uint64 price, uint32 minLevel, uint32 minStreak, bool whole, uint8 excludes)
        private pure returns (MachineReadableOnly.Upgrade memory)
    {
        return MachineReadableOnly.Upgrade({
            priceUsdc6: price, maxSupply: 0, sold: 0,
            minLevel: minLevel, minStreak: minStreak, requiresWhole: whole,
            active: true, excludes: uint16(1 << excludes), requiresAny: 0
        });
    }

    function _earned(uint64 price, uint32 minLevel, uint32 minStreak, bool whole, uint8 excludes)
        private pure returns (MachineReadableOnly.Upgrade memory)
    {
        return _mark(price, minLevel, minStreak, whole, excludes);
    }

    /// @dev A finisher Mark: free, whole-only, and capped at the size of its
    /// place band. `excludes` is left to the caller, which builds the whole
    /// group at once.
    function _finisher(uint32 cap) private pure returns (MachineReadableOnly.Upgrade memory) {
        return MachineReadableOnly.Upgrade({
            priceUsdc6: 0, maxSupply: cap, sold: 0,
            minLevel: 0, minStreak: 0, requiresWhole: true,
            active: true, excludes: 0, requiresAny: 0
        });
    }
}
