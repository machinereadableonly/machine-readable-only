// Do the Marks work in COMBINATION? All 256 of them.
//
// Every Mark so far has been measured alone, which proves nothing about the
// token that buys several. Most pairs are safe by construction because they
// write disjoint surfaces, but four pairs genuinely collide:
//
//   Beat + Break     -- both write the HEART's fill
//   Static + Break   -- both write the NOISE's ink
//   Eyes + Aura      -- the eye erases to the field, and Aura moves it
//   Eyes + Hush      -- same, for the quiet-zone tint
//
// (Named for the ladder as it stood when this sweep was written: Bloom,
// Singularity, Blue Blood, Halo and Voice are now Beat, Break, Static, Aura
// and Hush -- see the Task 4 rename.)
//
// The last two are a defect this sweep was written to catch: the first eye
// prototype erased its 7x7 to the FIELD constant, so on an Aura or Hush token
// it would have punched a white square into a tinted ground.
//
// Decoded at one size for the sweep (848, the exact 53 x 16 multiple), then any
// failure is re-run across the full ladder. Batched, because 256 renders is the
// shape of job that has taken this box down before.
//
//   node tools/combination-sweep.mjs           (through ~/scripts/safe-build.sh)
//   node tools/combination-sweep.mjs full      (all 5 sizes -- slow)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, canvasFor, STATIC_BY_TIER, TIERS, colourAt, rungOf, noiseAt, staticAt,
  QUIET, FIELD, AURA_FIELD, HUSH_QUIET,
  ACHE, STATIC, HUSH, BEAT, AURA, VESSEL, BREAK,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const S = CODE.size;
const OUT = new URL("./out/marks", import.meta.url).pathname;
const FULL = process.argv[2] === "full";
const SIZES = FULL ? [256, 500, 848, 1080, 1600] : [848];

// The state every Mark can coexist in: a whole heart at a 365-day streak, which
// is the only state Vessel and Break are even purchasable in. Note Ache draws
// NOTHING here -- a whole heart has no unearned cells left -- which is a
// property of the ladder, not a fault in the sweep.
const STATE = { level: 365, streak: 400, years: 1, lastDay: 20700, today: 20700 };
const rung = rungOf(STATE.streak);
const HEART = colourAt(rung);
const NEUTRAL = noiseAt(rung);

const VIOLET = "#2000ff";   // DECIDED: Beat's far end

/// Static's green per rung, read from the shipped derivation rather than
/// recomputed here -- one derivation, in render-token.mjs.
function greenInks() {
  return TIERS.map((_, i) => staticAt(TIERS.length - 1 - i));
}

const canvas = canvasFor(STATE.years);
const THICK = (canvas - 45) / 2 - 2;
const codeOff = 2 + THICK + QUIET;
const EYES = [[0, 0], [S - 7, 0], [0, S - 7]];

// Old ladder name -> new Mark id, same surface: vein -> ache, blueblood ->
// static, voice -> hush, bloom -> beat, halo -> aura, crown -> vessel,
// singularity -> break. "eyes" is not a Mark the reference renderer knows --
// it is this sweep's own prototype, stripped before the call and drawn after.
const MARKS = [ACHE, STATIC, HUSH, BEAT, AURA, VESSEL, BREAK, "eyes"];

