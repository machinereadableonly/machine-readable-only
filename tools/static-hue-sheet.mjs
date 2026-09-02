// STATIC's hue, compared fairly across the whole streak ladder.
//
// This exists because the two sheets that already touch this question cannot
// answer it side by side. `noise-mark-sheet.mjs` renders slate, teal and violet
// at FULL strength (chroma 50-77) and omits green; `green-violet-sheet.mjs`
// renders green under the CHROMA RULE (60% of the heart's) and omits the other
// three. Comparing them would be comparing two different rules, so nothing in
// either sheet decides anything.
//
// Here every hue is derived by the SAME rule, so the only variable left is the
// hue itself:
//
//   1. land on that rung's exact BT.601 luma -- the binarizer reads weight, not
//      hue, and an ink lighter than its heart resolves to background at large
//      rasters. This is not negotiable at any hue.
//   2. carry chroma at 60% of that rung's heart, so the noise never becomes
//      more saturated than the heart it surrounds.
//
// AND EVERY COLUMN IS A STATE STATIC CAN ACTUALLY BE WORN IN. The older sheet
// shows "day one", which Static can never be seen in: it is gated at level 30.
// The columns here are the five streak rungs at a level that has passed the
// gate, which is the whole space of pictures a buyer can actually get.
//
//   node tools/static-hue-sheet.mjs      (through ~/scripts/safe-build.sh)
//
// Writes tools/out/marks/static-hues.png.
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, canvasFor, BLUEBLOOD_BY_TIER, TIERS, colourAt, rungOf, noiseAt, STATIC,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
// Mask 7 is what robust-solve picks for token 1, so this is the shipped bitmap.
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
/// Pull a hue toward its own grey without moving its luma.
const toward = ([r, g, b], t) => {
  const m = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r + (m - r) * t, g + (m - g) * t, b + (m - b) * t];
};

/// The candidates. `rgb` null means the shipped neutral greys, kept as the
/// control -- without it there is nothing to judge "more visible" against.
const HUES = [
  { name: "shipped grey", rgb: null },
  { name: "green",        rgb: [0, 124, 8] },
  { name: "slate",        rgb: [60, 90, 130] },
  { name: "teal",         rgb: [40, 100, 95] },
  { name: "violet",       rgb: [100, 75, 135] },
];

/// One ink per rung under both rules. Identical derivation for every hue, which
/// is the only reason the columns can be compared.
function inksFor(dir) {
  return TIERS.map((_, i) => {
    const rung = TIERS.length - 1 - i;
    if (dir === null) return noiseAt(rung);
    const wanted = chromaOf(rgbOf(colourAt(rung))) * 0.60;
    const target = luma(rgbOf(noiseAt(rung)));
    let ink = atLuma(toward(dir, 0.95), target);
    for (let m = 0.95; m >= 0; m -= 0.01) {
      ink = atLuma(toward(dir, m), target);
      if (chromaOf(ink) >= wanted) break;
    }
    return hex(ink);
  });
}

/// One streak per rung, so the columns walk the ladder. Level is 200 for every
/// tile: past Static's level-30 gate, and short of a year ring.
const RUNGS = [
  { streak: 1,   label: "run 1" },
  { streak: 3,   label: "run 3" },
  { streak: 7,   label: "run 7" },
  { streak: 30,  label: "run 30" },
  { streak: 100, label: "run 100" },
];

const stateFor = streak => ({
  level: 200, streak, years: 0, marks: [], lastDay: 20700, today: 20700,
});
const draw = (streak, marks) =>
  renderSvg(CODE.modules, TARGET.want, CODE.size, { ...stateFor(streak), marks });

/// Read the native buffer ONCE. `.pixels` is a getter that copies the whole
/// buffer on every access, which once turned a 3.7-second job into 25 minutes.
const pixels = (svg, px) => new Resvg(svg, { fitTo: { mode: "width", value: px } }).render().pixels;
const shift = (a, b) => {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > max) max = d;
  }
  return max;
};
const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

// The bare token at each rung, rendered once and reused as the shift baseline.
const bare = RUNGS.map(r => pixels(draw(r.streak, []), 560));

const keep = [...BLUEBLOOD_BY_TIER];
const tiles = [];

console.log("STATIC HUE COMPARISON -- one rule for every hue");
console.log("chroma 60% of the heart's, on that rung's exact luma\n");
console.log("hue           run    heart    noise    chroma  vs heart  shift    decodes");

for (const h of HUES) {
  const inks = inksFor(h.rgb);
  // The palette is a module-level array, so a candidate is written in and put
  // back immediately after. Nothing here is meant to ship.
  for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = inks[i];

  RUNGS.forEach((r, ri) => {
    const rung = rungOf(r.streak);
    const ink = inks[TIERS.length - 1 - rung];
    const heart = colourAt(rung);
    const svg = draw(r.streak, [STATIC]);
    const ok = decodesAt(svg);
    const d = shift(bare[ri], pixels(svg, 560));
    const hc = chromaOf(rgbOf(heart));
    const nc = chromaOf(rgbOf(ink));
    console.log(
      `${h.name.padEnd(13)} ${r.label.padEnd(6)} ${heart}  ${ink}  ` +
      `${String(nc).padStart(6)}  ${nc < hc ? "under" : "OVER "}     ` +
      `${String(d).padStart(3)}/255  ` +
      `${ok.length === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok.length)}`
    );
    tiles.push({
      hue: h.name, run: r.label, svg, ink, shift: d,
      ok, all: ok.length === SIZES.length,
    });
  });
}
for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = keep[i];

// One row per hue, one column per rung, weakest run on the left.
const TILE = 230, LBL = 40, PAD = 24, HEAD = 74, ROWLBL = 26;
const COLS = RUNGS.length;
const rows = HUES.length;
const W = COLS * TILE + 2 * PAD;
const H = rows * (TILE + LBL + ROWLBL) + HEAD;
const canvas = canvasFor(0);

let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="30" font-family="monospace" font-size="17" fill="#111">`
  + `MRO STATIC -- which hue for the noise ink</text>`
  + `<text x="${PAD}" y="52" font-family="monospace" font-size="12" fill="#666">`
  + `every hue under the same rule; weakest run on the left; all states past Static's level-30 gate</text>`;

tiles.forEach((t, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x = PAD + col * TILE;
  const y = HEAD + row * (TILE + LBL + ROWLBL) + ROWLBL;
  if (col === 0) {
    sheet += `<text x="${PAD}" y="${y - 8}" font-family="monospace" font-size="15" fill="#111">`
      + `${t.hue}</text>`;
  }
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${canvas} ${canvas}">${inner}</svg>`
    + `<text x="${x + 6}" y="${y + TILE - 4}" font-family="monospace" font-size="12" fill="#111">`
    + `${t.run}, ${t.ink}</text>`
    + `<text x="${x + 6}" y="${y + TILE + 14}" font-family="monospace" font-size="11.5" fill="${t.all ? "#666" : "#c8102e"}">`
    + `shift ${t.shift}/255, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok.length)}</text>`;
});
sheet += "</svg>";

const dest = OUT + "/static-hues.png";
writeFileSync(dest, new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log("\nwrote " + dest);
