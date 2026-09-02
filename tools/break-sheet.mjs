// BREAK, and the two combinations that were unreachable until the trap came out.
//
// Until 2026-09-02 Break was excluded by both sides of pair 2, so Break+Static
// and Break+Beat could not exist and have never been rendered. Removing that
// exclusion makes both reachable, and one of them is the riskiest picture the
// ladder can produce. This sheet decides the definition of Break by measuring
// rather than by arguing.
//
// THE QUESTION. Break exchanges the heart's ink with the noise's. There are two
// ways to define that, and they differ only when Beat is also worn:
//
//   A, the naive FILL exchange: swap what the two paths are filled with. With
//      Beat that hands the GRADIENT to the noise.
//   B, the RUNG-COLOUR exchange: swap which rung colour each region takes, and
//      let Beat go on gradienting whichever region is now the heart. The noise
//      stays flat.
//
// WHY IT MIGHT MATTER. The two inks must match in BT.601 luminance or the
// binarizer drops the lighter one to background once its 8x8 blocks fall inside
// a single module -- that is what once stopped a bare token decoding at 1200px.
// A gradient has varying luminance by definition, so A puts a varying-luminance
// ink on the noise, which is the surface that rule binds hardest on. B cannot,
// because the noise stays flat. Whether A actually fails is a decode question,
// and a decode question is never settled by reasoning about it.
//
// Both DECIDED palette changes are applied here, so this renders the ladder as
// specified and not as currently coded: Static is GREEN (2026-09-02) and Beat's
// far stop is VIOLET (2026-08-31). Neither is in the shipped renderer yet.
//
// A Break token has a 365-day run at the moment it earns the Mark, but the Mark
// is permanent and the token can lapse afterwards -- so every rung is reachable
// and every rung is rendered.
//
//   node tools/break-sheet.mjs           (through ~/scripts/safe-build.sh)
//
// Writes tools/out/marks/break.png.
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, canvasFor, STATIC_BY_TIER, TIERS, colourAt, rungOf, noiseAt, staticAt,
  STATIC, BEAT,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const SIZES = [256, 500, 848, 1080, 1600];
const OUT = new URL("./out/marks", import.meta.url).pathname;

const VIOLET = "#2000ff";   // Beat's far stop, decided 2026-08-31

/// Static's green, one ink per rung: read from the shipped derivation rather
/// than recomputed here -- one derivation, in render-token.mjs.
const greenInks = () => TIERS.map((_, i) => staticAt(TIERS.length - 1 - i));

