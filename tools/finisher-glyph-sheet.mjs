// THE FINISHER'S NUMBER IN ACTUAL ONES AND ZEROS.
//
// EXPLORATORY. Nothing here is adopted.
//
// The operator's question: not dots -- the real digits. A border of literal 1s
// and 0s, which a machine reads as a number and a human reads as writing. It
// puts the piece in the line of concrete poetry and typewriter art, where the
// characters ARE the picture.
//
// NO SVG <text>. EVER. A token drawn with a font depends on what the VIEWER has
// installed: the same token renders differently in two browsers and may not
// render at all in ten years. For a piece whose whole claim is permanence that
// is fatal, so every digit here is a PATH -- a 3x5 cell bitmap, self-contained,
// identical everywhere forever.
//
// WHAT IT COSTS. A legible digit needs 3x5 cells, so the border band grows from
// one cell to five and the canvas grows with it. The canvas is what the heart
// competes with: at one ring the code block is 72% of the picture by area, and
// every cell of band takes some of that back. The sheet prints the number so
// the trade is visible rather than argued.
//
//   ~/scripts/safe-build.sh node tools/finisher-glyph-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { pathFor, GAP, QUIET, TIERS, colourAt, inks, FIELD } from "./render-token.mjs";
import { BLOCK, THICK, frameCells } from "./frame-geometry.mjs";
import * as SHEET from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const { DEST, CODE, TARGET } = SHEET;
const OUT = process.env.MRO_SHEET_OUT ?? "out";
mkdirSync(OUT, { recursive: true });
const SIZES = [256, 848, 1600];

const INK = "#2f2f2f";
const BITS = 16;

/// 3x5 bitmaps. Drawn as cells, so they are shapes and not characters, and no
/// font has to exist anywhere for the token to look like itself.
const GLYPH = {
  0: ["111", "101", "101", "101", "111"],
  1: ["010", "110", "010", "010", "111"],
};
const GW = 3, GH = 5, GAP_X = 1;        // a digit, and the space after it
const BAND = GH;                         // the border band is one digit tall

// The inner picture is unchanged: rings, day frame, quiet zone, code block.
const INNER = 1 * 2 - 1 + GAP + THICK + BLOCK + THICK + GAP + (1 * 2 - 1);
const CANVAS = INNER + 2 * (BAND + 1);   // the digit band, plus a cell of air
const INNER_OFF = BAND + 1;

/// Digit positions clockwise round the band, starting at the top left.
function slots() {
  const out = [];
  const step = GW + GAP_X;
  const span = CANVAS - 2 * BAND;
  const n = Math.floor(span / step);
  const pad = BAND + Math.floor((span - n * step) / 2);
  for (let i = 0; i < n; i++) out.push({ x: pad + i * step, y: 0, rot: 0 });          // top
  for (let i = 0; i < n; i++) out.push({ x: CANVAS - BAND, y: pad + i * step, rot: 0 }); // right
  for (let i = n - 1; i >= 0; i--) out.push({ x: pad + i * step, y: CANVAS - GH, rot: 0 }); // bottom
  for (let i = n - 1; i >= 0; i--) out.push({ x: 0, y: pad + i * step, rot: 0 });     // left
  return out;
}
const SLOTS = slots();

function digitsPath(ordinal) {
  const word = ordinal.toString(2).padStart(BITS, "0").split("").map(Number);
  const set = new Set();
  SLOTS.forEach((s, i) => {
    const rows = GLYPH[word[i % BITS]];
    for (let r = 0; r < GH; r++) {
      for (let c = 0; c < GW; c++) {
        if (rows[r][c] !== "1") continue;
        const x = s.x + c, y = s.y + r;
        if (x < 0 || y < 0 || x >= CANVAS || y >= CANVAS) continue;
        set.add(y * CANVAS + x);
      }
    }
  });
  return { d: pathFor(set, CANVAS), runs: (pathFor(set, CANVAS).match(/M/g) || []).length };
}

