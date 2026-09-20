// The six looks a finisher's ring can wear. EXPLORATORY -- nothing here is
// adopted, and the treatments are a proposal for the operator to react to.
//
// One ring, five looks, plus the DEFAULT a token wears while it is whole and
// has not claimed yet. That window is real: a token is whole the moment it
// reaches 365 and the claim takes a day to reach the chain.
//
// Every tile is a complete finished token -- field, full day frame, the ring,
// and the real solved code -- drawn against the REAL domain through
// sheet-code.mjs. A bitmap encodes its own url, so a ring judged beside an
// example.com code would be judged beside a token nobody mints.
//
// Each treatment is PRICED in the header of its entry, from the measurements in
// test/GasProfile.t.sol: an ink change is free, a solid ring is 3,705 gas, a
// doubled ring about 7,400, and a dash is 145,533 because it is 54 runs where a
// solid ring is four. Only one dash fits the budget.
//
//   ~/scripts/safe-build.sh node tools/finisher-ring-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import {
  canvasFor, ringSpan, pathFor, GAP, QUIET,
  colourAt, rungOf, inks, FIELD, GHOST, VESSEL_GOLD, TINT_VIOLET,
} from "./render-token.mjs";
import { BLOCK, THICK, frameCells } from "./frame-geometry.mjs";
import * as SHEET from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const { DEST, CODE, TARGET } = SHEET;
// Written to the gitignored tools/out, the same place preview.mjs uses.
// NEVER hardcode a session scratchpad path here: it carries the operator's
// username into a PUBLIC repository. Override with MRO_SHEET_OUT if needed.
const OUT = process.env.MRO_SHEET_OUT ?? "out";
mkdirSync(OUT, { recursive: true });
const SIZES = [256, 350, 500, 700, 848, 900, 1080, 1424, 1600];

// A finished token: whole, a deep live run, one ring of its own.
const STREAK = 365;
const RUNG = rungOf(STREAK);
const COLOUR = colourAt(RUNG);
const { heartInk, noiseInk } = inks([], RUNG);

/// One ring's bars at depth `o`, exactly as ringBars draws them.
function ringAt(o, canvas) {
  const len = canvas - 2 * o;
  let d = `M${o} ${o}h${len}v1h-${len}z` + `M${o} ${canvas - 1 - o}h${len}v1h-${len}z`;
  const h = len - 2;
  if (h > 0) d += `M${o} ${o + 1}h1v${h}h-1z` + `M${canvas - 1 - o} ${o + 1}h1v${h}h-1z`;
  return d;
}

/// The same ring as a DASH: two cells on, two off, the rule the echo ring uses.
/// Costs 145,533 gas against a solid ring's 3,705, so at most one treatment can
/// be this.
function dashRingAt(o, canvas) {
  const len = canvas - 2 * o;
  const last = o + len - 1;
  let d = "";
  const ink = i => i % 4 === 0 || i % 4 === 1;
  for (let i = 0; i < len; i++) {
    if (!ink(i)) continue;
    d += `M${o + i} ${o}h1v1h-1z` + `M${o + i} ${last}h1v1h-1z`;
  }
  for (let j = 1; j < len - 1; j++) {
    if (!ink(j)) continue;
    d += `M${o} ${o + j}h1v1h-1z` + `M${last} ${o + j}h1v1h-1z`;
  }
  return d;
}

/// A whole token with `rings` ring slots, the ring drawn by `ringPaint`.
function tile({ rings = 1, ringPaint, claspPaint: clasp = null }) {
  const canvas = canvasFor(rings, 0);
  const frameOff = ringSpan(rings) + GAP;
  const blockOff = frameOff + THICK;
  const codeOff = blockOff + QUIET;

  // The day frame, every cell lit: the token is whole.
  const lit = new Set();
  for (const [x, y] of frameCells()) lit.add((y + frameOff) * canvas + (x + frameOff));

  // The code, split into heart and noise exactly as the renderer splits it.
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
    + ringPaint(canvas)
    + `<path fill="${COLOUR}" d="${pathFor(lit, canvas)}"/>`
    + (clasp ? clasp(canvas) : "")
    + `<path fill="${noiseInk}" d="${pathFor(noise, canvas)}"/>`
    + `<path fill="${heartInk}" d="${pathFor(heart, canvas)}"/>`
    + `</svg>`;
}

const solid = ink => canvas => `<path fill="${ink}" d="${ringAt(0, canvas)}"/>`;
const dashed = ink => canvas => `<path fill="${ink}" d="${dashRingAt(0, canvas)}"/>`;
const doubled = ink => canvas =>
  `<path fill="${ink}" d="${ringAt(0, canvas) + ringAt(2, canvas)}"/>`;

/// THE CLASP: the 11 frame cells that light ONLY when the heart is whole.
///
/// The frame holds 376 cells and a year is 365. The surplus 11 sit at x 22-27,
/// y 47-48 -- a 6x2 block at BOTTOM CENTRE, directly opposite (24,0) where the
/// day walk starts, and directly under the heart's point. The year begins at
/// the top, walks round, and closes at the bottom.
///
/// They are drawn in the frame colour today, so nobody has ever seen them. As a
/// finisher's surface they are free of every other Mark and finisher-only by
/// construction -- no gate is needed, because an unfinished token has no lit
/// cells here to colour.
const CLASP = frameCells().slice(365);

