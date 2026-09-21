// THE FOUR OPTIONS, SIDE BY SIDE: today, a finer QR, real digits, and both.
//
// EXPLORATORY. The costs are measured (test/QrVersionCost.t.sol,
// test/DigitBandCost.t.sol); this is what they buy.
//
// ONE APPROXIMATION, STATED SO NOBODY MISTAKES IT FOR THE IMPLEMENTATION.
// FrameGeometry's 376 day cells are generated to fit exactly around a 45-cell
// block, and version 10's block is 65. The real fix is to draw frame cells in
// their OWN unit, about 1.44x a module, which keeps the count at exactly 376 --
// the 365 days plus the 11 that light at completion. Here that is done by
// scaling the frame's coordinates, which produces fractional positions and more
// svg bytes than the shipping renderer would. THE PICTURE IS FAITHFUL; THE BYTE
// COUNT FROM THIS FILE IS NOT.
//
//   ~/scripts/safe-build.sh node tools/finisher-combined-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";
import { pathFor, TIERS, colourAt, inks, FIELD } from "./render-token.mjs";
import { frameCells, LOCAL, BLOCK } from "./frame-geometry.mjs";
import { heartTarget } from "./heart-target.mjs";
import { FREE_BASE, FREE_BITS, payloadFor } from "./qart.mjs";
import * as SHEET from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const OUT = process.env.MRO_SHEET_OUT ?? "out";
mkdirSync(OUT, { recursive: true });
const DOMAIN = "machinereadableonly.com", TOKEN = 1;
const PAYLOAD = payloadFor(DOMAIN, TOKEN);
const DEST = PAYLOAD.slice(0, -1);
const SIZES = [256, 848, 1600];

const RUNG = 4;                       // a deep, live streak
const COLOUR = colourAt(RUNG);
const { heartInk, noiseInk } = inks([], RUNG);
const DIGIT_INK = "#2f2f2f";
const QUIET_CELLS = 4;

/// Solve the QArt code at a version. Same algebra as qart.mjs, version freed.
function solveAt(version) {
  const enc = bytes => QRCode.create(
    [{ data: PAYLOAD, mode: "byte" }, { data: Array.from(bytes), mode: "byte" }],
    { version, errorCorrectionLevel: "L", maskPattern: 0 });
  let lo = 0, hi = 3000;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); try { enc(new Uint8Array(m).fill(FREE_BASE)); lo = m; } catch { hi = m - 1; } }
  const K = lo, baseBytes = new Uint8Array(K).fill(FREE_BASE);
  const bits = qr => { const s = qr.modules.size, a = new Uint8Array(s * s);
    for (let i = 0; i < s * s; i++) a[i] = qr.modules.data[i] ? 1 : 0; return a; };
  const pack = a => { let v = 0n; for (let i = a.length - 1; i >= 0; i--) v = (v << 1n) | BigInt(a[i]); return v; };
  const bitAt = (v, i) => (v >> BigInt(i)) & 1n;
  const xorInto = (a, b) => { for (let i = 0; i < a.length; i++) a[i] ^= b[i]; };
  const baseline = enc(baseBytes), size = baseline.modules.size, base = bits(baseline);
  const basis = [];
  for (let byte = 0; byte < K; byte++) for (const bit of FREE_BITS) {
    const v = new Uint8Array(K); v[byte] = 1 << bit;
    const probe = baseBytes.slice(); probe[byte] ^= v[byte];
    const moved = bits(enc(probe)), d = new Uint8Array(size * size);
    for (let i = 0; i < moved.length; i++) d[i] = moved[i] ^ base[i];
    basis.push({ vec: pack(d), val: v });
  }
  const { want, order } = heartTarget(size);
  const avail = basis.slice(), piv = [];
  for (const pos of order) {
    const k = avail.findIndex(r => bitAt(r.vec, pos)); if (k === -1) continue;
    const p = avail.splice(k, 1)[0];
    for (const r of avail) if (bitAt(r.vec, pos)) { r.vec ^= p.vec; xorInto(r.val, p.val); }
    piv.push({ pos, ...p });
  }
  const chosen = baseBytes.slice(); let cur = pack(base);
  for (const p of piv) if (Number(bitAt(cur, p.pos)) !== want[p.pos]) { cur ^= p.vec; xorInto(chosen, p.val); }
  return { size, modules: bits(enc(chosen)), want };
}