// ---------------------------------------------------------------------------
// The Break transform.
//
// Break is not implemented in either renderer, so it is prototyped here by
// rewriting the two code paths. The code block is always the LAST TWO paths in
// the output, in the fixed order noise then heart -- Renderer.sol pins that
// order and CodeRenderer emits the pair adjacently. Every rewrite below is
// ASSERTED to have changed the string, so a renderer change that moved the
// paths fails loudly here instead of silently rendering an un-inverted token.
const PATH = /<path fill="([^"]*)" d="([^"]*)"\/>/g;

function invert(svg, { mode, heartInk, noiseInk, beat }) {
  const paths = [...svg.matchAll(PATH)];
  if (paths.length < 2) throw new Error("break-sheet: expected at least two paths");
  const [noiseP, heartP] = paths.slice(-2);

  let out = svg;
  if (mode === "A") {
    // Swap the two fills verbatim. With Beat the heart's fill is url(#b), so
    // the gradient moves onto the noise.
    out = out.replace(heartP[0], `<path fill="${noiseP[1]}" d="${heartP[2]}"/>`);
    out = out.replace(noiseP[0], `<path fill="${heartP[1]}" d="${noiseP[2]}"/>`);
  } else {
    // Swap which RUNG COLOUR each region takes. The heart keeps the gradient
    // reference if Beat is worn; the gradient's near stop becomes the noise
    // ink, so the noise path stays a flat, luminance-matched colour.
    out = out.replace(heartP[0], `<path fill="${beat ? "url(#b)" : noiseInk}" d="${heartP[2]}"/>`);
    out = out.replace(noiseP[0], `<path fill="${heartInk}" d="${noiseP[2]}"/>`);
    if (beat) {
      const stop = new RegExp(`(<stop offset="0" stop-color=")${heartInk}(")`);
      if (!stop.test(out)) throw new Error("break-sheet: gradient near stop not found");
      out = out.replace(stop, `$1${noiseInk}$2`);
    }
  }
  if (out === svg) throw new Error("break-sheet: inversion changed nothing");
  return out;
}

// ---------------------------------------------------------------------------
// Every rung is rendered: Break is earned at a 365-day run, but it is permanent
// and the token can lapse afterwards.
const RUNGS = [
  { streak: 1,   label: "run 1" },
  { streak: 3,   label: "run 3" },
  { streak: 7,   label: "run 7" },
  { streak: 30,  label: "run 30" },
  { streak: 365, label: "run 365" },
];

// Level 365 and one year ring: pair 4 opens only on a whole heart.
const stateFor = (streak, marks) => ({
  level: 365, streak, years: 1, marks, lastDay: 20700, today: 20700,
});
const raw = (streak, marks) => renderSvg(CODE.modules, TARGET.want, CODE.size, stateFor(streak, marks));
const violet = svg =>
  svg.replace(/(<stop offset="1" stop-color=")#c8102e(")/, `$1${VIOLET}$2`);

const pixels = (svg, px) => new Resvg(svg, { fitTo: { mode: "width", value: px } }).render().pixels;
const shift = (a, b) => {
  let max = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    if (d > max) max = d;
  }
  return max;
};
const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

const inks = greenInks();
const keep = [...STATIC_BY_TIER];

/// Each variant returns the finished SVG for one rung.
const VARIANTS = [
  {
    name: "bare (control)",
    make: (s, rung) => raw(s, []),
  },
  {
    name: "Break alone",
    make: (s, rung) => invert(raw(s, []), {
      mode: "B", heartInk: colourAt(rung), noiseInk: noiseAt(rung), beat: false,
    }),
  },
  {
    name: "Break + Static",
    make: (s, rung) => {
      for (let i = 0; i < STATIC_BY_TIER.length; i++) STATIC_BY_TIER[i] = inks[i];
      const svg = raw(s, [STATIC]);
      for (let i = 0; i < STATIC_BY_TIER.length; i++) STATIC_BY_TIER[i] = keep[i];
      return invert(svg, {
        mode: "B", heartInk: colourAt(rung),
        noiseInk: inks[TIERS.length - 1 - rung], beat: false,
      });
    },
  },
  {
    name: "Break + Beat, def A (fill swap)",
    make: (s, rung) => invert(violet(raw(s, [BEAT])), {
      mode: "A", heartInk: colourAt(rung), noiseInk: noiseAt(rung), beat: true,
    }),
  },
  {
    name: "Break + Beat, def B (rung swap)",
    make: (s, rung) => invert(violet(raw(s, [BEAT])), {
      mode: "B", heartInk: colourAt(rung), noiseInk: noiseAt(rung), beat: true,
    }),
  },
];

const baseline = RUNGS.map(r => pixels(raw(r.streak, []), 560));
const tiles = [];

console.log("BREAK -- the inversion, and the two combinations the trap made unreachable");
console.log("Static is green and Beat is violet: both DECIDED, neither shipped\n");
console.log("variant                          run      shift    decodes");

for (const v of VARIANTS) {
  RUNGS.forEach((r, ri) => {
    const rung = rungOf(r.streak);
    const svg = v.make(r.streak, rung);
    const ok = decodesAt(svg);
    const d = shift(baseline[ri], pixels(svg, 560));
    const all = ok.length === SIZES.length;
    console.log(
      `${v.name.padEnd(32)} ${r.label.padEnd(8)} ${String(d).padStart(3)}/255  ` +
      (all ? "ALL" : `FAILS ${SIZES.length - ok.length} (ok at ${ok.join(",") || "none"})`)
    );
    tiles.push({ name: v.name, run: r.label, svg, shift: d, ok, all });
  });
}

const failures = tiles.filter(t => !t.all);
console.log(failures.length
  ? `\n${failures.length} of ${tiles.length} tiles FAIL to decode somewhere.`
  : `\nAll ${tiles.length} tiles decode at all ${SIZES.length} sizes.`);

// One row per variant, one column per rung.
const TILE = 230, LBL = 40, PAD = 24, HEAD = 74, ROWLBL = 26;
const COLS = RUNGS.length, rowsN = VARIANTS.length;
const W = COLS * TILE + 2 * PAD;
const H = rowsN * (TILE + LBL + ROWLBL) + HEAD;
const canvas = canvasFor(1);

let sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`
  + `<rect width="100%" height="100%" fill="#ffffff"/>`
  + `<text x="${PAD}" y="30" font-family="monospace" font-size="17" fill="#111">`
  + `MRO BREAK -- the inversion, with Static and with Beat</text>`
  + `<text x="${PAD}" y="52" font-family="monospace" font-size="12" fill="#666">`
  + `def A hands the gradient to the noise; def B keeps the noise flat. `
  + `weakest run on the left</text>`;

tiles.forEach((t, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x = PAD + col * TILE;
  const y = HEAD + row * (TILE + LBL + ROWLBL) + ROWLBL;
  if (col === 0) {
    sheet += `<text x="${PAD}" y="${y - 8}" font-family="monospace" font-size="15" fill="#111">${t.name}</text>`;
  }
  const inner = t.svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  sheet += `<svg x="${x + 6}" y="${y}" width="${TILE - 12}" height="${TILE - 12}" viewBox="0 0 ${canvas} ${canvas}">${inner}</svg>`
    + `<text x="${x + 6}" y="${y + TILE - 4}" font-family="monospace" font-size="12" fill="#111">${t.run}</text>`
    + `<text x="${x + 6}" y="${y + TILE + 14}" font-family="monospace" font-size="11.5" fill="${t.all ? "#666" : "#c8102e"}">`
    + `shift ${t.shift}/255, ${t.all ? "decodes" : "FAILS " + (SIZES.length - t.ok.length)}</text>`;
});
sheet += "</svg>";

const dest = OUT + "/break.png";
writeFileSync(dest, new Resvg(sheet, { fitTo: { mode: "width", value: W } }).render().asPng());
console.log("wrote " + dest);
