// The finder patterns as a surface of their own.
//
// WHY THIS ONE. The artistic-QR literature's three standard levers are module
// shape, halftone subdivision, and finder-pattern styling. The first two are
// closed to this piece:
//
//   Module shapes (dots, rounded corners, gaps) require ONE ELEMENT PER CELL.
//   PathWriter merges horizontal runs precisely because it was measured: one
//   rect per cell came to 70,298 bytes on the code block against about 11,000
//   bytes of headroom. Shapes break the merge by construction.
//
//   Halftone subdivision needs 3x3 submodules -- nine times the elements -- and
//   also spends error-correction budget this piece has already spent: qart.mjs
//   runs at ECC level L on purpose, because the lowest correction leaves the
//   most free bits for the heart.
//
// Finder styling survives both tests. The three eyes are a FIXED 7x7 each, they
// merge into a handful of runs, and recolouring them costs no error correction
// at all -- every module keeps its value, only its ink changes.
//
//   node tools/eye-mark-sheet.mjs        (through ~/scripts/safe-build.sh)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import * as SHEET from "./sheet-code.mjs";
import { renderSvg, canvasFor, colourAt, rungOf, noiseAt, QUIET } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

// The reference code, shared so no sheet can be judged on a heart that will
// never mint. See sheet-code.mjs -- this used to be four hardcoded lines in ten
// separate files, all of them naming a domain that was decided against.
const { PAYLOAD, DEST, CODE, TARGET } = SHEET;
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = new URL("./out/marks", import.meta.url).pathname;
const STREAK = 150;

/// The three finder patterns, in MODULE coordinates. Standard QR: 7x7 at the
/// top-left, top-right and bottom-left. There is no fourth.
const S = CODE.size;
const EYES = [[0, 0], [S - 7, 0], [0, S - 7]];
const inEye = (i, j) => EYES.some(([x, y]) => i >= x && i < x + 7 && j >= y && j < y + 7);

/// Rebuild the SVG with the eye modules pulled into their own path.
///
/// Done by re-deriving the geometry rather than by patching the reference
/// renderer: this is a proposal, and render-token.mjs is the file the Solidity
/// side is diffed against byte for byte.
function withEyes(eyeInk) {
  const rung = rungOf(STREAK);
  const base = renderSvg(CODE.modules, TARGET.want, CODE.size,
    { level: 200, streak: STREAK, years: 1, marks: [], lastDay: 20700, today: 20700 });
  if (!eyeInk) return base;

  const canvas = canvasFor(1);
  // Where the modules start, mirroring renderSvg's own offsets.
  const ringSpan = 1, GAP = 1, THICK = (canvas - 45) / 2 - ringSpan - GAP;
  const codeOff = ringSpan + GAP + THICK + QUIET;

  // Every lit module inside an eye, as its own rect run. Emitted as plain
  // rects here for clarity; in Solidity these merge into runs like everything
  // else, which is the whole reason this technique is affordable.
  let d = "";
  let cells = 0;
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      if (!CODE.modules[j * S + i] || !inEye(i, j)) continue;
      d += `M${codeOff + i} ${codeOff + j}h1v1h-1z`;
      cells++;
    }
  }
  // Appended last so it paints over the heart and noise paths beneath.
  return { svg: base.replace(/<\/svg>$/, `<path fill="${eyeInk}" d="${d}"/></svg>`), cells, bytes: d.length + 30 };
}

const pixels = (svg, px) => {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  return r.pixels;
};
const shift = (a, b) => {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2]));
    if (d > max) max = d;
  }
  return max;
};
const decodes = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
}).length;

const rung = rungOf(STREAK);
const base = withEyes(null);
const basePx = pixels(base, 560);

// The eyes are the one part of a QR a scanner locates FIRST, so this is the
// riskiest recolour on the board and the numbers matter more than usual.
const CANDIDATES = [
  ["heart red", colourAt(rung)],
  ["crown gold", "#b8860b"],
  ["deep red", "#780a1c"],
  ["teal", "#007c08"],
];

console.log(`eyes: 3 x 7x7 modules, code ${S}x${S}, ECC level L\n`);
console.log("ink            shift    added   decodes");
const tiles = [];
for (const [label, ink] of CANDIDATES) {
  const { svg, cells, bytes } = withEyes(ink);
  const ok = decodes(svg);
  const s = shift(basePx, pixels(svg, 560));
  console.log(`${label.padEnd(13)} ${String(s).padStart(3)}/255  ${String(bytes).padStart(5)} B  `
    + `${ok === SIZES.length ? "ALL" : "FAILS " + (SIZES.length - ok) + " of " + SIZES.length}`);
  tiles.push({ label: `${label} ${ink}`, svg, shift: s, ok, all: ok === SIZES.length, bytes });
}

const TILE = 260, LBL = 44, PAD = 22;
const W = tiles.length * TILE + 2 * PAD, H = TILE + LBL + 76;
const cells = canvasFor(1);
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="34" font-family="monospace" font-size="18" fill="#111">`
  + `MRO THE EYES -- the finder patterns as their own surface</text>`;
tiles.forEach((t, i) => {
  const x = PAD + i * TILE, y = 58;
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${cells} ${cells}">${inner}</svg>`
    + `<text x="${x + 6}" y="${y + TILE - 4}" font-family="monospace" font-size="13" fill="#111">${t.label}</text>`
    + `<text x="${x + 6}" y="${y + TILE + 14}" font-family="monospace" font-size="12" fill="${t.all ? "#666" : "#c8102e"}">`
    + `shift ${t.shift}/255, ${t.bytes} B, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok)}</text>`;
});
sheet += "</svg>";
writeFileSync(`${OUT}/eyes.png`, new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nwrote ${OUT}/eyes.png`);
