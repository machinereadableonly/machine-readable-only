// The finisher ring's five inks, against EVERY frame colour they will meet.
//
// EXPLORATORY. Nothing here is adopted.
//
// WHY ALL FIVE TIERS. The frame wears the token's streak-tier colour, and a
// finisher can wear any of them -- reaching 365 credited days says nothing
// about the streak held at the end, so a token that lapsed finishes with a pale
// mauve frame while an unbroken one finishes bright red. An ink chosen against
// the deepest tier alone is chosen against one background out of five.
//
// The first sheet tested one tier and two of its six looks failed for exactly
// this reason: a ring in the token's OWN colour disappeared into a frame
// already wearing it, and a pale ring disappeared into the field.
//
// COSTS, from test/GasProfile.t.sol, against 182,700 gas of headroom:
//   an ink change   free
//   a solid ring    3,705 gas, 62 bytes
//   a DASHED ring   145,533 gas -- 80% of the headroom, so AT MOST ONE
//
//   ~/scripts/safe-build.sh node tools/finisher-ink-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import {
  canvasFor, ringSpan, pathFor, GAP, QUIET,
  TIERS, colourAt, inks, FIELD, GHOST,
} from "./render-token.mjs";
import { BLOCK, THICK, frameCells } from "./frame-geometry.mjs";
import * as SHEET from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const { DEST, CODE, TARGET } = SHEET;
const OUT = process.env.MRO_SHEET_OUT ?? "out";
mkdirSync(OUT, { recursive: true });

// Three sizes, not nine: this is a LOOK sheet and the ring sits outside the
// code block, so it cannot move a module. The nine-size gate is
// echo-decode-check.mjs and still runs before anything ships.
const SIZES = [256, 848, 1600];

/// Candidate inks. Chosen to span the wheel away from the frame's red-to-mauve
/// family, and all dark enough to hold against the white field.
const INKS = {
  graphite: "#3a3a3a",   // austere, reads on every background
  teal:     "#0f6466",   // cool, directly complementary to the frame's red
  violet:   "#6a0dad",   // the piece already owns a violet in Tint
  gold:     "#b8860b",   // the piece already owns this in Vessel
};

/// THE WIDE SCREEN. A broader field, judged at three tiers rather than five:
/// deepest, middle and palest bracket the range, and the finalists get the full
/// five. Screening on three keeps the sheet readable at a size where a one-cell
/// ring is actually visible.
///
/// THE LAST ENTRY IS A CONTROL THAT MUST FAIL. A ring in the frame's own colour
/// has nowhere to be seen, and the first sheet proved it by accident. It is in
/// here on purpose now: a screening sheet where everything looks fine is not
/// discriminating, it is just a sheet.
const WIDE = [
  ["near-black",  "#111111"],
  ["graphite",    "#3a3a3a"],
  ["slate",       "#46526b"],
  ["ink-blue",    "#1b3a8f"],
  ["teal",        "#0f6466"],
  ["forest",      "#1f5132"],
  ["olive",       "#4f5a16"],
  ["copper",      "#a0522d"],
  ["gold",        "#b8860b"],
  ["plum",        "#6d2c5a"],
  ["violet",      "#6a0dad"],
  ["oxblood",     "#5c1a1a"],
  ["CONTROL frame colour (must vanish)", null],
];

function ringAt(o, canvas) {
  const len = canvas - 2 * o;
  let d = `M${o} ${o}h${len}v1h-${len}z` + `M${o} ${canvas - 1 - o}h${len}v1h-${len}z`;
  const h = len - 2;
  if (h > 0) d += `M${o} ${o + 1}h1v${h}h-1z` + `M${canvas - 1 - o} ${o + 1}h1v${h}h-1z`;
  return d;
}

/// Two cells on, two off -- the echo ring's rule, and the only treatment here
/// that is not free.
function dashRingAt(o, canvas) {
  const len = canvas - 2 * o;
  const last = o + len - 1;
  const on = i => i % 4 === 0 || i % 4 === 1;
  let d = "";
  for (let i = 0; i < len; i++) {
    if (!on(i)) continue;
    d += `M${o + i} ${o}h1v1h-1z` + `M${o + i} ${last}h1v1h-1z`;
  }
  for (let j = 1; j < len - 1; j++) {
    if (!on(j)) continue;
    d += `M${o} ${o + j}h1v1h-1z` + `M${last} ${o + j}h1v1h-1z`;
  }
  return d;
}

/// A finished token at a given tier, with the ring painted by `paint`.
function tile(rungIndex, paint) {
  const rung = TIERS.length - 1 - rungIndex;   // rung 4 is the deepest
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
    + paint(canvas)
    + `<path fill="${colour}" d="${pathFor(lit, canvas)}"/>`
    + `<path fill="${noiseInk}" d="${pathFor(noise, canvas)}"/>`
    + `<path fill="${heartInk}" d="${pathFor(heart, canvas)}"/>`
    + `</svg>`;
}

