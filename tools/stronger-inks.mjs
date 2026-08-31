// How far CAN Bloom and Blue Blood go?
//
// The earlier candidates nudged one hue direction (slate) and asked whether it
// decoded. This asks the opposite question: at the luminance the binarizer
// forces, what is the most saturated colour that EXISTS, in any hue? The
// answer bounds the Mark, and the bound turns out to be much further out than
// the shipped ink sits.
//
// Luminance is not negotiable. Heart and noise must match in BT.601 luma or
// ZXing's binarizer resolves the lighter of the two to background once its 8x8
// blocks fall inside a single module. Hue and chroma are the free axes, so the
// search is over those at a FIXED luma.
//
//   node tools/stronger-inks.mjs            (through ~/scripts/safe-build.sh)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, BLUEBLOOD_BY_TIER, TIERS, colourAt, rungOf, noiseAt, canvasFor,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = "~/projects/machine-readable-only/tools/out/marks";

const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const chromaOf = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const hex = ([r, g, b]) =>
  "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, "0")).join("");
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

/// Which of six hue families a colour belongs to, by channel order. Crude on
/// purpose: the point is to offer one strongest example of each family, not to
/// be a colour science library.
function family([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return "grey";
  if (max === r) return b >= g ? "magenta" : "orange";
  if (max === g) return b >= r ? "teal" : "green";
  return r >= g ? "violet" : "blue";
}

/**
 * The most saturated colour at a given luma, per hue family.
 *
 * A grid search rather than a formula. Converting "maximum chroma at fixed
 * BT.601 luma" into closed form means handling channel clipping per hue
 * sector, and a 64-step grid answers it exactly well enough at a cost of a
 * quarter of a million cheap iterations.
 */
function strongestAt(targetLuma, tolerance = 0.6) {
  const best = new Map();
  for (let r = 0; r <= 255; r += 4)
    for (let g = 0; g <= 255; g += 4)
      for (let b = 0; b <= 255; b += 4) {
        const c = [r, g, b];
        if (Math.abs(luma(c) - targetLuma) > tolerance) continue;
        const f = family(c), ch = chromaOf(c);
        if (!best.has(f) || ch > best.get(f).chroma) best.set(f, { rgb: c, chroma: ch });
      }
  return best;
}

const stateFor = (streak, marks) => ({
  level: 200, streak, years: 1, marks, lastDay: 20700, today: 20700,
});
const draw = (streak, marks) => renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, marks));
const pixels = (svg, px) => {
  // `.pixels` is a getter that COPIES the buffer on every read -- never touch
  // it inside a loop.
  const r = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  return r.pixels;
};
const shift = (a, b) => {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2]));
    if (d > max) max = d;
  }
  return max;
};
const decodes = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
}).length;

const STREAK = 150;                 // the top rung, where both Marks are weakest
const rung = rungOf(STREAK);
const heart = colourAt(rung);
const neutral = noiseAt(rung);
const base = draw(STREAK, []);
const basePx = pixels(base, 560);
const tiles = [];

// ---------------------------------------------------------------------------
console.log(`top rung: heart ${heart} (chroma ${chromaOf(rgbOf(heart))}), `
  + `neutral noise ${neutral} (luma ${luma(rgbOf(neutral)).toFixed(1)})\n`);

console.log("BLUE BLOOD -- strongest ink per hue family at the noise's exact luma");
console.log("family    ink       chroma  vs heart  shift    decodes");
const strongest = strongestAt(luma(rgbOf(neutral)));
const keep = [...BLUEBLOOD_BY_TIER];
for (const [fam, { rgb, chroma }] of [...strongest].sort((a, b) => b[1].chroma - a[1].chroma)) {
  if (fam === "grey") continue;
  const ink = hex(rgb);
  // Every rung gets the same hue, each scaled to its own luma, so the ladder
  // stays coherent rather than only the tier being previewed.
  for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) {
    const r = BLUEBLOOD_BY_TIER.length - 1 - i;
    const k = luma(rgbOf(noiseAt(r))) / luma(rgb);
    BLUEBLOOD_BY_TIER[i] = hex(rgb.map(v => v * k));
  }
  const svg = draw(STREAK, ["blueblood"]);
  const ok = decodes(svg);
  const s = shift(basePx, pixels(svg, 560));
  const heartChroma = chromaOf(rgbOf(heart));
  console.log(`${fam.padEnd(9)} ${ink}   ${String(chroma).padStart(5)}  `
    + `${chroma < heartChroma ? "under" : "OVER "}     ${String(s).padStart(3)}/255  `
    + `${ok === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok)}`);
  tiles.push({ group: "blueblood", label: `${fam} ${ink}`, svg, shift: s, ok, all: ok === SIZES.length });
}
for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = keep[i];

// ---------------------------------------------------------------------------
// BLOOM. The far end of the gradient has more freedom than the flat noise ink,
// because only part of the heart ever reaches it. Two axes are tried: darker
// at the same hue, and the same weight at a different hue.
console.log("\nBLOOM -- gradient far end");
console.log("candidate           far      shift    decodes");
const heartRgb = rgbOf(heart);
const farEnds = [
  ["shipped #c8102e", "#c8102e"],
  ["tier x0.60", hex(heartRgb.map(v => v * 0.60))],
  ["tier x0.45", hex(heartRgb.map(v => v * 0.45))],
  ["tier x0.30", hex(heartRgb.map(v => v * 0.30))],
  // Hue moves at roughly half the heart's weight: a colour shift reads more
  // strongly than a brightness shift at the same distance.
  ...[...strongestAt(luma(heartRgb) * 0.5)]
      .filter(([f]) => f !== "grey")
      .sort((a, b) => b[1].chroma - a[1].chroma)
      .slice(0, 3)
      .map(([f, { rgb }]) => [`half-luma ${f}`, hex(rgb)]),
];
for (const [label, far] of farEnds) {
  const svg = draw(STREAK, ["bloom"]).replace(
    /(<stop offset="1" stop-color=")#c8102e(")/, `$1${far}$2`);
  const ok = decodes(svg);
  const s = shift(basePx, pixels(svg, 560));
  console.log(`${label.padEnd(19)} ${far}  ${String(s).padStart(3)}/255  `
    + `${ok === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok)}`);
  tiles.push({ group: "bloom", label, svg, shift: s, ok, all: ok === SIZES.length });
}

// ---------------------------------------------------------------------------
const TILE = 250, LBL = 44, PAD = 22, COLS = 6;
const rows = Math.ceil(tiles.length / COLS);
const W = COLS * TILE + 2 * PAD, H = rows * (TILE + LBL) + 76;
const cells = canvasFor(1);
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="34" font-family="monospace" font-size="18" fill="#111">`
  + `MRO STRONGER INKS -- top rung, every tile decode-tested at ${SIZES.length} sizes</text>`;
tiles.forEach((t, i) => {
  const x = PAD + (i % COLS) * TILE, y = 58 + Math.floor(i / COLS) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${cells} ${cells}">${inner}</svg>`
    + `<text x="${x + 6}" y="${y + TILE - 4}" font-family="monospace" font-size="13" fill="#111">${t.group}: ${t.label}</text>`
    + `<text x="${x + 6}" y="${y + TILE + 14}" font-family="monospace" font-size="12" fill="${t.all ? "#666" : "#c8102e"}">`
    + `shift ${t.shift}/255, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok)}</text>`;
});
sheet += "</svg>";
writeFileSync(`${OUT}/stronger-inks.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nwrote ${OUT}/stronger-inks.png`);
