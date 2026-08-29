// QArt module reshuffling: drive a QR code's own modules towards a picture.
//
// The whole QR pipeline is affine over GF(2) -- Reed-Solomon is linear, module
// placement is a permutation, and masking is XOR by a constant. So we never need
// to implement the algebra: flipping one free bit at a time through the encoder
// gives a basis over the module grid, and Gauss-Jordan picks the free-byte values
// that drive chosen modules to the colours we want.
//
// Technique: Russ Cox, https://research.swtch.com/qart
import QRCode from "qrcode";
import { heartTarget } from "./heart-target.mjs";

export const VERSION = 5;              // 37 x 37 modules
export const VERSION_SIZE = 37;        // that version's side, in modules
                                       // Lives here, not in token-bitmap.mjs: heart-mask.mjs
                                       // needs it too, and importing it from the higher-level
                                       // bitmap module made a cycle once robust-solve.mjs
                                       // put a renderer in that path.
export const ECC = "L";                // lowest correction leaves the most free bits
const DATA_CODEWORDS = 108;            // version 5, level L, single block
const DATA_BITS = DATA_CODEWORDS * 8;
export const MASKS = [0, 1, 2, 3, 4, 5, 6, 7];

// Free bytes ride in a second byte segment after a "#", so the scan destination
// is unchanged: the fragment is never sent to the server.
//
// They must also be characters a scanner will accept as part of a URL. Arbitrary
// binary decodes to a string full of control bytes, and a phone then refuses to
// offer the link at all -- the code scans and nothing happens. jsqr hides this by
// stopping at the first byte that is not valid text and returning the clean
// prefix, which is how it survived a green test suite; see test/decode-strict.
//
// The allowed set has to stay an affine subspace of GF(2)^8 or the whole QArt
// method collapses, because the solver derives its basis by flipping single bits.
// Fixing the top three bits and freeing the low five satisfies both: 32 values,
// 0x40 to 0x5F, the characters "@", "A".."Z", "[", "\\", "]", "^" and "_".
//
// Five is the ceiling, not a guess. A six-bit set would have to be 0x40-0x7F,
// the only 64-value coset that avoids the control range, and that one contains
// the backtick and DEL -- both of which a browser rewrites, which would change
// the URL the visitor is shown. Measured against Node's WHATWG URL parser: the
// only printable bytes it rewrites in a fragment are " < > and the backtick.
export const FREE_BASE = 0x40;                 // "@"
export const FREE_BITS = [0, 1, 2, 3, 4];      // the low five bits are ours

export function freeByteBudget(payloadLength) {
  const segment1 = 4 + 8 + payloadLength * 8;
  const segment2Header = 4 + 8;
  const terminator = 4;
  return Math.floor((DATA_BITS - segment1 - segment2Header - terminator) / 8);
}

function encode(payload, freeBytes, mask) {
  return QRCode.create(
    [{ data: payload, mode: "byte" }, { data: Array.from(freeBytes), mode: "byte" }],
    { version: VERSION, errorCorrectionLevel: ECC, maskPattern: mask }
  );
}
const moduleBits = qr => {
  const s = qr.modules.size;
  const a = new Uint8Array(s * s);
  for (let i = 0; i < s * s; i++) a[i] = qr.modules.data[i] ? 1 : 0;
  return a;
};
// Pack a 0/1 array into a BigInt so a basis row XORs in one operation.
const packBits = a => { let v = 0n; for (let i = a.length - 1; i >= 0; i--) v = (v << 1n) | BigInt(a[i]); return v; };
const bitAt = (v, i) => (v >> BigInt(i)) & 1n;
const xorInto = (a, b) => { for (let i = 0; i < a.length; i++) a[i] ^= b[i]; };

// Solve one (payload, mask) pair. Returns the code plus how well it hit the target.
export function solve(payload, mask, target) {
  const K = freeByteBudget(payload.length);
  if (K < 1) throw new Error(`payload too long for version ${VERSION}: ${payload.length} chars`);

  const baseBytes = new Uint8Array(K).fill(FREE_BASE);
  const baseline = encode(payload, baseBytes, mask);
  const size = baseline.modules.size;
  const base = moduleBits(baseline);

  // Basis: flip one free bit, record which modules moved.
  const basis = [];
  for (let byte = 0; byte < K; byte++) {
    for (const bit of FREE_BITS) {
      const v = new Uint8Array(K);
      v[byte] = 1 << bit;
      const probe = baseBytes.slice();
      probe[byte] ^= v[byte];
      const moved = moduleBits(encode(payload, probe, mask));
      const delta = new Uint8Array(size * size);
      for (let i = 0; i < moved.length; i++) delta[i] = moved[i] ^ base[i];
      basis.push({ vec: packBits(delta), val: v });
    }
  }

  const { want, order } = target ?? heartTarget(size);

  // Gauss-Jordan: claim target modules in priority order, one pivot each.
  const available = basis.slice();
  const pivots = [];
  for (const pos of order) {
    const k = available.findIndex(r => bitAt(r.vec, pos));
    if (k === -1) continue;               // module unreachable; it stays as chance left it
    const pivot = available.splice(k, 1)[0];
    for (const r of available) {
      if (bitAt(r.vec, pos)) { r.vec ^= pivot.vec; xorInto(r.val, pivot.val); }
    }
    pivots.push({ pos, ...pivot });
  }

  // Walk the pivots, adding the ones that flip a module the wrong way.
  const chosen = baseBytes.slice();
  let current = packBits(base);
  for (const p of pivots) {
    if (Number(bitAt(current, p.pos)) !== want[p.pos]) { current ^= p.vec; xorInto(chosen, p.val); }
  }

  const qr = encode(payload, chosen, mask);
  const got = moduleBits(qr);
  let hit = 0;
  for (let i = 0; i < got.length; i++) if (got[i] === want[i]) hit++;

  return { qr, size, want, modules: got, mask, controlled: pivots.length,
           match: hit / got.length };
}

// Every mask puts the free modules somewhere different, so searching all eight
// is free fidelity: measured +2.0 points on average, and it lifts the worst case.
//
// All eight solves, best heart match first. Callers that care only about
// fidelity take the head; callers that also care whether the code SCANS walk the
// list. See robust-solve.mjs for why the second kind exists.
export function allMaskSolves(payload, target) {
  return MASKS.map(mask => solve(payload, mask, target))
              .sort((a, b) => b.match - a.match);
}

// The best-looking solve, fidelity alone. NOT what a shipped token uses -- see
// tools/robust-solve.mjs. Kept because the previews and the QArt tests want the
// pure geometric answer, with no decoder in the loop.
export function bestOfAllMasks(payload, target) {
  return allMaskSolves(payload, target)[0];
}

// The stored form: one bit per module, row major, packed into bytes.
export function packModules(modules, size) {
  const out = new Uint8Array(Math.ceil((size * size) / 8));
  for (let i = 0; i < size * size; i++) if (modules[i]) out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}
export function unpackModules(bytes, size) {
  const out = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) out[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
  return out;
}

export const payloadFor = (domain, tokenId) => `https://${domain}/t/${tokenId}#`;
