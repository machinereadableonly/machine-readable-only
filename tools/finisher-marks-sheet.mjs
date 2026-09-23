// THE FIVE FINISHER MARKS, side by side, for the operator to judge.
//
// One row, one token per Mark, each finished and wearing the Mark its place
// earns. WHAT TO LOOK AT IS THE COLOUR OF THE NUMBER round the border: the
// five Marks are the same drawing in five inks, and the ink IS the rank.
//
// Every tile is rendered through render-token.mjs -- the reference
// RenderMatrix.t.sol hashes the Solidity renderer against -- so nothing here is
// an approximation of the shipping picture.
//
// THE MARK IS NOT PAIRED WITH ITS PLACE BY HAND. `finisherMark` is the same
// ladder MachineReadableOnly.finisherMark runs, and `finisherInk` the same one
// MarkRenderer.finisherInk runs, so a tile cannot be labelled with an ink its
// ordinal would not earn. Pairing them by hand is the mistake the mirrored
// functions exist to prevent.
//
// SVG <text> APPEARS HERE AND MAY NEVER APPEAR IN A TOKEN. A sheet is a
// throwaway picture for one reader on one screen; a token has to render the
// same way in ten years on a machine with no fonts installed. The rule is about
// the artwork, not about the contact sheet.
//
//   MRO_SHEET_OUT=<dir> ~/scripts/safe-build.sh node tools/finisher-marks-sheet.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { renderSvg, canvasUnits, canvasFor, finisherMark, finisherInk, MARKS } from "./render-token.mjs";
import { DEST, CODE, TARGET } from "./sheet-code.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const OUT = process.env.MRO_SHEET_OUT ?? "out";
mkdirSync(OUT, { recursive: true });

// The same three sizes every sheet in this project is judged at. The sheet is
// for the eye, but a tile that cannot be read by a scanner is not a finished
// token whatever it looks like, so it is checked here too.
const SIZES = [256, 848, 1600];

// A whole token with the year behind it: what every finisher is.
const BASE = { level: 365, streak: 365, years: 1, lastDay: 20700, today: 20700 };

// One place per Mark, left to right, best first. The ordinal drawn is one from
// somewhere INSIDE each Mark's range rather than its first place: 1 is Apex's
// only place, 3 sits in Atrium's 2-4, 9 in Valve's 5-14, 42 in Chamber's
// 15-64, and 365 well inside Aorta's 65-and-up. The boundaries themselves are
// pinned in FinishLine.t.sol, which is where an off-by-one belongs; here the
// point is that the operator sees a typical number in each ink rather than an
// edge case.
const ROWS = [
  { places: "1st", ordinal: 1, colour: "gold" },
  { places: "2nd-4th", ordinal: 3, colour: "silver" },
  { places: "5th-14th", ordinal: 9, colour: "bronze" },
  { places: "15th-64th", ordinal: 42, colour: "blue" },
  { places: "65th on", ordinal: 365, colour: "red" },
];

const cells = canvasFor(1);
const units = canvasUnits(cells, CODE.size);

// The band's ink, read off the drawing rather than searched for in the string,
// because Aorta's red is also the HEART's red -- an `includes` check would pass
// on a band drawn in the fallback near-black and the tile would still be
// labelled "gold". The same read-back finisher-band-sheet.mjs does, with the
// same reasoning at greater length: a band offsets the frame, so a banded token
// has TWO translated groups and the digits own the only bare `scale()`, while
// an unbanded one has one translated group and the bare `scale()` is the frame.
const bandInkOf = svg => {
  const translated = svg.match(/<g transform="translate\(/g) ?? [];
  if (translated.length < 2) return undefined;
  return (svg.match(/<g transform="scale\(\d+\)"><path fill="(#[0-9a-f]{6})"/) ?? [])[1];
};

const tiles = [];
let failures = 0;

for (const row of ROWS) {
  const id = finisherMark(row.ordinal);
  const ink = finisherInk([id]);
  const name = MARKS[id - 1];
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, {
    ...BASE, ordinal: row.ordinal, marks: [id],
  });

  const bad = [];
  for (const px of SIZES) {
    const r = scanResult(svg, px);
    if (!r.ok) bad.push(`${px}:${r.why}`);
    else if (r.destination !== DEST) bad.push(`${px}:wrong-destination`);
  }
  // A label is a claim, so the ink is read back off the drawing before the
  // label is written under it. A tile drawn in the fallback near-black must
  // never go out labelled "gold".
  const drawn = bandInkOf(svg);
  const wrongInk = drawn !== ink;
  if (bad.length || wrongInk) failures++;

  // Title case for the sheet only. The metadata name stays lower case, which
  // is what MarkRenderer emits and what the ladder tests assert.
  const shown = name[0].toUpperCase() + name.slice(1);
  console.log(
    `${row.places.padEnd(10)} ${shown.padEnd(8)} ${row.colour.padEnd(7)} ${ink}`
      + `  place ${String(row.ordinal).padStart(3)}`
      + `  drawn ${drawn ?? "none"}${wrongInk ? " WRONG" : ""}`
      + `  decodes ${SIZES.length - bad.length}/${SIZES.length}`
      + (bad.length ? `  ${bad.join(" ")}` : "")
  );

  tiles.push({ svg, label: `${row.places} - ${shown} - ${row.colour}`, sub: `place ${row.ordinal}, ${ink}` });
}

// ---------------------------------------------------------------------------
// The sheet: one row, white ground, about 2400 px wide.

const WIDTH = 2400;
const PAD = 60;
const TILE = (WIDTH - 2 * PAD) / tiles.length;   // 456
const ART = TILE - 24;                           // the drawing, with a gutter
const TOP = 86;                                  // under the title
const LABEL = TOP + ART + 44;
const HEIGHT = LABEL + 84;

let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="46" font-family="monospace" font-size="26" fill="#111">`
  + `MRO THE FINISHER'S MARKS -- five places, one drawing, five inks</text>`
  + `<text x="${PAD}" y="72" font-family="monospace" font-size="16" fill="#666">`
  + `look at the COLOUR OF THE NUMBER round each border. Every token below is finished: 365 days, one ring.</text>`;

tiles.forEach((t, i) => {
  const x = PAD + i * TILE + 12;
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x}" y="${TOP}" width="${ART}" height="${ART}" viewBox="0 0 ${units} ${units}">${inner}</svg>`
    + `<text x="${x}" y="${LABEL}" font-family="monospace" font-size="20" fill="#111">${t.label}</text>`
    + `<text x="${x}" y="${LABEL + 26}" font-family="monospace" font-size="15" fill="#666">${t.sub}</text>`;
});
sheet += `<text x="${PAD}" y="${HEIGHT - 20}" font-family="monospace" font-size="15" fill="#666">`
  + `every tile above decodes to ${DEST} at 256, 848 and 1600 px</text>`
  + `</svg>`;

const path = `${OUT}/finishers-final.png`;
writeFileSync(path, new Resvg(sheet, { fitTo: { mode: "width", value: WIDTH } }).render().asPng());
console.log(`\nsheet ${path}`);

if (failures) {
  console.error(`\n${failures} tile(s) failed to decode or wear the wrong ink. That is a blocker, not a note.`);
  process.exit(1);
}
