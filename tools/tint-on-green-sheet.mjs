// TINT's three inks against a GREEN noise -- the one render the spec left open.
//
// Tint's palette (violet, ink, gold) was chosen from eye-colourway-sheet.mjs,
// which draws the eyes against the SHIPPED NEUTRAL noise. Static then took green
// on 2026-09-02, and Static's noise is the surface that directly surrounds the
// three eyes. So every ink in the palette was picked against a background that
// half the tokens wearing Tint will not have.
//
// Heart red and crown gold were ruled out of the palette by the same adjacency
// argument that this sheet exists to test, so the argument is worth measuring
// rather than trusting: red because the untinted Iris already draws in the
// token's own colour, green because it is now Static's.
//
// WHAT IS BEING JUDGED. Not decoding -- reshaped eyes were already decoded at
// every shape and ink. It is whether the eye stays a distinct object against the
// green, at both ends of the ladder: the green is nearly grey at run 1 and fully
// saturated at run 100+, so an ink can collide at one end and not the other.
//
// Static and Beat exclude each other, so a green-noise token can never wear
// Beat. Tint's violet against BEAT's violet is therefore a different question
// and a different sheet.
//
//   node tools/tint-on-green-sheet.mjs      (through ~/scripts/safe-build.sh)
//
// Writes tools/out/marks/tint-on-green.png and tint-on-green-shapes.png.
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, canvasFor, BLUEBLOOD_BY_TIER, TIERS, colourAt, rungOf, noiseAt,
  QUIET, FIELD, STATIC,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = new URL("./out/marks", import.meta.url).pathname;
const S = CODE.size;

const canvas = canvasFor(1);
const RING = 1, GAP = 1;
const THICK = (canvas - 45) / 2 - RING - GAP;
const codeOff = RING + GAP + THICK + QUIET;
const EYES = [[0, 0], [S - 7, 0], [0, S - 7]];