function tile(rungIndex, digits) {
  const rung = TIERS.length - 1 - rungIndex;
  const colour = colourAt(rung);
  const { heartInk, noiseInk } = inks([], rung);
  const frameOff = INNER_OFF + (1 * 2 - 1) + GAP;
  const codeOff = frameOff + THICK + QUIET;

  const lit = new Set();
  for (const [x, y] of frameCells()) lit.add((y + frameOff) * CANVAS + (x + frameOff));

  const heart = new Set(), noise = new Set();
  for (let j = 0; j < CODE.size; j++) {
    for (let i = 0; i < CODE.size; i++) {
      if (!CODE.modules[j * CODE.size + i]) continue;
      const p = (codeOff + j) * CANVAS + (codeOff + i);
      (TARGET.want[j * CODE.size + i] ? heart : noise).add(p);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" shape-rendering="crispEdges">`
    + `<rect width="${CANVAS}" height="${CANVAS}" fill="${FIELD}"/>`
    + `<path fill="${INK}" d="${digits}"/>`
    + `<path fill="${colour}" d="${pathFor(lit, CANVAS)}"/>`
    + `<path fill="${noiseInk}" d="${pathFor(noise, CANVAS)}"/>`
    + `<path fill="${heartInk}" d="${pathFor(heart, CANVAS)}"/>`
    + `</svg>`;
}

const ORDINALS = [1, 2, 3, 40];

console.log(`payload ${DEST}`);
console.log(`canvas ${CANVAS} cells (was 53 with a one-cell ring)`);
console.log(`digit slots ${SLOTS.length} = ${(SLOTS.length / BITS).toFixed(2)} repeats of ${BITS} bits`);
console.log(`the code block is ${(100 * (BLOCK / CANVAS) ** 2).toFixed(0)}% of the picture by area`
  + `  (72% at a one-cell ring)\n`);

const rows = [];
let failures = 0;
for (const n of ORDINALS) {
  const g = digitsPath(n);
  const row = [];
  const bad = [];
  for (let ti = 0; ti < TIERS.length; ti += 2) {
    const svg = tile(ti, g.d);
    row.push(svg);
    for (const px of SIZES) {
      const res = scanResult(svg, px);
      if (!res.ok) bad.push(`t${ti}@${px}:${res.why}`);
      else if (res.destination !== DEST) bad.push(`t${ti}@${px}:wrong-dest`);
    }
  }
  rows.push(row);
  failures += bad.length;
  console.log(`finisher ${String(n).padStart(3)}  ${n.toString(2).padStart(BITS, "0")}`
    + `  ${String(g.runs).padStart(4)} runs  decodes ${9 - bad.length}/9`
    + (bad.length ? `  ${bad.slice(0, 3).join(" ")}` : ""));
}

const g2 = 2, cols = rows[0].length;
const totalW = CANVAS * cols + g2 * (cols - 1);
const totalH = CANVAS * rows.length + g2 * (rows.length - 1);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">`
  + `<rect width="${totalW}" height="${totalH}" fill="#ffffff"/>`
  + rows.map((row, r) => row.map((svg, c) =>
      `<svg x="${c * (CANVAS + g2)}" y="${r * (CANVAS + g2)}" width="${CANVAS}" height="${CANVAS}">`
      + svg.replace(/^<svg[^>]*>/, "<svg>") + `</svg>`).join("")).join("")
  + `</svg>`;
writeFileSync(`${OUT}/finisher-glyphs.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: 2200 } }).render().asPng());

console.log(`\nsheet ${OUT}/finisher-glyphs.png  (rows = finishers ${ORDINALS.join("/")})`);
console.log(`\nfor scale: a solid ring is 4 runs, the dashed echo ring 54 at 145,533 gas.`);
console.log(failures ? `${failures} decode rejections.` : `every tile decodes.`);
