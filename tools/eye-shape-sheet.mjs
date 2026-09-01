// Reshaped finder patterns, decode-tested.
//
// Recolouring the eyes was safe because every module kept its value. RESHAPING
// does not: it erases the 7x7 and draws something else there, so the 1:1:3:1:1
// ratio a scanner looks for along a line through the eye is genuinely at risk.
// That ratio is the whole reason the literature says the crosshair structure
// must survive, and it is why every candidate here is decoded rather than
// judged by eye.
//
// The eye is three concentric shapes -- 7x7 dark, 5x5 light, 3x3 dark -- so a
// style is just those three drawn differently. Nine elements for three eyes,
// at FIXED positions that do not vary per token.
//
//   node tools/eye-shape-sheet.mjs       (through ~/scripts/safe-build.sh)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg, canvasFor, colourAt, rungOf, QUIET, FIELD } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = new URL("./out/marks", import.meta.url).pathname;
const STREAK = 150;
const S = CODE.size;

const canvas = canvasFor(1);
const ringSpan = 1, GAP = 1;
const THICK = (canvas - 45) / 2 - ringSpan - GAP;
const codeOff = ringSpan + GAP + THICK + QUIET;
const EYES = [[0, 0], [S - 7, 0], [0, S - 7]];

/// Three concentric shapes per eye. `rx` of 0 gives the square the code
/// already draws, so the control runs through the identical code path.
const STYLES = [
  { name: "square (shipped)", kind: "rect", rx: [0, 0, 0] },
  { name: "soft", kind: "rect", rx: [1, 0.7, 0.5] },
  { name: "rounded", kind: "rect", rx: [2, 1.4, 1] },
  { name: "squircle", kind: "rect", rx: [3, 2.1, 1.5] },
  { name: "target", kind: "circle", rx: [0, 0, 0] },
  // Two opposite corners rounded, a common styling that keeps two square
  // corners for the scanner to square up against.
  { name: "leaf", kind: "leaf", rx: [2.6, 1.8, 1.3] },
];

const shape = (kind, x, y, w, fill, rx) => {
  const cx = x + w / 2;
  if (kind === "circle") {
    return `<circle cx="${cx}" cy="${y + w / 2}" r="${w / 2}" fill="${fill}"/>`;
  }
  if (kind === "leaf") {
    // Rounded at the top-left and bottom-right only.
    const r = rx;
    return `<path fill="${fill}" d="M${x + r} ${y}h${w - r}v${w - r}` +
      `a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}v-${w - r}a${r} ${r} 0 0 1 ${r} -${r}z"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${w}" ` +
    (rx ? `rx="${rx}" ` : "") + `fill="${fill}"/>`;
};

/// Erase the 7x7 to the field colour, then draw the style on top.
function withEyeStyle(style, ink) {
  const base = renderSvg(CODE.modules, TARGET.want, CODE.size,
    { level: 200, streak: STREAK, years: 1, marks: [], lastDay: 20700, today: 20700 });
  let add = "";
  for (const [ex, ey] of EYES) {
    const x = codeOff + ex, y = codeOff + ey;
    add += `<rect x="${x}" y="${y}" width="7" height="7" fill="${FIELD}"/>`;
    add += shape(style.kind, x, y, 7, ink, style.rx[0]);
    add += shape(style.kind, x + 1, y + 1, 5, FIELD, style.rx[1]);
    add += shape(style.kind, x + 2, y + 2, 3, ink, style.rx[2]);
  }
  return { svg: base.replace(/<\/svg>$/, `${add}</svg>`), bytes: add.length, base };
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
/// Which sizes decode, kept as the LIST -- a style that fails only at 1600 is a
/// different problem from one that fails at 256, and the count alone hides it.
const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

const ink = colourAt(rungOf(STREAK));
const basePx = pixels(renderSvg(CODE.modules, TARGET.want, CODE.size,
  { level: 200, streak: STREAK, years: 1, marks: [], lastDay: 20700, today: 20700 }), 560);

console.log(`eye styles, ink ${ink}, code ${S}x${S}, ECC level L`);
console.log(`decode sizes: ${SIZES.join(", ")}\n`);
console.log("style              shift    added   decodes");
const tiles = [];
for (const style of STYLES) {
  const { svg, bytes } = withEyeStyle(style, ink);
  const ok = decodesAt(svg);
  const s = shift(basePx, pixels(svg, 560));
  const all = ok.length === SIZES.length;
  console.log(`${style.name.padEnd(18)} ${String(s).padStart(3)}/255  ${String(bytes).padStart(5)} B  `
    + `${all ? "ALL" : "FAILS at " + SIZES.filter(p => !ok.includes(p)).join(",")}`);
  tiles.push({ label: style.name, svg, shift: s, ok, all, bytes });
}

const TILE = 250, LBL = 44, PAD = 22, COLS = 3;
const rows = Math.ceil(tiles.length / COLS);
const W = COLS * TILE + 2 * PAD, H = rows * (TILE + LBL) + 76;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="34" font-family="monospace" font-size="18" fill="#111">`
  + `MRO EYE SHAPES -- every tile decoded at ${SIZES.length} raster sizes</text>`;
tiles.forEach((t, i) => {
  const x = PAD + (i % COLS) * TILE, y = 58 + Math.floor(i / COLS) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${canvas} ${canvas}">${inner}</svg>`
    + `<text x="${x + 6}" y="${y + TILE - 4}" font-family="monospace" font-size="13" fill="#111">${t.label}</text>`
    + `<text x="${x + 6}" y="${y + TILE + 14}" font-family="monospace" font-size="12" fill="${t.all ? "#666" : "#c8102e"}">`
    + `shift ${t.shift}/255, ${t.bytes} B, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok.length)}</text>`;
});
sheet += "</svg>";
writeFileSync(`${OUT}/eye-shapes.png`, new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nwrote ${OUT}/eye-shapes.png`);
