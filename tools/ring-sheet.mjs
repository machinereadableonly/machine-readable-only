// What does a ring cap actually cost the picture? Renders the same token at a
// range of ring counts, all at the SAME display size, and decodes each one --
// because every ring added makes the canvas bigger, which makes every module
// smaller at a fixed size, which is what a scanner actually sees.
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg, canvasFor } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const CODE = solve(PAYLOAD, 0);
const TARGET = heartTarget(CODE.size);
const DEST = PAYLOAD.slice(0, -1);

const RINGS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];
const SIZES = [900, 700, 500, 350];
const TILE = 300;   // every tile the same on-screen size, which is the honest test

const tiles = RINGS.map(r => {
  const state = { level: 365 * Math.max(r, 1), streak: 140, years: r, marks: [] };
  const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, state);
  const cells = canvasFor(r);
  const ok = SIZES.filter(px => {
    const s = scanResult(svg, px);
    return s.ok && s.destination === DEST;
  });
  return { r, svg, cells, ok, atTile: scanResult(svg, TILE).ok };
});

console.log("rings  canvas  heart% of canvas  px/module at 700  decodes at");
for (const t of tiles) {
  const pct = ((45 / t.cells) * 100).toFixed(0);
  const pxm = (700 / t.cells).toFixed(1);
  console.log(
    `${String(t.r).padStart(5)}  ${String(t.cells).padStart(6)}  ${(pct + "%").padStart(15)}` +
    `  ${pxm.padStart(16)}  ${t.ok.length ? t.ok.join(", ") : "NOTHING"}` +
    `${t.atTile ? "" : "   <-- fails at 300px tile"}`
  );
}

const COLS = 5, LBL = 46, PAD = 26;
const rows = Math.ceil(tiles.length / COLS);
const W = COLS * TILE + 2 * PAD, H = rows * (TILE + LBL) + 78;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="36" font-family="monospace" font-size="20" fill="#111">`
  + `MRO YEAR RINGS -- the same token at each ring count, every tile the same size</text>`;
tiles.forEach((t, i) => {
  const x = PAD + (i % COLS) * TILE, y = 66 + Math.floor(i / COLS) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 10}" y="${y}" width="${TILE - 20}" height="${TILE - 20}" viewBox="0 0 ${t.cells} ${t.cells}">${inner}</svg>`;
  sheet += `<text x="${x + 10}" y="${y + TILE - 6}" font-family="monospace" font-size="15" fill="#111">`
    + `${t.r} ring${t.r === 1 ? "" : "s"} = ${t.r} year${t.r === 1 ? "" : "s"}</text>`;
  sheet += `<text x="${x + 10}" y="${y + TILE + 14}" font-family="monospace" font-size="13" fill="#666">`
    + `${t.cells} cells, heart ${((45 / t.cells) * 100).toFixed(0)}%</text>`;
});
sheet += "</svg>";
writeFileSync(new URL("../docs/year-rings.png", import.meta.url).pathname,
  new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nsheet written: ${W}x${H}`);
