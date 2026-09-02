// Do the Marks work in COMBINATION? All 459 renderable ones.
//
// The old sweep (before this rewrite) covered 256 combinations of the retired
// seven-Mark ladder, and did most of the drawing itself: it mutated the
// palette in place for Static, regex-swapped Beat's gradient stop, regex-swapped
// Break's fills, and hand-drew the eyes as a prototype `"eyes"` pseudo-Mark. None
// of that survives here. Tasks 4-7 taught `render-token.mjs`'s `renderSvg` every
// one of those surfaces natively -- Static's green, Beat's violet, Break's
// rung-colour exchange, and the three reshaped Iris eyes with Tint's ink -- so
// this sweep now does nothing but call it and decode what comes back.
//
// THE COMBINATIONS THEMSELVES ARE GENERATED, not listed by hand, from the same
// exclusion and requirement masks `contracts/src/Ladder.sol` encodes as
// `Upgrade.excludes` / `Upgrade.requiresAny`. That is the whole point: a hand
// list drifts the moment the ladder's pairing changes, silently leaving the
// newest states untested. The mask table below is this file's own mirror of
// Ladder.sol (there is no live JS import yet -- `warden/src/mcp/ladder.mjs`,
// which `tools/ladder-fixture.mjs` already expects, is Task 9's, not built as
// of this sweep) and MUST be kept in step with it by hand, the same way
// `render-token.mjs`'s Mark colours are kept in step with `MarkRenderer.sol`.
//
// Five pairs -- (1,2) (3,4) (5,6) (7,8) (9,10) -- one side bought, one earned,
// taking either closes the other, and a token may take neither. Pair 5 (Tint,
// Aura) additionally requires holding an Iris by either route (pair 3). That
// yields 189 reachable Mark SETS: pairs 1, 2 and 4 contribute 3 independent
// outcomes each, and pairs 3 and 5 together contribute 7 -- (1 x 1) + (2 x 3),
// one outcome when pair 3 is empty and pair 5 must be too, three when pair 3 is
// not empty and pair 5 is free to be anything -- so 3 x 3 x 3 x 7 = 189.
//
// A Mark SET is not yet a renderable COMBINATION: the bought Iris carries one of
// three shapes and Tint carries one of two inks, both real pixels this sweep has
// to see. Expanding those variants brings 189 to 459 -- verified against the
// derivation in the header of this file's own generateCombinations(), not
// hand-counted.
//
// THREE COMBINATIONS ARE NAMED EXPLICITLY below, because a stale reading of an
// earlier ladder revision would have left them untested: Break + Static and
// Break + Beat were REFUSALS before the cross-pair exclusion was removed
// (2026-09-02), and Break + Iris is the case where the eyes sit on a noise Break
// has recoloured to the token's own ink (see finding 3,
// docs/plans/2026-09-02-mro-plan5-mark-ladder.md). All three are asserted
// present in the generated set below -- if a future ladder edit makes any of
// them unreachable again, that assertion fails loudly rather than the case
// quietly vanishing from the sweep.
//
// Decoded at one size for the cheap gate (848, the exact 53 x 16 multiple), and
// at all five real sizes for the full gate. Batched, because 459 renders is
// exactly the shape of job that has taken this box down before.
//
//   node tools/combination-sweep.mjs           (848 px only, ~21 min, through ~/scripts/safe-build.sh)
//   node tools/combination-sweep.mjs full      (5 sizes, ~103 min, through ~/scripts/safe-build.sh)
import { writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import {
  renderSvg, MARKS, IRIS_SHAPE_NAMES,
  HUSH, STATIC, BEAT, IRIS_BOUGHT, IRIS_EARNED, VESSEL, BREAK, TINT,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DEST = PAYLOAD.slice(0, -1);
const CODE = solve(PAYLOAD, 7);
const TARGET = heartTarget(CODE.size);
const OUT = new URL("./out/marks", import.meta.url).pathname;
const FULL = process.argv[2] === "full";
const SIZES = FULL ? [256, 500, 848, 1080, 1600] : [848];

// The state every Mark set can coexist in: a whole heart at a 365-day streak --
// the only state Vessel and Break are even purchasable in, and live rather than
// resting or sunset so Break's rung-colour exchange has a rung to read. Note
// Ache draws NOTHING here -- a whole heart has no unearned cells left -- which
// is a property of the ladder, not a fault in the sweep.
const STATE = { level: 365, streak: 400, lastDay: 20700, today: 20700 };

// ---------------------------------------------------------------------------
// Generate the reachable Mark sets from Ladder.sol's own exclusion and
// requirement masks, rather than listing 189 sets by hand.
// ---------------------------------------------------------------------------

// Mirror of contracts/src/Ladder.sol: for each Mark id, the bit of its excluded
// partner, and (pair 5 only) the bits of what it requires ANY of. Bit n here
// means Mark id n, matching Ladder.sol's own `uint16(1 << id)` encoding.
const EXCLUDES = {
  1: 1 << 2, 2: 1 << 1,   // Hush / Ache
  3: 1 << 4, 4: 1 << 3,   // Static / Beat
  5: 1 << 6, 6: 1 << 5,   // Iris bought / Iris earned
  7: 1 << 8, 8: 1 << 7,   // Vessel / Break
  9: 1 << 10, 10: 1 << 9, // Tint / Aura
};
const AN_IRIS = (1 << 5) | (1 << 6);
const REQUIRES_ANY = { 9: AN_IRIS, 10: AN_IRIS };

/** Is this bitmask (bit n = Mark id n held) a set Ladder.sol's masks allow? */
function isLegalSet(mask) {
  for (let id = 1; id <= 10; id++) {
    if (!(mask & (1 << id))) continue;
    if (EXCLUDES[id] && (mask & EXCLUDES[id])) return false;
    const req = REQUIRES_ANY[id] ?? 0;
    if (req && !(mask & req)) return false;
  }
  return true;
}

function idsOf(mask) {
  const ids = [];
  for (let id = 1; id <= 10; id++) if (mask & (1 << id)) ids.push(id);
  return ids;
}

function labelFor(ids, irisVariant, tintVariant) {
  if (!ids.length) return "none";
  return ids.map(id => {
    if (id === IRIS_BOUGHT) return `iris-bought(${IRIS_SHAPE_NAMES[irisVariant]})`;
    if (id === IRIS_EARNED) return "iris-earned";
    if (id === TINT) return `tint(${tintVariant === 1 ? "gold" : "violet"})`;
    return MARKS[id - 1];
  }).join("+");
}

/**
 * Every reachable Mark set, expanded into every renderable variant: the three
 * Iris shapes when the BOUGHT Iris is held (the earned route is always shape 0,
 * "target" -- MarkRenderer.irisShape), and the two Tint inks when Tint is held.
 */
function generateCombinations() {
  const legalSets = [];
  for (let mask = 0; mask < (1 << 11); mask++) {
    if (mask & 1) continue;          // bit 0 is never a Mark
    if (isLegalSet(mask)) legalSets.push(mask);
  }
  if (legalSets.length !== 189) {
    throw new Error(
      `generated ${legalSets.length} reachable Mark sets from the masks, expected `
      + `189 -- the mask table above has drifted from contracts/src/Ladder.sol`
    );
  }

  const combos = [];
  for (const mask of legalSets) {
    const ids = idsOf(mask);
    const irisVariants = ids.includes(IRIS_BOUGHT) ? [0, 1, 2] : [0];
    const tintVariants = ids.includes(TINT) ? [0, 1] : [0];
    for (const irisVariant of irisVariants) {
      for (const tintVariant of tintVariants) {
        combos.push({ ids, irisVariant, tintVariant, label: labelFor(ids, irisVariant, tintVariant) });
      }
    }
  }
  if (combos.length !== 459) {
    throw new Error(
      `generated ${combos.length} renderable combinations, expected 459 -- `
      + `the variant expansion above has drifted`
    );
  }
  return { legalSets, combos };
}

const { legalSets, combos } = generateCombinations();
console.log(`generated ${legalSets.length} reachable Mark sets, ${combos.length} renderable combinations`);

// The three combinations a stale reading of an earlier ladder revision would
// have left untested. Asserted present, not just hoped for -- see the header.
const NAMED = [
  { name: "Break + Static", test: c => c.ids.length === 2 && c.ids.includes(BREAK) && c.ids.includes(STATIC) },
  { name: "Break + Beat", test: c => c.ids.length === 2 && c.ids.includes(BREAK) && c.ids.includes(BEAT) },
  { name: "Break + Iris", test: c => c.ids.includes(BREAK) && (c.ids.includes(IRIS_BOUGHT) || c.ids.includes(IRIS_EARNED)) },
];
for (const n of NAMED) {
  const found = combos.find(n.test);
  if (!found) throw new Error(`named combination missing from the generated sweep: ${n.name}`);
  n.combo = found;
  console.log(`  named case present: ${n.name}  ->  [${found.label}]`);
}

/** Build one token's SVG for a generated combination -- render-token.mjs does
 *  all the drawing now; this file only chooses what to ask it for. */
function build({ ids, irisVariant, tintVariant }) {
  return renderSvg(CODE.modules, TARGET.want, CODE.size, {
    ...STATE, marks: ids, irisVariant, tintVariant,
    // The run the EARNED Iris was applied at. STATE is live and never lapsed,
    // so its own streak is a faithful "when this was applied" value.
    irisRun: STATE.streak,
  });
}

const decodesAt = svg => SIZES.filter(px => {
  const r = scanResult(svg, px);
  return r.ok && r.destination === DEST;
});

const results = [];
let failures = 0;
for (let i = 0; i < combos.length; i++) {
  const combo = combos[i];
  const svg = build(combo);
  const ok = decodesAt(svg);
  const all = ok.length === SIZES.length;
  if (!all) failures++;
  results.push({ ...combo, all, ok, bytes: svg.length });
  const named = NAMED.find(n => n.combo === combo);
  if (!all) {
    console.log(`FAIL  [${combo.label}]  decoded at ${ok.join(",") || "no size"}`);
  } else if (named) {
    console.log(`  [NAMED OK] ${named.name}  [${combo.label}]  decoded at ${ok.join(",")}`);
  }
  if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${combos.length} combinations`);
}

const bytes = results.map(r => r.bytes);
console.log(`\n${results.length} combinations, ${SIZES.length} decode size(s) each`);
console.log(`decode failures: ${failures}`);
console.log(`svg bytes: min ${Math.min(...bytes)}, max ${Math.max(...bytes)}`);
const worst = results.reduce((a, b) => (b.bytes > a.bytes ? b : a));
console.log(`largest: [${worst.label}] at ${worst.bytes} B`);
for (const n of NAMED) {
  const r = results.find(x => x.ids === n.combo.ids && x.irisVariant === n.combo.irisVariant
    && x.tintVariant === n.combo.tintVariant);
  console.log(`named result -- ${n.name}: ${r.all ? "PASS" : "FAIL"} (decoded at ${r.ok.join(",") || "no size"})`);
}

// The maximal legal token (see contracts/test/GasBudget.t.sol's MAX_MARKS),
// drawn once so it can be looked at rather than trusted: Hush, Static, the
// bought Iris in its leaf shape, Vessel, Tint.
const MAX_LEGAL = { ids: [HUSH, STATIC, IRIS_BOUGHT, VESSEL, TINT], irisVariant: 2, tintVariant: 0 };
const maximal = build(MAX_LEGAL);
writeFileSync(`${OUT}/all-marks.png`,
  new Resvg(maximal, { fitTo: { mode: "width", value: 700 } }).render().asPng());
console.log(`\nwrote ${OUT}/all-marks.png (the maximal legal set: ${labelFor(MAX_LEGAL.ids, 2, 0)})`);

process.exitCode = failures ? 1 : 0;
