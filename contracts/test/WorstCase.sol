// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice What the piece's worst token actually costs, in ONE place.
///
/// @dev `RealTokenGas.t.sol` MEASURES it and `GasProfile.t.sol` PRINTS the
/// headroom that is left, and until this library existed the printer carried
/// its own copy of the measurer's two figures with nothing asserting they still
/// agreed. A copied number goes stale silently, which this project has watched
/// happen to an address, a gas figure, a suite count and a combination count.
///
/// So the measurer pins itself to these constants and the printer reads them:
/// change what the renderer costs and `RealTokenGas.t.sol` goes red, naming the
/// figure to update here, and nothing else has to be kept in step by hand.
///
/// EXACT EQUALITY, not a band. `GasBudget.t.sol` owns the regression bands and
/// the hard limits; this is a different instrument, and its job is to say that
/// the published figure IS the measured one. A change of any size is a change
/// worth writing down.
///
/// Measured on a finished child wearing every legal Mark, its echo ring and
/// the finisher's digit band -- the first token in the piece's history to hold
/// both records at once. First pinned 2026-09-23 at 3,540,467 / 22,162;
/// re-measured 2026-09-26 when the band lost its row of air (DigitBand.MIN_BAND),
/// which moved the canvas from 91 modules to 89.
library WorstCase {
    uint256 internal constant LARGEST_TOKEN_GAS = 3_539_751;
    uint256 internal constant LARGEST_TOKEN_BYTES = 22_158;
}
