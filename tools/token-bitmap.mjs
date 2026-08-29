// The per-token code bitmap: what the contract stores and the renderer draws.
//
// One bit per module, row major, bit 7 of byte 0 is module (0,0) -- the packing
// qart.packModules already produces, and the same one HeartMask uses, so a
// token's bitmap and the shared heart mask can be indexed with identical code.
import { packModules, payloadFor, VERSION_SIZE } from "./qart.mjs";
import { robustSolve } from "./robust-solve.mjs";

export { VERSION_SIZE } from "./qart.mjs";  // re-exported: callers already import it from here
export const SIZE = VERSION_SIZE;
export const BYTES = Math.ceil(SIZE * SIZE / 8);   // 172
export const HEX_CHARS = BYTES * 2;                // 344

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

// Solving is deterministic, so a token's bitmap is worth computing once per
// process. The robustness gate renders and decodes the candidate in five states
// at ten raster sizes, which is far too much work to repeat for every fixture
// that happens to want token 1.
const memo = new Map();

/// The bitmap a token actually ships: the best-matching solve that SCANS.
///
/// Selection is by robustness first, heart match second -- see robust-solve.mjs
/// for the measurement that forced this, and why the previous "highest match
/// wins" rule shipped a code that failed at a fifth of raster sizes on two of
/// twelve tokens.
export function tokenBitmap(domain, tokenId) {
  const key = `${domain}/${tokenId}`;
  if (memo.has(key)) return memo.get(key);

  const best = robustSolve(payloadFor(domain, tokenId));
  if (best.size !== SIZE) throw new Error(`expected a ${SIZE}x${SIZE} code, got ${best.size}`);
  const packed = packModules(best.modules, best.size);
  const result = {
    hex: hex(packed), mask: best.mask, match: best.match, size: SIZE, bytes: BYTES,
    // How many better-matching masks the gate threw out. Zero on a healthy
    // token; non-zero is the interesting case and worth surfacing in the CLI.
    rejected: best.gate.rejected,
  };
  memo.set(key, result);
  return result;
}

if (process.argv[1] && process.argv[1].endsWith("token-bitmap.mjs")) {
  const [id, domain = "example.com"] = process.argv.slice(2);
  if (!id) { console.error("usage: node token-bitmap.mjs <tokenId> [domain]"); process.exit(1); }
  const r = tokenBitmap(domain, id);
  console.error(`token ${id} on ${domain}: mask ${r.mask}, match ${(r.match * 100).toFixed(1)}%`
    + (r.rejected ? `, ${r.rejected} better-matching mask(s) rejected as unscannable` : ""));
  console.log(r.hex);   // stdout is the hex alone, so the deploy script can pipe it
}
