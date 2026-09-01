// The three proposed Mark treatments, shown the only way the small ones read:
// two states meeting at a seam.
//
// Each Mark gets three panels.
//   1. unmarked | proposed   -- does it register as a Mark at all?
//   2. shipped  | proposed   -- what the change actually buys over today.
//   3. a zoom of 1           -- for the shifts too small to see at full size.
//
// The proposals themselves are prototyped by substitution on the rendered SVG
// and by writing into the palette array. tools/render-token.mjs is NOT
// modified: it is the reference the Solidity Renderer is diffed against byte
// for byte, and nothing here has been agreed yet.
//
//   node tools/proposal-sheet.mjs        (through ~/scripts/safe-build.sh)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
import { PNG } from "pngjs";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, BLUEBLOOD_BY_TIER, TIERS, colourAt, rungOf, noiseAt,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const DOMAIN = "example.com";
const PAYLOAD = payloadFor(DOMAIN, 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const OUT = new URL("./out/marks", import.meta.url).pathname;
const SIZES = [256, 500, 848, 1080, 1600];

const PANEL = 520;   // rendered size of each half-and-half panel
const WIN = 260;     // zoom window, in source pixels of a 1200px render
const SRC = 1200;

const luma = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
const hex = (r, g, b) =>
  "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, "0")).join("");
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const chroma = h => {
  const [r, g, b] = rgbOf(h);
  return Math.max(r, g, b) - Math.min(r, g, b);
};
const atLuma = ([r, g, b], target) => {
  const k = target / (0.299 * r + 0.587 * g + 0.114 * b);
  return hex(r * k, g * k, b * k);
};
const toward = ([r, g, b], t) => {
  const m = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r + (m - r) * t, g + (m - g) * t, b + (m - b) * t];
};

const stateFor = (streak, marks) => ({
  level: 200, streak, years: 1, marks, lastDay: 20700, today: 20700,
});
const draw = (streak, marks) => renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, marks));

// ---------------------------------------------------------------------------
// The three proposals.
// ---------------------------------------------------------------------------

/// Bloom: the gradient's far end derived from the tier ink at 60% of its
/// luminance, instead of the fixed #c8102e that equals the top tier's own
/// colour and therefore vanishes there.
function bloomProposed(streak) {
  const tier = colourAt(rungOf(streak));
  const far = atLuma(rgbOf(tier), luma(tier) * 0.6);
  const svg = draw(streak, ["bloom"]).replace(
    /(<stop offset="1" stop-color=")#c8102e(")/, `$1${far}$2`);
  if (svg.includes('stop-color="#c8102e"/></linearGradient>') && far !== "#c8102e") {
    throw new Error("bloom far stop was not substituted");
  }
  return svg;
}

/// Blue Blood: chroma scaled to 40% of the heart's at the same rung, with a
/// floor of 22 so day one is no fainter than it already is. Luminance is
/// untouched -- that is the binarizer's rule, not a preference.
const SLATE = [60, 90, 130];
function bluebloodInks() {
  return TIERS.map((_, i) => {
    const rung = TIERS.length - 1 - i;
    const wanted = Math.max(chroma(colourAt(rung)) * 0.40, 22);
    const target = luma(noiseAt(rung));
    let ink = atLuma(toward(SLATE, 0.95), target);
    for (let m = 0.95; m >= 0; m -= 0.01) {
      ink = atLuma(toward(SLATE, m), target);
      if (chroma(ink) >= wanted) break;
    }
    return ink;
  });
}
function bluebloodProposed(streak) {
  const keep = [...BLUEBLOOD_BY_TIER];
  const inks = bluebloodInks();
  for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = inks[i];
  const svg = draw(streak, ["blueblood"]);
  for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = keep[i];
  return svg;
}

