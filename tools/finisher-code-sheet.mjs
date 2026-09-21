// THE FINISHER'S NUMBER, WRITTEN ROUND THE TOKEN.
//
// EXPLORATORY. Nothing here is adopted.
//
// The ring is not a colour. It is the finisher's ordinal -- were you the first
// to complete a year, or the fortieth -- encoded in the ring's own cells, so
// the rank is readable off the artwork by a machine and visibly different for
// every finisher. A coloured ring is decoration on an already-square image;
// this is the piece doing what its name says.
//
// THREE THINGS THE EARLIER DRAFTS GOT WRONG, all fixed here.
//
// 1. PRESENCE AND ABSENCE READS AS DIRT. Lighting a cell for a 1 and leaving a
//    0 empty made the ring's density the popcount of the number, so finisher 1
//    (0000000000000001) got thirteen lit cells out of 208 and looked like
//    scattered specks. BOTH STATES ARE DRAWN: a 1 is dark, a 0 is pale, and the
//    ring is always a complete band.
//
// 2. DENSITY MUST NOT CARRY ACCIDENTAL MEANING. Even drawn in two tones, a raw
//    binary number varies in darkness for no reason -- the rarest token could
//    look the plainest. CONSTANT WEIGHT fixes it: every codeword has exactly 8
//    dark cells in 16, so all finishers' rings weigh the same and only the
//    ARRANGEMENT differs.
//
// 3. THE CODEBOOK IS CHOSEN FOR CHEAPNESS. There are 12,870 balanced 16-bit
//    words and only 256 are needed. Picking the ones that draw in the fewest
//    path runs takes the worst case from 104 runs to 66 -- an estimated 280,000
//    gas down to 178,000, against roughly 310,000 of headroom once rings cap at
//    one. That estimate is derived from the dashed echo ring's measured cost
//    and MUST be measured for real before anything is adopted.
//
// The ring is 208 cells on a 53-cell canvas and 208 = 13 x 16, so the word
// repeats THIRTEEN times: readable from any arc long enough to hold one period,
// and it survives a corner being cropped.
//
//   ~/scripts/safe-build.sh node tools/finisher-code-sheet.mjs
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

const BITS = 16;
const WEIGHT = 8;
const ONE = "#2f2f2f";     // a 1 bit
const ZERO = "#d8d2d4";    // a 0 bit: pale, but unmistakably part of the band

const canvas = canvasFor(1, 0);

/// The ring's cells clockwise from the top-left corner. This order IS the
/// encoding's alphabet -- a reader walking it the other way reads a different
/// number -- so it would be published rather than left to be inferred.
function ringCells(c) {
  const out = [], last = c - 1;
  for (let x = 0; x <= last; x++) out.push([x, 0]);
  for (let y = 1; y <= last; y++) out.push([last, y]);
  for (let x = last - 1; x >= 0; x--) out.push([x, last]);
  for (let y = last - 1; y >= 1; y--) out.push([0, y]);
  return out;
}
const CELLS = ringCells(canvas);

const setsFor = word => {
  const ones = new Set(), zeros = new Set();
  CELLS.forEach(([x, y], i) => {
    ((word >> (BITS - 1 - (i % BITS))) & 1 ? ones : zeros).add(y * canvas + x);
  });
  return { ones, zeros };
};
const runsOf = set => (pathFor(set, canvas).match(/M/g) || []).length;

/// THE CODEBOOK: the 256 balanced words that draw in the fewest runs, cheapest
/// first. Generated here; in the build it would be a fixed published table,
/// because the mapping from ordinal to pattern must never drift.
const CODEBOOK = (() => {
  const scored = [];
  for (let w = 0; w < 1 << BITS; w++) {
    let c = 0;
    for (let b = 0; b < BITS; b++) if ((w >> b) & 1) c++;
    if (c !== WEIGHT) continue;
    scored.push([w, runsOf(setsFor(w).ones)]);
  }
  scored.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return scored.slice(0, 256);
})();

function ringPaint(ordinal) {
  const [word] = CODEBOOK[(ordinal - 1) % CODEBOOK.length];
  const { ones, zeros } = setsFor(word);
  return {
    svg: `<path fill="${ZERO}" d="${pathFor(zeros, canvas)}"/>`
       + `<path fill="${ONE}" d="${pathFor(ones, canvas)}"/>`,
    word, runs: runsOf(ones),
  };
}

function tile(rungIndex, paint) {
  const rung = TIERS.length - 1 - rungIndex;
  const colour = colourAt(rung);
  const { heartInk, noiseInk } = inks([], rung);
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
    + paint
    + `<path fill="${colour}" d="${pathFor(lit, canvas)}"/>`
    + `<path fill="${noiseInk}" d="${pathFor(noise, canvas)}"/>`
    + `<path fill="${heartInk}" d="${pathFor(heart, canvas)}"/>`
    + `</svg>`;
}

// The first finishers, plus one deep in the run, so consecutive numbers can be
// compared as well as distant ones.
const ORDINALS = [1, 2, 3, 4, 40];

console.log(`payload ${DEST}`);
console.log(`codebook: 256 balanced words, ${CODEBOOK[0][1]}-${CODEBOOK[255][1]} runs`);
console.log(`ring ${CELLS.length} cells = ${CELLS.length / BITS} repeats of a ${BITS}-bit word\n`);

const rows = [];
let failures = 0;
for (const n of ORDINALS) {
  const p = ringPaint(n);
  const row = [];
  const bad = [];
  for (let ti = 0; ti < TIERS.length; ti++) {
    const svg = tile(ti, p.svg);
    row.push(svg);
    for (const px of SIZES) {
      const res = scanResult(svg, px);
      if (!res.ok) bad.push(`t${ti}@${px}:${res.why}`);
      else if (res.destination !== DEST) bad.push(`t${ti}@${px}:wrong-dest`);
    }
  }
  rows.push(row);
  failures += bad.length;
  console.log(`finisher ${String(n).padStart(3)}  word ${p.word.toString(2).padStart(BITS, "0")}`
    + `  ${String(p.runs).padStart(3)} runs  decodes `
    + `${TIERS.length * SIZES.length - bad.length}/${TIERS.length * SIZES.length}`
    + (bad.length ? `  ${bad.slice(0, 3).join(" ")}` : ""));
}

const g = 2, cols = TIERS.length;
const totalW = canvas * cols + g * (cols - 1);
const totalH = canvas * rows.length + g * (rows.length - 1);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">`
  + `<rect width="${totalW}" height="${totalH}" fill="#ffffff"/>`
  + rows.map((row, r) => row.map((svg, c) =>
      `<svg x="${c * (canvas + g)}" y="${r * (canvas + g)}" width="${canvas}" height="${canvas}">`
      + svg.replace(/^<svg[^>]*>/, "<svg>") + `</svg>`).join("")).join("")
  + `</svg>`;
writeFileSync(`${OUT}/finisher-code.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: 2400 } }).render().asPng());

console.log(`\nsheet ${OUT}/finisher-code.png  (rows = finishers ${ORDINALS.join("/")}, columns = tiers)`);
console.log(failures ? `\n${failures} decode rejections.` : `\nevery ring decodes at every tier.`);
