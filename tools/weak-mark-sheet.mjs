// Candidate treatments for the three Marks that do not earn their price.
//
// WHY. Measured 2026-08-31 across all five rungs: Bloom moves the image by
// 88/255 at the bottom rung and 0/255 at the top -- its gradient runs from the
// token's own tier colour to #c8102e, and at rung 4 the tier colour IS
// #c8102e, so it emits a gradient from a colour to itself. Blue Blood sits at
// 11-15/255 everywhere. Singularity draws nothing at all: MarkRenderer
// declares the constant and never uses it.
//
// Nothing here ships. This renders candidates and DECODES them, because the
// heart and the noise must stay matched in BT.601 luminance or ZXing's
// binarizer resolves the lighter one to background -- the same rule that
// governs noise-mark-sheet.mjs, which this follows.
//
//   node tools/weak-mark-sheet.mjs bloom
//   node tools/weak-mark-sheet.mjs blueblood
//   node tools/weak-mark-sheet.mjs singularity
//
// Always through ~/scripts/safe-build.sh: each candidate is rendered and
// decoded at five raster sizes.
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, canvasFor, BLUEBLOOD_BY_TIER, TIERS, colourAt, rungOf, noiseAt,
  STATIC, BEAT,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const DOMAIN = "example.com";
const PAYLOAD = payloadFor(DOMAIN, 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);            // mask 7: the shipped bitmap for token 1
const TARGET = heartTarget(CODE.size);
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = new URL("./out/marks", import.meta.url).pathname;

/// BT.601, the weighting ZXing's RGBLuminanceSource uses.
const luma = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
const chroma = h => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b);
};
const hex = (r, g, b) =>
  "#" + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, "0")).join("");
const rgbOf = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
/// Move an RGB direction onto an exact luma, keeping its hue.
const atLuma = ([r, g, b], target) => {
  const k = target / (0.299 * r + 0.587 * g + 0.114 * b);
  return hex(r * k, g * k, b * k);
};
/// Pull a colour toward its own grey, which lowers chroma at constant luma.
const toward = ([r, g, b], t) => {
  const m = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r + (m - r) * t, g + (m - g) * t, b + (m - b) * t];
};

const stateFor = (streak, marks) => ({
  level: 200, streak, years: 1, marks, lastDay: 20700, today: 20700,
});
const STREAKS = [1, 5, 10, 45, 150];   // one per rung, lowest first

/// Largest per-channel difference between two renders of the same size.
function delta(svgA, svgB, px = 560) {
  const a = new Resvg(svgA, { fitTo: { mode: "width", value: px } }).render().pixels;
  const b = new Resvg(svgB, { fitTo: { mode: "width", value: px } }).render().pixels;
  let max = 0, changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i+1] - b[i+1]), Math.abs(a[i+2] - b[i+2]));
    if (d) { changed++; if (d > max) max = d; }
  }
  return { max, pct: +((changed / (a.length / 4)) * 100).toFixed(1) };
}

const decodes = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

// ---------------------------------------------------------------------------
// BLOOM. The far end of the gradient is the only dial. The shipped value is a
// fixed colour, which is exactly why it collapses at the rung whose tier
// colour equals it; the alternatives derive the far end FROM the tier colour
// so every rung gets the same sweep.
// ---------------------------------------------------------------------------
function bloomCandidates(streak) {
  const rung = rungOf(streak);
  const tier = colourAt(rung);
  const noise = noiseAt(rung);
  return [
    { name: "shipped", to: "#c8102e" },
    // A fixed deep red below the whole ladder. Simple, but its distance from
    // the tier colour still varies rung to rung.
    { name: "fixed deep", to: "#8c0a20" },
    // The tier's own hue at 60% of its luma: an identical sweep at every rung,
    // and the darker end can never be paler than the tier it came from.
    { name: "tier x0.6", to: atLuma(rgbOf(tier), luma(tier) * 0.6) },
    // Same idea, gentler, so the heart stays nearer the noise in weight.
    { name: "tier x0.75", to: atLuma(rgbOf(tier), luma(tier) * 0.75) },
  ].map(c => {
    const base = renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, []));
    const shipped = renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, [BEAT]));
    // Prototype by substituting the gradient's far stop. Nothing here ships,
    // and doing it this way keeps the reference renderer untouched.
    const svg = shipped.replace(
      /(<stop offset="1" stop-color=")#c8102e(")/, `$1${c.to}$2`);
    if (c.to !== "#c8102e" && svg === shipped) throw new Error("bloom stop not substituted");
    return {
      ...c, svg, tier, noise,
      // The gradient's dark end against the noise it sits beside.
      gap: +Math.abs(luma(c.to) - luma(noise)).toFixed(1),
      ...delta(base, svg),
      ok: decodes(svg),
    };
  });
}