/// Singularity: the spec's inversion. The heart and the noise are two adjacent
/// paths differing only by fill, so exchanging the two fills IS the effect --
/// no new geometry and no eighth surface.
function singularityProposed(streak) {
  const rung = rungOf(streak);
  const tier = colourAt(rung), noise = noiseAt(rung);
  const base = draw(streak, []);
  const fills = [...base.matchAll(/<path fill="(#[0-9a-f]{6})"/g)];
  const n = fills[fills.length - 2], h = fills[fills.length - 1];
  if (n[1] !== noise || h[1] !== tier) throw new Error(`unexpected path order: ${n[1]}, ${h[1]}`);
  let svg = base.slice(0, h.index) + h[0].replace(tier, noise) + base.slice(h.index + h[0].length);
  svg = svg.slice(0, n.index) + n[0].replace(noise, tier) + svg.slice(n.index + n[0].length);
  return svg;
}

// ---------------------------------------------------------------------------
// Panel building.
// ---------------------------------------------------------------------------
/// Render, and read `.pixels` EXACTLY ONCE.
///
/// resvg-js exposes `.pixels` as a getter that copies the entire buffer on
/// every access. Reading it inside a per-pixel loop turned a 520x520 compose
/// into 270,400 copies of a 1 MB buffer, which ran for 25 minutes before the
/// wall-clock cap killed it. Return a plain object so the buffer cannot be
/// re-fetched by accident.
const pixels = (svg, px) => {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  return { px: r.pixels, w: r.width, h: r.height };
};

/// Two renders meeting at a vertical seam, left half from A and right from B.
function seam(svgA, svgB, px) {
  const a = pixels(svgA, px), b = pixels(svgB, px);
  const png = new PNG({ width: px, height: a.h });
  const half = px >> 1;
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < px; x++) {
      const i = (y * px + x) * 4;
      const from = x < half ? a.px : b.px;
      png.data[i] = from[i]; png.data[i+1] = from[i+1];
      png.data[i+2] = from[i+2]; png.data[i+3] = 255;
      if (x === half) { png.data[i] = 34; png.data[i+1] = 29; png.data[i+2] = 31; }
    }
  }
  return png;
}

/// The WIN x WIN window holding the most changed pixels, on a coarse grid with
/// a summed-area table. Not the centroid: a ring-shaped change has its centroid
/// in the middle, where nothing changed.
function bestWindow(maskFn, w, h, COARSE = 20) {
  const gw = Math.ceil(w / COARSE), gh = Math.ceil(h / COARSE);
  const grid = new Float64Array(gw * gh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (maskFn(y * w + x)) grid[((y / COARSE) | 0) * gw + ((x / COARSE) | 0)]++;
  const sat = new Float64Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      sat[(y+1)*(gw+1)+(x+1)] = grid[y*gw+x] + sat[y*(gw+1)+(x+1)] + sat[(y+1)*(gw+1)+x] - sat[y*(gw+1)+x];
  const cells = Math.round(WIN / COARSE);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y + cells <= gh; y++)
    for (let x = 0; x + cells <= gw; x++) {
      const s = sat[(y+cells)*(gw+1)+(x+cells)] - sat[y*(gw+1)+(x+cells)]
              - sat[(y+cells)*(gw+1)+x] + sat[y*(gw+1)+x];
      if (s > best) { best = s; bx = x; by = y; }
    }
  return { x: bx * COARSE, y: by * COARSE };
}

/// A zoomed seam: the same window from both renders, nearest-neighbour scaled.
function zoomSeam(svgA, svgB, out) {
  const a = pixels(svgA, SRC), b = pixels(svgB, SRC);
  const ap = a.px, bp = b.px;
  const win = bestWindow(i => {
    const o = i * 4;
    return Math.max(Math.abs(ap[o] - bp[o]),
                    Math.abs(ap[o+1] - bp[o+1]),
                    Math.abs(ap[o+2] - bp[o+2])) > 0;
  }, a.w, a.h);
  const png = new PNG({ width: out, height: out });
  const half = WIN >> 1;
  for (let y = 0; y < out; y++) {
    const sy = win.y + Math.min(WIN - 1, (y * WIN / out) | 0);
    for (let x = 0; x < out; x++) {
      const sxWin = Math.min(WIN - 1, (x * WIN / out) | 0);
      const from = sxWin < half ? ap : bp;
      const s = (sy * a.w + win.x + sxWin) * 4, d = (y * out + x) * 4;
      png.data[d] = from[s]; png.data[d+1] = from[s+1];
      png.data[d+2] = from[s+2]; png.data[d+3] = 255;
      if (sxWin === half) { png.data[d] = 34; png.data[d+1] = 29; png.data[d+2] = 31; }
    }
  }
  return png;
}

