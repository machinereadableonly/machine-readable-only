// THE FINISHER'S DIGIT BAND, drawn from the SHIPPING geometry.
//
// finisher-combined-sheet.mjs, which produced the sheets the operator judged on
// 2026-09-21, approximated the frame by scaling its coordinates and says so in
// its own header: the picture was faithful and the byte count was not. This
// renders through render-token.mjs -- the reference RenderMatrix.t.sol hashes
// the Solidity renderer against -- so here both are the real thing.
//
// WHAT IT IS FOR. Two questions the contract tests cannot answer:
//   1. Does the code still DECODE with a band round it? The band grows the
//      canvas, which changes how many source pixels a rasteriser gives each
//      module. Every render decision in this piece has been checked by actually
//      decoding the picture rather than by reasoning about it.
//   2. Does it look like the sheet the operator approved? The real canvas is
//      wider than the approximation's, so the digits sit very slightly smaller
//      against the heart. That is his call, not a test's.
//
// It does NOT re-solve any bitmap. The code is untouched; only its surroundings
// move. The re-solve rule is about changing the payload, which this does not.
//
//   ~/scripts/safe-build.sh node tools/finisher-band-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import {
  renderSvg, canvasFor, canvasUnits, bandUnits, finisherMark, finisherInk, MARKS,
} from "./render-token.mjs";
import { DEST, CODE, TARGET } from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const OUT = process.env.MRO_SHEET_OUT ?? "out";
mkdirSync(OUT, { recursive: true });

// The three sizes every sheet in this project is judged at. A thumbnail, the
// declared intrinsic size, and a size a marketplace asks for.
const SIZES = [256, 848, 1600];

// A whole token with a year behind it and a live streak: what a finisher is.
const BASE = { level: 365, streak: 365, years: 1, lastDay: 20700, today: 20700 };

// ONE PLACE PER MARK, plus the unbanded control: the five bands the piece can
// actually draw, each in the ink its place earns. The ordinals are one from
// somewhere INSIDE each Mark's range, not its first place -- 1 Apex (whose
// range is one place, so it is also the only one), 3 Atrium (of 2-4), 9 Valve
// (of 5-14), 42 Chamber (of 15-64), 365 Aorta (of 65 on) -- so a reader can
// see at a glance which ink goes with which rank. Middles rather than
// boundaries on purpose: a boundary ordinal would pass even if `finisherMark`
// were off by one, and the boundaries themselves are pinned in FinishLine.t.sol
// where an off-by-one is what the test is looking for.
//
// THE MARK IS NOT PAIRED BY HAND. `finisherMark` is the same ladder the
// contract runs (MachineReadableOnly.finisherMark), so a case cannot be given
// an ink its ordinal would not earn. Pairing them by hand is exactly the
// mistake the mirrored function exists to prevent.
//
// Finisher 1 stays in the set for a second reason: it is the dearest band to
// draw, because a 0 glyph carries more ink than a 1 and 1 is fifteen zeros.
const PLACES = [1, 3, 9, 42, 365];

const CASES = [["control, no band", 0, [], ""]].concat(
  PLACES.map(ordinal => {
    const id = finisherMark(ordinal);
    const ink = finisherInk([id]);
    return [`finisher ${ordinal} (${MARKS[id - 1]}, ${ink})`, ordinal, [id], ink];
  })
);

