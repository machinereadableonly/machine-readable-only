// Three eye shapes across five colourways, all decode-tested.
//
// Shape and colour are independent choices, so they are measured as a grid
// rather than one at a time. Every combination is decoded: the eyes are what a
// scanner locates FIRST, and a colour that works in the noise field is not
// automatically one that works here.
//
//   node tools/eye-colourway-sheet.mjs   (through ~/scripts/safe-build.sh)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import * as SHEET from "./sheet-code.mjs";
import { renderSvg, canvasFor, QUIET, FIELD } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

// The reference code, shared so no sheet can be judged on a heart that will
// never mint. See sheet-code.mjs -- this used to be four hardcoded lines in ten
// separate files, all of them naming a domain that was decided against.
const { PAYLOAD, DEST, CODE, TARGET } = SHEET;
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = new URL("./out/marks", import.meta.url).pathname;
const S = CODE.size;

const canvas = canvasFor(1);
const THICK = (canvas - 45) / 2 - 2;
const codeOff = 2 + THICK + QUIET;
const EYES = [[0, 0], [S - 7, 0], [0, S - 7]];

const SHAPES = ["square", "target", "leaf"];
const INKS = [
  ["heart red", "#c8102e"],
  ["crown gold", "#b8860b"],
  ["green", "#007c08"],
  ["violet", "#9800fc"],
  ["ink", "#2b2b2e"],
];

const shape = (kind, x, y, w, fill) => {
  const c = x + w / 2;
  if (kind === "target") {
    return `<circle cx="${c}" cy="${y + w / 2}" r="${w / 2}" fill="${fill}"/>`;
  }
  if (kind === "leaf") {
    const r = w * 0.37;
    return `<path fill="${fill}" d="M${x + r} ${y}h${w - r}v${w - r}` +
      `a${r} ${r} 0 0 1 -${r} ${r}h-${w - r}v-${w - r}a${r} ${r} 0 0 1 ${r} -${r}z"/>`;
  }
  return `<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="${fill}"/>`;
};

function withEyes(kind, ink) {
  const base = renderSvg(CODE.modules, TARGET.want, CODE.size,
    { level: 200, streak: 150, years: 0, marks: [], lastDay: 20700, today: 20700 });
  let add = "";
  for (const [ex, ey] of EYES) {
    const x = codeOff + ex, y = codeOff + ey;
    add += `<rect x="${x}" y="${y}" width="7" height="7" fill="${FIELD}"/>`
      + shape(kind, x, y, 7, ink)
      + shape(kind, x + 1, y + 1, 5, FIELD)
      + shape(kind, x + 2, y + 2, 3, ink);
  }
  return { svg: base.replace(/<\/svg>$/, `${add}</svg>`), bytes: add.length };
}

const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

console.log("shape   ink          bytes  decodes");
const tiles = [];
for (const [inkName, ink] of INKS) {
  for (const kind of SHAPES) {
    const { svg, bytes } = withEyes(kind, ink);
    const ok = decodesAt(svg);
    const all = ok.length === SIZES.length;
    console.log(`${kind.padEnd(7)} ${inkName.padEnd(12)} ${String(bytes).padStart(5)}  `
      + `${all ? "ALL" : "FAILS at " + SIZES.filter(p => !ok.includes(p)).join(",")}`);
    tiles.push({ label: `${kind} / ${inkName}`, svg, ok, all, bytes });
  }
}

const TILE = 240, LBL = 42, PAD = 22, COLS = SHAPES.length;
const rows = Math.ceil(tiles.length / COLS);
const W = COLS * TILE + 2 * PAD, H = rows * (TILE + LBL) + 72;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="32" font-family="monospace" font-size="17" fill="#111">`
  + `MRO EYE COLOURWAYS -- square / target / leaf, decoded at ${SIZES.length} sizes</text>`;
tiles.forEach((t, i) => {
  const x = PAD + (i % COLS) * TILE, y = 54 + Math.floor(i / COLS) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${canvas} ${canvas}">${inner}</svg>`
    + `<text x="${x + 6}" y="${y + TILE - 6}" font-family="monospace" font-size="13" fill="#111">${t.label}</text>`
    + `<text x="${x + 6}" y="${y + TILE + 12}" font-family="monospace" font-size="11.5" fill="${t.all ? "#666" : "#c8102e"}">`
    + `${t.bytes} B, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok.length)}</text>`;
});
sheet += "</svg>";
writeFileSync(`${OUT}/eye-colourways.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nwrote ${OUT}/eye-colourways.png`);
