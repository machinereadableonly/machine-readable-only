// Build the phone-scan sheet, and refuse to write one that is already broken.
//
// The previous sheet was generated from a scratch script, was never checked with
// anything but jsqr, and every tile on it failed on a real phone: the payload
// carried binary junk, so the code decoded to something no scanner would treat as
// a URL. Two rules come out of that and are enforced below.
//
// 1. Every tile is verified with the strict decoder at its own pixel size before
//    the sheet is written. A sheet that cannot pass a machine has no business
//    costing a human a scan.
// 2. Tiles are drawn at a whole number of pixels per module with crisp edges. The
//    old sheet rendered 53 canvas cells into 250 pixels -- 4.717 px per module,
//    antialiased -- which put 74 distinct colours into a three-colour picture.
//
// A plain control code sits on the sheet as tile 1. If the control fails on a
// phone, the fault is the screen, the zoom or the camera, not the design.
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";
import { solve, payloadFor, VERSION, ECC } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg, canvasFor, QUIET } from "./render-token.mjs";
import { scanResult, renderModules } from "./test/helpers/decode.mjs";

const DOMAIN = process.argv[3] ?? "example.com";
const OUT = process.argv[2] ?? "../docs/scan-test.png";
const PAYLOAD = payloadFor(DOMAIN, 1);
const CODE = solve(PAYLOAD, 0);
const TARGET = heartTarget(CODE.size);

// A plain, ordinary QR of the same destination: the control.
function controlSvg() {
  const qr = QRCode.create([{ data: PAYLOAD, mode: "byte" }],
    { version: VERSION, errorCorrectionLevel: ECC });
  const m = new Uint8Array(qr.modules.size * qr.modules.size);
  for (let i = 0; i < m.length; i++) m[i] = qr.modules.data[i] ? 1 : 0;
  return { svg: renderModules(m, qr.modules.size), cells: qr.modules.size + 2 * QUIET };
}

const control = controlSvg();
// Sizes are whole multiples of the cell count, so every module is an exact block.
const TILES = [
  { label: "control, plain code", svg: control.svg, cells: control.cells, mult: 5 },
  { label: "day 1, no streak",  state: { level: 0, streak: 0, years: 0 },    mult: 5 },
  { label: "day 200, streak 45", state: { level: 200, streak: 45, years: 0 }, mult: 5 },
  { label: "whole, streak 140",  state: { level: 365, streak: 140, years: 1 }, mult: 5 },
  { label: "day 1, small",      state: { level: 0, streak: 0, years: 0 },    mult: 4 },
  { label: "day 200, small",    state: { level: 200, streak: 45, years: 0 },  mult: 4 },
  { label: "whole, small",      state: { level: 365, streak: 140, years: 1 }, mult: 4 },
  { label: "whole, smallest",   state: { level: 365, streak: 140, years: 1 }, mult: 3 },
];

for (const t of TILES) {
  if (!t.svg) {
    t.svg = renderSvg(CODE.modules, TARGET.want, CODE.size, t.state);
    t.cells = canvasFor(t.state.years);
  }
  t.px = t.cells * t.mult;
}

// Verify before writing. A failing tile stops the sheet.
console.log("tile                    cells  px   px/module  decode");
const failures = [];
TILES.forEach((t, i) => {
  const r = scanResult(t.svg, t.px);
  if (!r.ok) failures.push(`${i + 1}. ${t.label}: ${r.why}`);
  console.log(`${String(i + 1).padStart(2)}. ${t.label.padEnd(20)} ${String(t.cells).padStart(3)}  ${String(t.px).padStart(3)}      ${t.mult}       ${r.ok ? "ok" : "FAIL -- " + r.why}`);
});
if (failures.length) {
  console.error("\nSheet NOT written. Fix these first:\n  " + failures.join("\n  "));
  process.exit(1);
}

const COLS = 4, CELL = 300, LBL = 52, PAD = 26;
const rows = Math.ceil(TILES.length / COLS);
const W = COLS * CELL + PAD, H = rows * (CELL + LBL) + 74;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="34" font-family="monospace" font-size="19" fill="#111">`
  + `MRO SCAN TEST -- view at 100% zoom. Every tile must open ${PAYLOAD.slice(0, -1)}</text>`;
TILES.forEach((t, i) => {
  const x = PAD + (i % COLS) * CELL, y = 62 + Math.floor(i / COLS) * (CELL + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x}" y="${y}" width="${t.px}" height="${t.px}" viewBox="0 0 ${t.cells} ${t.cells}">${inner}</svg>`;
  sheet += `<text x="${x}" y="${y + CELL - 16}" font-family="monospace" font-size="14" fill="#111">${i + 1}. ${t.label}</text>`;
  sheet += `<text x="${x}" y="${y + CELL + 4}" font-family="monospace" font-size="14" fill="#666">${t.px}px, ${t.mult}px per module</text>`;
});
sheet += "</svg>";
writeFileSync(new URL(OUT, import.meta.url),
  new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nsheet written: ${W}x${H}, ${TILES.length} tiles, all verified`);