// The band's ink, read off the drawing rather than searched for in the string,
// because Aorta's red is also the HEART's red -- an `includes` check would pass
// on a band drawn in the fallback near-black and nobody would know.
//
// `renderSvg` emits exactly three groups: the digits under a bare `scale()`,
// the frame, and the code block. A band offsets the frame, so with one the
// frame is TRANSLATED and the digits own the only bare `scale()`; without one
// the frame takes that bare `scale()` itself. Position cannot tell them apart,
// and neither can the scale factor -- at version 5 a frame cell and a QR module
// are both 13 units. The count of translated groups can: two (frame and code)
// means there is a band, one (code alone) means the bare `scale()` is the
// frame.
//
// THE CONTROL ASSERTION BELOW IS WHAT FOUND THIS. The first version of this
// helper took the first bare `scale()` unconditionally and duly reported the
// unbanded control's FRAME fill -- the heart's red -- as a band ink.
const bandInkOf = svg => {
  const translated = svg.match(/<g transform="translate\(/g) ?? [];
  if (translated.length < 2) return undefined;
  return (svg.match(/<g transform="scale\(\d+\)"><path fill="(#[0-9a-f]{6})"/) ?? [])[1];
};

const tiles = [];
let failures = 0;

for (const [label, ordinal, marks, ink] of CASES) {
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, { ...BASE, ordinal, marks });
  const cells = canvasFor(1);
  const units = ordinal ? canvasUnits(cells, CODE.size) : cells * 13;
  // The code block is 45 frame cells wide in both cases; what changes is the
  // canvas around it. This is the trade the operator accepted with the sheets
  // in front of him, so the sheet prints it rather than arguing it.
  const blockShare = ((45 * 13) / units) ** 2;

  const bad = [];
  for (const px of SIZES) {
    const r = scanResult(svg, px);
    if (!r.ok) bad.push(`${px}:${r.why}`);
    else if (r.destination !== DEST) bad.push(`${px}:wrong-destination`);
  }
  // The ink is a claim about the picture, so it is read back off the picture.
  // Counted separately from the decode: a wrong ink and a failed scan are
  // different failures and a combined "3/3" would hide one behind the other.
  //
  // THE CONTROL IS CHECKED TOO, and in the opposite direction: it must carry
  // NO band at all. Without that this read-back is a test that can only ever
  // pass one way -- it would not notice a renderer that drew a band on every
  // token, because the five cases it looks at all want one.
  const drawn = bandInkOf(svg);
  const wrongInk = ink ? drawn !== ink : drawn !== undefined;
  if (bad.length || wrongInk) failures++;

  console.log(label);
  console.log(
    `  canvas ${units} units${ordinal ? ` (band ${bandUnits(cells, CODE.size)})` : ""}`
      + `, svg ${svg.length} bytes`
      + `, code block ${(100 * blockShare).toFixed(0)}% of the picture`
      + `, band ink ${drawn ?? "none"}${wrongInk ? ` WRONG, wanted ${ink || "none"}` : ""}`
      + `, decodes ${SIZES.length - bad.length}/${SIZES.length}`
      + (bad.length ? `  ${bad.join(" ")}` : "")
  );

  tiles.push({ label, svg, units });
}

// One sheet, three to a row, every tile on the same scale so the canvases can
// be compared by eye rather than by the numbers above.
const W = Math.max(...tiles.map(t => t.units));
// A wide gutter, because the digits run to the very edge of every tile: at a
// narrow one the neighbouring token's band reads as part of this one's.
const gap = Math.round(W / 6);
const cols = 3;
const rows = Math.ceil(tiles.length / cols);
// The same gutter outside, so the outermost digits do not touch the image edge
// and read as cropped.
const pad = gap;
const totalW = W * cols + gap * (cols - 1) + 2 * pad;
const totalH = W * rows + gap * (rows - 1) + 2 * pad;

const sheet = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges">`
  + `<rect width="${totalW}" height="${totalH}" fill="#eeeeee"/>`
  + tiles.map((t, i) => {
      const off = (W - t.units) / 2;
      const x = pad + (i % cols) * (W + gap) + off;
      const y = pad + Math.floor(i / cols) * (W + gap) + off;
      return `<svg x="${x}" y="${y}" width="${t.units}" height="${t.units}">`
        + t.svg.replace(/^<svg[^>]*>/, `<svg viewBox="0 0 ${t.units} ${t.units}">`)
        + `</svg>`;
    }).join("")
  + `</svg>`;

const path = `${OUT}/finisher-band.png`;
writeFileSync(path, new Resvg(sheet, { fitTo: { mode: "width", value: 2400 } }).render().asPng());

console.log(`\nsheet ${path}`);
console.log("  row 1: the control, finisher 1 (apex), finisher 3 (atrium)");
console.log("  row 2: finisher 9 (valve), finisher 42 (chamber), finisher 365 (aorta)");

if (failures) {
  console.error(`\n${failures} tile(s) failed to decode or wear the wrong ink. That is a blocker, not a note.`);
  process.exit(1);
}
console.log("\nevery tile decodes at every size, to the right destination,");
console.log("and every band is drawn in the ink its place earns.");
