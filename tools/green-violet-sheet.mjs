// Blue Blood in green, Bloom in violet -- across the whole tier ladder.
//
// Neither can be a single hex value. Both inks are DERIVED per rung and both
// have a rule attached:
//
//   Blue Blood must land on its rung's exact BT.601 luma (the binarizer reads
//   weight, not hue) AND stay less saturated than the heart it surrounds, or
//   the noise becomes the subject. That second rule binds hardest at day one,
//   where the heart carries chroma 25 -- the least on the ladder.
//
//   Bloom's far end has no chroma rule, because it is inside the heart rather
//   than beside it. Its constraint is only that the code still decodes.
//
// So a green at the top rung is not the same green at the bottom, and this
// prints what each rung actually gets.
//
//   node tools/green-violet-sheet.mjs    (through ~/scripts/safe-build.sh)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, canvasFor, BLUEBLOOD_BY_TIER, TIERS, colourAt, rungOf, noiseAt,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = new URL("./out/marks", import.meta.url).pathname;

const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const chromaOf = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const hex = ([r, g, b]) => "#" + [r, g, b].map(v =>
  Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const atLuma = ([r, g, b], t) => {
  const k = t / (0.299 * r + 0.587 * g + 0.114 * b);
  return [r * k, g * k, b * k];
};
const toward = ([r, g, b], t) => {
  const m = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r + (m - r) * t, g + (m - g) * t, b + (m - b) * t];
};

const GREEN = [0, 124, 8];      // the strongest green found at the noise luma
const VIOLET = [28, 0, 252];    // the strongest violet at half the heart's luma

/// Green for the noise, one ink per rung: pulled toward grey until its chroma
/// is 60% of that rung's heart, then put back on that rung's exact luma.
function greenInks() {
  return TIERS.map((_, i) => {
    const rung = TIERS.length - 1 - i;
    const wanted = chromaOf(rgbOf(colourAt(rung))) * 0.60;
    const target = luma(rgbOf(noiseAt(rung)));
    let ink = atLuma(toward(GREEN, 0.95), target);
    for (let m = 0.95; m >= 0; m -= 0.01) {
      ink = atLuma(toward(GREEN, m), target);
      if (chromaOf(ink) >= wanted) break;
    }
    return hex(ink);
  });
}

const stateFor = (streak, marks) => ({
  level: 200, streak, years: 1, marks, lastDay: 20700, today: 20700,
});
const draw = (streak, marks) => renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, marks));
const pixels = (svg, px) => {
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
const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

const STREAKS = [1, 10, 45, 150];
const tiles = [];

console.log("BLUE BLOOD in green -- chroma 60% of the heart's, luma unchanged");
console.log("streak  heart    green    chroma  vs heart  shift    decodes");
const keep = [...BLUEBLOOD_BY_TIER];
const inks = greenInks();
for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = inks[i];
for (const s of STREAKS) {
  const rung = rungOf(s);
  const ink = inks[TIERS.length - 1 - rung];
  const heart = colourAt(rung);
  const svg = draw(s, ["blueblood"]);
  const ok = decodesAt(svg);
  const d = shift(pixels(draw(s, []), 560), pixels(svg, 560));
  const hc = chromaOf(rgbOf(heart)), nc = chromaOf(rgbOf(ink));
  console.log(`${String(s).padStart(6)}  ${heart}  ${ink}  ${String(nc).padStart(6)}  `
    + `${nc < hc ? "under" : "OVER "}     ${String(d).padStart(3)}/255  `
    + `${ok.length === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok.length)}`);
  tiles.push({ label: `green noise, streak ${s}`, svg, shift: d, ok, all: ok.length === SIZES.length });
}
for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = keep[i];

console.log("\nBLOOM in violet -- gradient far end at half the heart's luma");
console.log("streak  heart    far      shift    decodes");
for (const s of STREAKS) {
  const heart = colourAt(rungOf(s));
  const far = hex(atLuma(VIOLET, luma(rgbOf(heart)) * 0.5));
  const svg = draw(s, ["bloom"]).replace(
    /(<stop offset="1" stop-color=")#c8102e(")/, `$1${far}$2`);
  const ok = decodesAt(svg);
  const d = shift(pixels(draw(s, []), 560), pixels(svg, 560));
  console.log(`${String(s).padStart(6)}  ${heart}  ${far}  ${String(d).padStart(3)}/255  `
    + `${ok.length === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok.length)}`);
  tiles.push({ label: `violet bloom, streak ${s}`, svg, shift: d, ok, all: ok.length === SIZES.length });
}

const TILE = 240, LBL = 42, PAD = 22, COLS = 4;
const rows = Math.ceil(tiles.length / COLS);
const W = COLS * TILE + 2 * PAD, H = rows * (TILE + LBL) + 72;
const canvas = canvasFor(1);
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="32" font-family="monospace" font-size="17" fill="#111">`
  + `MRO GREEN NOISE / VIOLET BLOOM -- weakest streak on the left</text>`;
tiles.forEach((t, i) => {
  const x = PAD + (i % COLS) * TILE, y = 54 + Math.floor(i / COLS) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${canvas} ${canvas}">${inner}</svg>`
    + `<text x="${x + 6}" y="${y + TILE - 6}" font-family="monospace" font-size="12.5" fill="#111">${t.label}</text>`
    + `<text x="${x + 6}" y="${y + TILE + 12}" font-family="monospace" font-size="11.5" fill="${t.all ? "#666" : "#c8102e"}">`
    + `shift ${t.shift}/255, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok.length)}</text>`;
});
sheet += "</svg>";
writeFileSync(`${OUT}/green-violet.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nwrote ${OUT}/green-violet.png`);