const solid = ink => canvas => `<path fill="${ink}" d="${ringAt(0, canvas)}"/>`;
const dashed = ink => canvas => `<path fill="${ink}" d="${dashRingAt(0, canvas)}"/>`;

/// THE FINALISTS, chosen from the wide screen of twelve.
///
/// Dropped and why: the token's OWN colour and pale both vanish (one into the
/// frame, one into the field); plum and oxblood sit in the frame's own
/// red-purple family and merge at the deep tier, exactly as the deliberate
/// control did; slate fades toward the mauve tiers; near-black works but boxes
/// the piece in; olive reads muddy; copper sits near the red.
///
/// The order is a progression rather than five peers: neutral, cool, cooler,
/// richer, and finally precious AND patterned for the one-of-one.
const LOOKS = [
  ["unclaimed", "whole, nothing claimed -- pale", solid(GHOST)],
  ["id11-graphite", "id 11, uncapped -- graphite", solid("#3a3a3a")],
  ["id12-teal", "id 12, cap 50 -- teal", solid("#0f6466")],
  ["id13-ink-blue", "id 13, cap 10 -- ink blue", solid("#1b3a8f")],
  ["id14-violet", "id 14, cap 3 -- violet", solid("#6a0dad")],
  ["id15-dashed-gold", "id 15, cap 1 -- DASHED gold, the one dear treatment", dashed("#b8860b")],
];

const wide = process.argv.includes("--wide");
// Deepest, middle and palest. Indices into TIERS as `tile` uses them.
const TIER_IDX = wide ? [0, 2, 4] : TIERS.map((_, i) => i);

// A 13-row sheet renders each tile too small to judge a ONE-CELL ring: the
// whole image is scaled to fit, so more rows means a thinner hairline. Slice it
// into batches of four and judge those.
const arg = n => { const i = process.argv.indexOf(n); return i === -1 ? null : Number(process.argv[i + 1]); };
const from = arg("--from") ?? 0;
const to = arg("--to") ?? WIDE.length;

const LOOK_LIST = wide
  ? WIDE.slice(from, to).map(([name, ink]) => [name, name, ink === null ? "FRAME" : solid(ink)])
  : LOOKS;
const TAG = wide ? `finisher-inks-wide-${from}` : "finisher-inks";

console.log(`payload ${DEST}`);
console.log(wide
  ? `WIDE SCREEN: ${WIDE.length} inks x ${TIER_IDX.length} tiers (deepest, middle, palest)\n`
  : `tiers (frame colour, deepest first): ${TIERS.map(t => t.colour).join(" ")}\n`);

let failures = 0;
const grid = [];
for (const [name, label, paint] of LOOK_LIST) {
  const row = [];
  const bad = [];
  for (const ti of TIER_IDX) {
    // The control paints the ring in whatever colour THIS tier's frame wears,
    // which is the whole point of it.
    const p = paint === "FRAME"
      ? solid(colourAt(TIERS.length - 1 - ti))
      : paint;
    const svg = tile(ti, p);
    row.push(svg);
    for (const px of SIZES) {
      const r = scanResult(svg, px);
      if (!r.ok) bad.push(`tier${ti}@${px}:${r.why}`);
      else if (r.destination !== DEST) bad.push(`tier${ti}@${px}:wrong-dest`);
    }
  }
  grid.push(row);
  failures += bad.length;
  console.log(`${label}`);
  console.log(`  decodes ${TIER_IDX.length * SIZES.length - bad.length}/${TIER_IDX.length * SIZES.length}`
    + (bad.length ? `  ${bad.slice(0, 4).join(" ")}` : ""));
}

// One sheet: a row per look, a column per tier. Deepest tier on the left, so
// the frame pales left to right and an ink that only works on red is obvious.
const W = canvasFor(1, 0), g = 2;
const cols = TIER_IDX.length, rows = LOOK_LIST.length;
const totalW = W * cols + g * (cols - 1);
const totalH = W * rows + g * (rows - 1);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">`
  + `<rect width="${totalW}" height="${totalH}" fill="#e8e8e8"/>`
  + grid.map((row, r) => row.map((svg, c) =>
      `<svg x="${c * (W + g)}" y="${r * (W + g)}" width="${W}" height="${W}">`
      + svg.replace(/^<svg[^>]*>/, "<svg>") + `</svg>`).join("")).join("")
  + `</svg>`;
writeFileSync(`${OUT}/${TAG}.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: 2400 } }).render().asPng());

console.log(`\nsheet ${OUT}/${TAG}.png  (rows = looks, columns = tiers, deepest left)`);
console.log(failures ? `\n${failures} decode rejections -- read them before judging the picture.`
                     : `\nevery look decodes at every tier, at ${SIZES.join("/")} px.`);