// ---------------------------------------------------------------------------
// BLUE BLOOD. Luminance is fixed by the binarizer and cannot move. Chroma is
// the only axis, and the rule is `noise chroma < heart chroma at the same
// rung` -- which BINDS only at day one (22 against 25) and leaves the top
// rungs almost untouched, where the heart carries chroma 155 to 184.
// ---------------------------------------------------------------------------
const SLATE = [60, 90, 130];
function bluebloodInks(fraction, floor = 0) {
  // Derived per rung, never hand-picked: take the slate direction, pull it
  // toward grey until its chroma is `fraction` of that rung's heart chroma,
  // then put it back on the rung's exact luma.
  return TIERS.map((_, i) => {
    const rung = TIERS.length - 1 - i;
    const heart = colourAt(rung);
    const neutral = noiseAt(rung);
    // A floor keeps day one at least as tinted as it is today: scaling by the
    // heart alone makes the start tier FAINTER than shipped, because the
    // start-tier heart carries the least chroma on the ladder.
    const wanted = Math.max(chroma(heart) * fraction, floor);
    let mix = 0.95, ink = atLuma(toward(SLATE, mix), luma(neutral));
    // Walk the mix down until the chroma reaches the target, or the hue runs
    // out of strength. A search, because chroma after the luma rescale is not
    // a closed form.
    for (let m = 0.95; m >= 0; m -= 0.01) {
      ink = atLuma(toward(SLATE, m), luma(neutral));
      if (chroma(ink) >= wanted) break;
      mix = m;
    }
    return ink;
  });
}

function bluebloodCandidates(streak) {
  const SHIPPED = [...BLUEBLOOD_BY_TIER];
  const rung = rungOf(streak);
  const out = [];
  for (const c of [
    { name: "shipped", inks: SHIPPED },
    { name: "0.25 x heart", inks: bluebloodInks(0.25) },
    { name: "0.40 x heart", inks: bluebloodInks(0.40) },
    { name: "0.40 + floor", inks: bluebloodInks(0.40, 22) },
  ]) {
    for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = c.inks[i];
    const base = renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, []));
    const svg = renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, [STATIC]));
    const ink = c.inks[TIERS.length - 1 - rung];
    const heart = colourAt(rung);
    out.push({
      name: c.name, svg, tier: heart, noise: ink,
      gap: +Math.abs(luma(heart) - luma(ink)).toFixed(1),
      chroma: chroma(ink), heartChroma: chroma(heart),
      ...delta(base, svg),
      ok: decodes(svg),
    });
  }
  for (let i = 0; i < BLUEBLOOD_BY_TIER.length; i++) BLUEBLOOD_BY_TIER[i] = SHIPPED[i];
  return out;
}

