// The per-token code bitmap: what the contract stores and the renderer draws.
//
// One bit per module, row major, bit 7 of byte 0 is module (0,0) -- the packing
// qart.packModules already produces, and the same one HeartMask uses, so a
// token's bitmap and the shared heart mask can be indexed with identical code.
import { bestOfAllMasks, packModules, payloadFor } from "./qart.mjs";

export const VERSION_SIZE = 37;            // QR version 5
export const SIZE = VERSION_SIZE;
export const BYTES = Math.ceil(SIZE * SIZE / 8);   // 172
export const HEX_CHARS = BYTES * 2;                // 344

const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");

export function tokenBitmap(domain, tokenId) {
  const best = bestOfAllMasks(payloadFor(domain, tokenId));
  if (best.size !== SIZE) throw new Error(`expected a ${SIZE}x${SIZE} code, got ${best.size}`);
  const packed = packModules(best.modules, best.size);
  return { hex: hex(packed), mask: best.mask, match: best.match, size: SIZE, bytes: BYTES };
}

if (process.argv[1] && process.argv[1].endsWith("token-bitmap.mjs")) {
  const [id, domain = "example.com"] = process.argv.slice(2);
  if (!id) { console.error("usage: node token-bitmap.mjs <tokenId> [domain]"); process.exit(1); }
  const r = tokenBitmap(domain, id);
  console.error(`token ${id} on ${domain}: mask ${r.mask}, match ${(r.match * 100).toFixed(1)}%`);
  console.log(r.hex);   // stdout is the hex alone, so the deploy script can pipe it
}
