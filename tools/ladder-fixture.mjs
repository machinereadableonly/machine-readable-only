// Prints the hash Ladder.t.sol asserts against, computed from the WARDEN's
// catalogue rather than from the contract -- which is the point. Two
// independently written ladders that must agree is a far stronger check than
// either one alone, and it is the same idiom tools/token-uri-fixture.mjs uses
// for the renderer.
//
//   node tools/ladder-fixture.mjs
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { LADDER } from "../warden/src/mcp/ladder.mjs";

const TUPLE = parseAbiParameters(
  "(uint64,uint32,uint32,uint32,uint32,bool,bool,uint16,uint16)[11]"
);

// maxSupply and active are DERIVED, not hardcoded. Hardcoding them left a JS
// cap or an inactive Mark invisible to the hash, which is the one field pair
// the two ladders would then have disagreed about silently. `sold` is the
// exception and stays 0: it is owned by applyMark on chain and the Warden
// counts reservations from the mirror, so it is state rather than definition.
const records = [];
for (let id = 0; id <= 10; id++) {
  const m = LADDER[id];
  records.push(m
    ? [BigInt(m.priceUsdc6), m.supply === Infinity ? 0 : m.supply, 0,
       m.minLevel, m.minStreak, m.needsWhole, true, m.excludes, m.requiresAny]
    : [0n, 0, 0, 0, 0, false, false, 0, 0]);
}

console.log(keccak256(encodeAbiParameters(TUPLE, [records])));