// ---------------------------------------------------------------------------
// SINGULARITY. The spec's own words: "heart cells render as code modules and
// the QR becomes the only red element". In the current SVG the heart and the
// noise are two adjacent paths that differ only by fill, so the inversion is a
// fill SWAP -- no new geometry, and no eighth surface invented.
// ---------------------------------------------------------------------------
function singularityCandidates(streak) {
  const rung = rungOf(streak);
  const tier = colourAt(rung), noise = noiseAt(rung);
  const base = renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, []));
  // Draw order in renderSvg is ghost, frame, noise, heart -- so the last two
  // fills are the pair to exchange.
  const fills = [...base.matchAll(/<path fill="(#[0-9a-f]{6})"/g)];
  if (fills.length < 2) throw new Error("expected at least two filled paths");
  const noiseFill = fills[fills.length - 2], heartFill = fills[fills.length - 1];
  if (noiseFill[1] !== noise || heartFill[1] !== tier) {
    throw new Error(`path order not as expected: ${noiseFill[1]} then ${heartFill[1]}`);
  }
  // Swap right to left so the earlier index stays valid.
  let svg = base.slice(0, heartFill.index)
    + heartFill[0].replace(tier, noise)
    + base.slice(heartFill.index + heartFill[0].length);
  svg = svg.slice(0, noiseFill.index)
    + noiseFill[0].replace(noise, tier)
    + svg.slice(noiseFill.index + noiseFill[0].length);

  return [{
    name: "inversion", svg, tier, noise,
    gap: +Math.abs(luma(tier) - luma(noise)).toFixed(1),
    ...delta(base, svg),
    ok: decodes(svg),
  }];
}

// ---------------------------------------------------------------------------
const WHICH = (process.argv[2] ?? "bloom").toLowerCase();
const RUN = {
  bloom: { candidates: bloomCandidates, streaks: STREAKS },
  blueblood: { candidates: bluebloodCandidates, streaks: [1, 45, 150] },
  singularity: { candidates: singularityCandidates, streaks: [1, 150] },
}[WHICH];
if (!RUN) throw new Error(`unknown mark: ${WHICH}`);

const tiles = [];
console.log(`${WHICH} candidates -- ${SIZES.length} decode sizes each\n`);
console.log("streak  candidate      tier     far/ink   lumaGap  shift      decodes");
for (const streak of RUN.streaks) {
  for (const c of RUN.candidates(streak)) {
    const all = c.ok.length === SIZES.length;
    console.log(
      `${String(streak).padStart(6)}  ${c.name.padEnd(13)}  ${c.tier}  ${(c.to ?? c.noise)}  ` +
      `${String(c.gap).padStart(7)}  ${String(c.max).padStart(3)}/255  ` +
      `${all ? "ALL" : "FAILS " + (SIZES.length - c.ok.length) + " (" + c.ok.join(",") + ")"}`);
    tiles.push({ ...c, streak, all });
  }
}

// One contact sheet, candidates across, rungs down.
const TILE = 260, LBL = 46, PAD = 24;
const cols = RUN.candidates(RUN.streaks[0]).length;
const rows = RUN.streaks.length;
const W = cols * TILE + 2 * PAD, H = rows * (TILE + LBL) + 84;
const cells = canvasFor(1);
let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="34" font-family="monospace" font-size="18" fill="#111">`
  + `MRO ${WHICH.toUpperCase()} CANDIDATES -- weakest streak at the top</text>`;
tiles.forEach((t, i) => {
  const x = PAD + (i % cols) * TILE, y = 62 + Math.floor(i / cols) * (TILE + LBL);
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 8}" y="${y}" width="${TILE - 16}" height="${TILE - 16}" viewBox="0 0 ${cells} ${cells}">${inner}</svg>`;
  sheet += `<text x="${x + 8}" y="${y + TILE - 2}" font-family="monospace" font-size="14" fill="#111">`
    + `${t.name} -- streak ${t.streak}</text>`;
  sheet += `<text x="${x + 8}" y="${y + TILE + 16}" font-family="monospace" font-size="11.5" fill="${t.all ? "#666" : "#c8102e"}">`
    + `shift ${t.max}/255, ${t.all ? "decodes at every size" : "FAILS " + (SIZES.length - t.ok.length) + " sizes"}</text>`;
});
sheet += "</svg>";

writeFileSync(`${OUT}/candidates-${WHICH}.png`,
  new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log(`\nwrote ${OUT}/candidates-${WHICH}.png`);
