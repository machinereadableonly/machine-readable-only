// THROWAWAY probe, 2026-09-20. Does a HIGHER QR VERSION draw a better heart?
//
// The heart is ragged because only about 400 of version 5's 1,369 modules can
// be moved: the free bits ride in spare data codewords, and the payload eats
// most of the budget. A larger version raises BOTH terms -- more spare
// codewords, and a finer grid to draw on. This measures whether that is true
// and what it costs.
//
// Deliberately a COPY of qart.mjs's solver with the version parameterised,
// rather than an edit of the shipped file. It is an experiment; the shipped
// solver stays pinned at 5 until something here earns a change.
//
// CAPACITY IS DISCOVERED, NOT TABULATED. Free-byte budget per version is found
// by binary search against the encoder itself, so no remembered codeword table
// can be wrong.
//
//   ~/scripts/safe-build.sh node tools/version-probe.mjs
import QRCode from "qrcode";
import { heartTarget } from "./heart-target.mjs";
import { FREE_BASE, FREE_BITS, payloadFor } from "./qart.mjs";
import { scanResult } from "./test/helpers/decode.mjs";
import { renderModules } from "./test/helpers/decode.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

// Written to the gitignored tools/out, the same place preview.mjs uses.
// NEVER hardcode a session scratchpad path here: it carries the operator's
// username into a PUBLIC repository. Override with MRO_SHEET_OUT if needed.
const OUT = process.env.MRO_SHEET_OUT ?? "out";
const HEART_INK = "#c8102e", NOISE_INK = "#4a4a4a";

/// Duotone: heart modules in the heart ink, everything else in the noise ink,
/// which is how the shipped renderer separates them. A plain black render would
/// hide the whole question.
function duotone(modules, want, size, px) {
  let heart = "", noise = "";
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      if (!modules[j * size + i]) continue;
      const seg = `M${i + 4} ${j + 4}h1v1h-1z`;
      if (want[j * size + i]) heart += seg; else noise += seg;
    }
  }
  const span = size + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" shape-rendering="crispEdges">`
    + `<rect width="${span}" height="${span}" fill="#ffffff"/>`
    + `<path fill="${NOISE_INK}" d="${noise}"/><path fill="${HEART_INK}" d="${heart}"/></svg>`;
}

const DOMAIN = "machinereadableonly.com";
const TOKEN_ID = 1;
const PAYLOAD = payloadFor(DOMAIN, TOKEN_ID);
const DEST = PAYLOAD.slice(0, -1);
const ECC = "L";

// One mask, not all eight. The shipped selection searches every mask for
// robustness; this probe is comparing VERSIONS, so the mask is held constant
// and the absolute match will read slightly below what a full search reaches.
const MASK = 0;

const VERSIONS = [5, 6, 8, 10];
mkdirSync(OUT, { recursive: true });
const SIZES = [256, 350, 500, 700, 848, 900, 1080, 1424, 1600];

const encode = (freeBytes, version) =>
  QRCode.create(
    [{ data: PAYLOAD, mode: "byte" }, { data: Array.from(freeBytes), mode: "byte" }],
    { version, errorCorrectionLevel: ECC, maskPattern: MASK },
  );

/// The largest free-byte count this version still encodes. Binary search
/// against the encoder, so the answer comes from the library and not a table.
function maxFreeBytes(version) {
  let lo = 0, hi = 1200;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    try { encode(new Uint8Array(mid).fill(FREE_BASE), version); lo = mid; }
    catch { hi = mid - 1; }
  }
  return lo;
}

const moduleBits = qr => {
  const s = qr.modules.size;
  const a = new Uint8Array(s * s);
  for (let i = 0; i < s * s; i++) a[i] = qr.modules.data[i] ? 1 : 0;
  return a;
};
const packBits = a => { let v = 0n; for (let i = a.length - 1; i >= 0; i--) v = (v << 1n) | BigInt(a[i]); return v; };
const bitAt = (v, i) => (v >> BigInt(i)) & 1n;
const xorInto = (a, b) => { for (let i = 0; i < a.length; i++) a[i] ^= b[i]; };

