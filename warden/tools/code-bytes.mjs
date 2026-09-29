// The bitmap length the token contract enforces, mirrored for the tools and
// tests that build a stand-in code.
//
// `CODE_BYTES` is `internal` in MachineReadableOnly.sol, so there is nothing to
// read off the chain; `mint` and `seed` revert `BadCodeLength` on anything else.
// A version raise changes it, and code-bytes.test.mjs fails when this copy and
// the contract disagree.
export const CODE_BYTES = 407;

/// The same length as an unprefixed hex string, which is how a solved bitmap
/// arrives from tools/token-bitmap.mjs.
export const CODE_HEX_CHARS = CODE_BYTES * 2;