function claspPaint(ink, { hollow = false } = {}) {
  return (canvas) => {
    const frameOff = ringSpan(1) + GAP;
    const xs = CLASP.map(c => c[0]), ys = CLASP.map(c => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const set = new Set();
    for (const [x, y] of CLASP) {
      // Hollow keeps only the outline of the block, so the mark reads as a
      // clasp rather than a bar.
      if (hollow && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
      set.add((y + frameOff) * canvas + (x + frameOff));
    }
    return `<path fill="${ink}" d="${pathFor(set, canvas)}" data-clasp="1"/>`;
  };
}

/// A whole token whose clasp is painted over the frame. The frame is drawn
/// first and the clasp on top, which is what splitting the path would achieve
/// on chain.
const CLASP_LOOKS = [
  ["c0-invisible", "today: the clasp is the frame colour and cannot be seen", claspPaint(COLOUR)],
  ["c1-gold", "gold", claspPaint(VESSEL_GOLD)],
  ["c2-violet", "violet", claspPaint(TINT_VIOLET)],
  ["c3-graphite", "graphite", claspPaint("#3a3a3a")],
  ["c4-pale", "pale, the unclaimed default", claspPaint(GHOST)],
  ["c5-hollow-gold", "gold, hollow -- outline only", claspPaint(VESSEL_GOLD, { hollow: true })],
];

const LOOKS = [
  ["0-default-unclaimed", "whole, not yet claimed -- pale", { ringPaint: solid(GHOST) }],
  ["1-mark11-own-colour", "id 11, uncapped -- the token's own colour", { ringPaint: solid(COLOUR) }],
  ["2-mark12-violet", "id 12, cap 50 -- violet", { ringPaint: solid(TINT_VIOLET) }],
  ["3-mark13-gold", "id 13, cap 10 -- gold", { ringPaint: solid(VESSEL_GOLD) }],
  ["4-mark14-doubled", "id 14, cap 3 -- doubled gold", { rings: 2, ringPaint: doubled(VESSEL_GOLD) }],
  ["5-mark15-dashed", "id 15, cap 1 -- dashed gold, the one dear treatment",
    { ringPaint: dashed(VESSEL_GOLD) }],
];

console.log(`payload ${DEST}`);
console.log(`streak ${STREAK}, rung ${RUNG}, frame ${COLOUR}, heart ${heartInk}\n`);

let failures = 0;
const svgs = [];
for (const [name, label, opts] of LOOKS) {
  const svg = tile(opts);
  svgs.push(svg);
  writeFileSync(`${OUT}/ring-${name}.png`,
    new Resvg(svg, { fitTo: { mode: "width", value: 700 } }).render().asPng());

  const bad = [];
  for (const px of SIZES) {
    const res = scanResult(svg, px);
    if (!res.ok) bad.push(`${px}:${res.why}`);
    else if (res.destination !== DEST) bad.push(`${px}:wrong-dest`);
  }
  failures += bad.length;
  console.log(`${label}`);
  console.log(`  ${svg.length} svg bytes, decodes ${SIZES.length - bad.length}/${SIZES.length}`
    + (bad.length ? `  ${bad.join(" ")}` : ""));
}

// One sheet, six tiles in a row, nested svg so nothing needs pixel compositing
// and no font has to resolve.
const W = 53, g = 2;
const total = W * 6 + g * 5;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${W}" shape-rendering="crispEdges">`
  + `<rect width="${total}" height="${W}" fill="#e8e8e8"/>`
  + svgs.map((s, i) =>
      `<svg x="${i * (W + g)}" y="0" width="${W}" height="${W}">`
      + s.replace(/^<svg[^>]*viewBox="([^"]*)"[^>]*>/, (m, vb) => `<svg viewBox="${vb}">`)
      + `</svg>`).join("")
  + `</svg>`;
writeFileSync(`${OUT}/finisher-rings.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: 2400 } }).render().asPng());

console.log(`\nsheet ${OUT}/finisher-rings.png`);
// ---- the clasp, the same token with the mark on the surplus cells ----------
console.log("\nTHE CLASP -- the 11 cells only a whole heart lights");
const claspSvgs = [];
for (const [name, label, paint] of CLASP_LOOKS) {
  // Frame first, clasp painted over it: the same result as splitting the path.
  const svg = tile({ ringPaint: () => "", claspPaint: paint });
  claspSvgs.push(svg);
  writeFileSync(`${OUT}/clasp-${name}.png`,
    new Resvg(svg, { fitTo: { mode: "width", value: 700 } }).render().asPng());
  const bad = [];
  for (const px of SIZES) {
    const res = scanResult(svg, px);
    if (!res.ok) bad.push(`${px}:${res.why}`);
    else if (res.destination !== DEST) bad.push(`${px}:wrong-dest`);
  }
  failures += bad.length;
  console.log(`${label}`);
  console.log(`  ${svg.length} svg bytes, decodes ${SIZES.length - bad.length}/${SIZES.length}`
    + (bad.length ? `  ${bad.join(" ")}` : ""));
}
const claspSheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${W}" shape-rendering="crispEdges">`
  + `<rect width="${total}" height="${W}" fill="#e8e8e8"/>`
  + claspSvgs.map((s, i) =>
      `<svg x="${i * (W + g)}" y="0" width="${W}" height="${W}">`
      + s.replace(/^<svg[^>]*viewBox="([^"]*)"[^>]*>/, (m, vb) => `<svg viewBox="${vb}">`)
      + `</svg>`).join("")
  + `</svg>`;
writeFileSync(`${OUT}/finisher-clasps.png`,
  new Resvg(claspSheet, { fitTo: { mode: "width", value: 2400 } }).render().asPng());
console.log(`\nclasp sheet ${OUT}/finisher-clasps.png`);

console.log(failures ? `\n${failures} decode rejections -- read them before judging the picture.`
                     : `\nevery look decodes to its own url at all ${SIZES.length} sizes.`);
