// Does a SEEDED CHILD still scan?
//
// The echo ring is the first high-frequency pattern this piece has ever drawn
// next to the code: 104 cells of ink on the innermost ring slot, drawn as a
// DASH -- two cells on, two off, in 54 runs. Every other ring the piece draws is
// a solid line, and a solid line is the kind of thing a binarizer ignores. A
// broken one is, at small pixel sizes, a row of things about the size of a
// module.
//
// RUN THIS AGAIN WHENEVER THE PATTERN CHANGES, not only when the ring is added.
// The dot rule and the dash draw the same NUMBER of cells, 104, which makes the
// revision look like a pure regrouping. It is not: the two rules agree only on
// the offsets divisible by 4, so 52 cells are shared and THE OTHER HALF OF THE
// INK MOVED. Both the spatial frequency and the ink's actual positions changed.
//
// That is why both rules were put through this gate rather than the dash being
// waved through on the strength of an unchanged cell count, and it is why the
// dash's 54 of 54 means MORE than the dot rule's did: the pattern next to the
// code is genuinely different and still decodes at every size.
//
// So this is a gate, not a sheet. It renders a child at BOTH extremes of the
// ring's depth and decodes each render at nine pixel sizes, and it exits
// non-zero if anything fails to decode to the token's own url. A rejection here
// is a DESIGN problem and goes back to
// docs/specs/2026-09-06-mro-lineage-design.md -- it is not something to tune
// away by moving a size out of the list.
//
// THE CONTROLS ARE THE POINT, AND ONLY ONE PAIR STILL HAS A TRUE ONE. A
// newborn child's canvas is canvasFor(0, echo) = 53, exactly what a founding
// token with its one ring has, so the SHALLOW child is compared against a
// FOUNDING token on the identical canvas, at the identical module size, whose
// only difference is that its innermost ring is solid instead of dashed. There
// a failure is attributable to the dash and nothing else.
//
// THE DEEP CASES HAVE NO SAME-CANVAS CONTROL, AND CANNOT HAVE ONE. Spec 10f
// (built 2026-09-24) gave a token ONE ring of its own, so a founding token
// never grows past 53 cells, while a child with a year behind it carries its
// own ring AND the echo ring: 57. Only a child can reach 57, so no solid-ring
// twin of it exists to draw. Each deep case is therefore paired with the
// founding token in the SAME STATE on its own 53-cell canvas. That pair still
// answers "does the deep child scan?" -- the gate -- but a failure there could
// be the canvas as well as the dash, and must be read that way.
//
// THE REACHABLE DEEP CASE IS "finished child, every legal Mark and its place":
// 365 days, every Mark a child can legally hold, the Apex that finishing first
// gives, and ordinal 1 -- the densest digit band, since a 0 glyph carries more
// ink than a 1. That is the dearest token the shipping contract can produce
// (.claude/rules/contracts.md). The two older deep cases are KEPT at level
// 3,650, which the chain cannot reach -- the renderer draws one ring for it --
// because removing a state from a decode gate can only ADD survivors, and every
// committed bitmap was solved against this gate as it stands. Trimming it could
// move a mask a minted token would ship with.
//
// MEMORY. This is a rendering sweep, which is the exact shape of job that took
// this machine down on 2026-08-28 (400 SVGs x 14 sizes, 6.28 GB resident, one
// session destroyed). Run it through the wrapper:
//
//   ~/scripts/safe-build.sh node tools/echo-decode-check.mjs
//
// `@resvg/resvg-js` 2.6.2 does not report its native allocations to V8, so
// nothing is collected under pressure and gc() does not help -- see the header
// of combination-sweep.mjs, which had to split its 459 combinations into child
// processes for that reason. This sweep is 54 rasters, not 2,295, so one
// process is enough; what keeps it small is that only ONE svg and ONE raster
// are alive at a time (a state is rendered, decoded across every size, and
// dropped before the next state is built). Peak RSS is printed at the end so
// the claim is measured rather than asserted.
//
// EXPECT THAT PEAK TO MOVE between runs -- 951 to 968 MB over four runs of the
// identical workload. The allocations are native, so V8 cannot see them and the
// peak follows collection timing rather than the work done. It is a sanity
// check that the sweep is nowhere near the cap, not a figure to pin.
import { renderSvg, canvasFor, finisherMark, HUSH, BEAT, IRIS_BOUGHT, VESSEL, TINT } from "./render-token.mjs";
import * as SHEET from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

// The reference code, solved against the real domain. See sheet-code.mjs: a
// bitmap encodes its own url, so a child judged on `example.com` would be a
// child nobody can mint.
const { DEST, CODE, TARGET } = SHEET;

