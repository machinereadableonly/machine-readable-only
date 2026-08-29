// Candidates for the rung-2 Mark that replaces Pulse, rendered and decoded.
//
// WHY THE NOISE INK. The drawn image has seven surfaces and six are already
// claimed -- field by Halo, quiet zone by Voice, ghost cells by Vein, frame and
// year rings by Crown, heart modules by Bloom, and the QArt target itself by
// Singularity. The noise ink is the only one left, and it is the largest of
// them: the noise is roughly half the lit modules in the code block. Claiming it
// costs nothing structurally, because `CodeRenderer.paths` already takes the
// noise as a parameter, exactly like the four Marks that are only a substituted
// string.
//
// THE CONSTRAINT THAT DECIDES IT. Heart and noise must MATCH in BT.601
// luminance. Once a raster is large enough that ZXing's 8x8 binarizer blocks
// fall inside a single module, a block has no local contrast and the LIGHTER of
// the two inks resolves to background -- which is what made a bare token stop
// decoding at 1200px while the noise was a constant #767676. So a tinted noise
// may move in hue but NOT in weight, and every candidate here is scaled to its
// tier's exact luma and then actually decoded rather than reasoned about.
//
//   node tools/noise-mark-sheet.mjs
//
// Writes docs/noise-mark.png. Run it through ~/scripts/safe-build.sh.
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import { renderSvg, canvasFor, NOISE_BY_TIER, TIERS, colourAt, rungOf } from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const DOMAIN = "example.com";
const PAYLOAD = payloadFor(DOMAIN, 1);
const DEST = PAYLOAD.slice(0, -1);
// Mask 7 is the mask robust-solve chooses for token 1, so this is the shipped
// bitmap rather than a fresh solve that might behave differently.
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);

/// BT.601 -- the weighting ZXing's RGBLuminanceSource uses. Not WCAG's, which
/// measures human legibility rather than what the binarizer sees.
const luma = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
const hex = (r, g, b) =>
  "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, "0")).join("");
const chroma = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b);
};

/// Scale a hue's RGB direction until it lands on exactly the luma we need.
/// Scaling in linear RGB keeps the hue and moves only the weight, which is the
/// one axis the binarizer cares about.
const atLuma = ([r, g, b], target) => {
  const k = target / (0.299 * r + 0.587 * g + 0.114 * b);
  return hex(r * k, g * k, b * k);
};

/// The neutral greys the token ships with today, as the control.
const SHIPPED = [...NOISE_BY_TIER];

/// Each candidate is a hue direction; the per-tier inks are derived so every
/// one of them matches its heart exactly. Hand-picking five hex values per
/// candidate would have been five chances to break the invariant by eye.
const FLAVOURS = [
  { name: "shipped (neutral)", rgb: null },
  { name: "slate",            rgb: [60, 90, 130] },
  { name: "teal",             rgb: [40, 100, 95] },
  { name: "violet",           rgb: [100, 75, 135] },
];

const STATES = [
  { label: "day one",  state: { level: 1,   streak: 0,   years: 0, marks: [], lastDay: 1000, today: 1000 } },
  { label: "streak 100", state: { level: 200, streak: 100, years: 0, marks: [], lastDay: 1000, today: 1000 } },
];

// 848 is the exact multiple (53 cells x 16). The rest are sizes a third party
// actually picks, including the 1200-1600 band where the old constant-grey
// noise first failed.
const SIZES = [256, 500, 848, 1080, 1600];

const tiles = [];
for (const f of FLAVOURS) {
  // The palette is a module-level array, so a candidate is applied by writing
  // into it and restored immediately after. Nothing here is meant to ship.
  const inks = f.rgb
    ? SHIPPED.map((_, i) => atLuma(f.rgb, luma(SHIPPED[i])))
    : SHIPPED;
  for (let i = 0; i < NOISE_BY_TIER.length; i++) NOISE_BY_TIER[i] = inks[i];

  for (const s of STATES) {
    const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, s.state);
    const rung = rungOf(s.state.streak);
    const heart = colourAt(rung);
    const noise = inks[TIERS.length - 1 - rung];
    const ok = SIZES.filter(px => {
      const r = scanResult(svg, px);
      return r.ok && r.destination === DEST;
    });
    tiles.push({
      flavour: f.name, state: s.label, svg, cells: canvasFor(0),
      heart, noise, gap: Math.abs(luma(heart) - luma(noise)), chroma: chroma(noise),
      ok, all: ok.length === SIZES.length,
    });
  }
}
for (let i = 0; i < NOISE_BY_TIER.length; i++) NOISE_BY_TIER[i] = SHIPPED[i];

console.log("flavour            state        heart    noise    lumaGap  chroma  decodes");
for (const t of tiles) {
  console.log(
    `${t.flavour.padEnd(18)} ${t.state.padEnd(12)} ${t.heart}  ${t.noise}  ` +
    `${t.gap.toFixed(1).padStart(7)}  ${String(t.chroma).padStart(6)}  ` +
    `${t.all ? "ALL " + SIZES.length : t.ok.length + "/" + SIZES.length + " (" + t.ok.join(",") + ")"}`
  );
}