/// Build one token with an arbitrary set of Marks, applying the proposals.
function build(set) {
  const has = m => set.includes(m);

  // Green noise, if Static is on. Written into the palette and restored.
  const keep = [...STATIC_BY_TIER];
  if (has(STATIC)) {
    const inks = greenInks();
    for (let i = 0; i < STATIC_BY_TIER.length; i++) STATIC_BY_TIER[i] = inks[i];
  }
  // `eyes` is not a Mark the reference renderer knows, so it is stripped before
  // the call and drawn afterwards.
  let svg = renderSvg(CODE.modules, TARGET.want, CODE.size,
    { ...STATE, marks: set.filter(m => m !== "eyes") });
  for (let i = 0; i < STATIC_BY_TIER.length; i++) STATIC_BY_TIER[i] = keep[i];

  // Violet Beat: one constant, same length as the one it replaces.
  if (has(BEAT)) svg = svg.replace(
    /(<stop offset="1" stop-color=")#c8102e(")/, `$1${VIOLET}$2`);

  const noiseInk = has(STATIC) ? greenInks()[TIERS.length - 1 - rung] : NEUTRAL;

  // Break: exchange the heart and noise fills. When Beat is also on, the
  // heart's fill is the gradient reference, so the exchange carries the
  // GRADIENT across to the noise -- Beat decorates whatever wears the heart's
  // ink. That is a DESIGN CHOICE and is flagged in the report, not settled here.
  if (has(BREAK)) {
    const fills = [...svg.matchAll(/<path fill="(url\(#b\)|#[0-9a-f]{6})"/g)];
    const n = fills[fills.length - 2], h = fills[fills.length - 1];
    const nf = n[1], hf = h[1];
    svg = svg.slice(0, h.index) + h[0].replace(hf, nf) + svg.slice(h.index + h[0].length);
    svg = svg.slice(0, n.index) + n[0].replace(nf, hf) + svg.slice(n.index + n[0].length);
  }

  // The eyes. THE GROUND UNDER THEM IS NOT ALWAYS WHITE: Hush tints the block
  // the code sits in, and Aura tints the whole field. Erasing to a constant
  // would punch a white square into either one.
  if (has("eyes")) {
    const ground = has(HUSH) ? HUSH_QUIET : (has(AURA) ? AURA_FIELD : FIELD);
    const ink = has(VESSEL) ? "#b8860b" : HEART;
    let add = "";
    for (const [ex, ey] of EYES) {
      const x = codeOff + ex, y = codeOff + ey, c = x + 3.5, cy = y + 3.5;
      add += `<rect x="${x}" y="${y}" width="7" height="7" fill="${ground}"/>`
        + `<circle cx="${c}" cy="${cy}" r="3.5" fill="${ink}"/>`
        + `<circle cx="${c}" cy="${cy}" r="2.5" fill="${ground}"/>`
        + `<circle cx="${c}" cy="${cy}" r="1.5" fill="${ink}"/>`;
    }
    svg = svg.replace(/<\/svg>$/, `${add}</svg>`);
  }
  return svg;
}

const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

// All 256 subsets, as bitmasks.
const results = [];
let failures = 0;
for (let mask = 0; mask < (1 << MARKS.length); mask++) {
  const set = MARKS.filter((_, i) => mask & (1 << i));
  const svg = build(set);
  const ok = decodesAt(svg);
  const all = ok.length === SIZES.length;
  if (!all) failures++;
  results.push({ mask, set, all, ok, bytes: svg.length });
  if (!all) {
    console.log(`FAIL  [${set.join(" ") || "none"}]  decoded at ${ok.join(",") || "no size"}`);
  }
  if ((mask + 1) % 32 === 0) console.log(`  ...${mask + 1}/256 combinations`);
}

const bytes = results.map(r => r.bytes);
console.log(`\n${results.length} combinations, ${SIZES.length} decode size(s) each`);
console.log(`decode failures: ${failures}`);
console.log(`svg bytes: min ${Math.min(...bytes)}, max ${Math.max(...bytes)}`);
const worst = results.reduce((a, b) => (b.bytes > a.bytes ? b : a));
console.log(`largest: [${worst.set.join(" ")}] at ${worst.bytes} B`);

// The full set, drawn once so it can be looked at rather than trusted.
const everything = build(MARKS);
writeFileSync(`${OUT}/all-marks.png`,
  new Resvg(everything, { fitTo: { mode: "width", value: 700 } }).render().asPng());
console.log(`\nwrote ${OUT}/all-marks.png`);
