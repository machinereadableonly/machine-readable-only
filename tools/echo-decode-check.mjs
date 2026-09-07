// Does a SEEDED CHILD still scan?
//
// The echo ring is the first high-frequency pattern this piece has ever drawn
// next to the code: 104 dots, one cell on and one cell off, on the innermost
// ring slot. Every other ring the piece draws is a solid line, and a solid line
// is the kind of thing a binarizer ignores. A dotted one is, at small pixel
// sizes, a row of things about the size of a module.
//
// So this is a gate, not a sheet. It renders a child at BOTH extremes of the
// ring's depth and decodes each render at nine pixel sizes, and it exits
// non-zero if anything fails to decode to the token's own url. A rejection here
// is a DESIGN problem and goes back to
// docs/specs/2026-09-06-mro-lineage-design.md -- it is not something to tune
// away by moving a size out of the list.
//
// THE CONTROLS ARE THE POINT. A child's canvas is not new: canvasFor(0, echo)
// is 53, exactly what a founding token with one year ring has, and
// canvasFor(10, echo) is 89, exactly the founding ring cap. So each child is
// compared against a FOUNDING token on the identical canvas, at the identical
// module size, whose only difference is that its innermost ring is solid
// instead of dotted. Without that pair, a failure could not be attributed to
// the ring rather than to the canvas.
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
import { renderSvg, canvasFor, HUSH, BEAT, IRIS_BOUGHT, VESSEL, TINT } from "./render-token.mjs";
import * as SHEET from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

// The reference code, solved against the real domain. See sheet-code.mjs: a
// bitmap encodes its own url, so a child judged on `example.com` would be a
// child nobody can mint.
const { DEST, CODE, TARGET } = SHEET;

// The five sizes every Mark sheet in this project is judged at, plus four more.
// 848 is 16 x 53, the exact multiple a 53-cell child renders at with no
// resampling, and 1424 is 16 x 89, the same for a child at the cap -- both are
// in because the intrinsic size the SVG declares is canvas x 16 and a consumer
// that honours it lands exactly there. 350, 700 and 900 come from the ring-cap
// gate in render-token.test.mjs, which is the existing test for a ten-ring
// canvas and the closest thing to a precedent for the deep case.
const SIZES = [256, 350, 500, 700, 848, 900, 1080, 1424, 1600];

// A child at level 1 can wear Hush and nothing else: Iris needs level 100, Beat
// needs a completed run of 30, Tint needs an Iris, and Vessel needs a whole
// heart. A child at the cap can wear the whole maximal legal set. Asking a
// newborn to wear five Marks would be testing a token that cannot exist.
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
  { name: "founding token, 10 solid rings (control)",
    state: { level: 365 * 10, streak: 400, years: 10, echo: 0 } },
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
  const canvas = canvasFor(state.years, state.echo);

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
  console.log(`  canvas ${canvas} cells, ${svg.length} svg bytes, decodes: ${verdict}`);
  for (const b of bad) console.log(`    ${b}`);
  failures += bad.length;
}

console.log(`\npeak rss ${(peakRss / 1024 / 1024).toFixed(0)} MB`);

if (failures) {
  console.log(`\n${failures} rejections. A child that does not scan is a DESIGN`);
  console.log("problem: it goes back to the lineage spec, not to this file's size list.");
  process.exit(1);
}
console.log("\nzero rejections: a seeded child scans at every size, at both extremes.");
