// THE RING AS BINARY: the finisher's own number, written round the token.
//
// EXPLORATORY. Nothing here is adopted.
//
// THE IDEA. The outermost ring of a 53-cell canvas is exactly 208 cells, and
// 208 = 13 x 16. So a 16-bit finisher ordinal repeats THIRTEEN TIMES around the
// token: it fills the ring, it is readable from any arc long enough to hold one
// period, and it survives a corner being cropped or occluded.
//
// WHY IT BEATS A COLOUR. Five inks are PEERS -- nothing about teal says it is
// commoner than violet, so rarity has to be read from metadata. A binary ring
// is a RANK: finisher 3 and finisher 400 wear visibly different rings, and the
// number is machine-readable off the artwork. In a piece called Machine
// Readable Only, a ring that is itself readable is a better answer than a ring
// that is merely a colour.
//
// It also extends what the image already does: the day frame encodes `level` in
// its lit cells, so the artwork is already partly its own record.
//
// COST. A patterned ring is not free. The dashed echo ring measured 145,533 gas
// against a solid ring's 3,705, because a dash is many runs where a solid ring
// is four. A binary ring is the same class. Whether it fits depends on the
// worst case AFTER rings cap at one -- capping saved 134,353 gas on a founding
// token -- and that has NOT been measured for a child. Measure before adopting.
//
//   ~/scripts/safe-build.sh node tools/finisher-binary-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import {
  canvasFor, ringSpan, pathFor, GAP, QUIET,
  TIERS, colourAt, inks, FIELD,
} from "./render-token.mjs";
import { THICK, frameCells } from "./frame-geometry.mjs";
import * as SHEET from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const { DEST, CODE, TARGET } = SHEET;
const OUT = process.env.MRO_SHEET_OUT ?? "out";
mkdirSync(OUT, { recursive: true });
const SIZES = [256, 848, 1600];

// TWO TONES, NOT PRESENCE AND ABSENCE.
//
// The first version lit a cell for a 1 and left a 0 empty, so the ring's
// DENSITY was the popcount of the number -- arbitrary. Finisher 1 is
// 0000000000000001: thirteen lit cells out of 208, the faintest ring in the
// piece on the rarest token in it. It read as scattered dirt, not as a mark.
//
// Drawing both states fixes it completely: the ring is always a complete band,
// every finisher's is equally present, and the number lives in the CONTRAST
// between two inks rather than in whether a cell exists.
const ONE = "#3a3a3a";    // a 1 bit
const ZERO = "#cfc9cb";   // a 0 bit: pale, but unmistakably part of the ring
const BITS = 16;

/// The ring's cells in ONE order, clockwise from the top-left corner.
///
/// The order is the encoding's alphabet: a reader that walks it the other way
/// reads a different number, so it is fixed here and would be published rather
/// than inferred.
function ringCells(canvas) {
  const cells = [];
  const last = canvas - 1;
  for (let x = 0; x <= last; x++) cells.push([x, 0]);           // top, left to right
  for (let y = 1; y <= last; y++) cells.push([last, y]);        // right, down
  for (let x = last - 1; x >= 0; x--) cells.push([x, last]);    // bottom, right to left
  for (let y = last - 1; y >= 1; y--) cells.push([0, y]);       // left, up
  return cells;
}

/// The ordinal as a 16-bit word, repeated to fill the ring. A cell is ink where
/// its bit is 1.
function binaryRing(ordinal, canvas) {
  const cells = ringCells(canvas);
  const word = [];
  for (let b = BITS - 1; b >= 0; b--) word.push((ordinal >> b) & 1);
  const ones = new Set(), zeros = new Set();
  cells.forEach(([x, y], i) => {
    (word[i % BITS] ? ones : zeros).add(y * canvas + x);
  });
  return { ones: pathFor(ones, canvas), zeros: pathFor(zeros, canvas),
           periods: cells.length / BITS, cells: cells.length };
}

function tile(rungIndex, paintRing) {
  const rung = TIERS.length - 1 - rungIndex;
  const colour = colourAt(rung);
  const { heartInk, noiseInk } = inks([], rung);
  const canvas = canvasFor(1, 0);
  const frameOff = ringSpan(1) + GAP;
  const codeOff = frameOff + THICK + QUIET;

  const lit = new Set();
  for (const [x, y] of frameCells()) lit.add((y + frameOff) * canvas + (x + frameOff));

  const heart = new Set(), noise = new Set();
  for (let j = 0; j < CODE.size; j++) {
    for (let i = 0; i < CODE.size; i++) {
      if (!CODE.modules[j * CODE.size + i]) continue;
      const p = (codeOff + j) * canvas + (codeOff + i);
      (TARGET.want[j * CODE.size + i] ? heart : noise).add(p);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}" shape-rendering="crispEdges">`
    + `<rect width="${canvas}" height="${canvas}" fill="${FIELD}"/>`
    + paintRing(canvas)
    + `<path fill="${colour}" d="${pathFor(lit, canvas)}"/>`
    + `<path fill="${noiseInk}" d="${pathFor(noise, canvas)}"/>`
    + `<path fill="${heartInk}" d="${pathFor(heart, canvas)}"/>`
    + `</svg>`;
}

// Ordinals chosen to look as different from each other as possible: the first
// finisher, a single-digit one, one in the tens, and one past the caps.
const ORDINALS = [1, 3, 42, 365, 1024];

const W = canvasFor(1, 0);
let info = null;
const rows = [];

console.log(`payload ${DEST}`);
for (const n of ORDINALS) {
  const paint = (canvas) => {
    const r = binaryRing(n, canvas);
    info = r;
    return `<path fill="${ZERO}" d="${r.zeros}"/><path fill="${ONE}" d="${r.ones}"/>`;
  };
  const row = [];
  const bad = [];
  for (const ti of [0, 2, 4]) {
    const svg = tile(ti, paint);
    row.push(svg);
    for (const px of SIZES) {
      const res = scanResult(svg, px);
      if (!res.ok) bad.push(`t${ti}@${px}:${res.why}`);
      else if (res.destination !== DEST) bad.push(`t${ti}@${px}:wrong-dest`);
    }
  }
  rows.push(row);
  console.log(`finisher ${String(n).padStart(4)}  ${n.toString(2).padStart(BITS, "0")}`
    + `   decodes ${9 - bad.length}/9` + (bad.length ? `  ${bad.join(" ")}` : ""));
}

console.log(`\nring is ${info.cells} cells = ${info.periods} repeats of a ${BITS}-bit word`);

const g = 2, cols = 3;
const totalW = W * cols + g * (cols - 1);
const totalH = W * rows.length + g * (rows.length - 1);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">`
  + `<rect width="${totalW}" height="${totalH}" fill="#e8e8e8"/>`
  + rows.map((row, r) => row.map((svg, c) =>
      `<svg x="${c * (W + g)}" y="${r * (W + g)}" width="${W}" height="${W}">`
      + svg.replace(/^<svg[^>]*>/, "<svg>") + `</svg>`).join("")).join("")
  + `</svg>`;
writeFileSync(`${OUT}/finisher-binary.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: 1700 } }).render().asPng());
console.log(`sheet ${OUT}/finisher-binary.png  (rows = finisher 1/3/42/365/1024, columns = tiers)`);
