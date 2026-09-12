// The Base Builder Code the Clock attaches to every transaction it sends.
//
// Base credits an app's on-chain activity -- App Leaderboards, the Base App
// store, future rewards -- only when each transaction carries the app's code as
// an ERC-8021 suffix on the END of its calldata. The contract ignores it: no
// function reads raw calldata, and contracts/test/BuilderCodeSuffix.t.sol
// proves each function the Clock sends behaves identically with and without it.
//
// NOT A SECRET. The code is written into public calldata by design.
import { Attribution } from "ox/erc8021";

/// Issued by the Base Dashboard when MRO is registered there. NULL UNTIL THEN:
/// registering a second app on the operator's Base account is broken (open Base
/// bug https://github.com/base/docs/issues/1950), so the plumbing ships first
/// and the code is a one-line change the day it is issued. While it is null the
/// Clock's transactions are byte-identical to before. DEPLOY.md section 10
/// lists setting it among the things a mainnet cutover must not miss.
export const BUILDER_CODE = null;

/// The shape Base issues: `bc_` and lowercase letters and digits
/// (`bc_b7k3p9da` in Base's docs). A typo here would attribute the piece's
/// history to nobody, silently, so a malformed code stops the Clock instead.
const CODE_SHAPE = /^bc_[a-z0-9]+$/;

/**
 * The ERC-8021 calldata suffix for `code`, or undefined when there is none.
 *
 * Built with ox's own encoder rather than by hand. For schema 0 the layout is
 * the code's ASCII bytes, its 1-byte length, the schema id 0x00, then the
 * 16-byte marker 0x8021 repeated -- 29 bytes for an 11-character code.
 */
export function builderCodeSuffix(code = BUILDER_CODE) {
  if (code === null || code === undefined) return undefined;
  if (typeof code !== "string" || !CODE_SHAPE.test(code)) {
    throw new Error(`Builder Code ${JSON.stringify(code)} is not in Base's bc_... form`);
  }
  return Attribution.toDataSuffix({ codes: [code] });
}