// Three sizes of digit. The 3x5 was the first draft and proved too heavy: on
// version 10 it stood as tall as five QR modules and competed with the code's
// own texture instead of annotating it.
//
// A SQUARE glyph is the useful discovery. With 3x3 the step is the same
// horizontally and vertically, so all four edges take digits with one rule --
// which closes the composition that top-and-bottom left open, and sidesteps the
// bug where a 3-wide, 5-tall glyph needs a step of 4 one way and 6 the other.
const GLYPHS = {
  "3x5": { w: 3, h: 5, g: { 0: ["111","101","101","101","111"], 1: ["010","110","010","010","111"] } },
  "3x4": { w: 3, h: 4, g: { 0: ["111","101","101","111"],       1: ["010","110","010","111"] } },
  // The 3x3 "1" was a plain vertical bar in the first pass, so a row of them
  // read as a dotted rule rather than as writing. A flag and a foot fit inside
  // three cells and put the digit back.
  "3x3": { w: 3, h: 3, g: { 0: ["111","101","111"],             1: ["110","010","111"] } },
};

/// Turn a glyph bitmap a quarter turn clockwise. Only square glyphs rotate
/// cleanly, which is the second reason 3x3 is the size that works.
function rot90(rows) {
  const n = rows.length;
  const out = [];
  for (let r = 0; r < n; r++) {
    let s = "";
    for (let c = 0; c < n; c++) s += rows[n - 1 - c][r];
    out.push(s);
  }
  return out;
}
const rotN = (rows, k) => { let r = rows; for (let i = 0; i < (k & 3); i++) r = rot90(r); return r; };
const BITS = 16;

/// One token. `digits` adds the band; `code` is whichever solve was used.
function tile({ code, digits, ordinal = 1, glyph = "3x5", edges = 2, upright = false }) {
  const G = GLYPHS[glyph];
  const GW = G.w, GH = G.h, STEP = GW + 1;
  const block = code.size + 2 * QUIET_CELLS;
  const scale = block / BLOCK;                 // frame cells in their own unit
  const frameSpan = LOCAL * scale;             // the 49-grid, scaled
  const band = digits ? GH + 1 : 0;
  const ringSpan = 1;
  const canvas = Math.ceil(frameSpan) + 2 * (1 + ringSpan) + 2 * band;
  const frameOff = band + ringSpan + 1;
  const codeOff = frameOff + (2 + QUIET_CELLS) * scale;
  const r3 = n => Number(n.toFixed(3));

  // The day frame, every cell lit, in its own unit.
  let frameD = "";
  for (const [x, y] of frameCells()) {
    frameD += `M${r3(frameOff + x * scale)} ${r3(frameOff + y * scale)}`
      + `h${r3(scale)}v${r3(scale)}h-${r3(scale)}z`;
  }
  // The completion ring, one cell at the canvas edge inside the band.
  const o = band;
  const len = canvas - 2 * o;
  let ringD = `M${o} ${o}h${len}v1h-${len}z` + `M${o} ${canvas - 1 - o}h${len}v1h-${len}z`
    + `M${o} ${o + 1}h1v${len - 2}h-1z` + `M${canvas - 1 - o} ${o + 1}h1v${len - 2}h-1z`;

  // The code: heart and noise, at one canvas cell per module.
  let heartD = "", noiseD = "";
  for (let j = 0; j < code.size; j++) {
    for (let i = 0; i < code.size; i++) {
      if (!code.modules[j * code.size + i]) continue;
      const seg = `M${r3(codeOff + i)} ${r3(codeOff + j)}h1v1h-1z`;
      if (code.want[j * code.size + i]) heartD += seg; else noiseD += seg;
    }
  }

  // The digit band: the ordinal along the top and the bottom.
  let digitD = "";
  if (digits) {
    const word = ordinal.toString(2).padStart(BITS, "0").split("").map(Number);
    // The visible span is one gap short of BITS*STEP, because the last digit
    // needs no trailing space. Centring on the true span is what puts equal
    // margins at both ends of every edge.
    const span = BITS * STEP - (STEP - GW);
    const pad = Math.floor((canvas - span) / 2);
    const put = (x, y, rows) => {
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < GW; c++) {
        if (rows[r][c] !== "1") continue;
        digitD += `M${x + c} ${y + r}h1v1h-1z`;
      }
    };
    if (edges === 4 && GW === GH) {
      // CLOCKWISE, each edge starting at its own right-hand corner as you stand
      // on that edge and look into the centre. Face south from the top and your
      // right is the image's left; face west from the right edge and your right
      // is the top; and so on. The four starts chain into one clockwise
      // reading, and each edge's glyphs are turned a quarter turn to match, so
      // the border has rotational symmetry rather than four separate captions.
      // EVERY EDGE CENTRED. Top and right were centred on `pad` while bottom
      // and left ran flush from the far corner, so the four ends did not agree
      // and the corners doubled up. `far` is `pad` measured from the other end,
      // which gives all four the same margin.
      const last = canvas - GW;
      const far = canvas - pad - GW;
      // UPRIGHT reads from one viewpoint: every digit the right way up, each
      // edge running the way a reader scans -- left to right along the top and
      // bottom, top to bottom down each side. It gives up the rotational
      // symmetry of an inscription for being readable off a screen.
      const edgesDef = upright
        ? [
            { k: 0, at: i => [pad + i * STEP, 0] },        // top: left to right
            { k: 0, at: i => [last, pad + i * STEP] },     // right: top to bottom
            { k: 0, at: i => [pad + i * STEP, last] },     // bottom: left to right
            { k: 0, at: i => [0, pad + i * STEP] },        // left: top to bottom
          ]
        : [
            { k: 0, at: i => [pad + i * STEP, 0] },        // top: left to right
            { k: 1, at: i => [last, pad + i * STEP] },     // right: top to bottom
            { k: 2, at: i => [far - i * STEP, last] },     // bottom: right to left
            { k: 3, at: i => [0, far - i * STEP] },        // left: bottom to top
          ];
      for (const e of edgesDef) {
        for (let i = 0; i < BITS; i++) {
          const [x, y] = e.at(i);
          if (x < 0 || y < 0 || x > last || y > last) continue;
          put(x, y, rotN(G.g[word[i]], e.k));
        }
      }
    } else {
      for (const topY of [0, canvas - GH]) {
        for (let i = 0; i < BITS; i++) put(pad + i * STEP, topY, G.g[word[i]]);
      }
    }
  }

  return { canvas, blockShare: (block / canvas) ** 2,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" shape-rendering="crispEdges">`
      + `<rect width="${canvas}" height="${canvas}" fill="${FIELD}"/>`
      + (digitD ? `<path fill="${DIGIT_INK}" d="${digitD}"/>` : "")
      + `<path fill="${DIGIT_INK}" d="${ringD}"/>`
      + `<path fill="${COLOUR}" d="${frameD}"/>`
      + `<path fill="${noiseInk}" d="${noiseD}"/>`
      + `<path fill="${heartInk}" d="${heartD}"/>`
      + `</svg>` };
}

