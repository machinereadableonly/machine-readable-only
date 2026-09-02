// Prints the hash Ladder.t.sol asserts against, computed from the WARDEN's
// catalogue rather than from the contract -- which is the point. Two
// independently written ladders that must agree is a far stronger check than
// either one alone, and it is the same idiom tools/token-uri-fixture.mjs uses
// for the renderer.
//
//   node tools/ladder-fixture.mjs
//
// EXPORTED as well as printed, for the same reason token-uri-fixture.mjs is: a
// hash a human pastes into a Solidity file is only checked in one direction.
// Ladder.t.sol fails when the CONTRACT moves; nothing re-ran this generator, so
// a change to the JavaScript catalogue moved nothing and failed nothing --
// LADDER[3].minLevel could go from 30 to 10 with all four suites green, and the
// Warden would then sell Static to a level-10 token and the chain would revert
// after payment. tools/test/ladder-fixture.test.mjs re-runs the comparison.
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { LADDER } from "../warden/src/mcp/ladder.mjs";

const TUPLE = parseAbiParameters(
  "(uint64,uint32,uint32,uint32,uint32,bool,bool,uint16,uint16)[11]"
);

/**
 * The eleven Upgrade records, in the contract's own field order.
 *
 * maxSupply and active are DERIVED, not hardcoded. Hardcoding them left a JS
 * cap or an inactive Mark invisible to the hash, which is the one field pair
 * the two ladders would then have disagreed about silently. `sold` is the
 * exception and stays 0: it is owned by applyMark on chain and the Warden
 * counts reservations from the mirror, so it is state rather than definition.
 */
export function ladderRecords(ladder = LADDER) {
  const records = [];
  for (let id = 0; id <= 10; id++) {
    const m = ladder[id];
    records.push(m
      ? [BigInt(m.priceUsdc6), m.supply === Infinity ? 0 : m.supply, 0,
         m.minLevel, m.minStreak, m.needsWhole, true, m.excludes, m.requiresAny]
      : [0n, 0, 0, 0, 0, false, false, 0, 0]);
  }
  return records;
}

/// The hash Ladder.t.sol pins. Same encoding as `abi.encode(Ladder.all())`.
export function ladderHash(ladder = LADDER) {
  return keccak256(encodeAbiParameters(TUPLE, [ladderRecords(ladder)]));
}

if (process.argv[1] && process.argv[1].endsWith("ladder-fixture.mjs")) {
  console.log(ladderHash());
}