// The five sizes every Mark sheet in this project is judged at, plus four more.
// 848 is 16 x 53, the exact multiple a 53-cell child renders at with no
// resampling, and 1424 was 16 x 89, the same for a child at the old ten-ring
// cap -- both are in because the intrinsic size the SVG declares is canvas x 16
// and a consumer that honours it lands exactly there. Since spec 10f there is
// no 89-cell canvas, so 1424 is now an ordinary oversize raster rather than an
// exact multiple; it is kept because a stricter list can only remove survivors.
// 350, 700 and 900 come from the deep-canvas gate in render-token.test.mjs.
const SIZES = [256, 350, 500, 700, 848, 900, 1080, 1424, 1600];

// A child at level 1 can wear Hush and nothing else: Iris needs level 100, Beat
// needs a completed run of 30, Tint needs an Iris, and Vessel needs a whole
// heart. A deep child can wear the whole maximal legal set. Asking a newborn to
// wear five Marks would be testing a token that cannot exist. (The case labels
// below still say "at the cap"; since spec 10f there is no ring cap, and the
// labels are kept because the tests and the committed masks were judged under
// them -- a rename is how a guard like this gets defeated by tidying.)
const NEWBORN_MARKS = [HUSH];
const CAP_MARKS = [HUSH, BEAT, IRIS_BOUGHT, VESSEL, TINT];

// `irisVariant: 2` is leaf, the costliest of the three shapes to draw.
const CASES = [
  { name: "newborn child, bare",
    state: { level: 1, streak: 1, years: 0, echo: 365 } },
  { name: "newborn child, Hush",
    state: { level: 1, streak: 1, years: 0, echo: 365, marks: NEWBORN_MARKS } },
  { name: "founding token, 1 solid ring (control)",
    state: { level: 365, streak: 140, years: 1, echo: 0 } },

  { name: "child at the cap, bare",
    state: { level: 365 * 10, streak: 400, years: 10, echo: 3650 } },
  { name: "child at the cap, every legal Mark",
    state: { level: 365 * 10, streak: 400, years: 10, echo: 3650,
             marks: CAP_MARKS, irisVariant: 2 } },
  // Since spec 10f this draws ONE solid ring on 53 cells, not ten: the label
  // is kept for the reason given above CAP_MARKS.
  { name: "founding token, 10 solid rings (control)",
    state: { level: 365 * 10, streak: 400, years: 10, echo: 0 } },

  // The deepest child the chain can actually produce, and its founding twin in
  // the same state. Not a same-canvas pair: see the header.
  { name: "finished child, every legal Mark and its place",
    state: { level: 365, streak: 365, years: 1, echo: 365, ordinal: 1,
             marks: [...CAP_MARKS, finisherMark(1)], irisVariant: 2 } },
  { name: "finished founding token, every legal Mark and its place (nearest control)",
    state: { level: 365, streak: 365, years: 1, echo: 0, ordinal: 1,
             marks: [...CAP_MARKS, finisherMark(1)], irisVariant: 2 } },
];

// Every state is live rather than lapsed or sealed, so the page is at full
// contrast and the ring is judged on its own and not on a paled field.
const DAY = { lastDay: 1000, today: 1000 };

let peakRss = 0;
const noteRss = () => { peakRss = Math.max(peakRss, process.memoryUsage.rss()); };

let failures = 0;
console.log(`payload ${DEST}`);
console.log(`sizes   ${SIZES.join(", ")}\n`);

for (const c of CASES) {
  const state = { ...DAY, ...c.state };
  // One svg alive at a time. It goes out of scope with the iteration.
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, state);
  // The digit band sits outside the ring canvas, so it is named on top.
  const canvas = `${canvasFor(state.years, state.echo)} cells${state.ordinal ? " plus the digit band" : ""}`;

  const bad = [];
  for (const px of SIZES) {
    const r = scanResult(svg, px);
    noteRss();
    // Decoding is not enough. The payload has to be the token's own url, or a
    // code that decodes to something else would pass as "it scans" -- which is
    // the failure judge() and this project's decode oracle exist to prevent.
    if (!r.ok) bad.push(`${px}px: ${r.why}`);
    else if (r.destination !== DEST) bad.push(`${px}px: wrong destination ${r.destination}`);
  }

  const verdict = bad.length ? `FAILED at ${bad.length} of ${SIZES.length}` : "all sizes";
  console.log(`${c.name}`);
  console.log(`  canvas ${canvas}, ${svg.length} svg bytes, decodes: ${verdict}`);
  for (const b of bad) console.log(`    ${b}`);
  failures += bad.length;
}

console.log(`\npeak rss ${(peakRss / 1024 / 1024).toFixed(0)} MB`);

if (failures) {
  console.log(`\n${failures} rejections. A child that does not scan is a DESIGN`);
  console.log("problem: it goes back to the lineage spec, not to this file's size list.");
  process.exit(1);
}
console.log("\nzero rejections: a seeded child scans at every size, newborn and finished.");