const TILE = 300, COLS = 2, LBL = 52, PAD = 26;
const rows = Math.ceil(tiles.length / COLS);
const W = COLS * TILE + 2 * PAD, H = rows * (TILE + LBL) + 78;
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="36" font-family="monospace" font-size="19" fill="#111">`
  + `MRO RUNG-2 CANDIDATES -- the noise ink, the last unclaimed surface</text>`;
tiles.forEach((t, i) => {
  const x = PAD + (i % COLS) * TILE, y = 66 + Math.floor(i / COLS) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 10}" y="${y}" width="${TILE - 20}" height="${TILE - 20}" viewBox="0 0 ${t.cells} ${t.cells}">${inner}</svg>`;
  sheet += `<text x="${x + 10}" y="${y + TILE - 4}" font-family="monospace" font-size="15" fill="#111">`
    + `${t.flavour} -- ${t.state}</text>`;
  sheet += `<text x="${x + 10}" y="${y + TILE + 16}" font-family="monospace" font-size="12" fill="#666">`
    + `noise ${t.noise}, luma gap ${t.gap.toFixed(1)}, ${t.all ? "decodes at every size" : "FAILS " + (SIZES.length - t.ok.length)}</text>`;
});
sheet += "</svg>";

const OUT = "~/projects/machine-readable-only/docs/noise-mark.png";
writeFileSync(OUT, new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log("\nwrote " + OUT);

// ---------------------------------------------------------------------------
// How MUCH tint, which is a separate question from which hue.
//
// The hue sheet above runs at chroma 50-77, and at day one that reads wrong:
// the start-tier heart (#70575f) carries chroma 25, so a vivid noise is more
// saturated than the heart it surrounds and the noise becomes the subject. A
// number that decides what something LOOKS like has to be seen at every value
// before it is chosen, so this sweeps the intensity at a fixed hue.
//
// Chroma is reduced by pulling the hue direction toward its own grey, which
// keeps the luma exactly where it was -- the invariant is not negotiable at any
// intensity.
const toward = ([r, g, b], t) => {
  const m = (r + g + b) / 3;
  return [r + (m - r) * t, g + (m - g) * t, b + (m - b) * t];
};

const SWEEP_HUE = [60, 90, 130];          // slate, the strongest of the three
const MIXES = [0.85, 0.7, 0.55, 0.35, 0]; // 0 = the full-strength version above

const sweep = [];
for (const mix of MIXES) {
  const dir = toward(SWEEP_HUE, mix);
  const inks = SHIPPED.map((_, i) => atLuma(dir, luma(SHIPPED[i])));
  for (let i = 0; i < NOISE_BY_TIER.length; i++) NOISE_BY_TIER[i] = inks[i];

  for (const s2 of STATES) {
    const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, s2.state);
    const rung = rungOf(s2.state.streak);
    const heart = colourAt(rung);
    const noise = inks[TIERS.length - 1 - rung];
    const ok = SIZES.filter(px => {
      const r = scanResult(svg, px);
      return r.ok && r.destination === DEST;
    });
    sweep.push({
      label: "chroma " + chroma(noise), state: s2.label, svg, cells: canvasFor(0),
      heart, noise, gap: Math.abs(luma(heart) - luma(noise)),
      heartChroma: chroma(heart), chroma: chroma(noise),
      ok, all: ok.length === SIZES.length,
    });
  }
}
for (let i = 0; i < NOISE_BY_TIER.length; i++) NOISE_BY_TIER[i] = SHIPPED[i];

console.log("\nintensity sweep, slate hue");
console.log("state        heart    chroma  noise    chroma  lumaGap  decodes");
for (const t of sweep) {
  console.log(
    `${t.state.padEnd(12)} ${t.heart}  ${String(t.heartChroma).padStart(6)}  ${t.noise}  ` +
    `${String(t.chroma).padStart(6)}  ${t.gap.toFixed(1).padStart(7)}  ` +
    `${t.all ? "ALL " + SIZES.length : t.ok.length + "/" + SIZES.length}`
  );
}

const rows2 = Math.ceil(sweep.length / COLS);
const H2 = rows2 * (TILE + LBL) + 78;
let sheet2 = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H2}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="36" font-family="monospace" font-size="19" fill="#111">`
  + `MRO RUNG-2 INTENSITY -- how much tint, at the slate hue</text>`;
sweep.forEach((t, i) => {
  const x = PAD + (i % COLS) * TILE, y = 66 + Math.floor(i / COLS) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet2 += `<svg x="${x + 10}" y="${y}" width="${TILE - 20}" height="${TILE - 20}" viewBox="0 0 ${t.cells} ${t.cells}">${inner}</svg>`;
  sheet2 += `<text x="${x + 10}" y="${y + TILE - 4}" font-family="monospace" font-size="15" fill="#111">`
    + `${t.label} -- ${t.state}</text>`;
  sheet2 += `<text x="${x + 10}" y="${y + TILE + 16}" font-family="monospace" font-size="12" fill="#666">`
    + `heart chroma ${t.heartChroma}, noise ${t.noise}, ${t.all ? "decodes at every size" : "FAILS"}</text>`;
});
sheet2 += "</svg>";

const OUT2 = "~/projects/machine-readable-only/docs/noise-mark-intensity.png";
writeFileSync(OUT2, new Resvg(sheet2, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log("wrote " + OUT2);
