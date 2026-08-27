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
export const ECC = "L";                // lowest correction leaves the most free bits
const DATA_CODEWORDS = 108;            // version 5, level L, single block
const DATA_BITS = DATA_CODEWORDS * 8;
export const MASKS = [0, 1, 2, 3, 4, 5, 6, 7];

// Free bytes ride in a second byte segment after a "#", so the scan destination
// is unchanged: the fragment is never sent to the server.
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

  const baseline = encode(payload, new Uint8Array(K), mask);
  const size = baseline.modules.size;
  const base = moduleBits(baseline);

  // Basis: flip one free bit, record which modules moved.
  const basis = [];
  for (let byte = 0; byte < K; byte++) {
    for (let bit = 0; bit < 8; bit++) {
      const v = new Uint8Array(K);
      v[byte] = 1 << bit;
      const moved = moduleBits(encode(payload, v, mask));
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
  const chosen = new Uint8Array(K);
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
export function bestOfAllMasks(payload, target) {
  let best = null;
  for (const mask of MASKS) {
    const r = solve(payload, mask, target);
    if (!best || r.match > best.match) best = r;
  }
  return best;
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