console.log("solving...");
const V5 = { size: SHEET.CODE.size, modules: SHEET.CODE.modules, want: SHEET.TARGET.want };
const V10 = solveAt(10);
console.log(`v5 ${V5.size} modules, v10 ${V10.size} modules\n`);

const OPTIONS = [
  ["A UPRIGHT, finisher 1", { code: V10, digits: true, glyph: "3x3", edges: 4, ordinal: 1, upright: true }],
  ["B UPRIGHT, finisher 42", { code: V10, digits: true, glyph: "3x3", edges: 4, ordinal: 42, upright: true }],
  ["C UPRIGHT, finisher 365", { code: V10, digits: true, glyph: "3x3", edges: 4, ordinal: 365, upright: true }],
  ["D rotated clockwise, finisher 1 (for contrast)", { code: V10, digits: true, glyph: "3x3", edges: 4, ordinal: 1 }],
  ["E rotated clockwise, finisher 42 (for contrast)", { code: V10, digits: true, glyph: "3x3", edges: 4, ordinal: 42 }],
];

const tiles = [];
for (const [label, opts] of OPTIONS) {
  const t = tile(opts);
  tiles.push(t);
  const bad = [];
  for (const px of SIZES) {
    const r = scanResult(t.svg, px);
    if (!r.ok) bad.push(`${px}:${r.why}`);
    else if (r.destination !== DEST) bad.push(`${px}:wrong-dest`);
  }
  console.log(`${label}`);
  console.log(`  canvas ${t.canvas}, code block ${(100 * t.blockShare).toFixed(0)}% of the picture`
    + `, decodes ${SIZES.length - bad.length}/${SIZES.length}` + (bad.length ? `  ${bad.join(" ")}` : ""));
}

const W = Math.max(...tiles.map(t => t.canvas)), g = 2;
const cols = 3, rowsN = Math.ceil(tiles.length / cols);
const totalW = W * cols + g * (cols - 1), totalH = W * rowsN + g * (rowsN - 1);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">`
  + `<rect width="${totalW}" height="${totalH}" fill="#eeeeee"/>`
  + tiles.map((t, i) => {
      const off = (W - t.canvas) / 2;
      return `<svg x="${(i % cols) * (W + g) + off}" y="${Math.floor(i / cols) * (W + g) + off}"`
        + ` width="${t.canvas}" height="${t.canvas}">`
        + t.svg.replace(/^<svg[^>]*>/, "<svg>") + `</svg>`;
    }).join("")
  + `</svg>`;
writeFileSync(`${OUT}/finisher-combined.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: 2000 } }).render().asPng());
console.log(`\nsheet ${OUT}/finisher-combined.png`);
console.log("  row 1: UPRIGHT -- finisher 1, 42, 365");
console.log("  row 2: ROTATED clockwise -- finisher 1, 42");