function solveAt(version, K) {
  const baseBytes = new Uint8Array(K).fill(FREE_BASE);
  const baseline = encode(baseBytes, version);
  const size = baseline.modules.size;
  const base = moduleBits(baseline);

  const basis = [];
  for (let byte = 0; byte < K; byte++) {
    for (const bit of FREE_BITS) {
      const v = new Uint8Array(K);
      v[byte] = 1 << bit;
      const probe = baseBytes.slice();
      probe[byte] ^= v[byte];
      const moved = moduleBits(encode(probe, version));
      const delta = new Uint8Array(size * size);
      for (let i = 0; i < moved.length; i++) delta[i] = moved[i] ^ base[i];
      basis.push({ vec: packBits(delta), val: v });
    }
  }

  const { want, order } = heartTarget(size);
  const available = basis.slice();
  const pivots = [];
  for (const pos of order) {
    const k = available.findIndex(r => bitAt(r.vec, pos));
    if (k === -1) continue;
    const pivot = available.splice(k, 1)[0];
    for (const r of available) {
      if (bitAt(r.vec, pos)) { r.vec ^= pivot.vec; xorInto(r.val, pivot.val); }
    }
    pivots.push({ pos, ...pivot });
  }

  const chosen = baseBytes.slice();
  let current = packBits(base);
  for (const p of pivots) {
    if (Number(bitAt(current, p.pos)) !== want[p.pos]) { current ^= p.vec; xorInto(chosen, p.val); }
  }

  const qr = encode(chosen, version);
  const got = moduleBits(qr);
  let hit = 0, bodyWant = 0, bodyHit = 0;
  for (let i = 0; i < got.length; i++) {
    if (got[i] === want[i]) hit++;
    // The heart BODY is what a reader actually sees as a heart. Overall match
    // counts the ground outside it too, which flatters every version equally
    // but hides whether the shape filled in.
    if (want[i]) { bodyWant++; if (got[i]) bodyHit++; }
  }
  return { size, modules: got, want, controlled: pivots.length,
           match: hit / got.length, body: bodyHit / bodyWant };
}

let peak = 0;
const note = () => { peak = Math.max(peak, process.memoryUsage.rss()); };

console.log(`payload ${PAYLOAD}  (${PAYLOAD.length} chars), ecc ${ECC}, mask ${MASK} only\n`);
console.log("ver  side  modules  freeB  controlled  ctl%   match%  body%   solve      bitmap  decodes");

for (const version of VERSIONS) {
  const K = maxFreeBytes(version);
  const t0 = Date.now();
  const r = solveAt(version, K);
  const secs = (Date.now() - t0) / 1000;
  note();

  const total = r.size * r.size;
  // What the contract would have to store per token, at CODE_BYTES.
  const bitmapBytes = Math.ceil(total / 8);

  // Decode the bare code block, so the only variable is the version.
  const bad = [];
  for (const px of SIZES) {
    const svg = renderModules(r.modules, r.size, px);
    const res = scanResult(svg, px);
    if (!res.ok) bad.push(`${px}:${res.why}`);
    else if (res.destination !== DEST) bad.push(`${px}:wrong-dest`);
    note();
  }

  // Render each version at the SAME physical width, so the comparison is what a
  // viewer would actually see rather than what a module grid measures.
  writeFileSync(`${OUT}/heart-v${version}.png`,
    new Resvg(duotone(r.modules, r.want, r.size, 900),
      { fitTo: { mode: "width", value: 900 } }).render().asPng());

  console.log(
    `${String(version).padStart(3)}`
    + `${String(r.size).padStart(6)}`
    + `${String(total).padStart(9)}`
    + `${String(K).padStart(7)}`
    + `${String(r.controlled).padStart(12)}`
    + `${(100 * r.controlled / total).toFixed(1).padStart(7)}`
    + `${(100 * r.match).toFixed(1).padStart(9)}`
    + `${(100 * r.body).toFixed(1).padStart(7)}`
    + `${(secs.toFixed(1) + "s").padStart(9)}`
    + `${(bitmapBytes + "B").padStart(12)}`
    + `  ${bad.length ? `FAILED ${bad.length}/${SIZES.length}: ${bad.join(" ")}` : `${SIZES.length}/${SIZES.length}`}`,
  );
}

console.log(`\npeak rss ${(peak / 1024 / 1024).toFixed(0)} MB`);
console.log("ctl% is modules the solver can move; body% is how much of the heart filled in.");