const uri = png => "data:image/png;base64," + PNG.sync.write(png).toString("base64");
const decodes = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
}).length;

// ---------------------------------------------------------------------------
const MARKS = [
  {
    tag: "bloom", name: "Bloom", streak: 150, rungNote: "streak 150, the tier where Bloom currently does nothing at all",
    proposal: "gradient far end = tier ink at 60% luminance",
    proposed: bloomProposed, shipped: s => draw(s, ["bloom"]),
  },
  {
    tag: "blueblood", name: "Blue Blood", streak: 150, rungNote: "streak 150, the top tier",
    proposal: "noise chroma = 40% of the heart's, floor 22",
    proposed: bluebloodProposed, shipped: s => draw(s, ["blueblood"]),
  },
  {
    tag: "singularity", name: "Singularity", streak: 150, rungNote: "streak 150; the Mark can only ever be bought at this tier",
    proposal: "the spec's inversion -- heart and noise exchange inks",
    proposed: singularityProposed, shipped: s => draw(s, []),
  },
];

const ONLY = process.argv[2];
const t0 = process.hrtime.bigint();
const step = (label) => {
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  [${ms.toFixed(0).padStart(7)} ms] ${label}`);
};

for (const m of MARKS.filter(x => !ONLY || x.tag === ONLY)) {
  const base = draw(m.streak, []);
  const shipped = m.shipped(m.streak);
  const proposed = m.proposed(m.streak);

  // Decoded ONCE. It was being called twice per Mark -- in the caption and in
  // the log line -- which is ten ZXing passes per Mark, several at 1600px.
  const ok = decodes(proposed);
  console.log(`${m.name}: rendered, decodes ${ok}/${SIZES.length}`);

  step("decoded");
  const p1 = seam(base, proposed, PANEL); step("seam 1");
  const p2 = seam(shipped, proposed, PANEL); step("seam 2");
  const p3 = zoomSeam(base, proposed, PANEL); step("zoom seam");
  const panels = [
    { png: p1, a: "unmarked", b: "proposed" },
    { png: p2, a: m.tag === "singularity" ? "unmarked" : "shipped Mark", b: "proposed" },
    { png: p3, a: "unmarked", b: "proposed", zoom: true },
  ];

  const PAD = 26, GAP = 18, LBL = 62, TOP = 96;
  const W = panels.length * PANEL + (panels.length - 1) * GAP + 2 * PAD;
  const H = TOP + PANEL + LBL + PAD;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/>`
    + `<text x="${PAD}" y="42" font-family="monospace" font-size="27" fill="#111">${m.name.toUpperCase()} -- proposed</text>`
    + `<text x="${PAD}" y="72" font-family="monospace" font-size="17" fill="#666">${m.proposal}</text>`
    + `<text x="${PAD}" y="${TOP - 6}" font-family="monospace" font-size="15" fill="#666">`
    + `${m.rungNote} -- decodes at ${ok} of ${SIZES.length} raster sizes</text>`;
  panels.forEach((p, i) => {
    const x = PAD + i * (PANEL + GAP);
    svg += `<image x="${x}" y="${TOP}" width="${PANEL}" height="${PANEL}" href="${uri(p.png)}"/>`
      + `<text x="${x}" y="${TOP + PANEL + 26}" font-family="monospace" font-size="17" fill="#111">`
      + `${p.a}  |  ${p.b}</text>`
      + `<text x="${x}" y="${TOP + PANEL + 48}" font-family="monospace" font-size="14" fill="#666">`
      + `${p.zoom ? "zoomed about 7x on the region that changed" : "left of the seam / right of the seam"}</text>`;
  });
  svg += "</svg>";
  step("sheet svg assembled, " + (svg.length / 1024).toFixed(0) + " KB");

  const file = `${OUT}/proposed-${m.tag}.png`;
  writeFileSync(file, new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng());
  step("sheet rasterised");
  console.log(`${m.name.padEnd(12)} decodes ${ok}/${SIZES.length}  ->  ${file}`);
}