const GREEN = [0, 124, 8];
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
/// Static's green per rung, same derivation as static-hue-sheet.mjs.
const greenInks = () => TIERS.map((_, i) => {
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

/// The three shapes adopted for the bought Iris, with the measured geometry.
const SHAPES = {
  target:   { kind: "circle", rx: [0, 0, 0] },
  squircle: { kind: "rect",   rx: [3, 2.1, 1.5] },
  leaf:     { kind: "leaf",   rx: [2.6, 1.8, 1.3] },
};

const shape = (kind, x, y, w, fill, rx) => {
  const cx = x + w / 2;
  if (kind === "circle") return `<circle cx="${cx}" cy="${y + w / 2}" r="${w / 2}" fill="${fill}"/>`;
  if (kind === "leaf") {
    const r = rx;
    return `<path fill="${fill}" d="M${x + r} ${y}h${w - r}v${w - r}`
      + `a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}v-${w - r}a${r} ${r} 0 0 1 ${r} -${r}z"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${w}" `
    + (rx ? `rx="${rx}" ` : "") + `fill="${fill}"/>`;
};

/// Erase each 7x7 to the GROUND and draw the eye on top. The ground here is the
/// field: Static tints the noise INK, not the page, and neither Hush nor Aura is
/// worn in any tile. A constant would be wrong on a Hush token, which is the
/// defect the combination sweep caught in the first eye prototype.
function withEyes(svg, style, ink) {
  let add = "";
  for (const [ex, ey] of EYES) {
    const x = codeOff + ex, y = codeOff + ey;
    add += `<rect x="${x}" y="${y}" width="7" height="7" fill="${FIELD}"/>`;
    add += shape(style.kind, x, y, 7, ink, style.rx[0]);
    add += shape(style.kind, x + 1, y + 1, 5, FIELD, style.rx[1]);
    add += shape(style.kind, x + 2, y + 2, 3, ink, style.rx[2]);
  }
  return svg.replace(/<\/svg>$/, `${add}</svg>`);
}

const RUNGS = [
  { streak: 1,   label: "run 1" },
  { streak: 3,   label: "run 3" },
  { streak: 7,   label: "run 7" },
  { streak: 30,  label: "run 30" },
  { streak: 100, label: "run 100" },
];

/// null ink means the UNTINTED Iris, which draws in the token's own colour.
/// It is the thing Tint is bought to replace, so it is the control.
const INKS = [
  { name: "untinted (control)", hex: null },
  { name: "violet",             hex: "#9800fc" },
  { name: "ink",                hex: "#2b2b2e" },
  { name: "gold",               hex: "#b8860b" },
];

const inks = greenInks();
const keep = [...BLUEBLOOD_BY_TIER];

/// A token wearing Static, at one rung, with an Iris in the given shape/ink.
function tile(streak, rung, style, tintHex) {
  for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = inks[i];
  const base = renderSvg(CODE.modules, TARGET.want, CODE.size,
    { level: 200, streak, years: 1, marks: [STATIC], lastDay: 20700, today: 20700 });
  for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = keep[i];
  return withEyes(base, style, tintHex ?? colourAt(rung));
}

const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

function draw(tiles, cols, title, sub, dest, rowKey, colKey) {
  const TILE = 230, LBL = 40, PAD = 24, HEAD = 74, ROWLBL = 26;
  const rowsN = Math.ceil(tiles.length / cols);
  const W = cols * TILE + 2 * PAD, H = rowsN * (TILE + LBL + ROWLBL) + HEAD;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/>`
    + `<text x="${PAD}" y="30" font-family="monospace" font-size="17" fill="#111">${title}</text>`
    + `<text x="${PAD}" y="52" font-family="monospace" font-size="12" fill="#666">${sub}</text>`;
  tiles.forEach((t, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = PAD + col * TILE, y = HEAD + row * (TILE + LBL + ROWLBL) + ROWLBL;
    if (col === 0) {
      s += `<text x="${PAD}" y="${y - 8}" font-family="monospace" font-size="15" fill="#111">${t[rowKey]}</text>`;
    }
    const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    s += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${canvas} ${canvas}">${inner}</svg>`
      + `<text x="${x + 6}" y="${y + TILE - 4}" font-family="monospace" font-size="12" fill="#111">${t[colKey]}, noise ${t.green}</text>`
      + `<text x="${x + 6}" y="${y + TILE + 14}" font-family="monospace" font-size="11.5" fill="${t.all ? "#666" : "#c8102e"}">`
      + `eye ${t.eye}, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok.length)}</text>`;
  });
  writeFileSync(dest, new Resvg(s + "</svg>", { fitTo: { mode: "width", value: W } }).render().asPng());
  console.log("wrote " + dest);
}

// --- Sheet 1: ink x rung, target shape -------------------------------------
console.log("TINT INKS AGAINST A GREEN NOISE -- target shape\n");
console.log("ink                  run      eye      green    lumaGap  decodes");
const a = [];
for (const ink of INKS) {
  for (const r of RUNGS) {
    const rung = rungOf(r.streak);
    const green = inks[TIERS.length - 1 - rung];
    const eye = ink.hex ?? colourAt(rung);
    const svg = tile(r.streak, rung, SHAPES.target, ink.hex);
    const ok = decodesAt(svg);
    const gap = Math.abs(luma(rgbOf(eye)) - luma(rgbOf(green)));
    console.log(`${ink.name.padEnd(20)} ${r.label.padEnd(8)} ${eye}  ${green}  `
      + `${gap.toFixed(1).padStart(7)}  ${ok.length === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok.length)}`);
    a.push({ ink: ink.name, run: r.label, green, eye, svg, ok, all: ok.length === SIZES.length });
  }
}
draw(a, RUNGS.length,
  "MRO TINT ON GREEN -- the three inks against Static's noise",
  "target shape; weakest run on the left; the untinted Iris is the control",
  OUT + "/tint-on-green.png", "ink", "run");

// --- Sheet 2: ink x shape, top rung ----------------------------------------
console.log("\nSAME INKS, ALL THREE SHAPES, at the strongest green (run 100)");
console.log("ink                  shape      eye      green    decodes");
const b = [];
for (const ink of INKS) {
  for (const [name, style] of Object.entries(SHAPES)) {
    const rung = rungOf(100);
    const green = inks[TIERS.length - 1 - rung];
    const eye = ink.hex ?? colourAt(rung);
    const svg = tile(100, rung, style, ink.hex);
    const ok = decodesAt(svg);
    console.log(`${ink.name.padEnd(20)} ${name.padEnd(10)} ${eye}  ${green}  `
      + `${ok.length === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok.length)}`);
    b.push({ ink: ink.name, run: name, green, eye, svg, ok, all: ok.length === SIZES.length });
  }
}
draw(b, Object.keys(SHAPES).length,
  "MRO TINT ON GREEN -- all three shapes at the strongest green",
  "run 100, where Static's green is most saturated",
  OUT + "/tint-on-green-shapes.png", "ink", "run");

const fails = [...a, ...b].filter(t => !t.all);
console.log(fails.length ? `\n${fails.length} tiles FAIL somewhere.`
  : `\nAll ${a.length + b.length} tiles decode at all ${SIZES.length} sizes.`);
