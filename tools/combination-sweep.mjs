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
// THE SWEEP IS THE AUTHORITY ON THE WORST CASE, A GUESS IS NOT. Fix Round 1
// caught `contracts/test/GasBudget.t.sol`'s MAX_MARKS assuming Static was the
// pricier side of pair 2 -- it is not, Beat is (a whole extra `<defs>` gradient
// block against a same-length ink swap) -- and this sweep's own `largest:` line
// already said so (a Beat combination, not a Static one) without anyone
// checking it against MAX_MARKS. MAX_LEGAL below is now the Beat variant, and
// `crossCheckAgainstMaxLegal()` below ties it to the sweep's own computed
// maximum so the two can never silently disagree again -- by BYTE COUNT, not by
// which Marks are named, because Vessel and Tint are same-length hex
// substitutions that cost zero extra bytes, so several Mark sets legitimately
// tie for "largest" and the sweep may report any one of them.
//
// MEMORY: reading `.pixels` more than once per render was the classic resvg-js
// leak shape on this project (see the resvg-pixels-getter memory note) and this
// file only ever reads it once per raster -- but that alone does not save the
// FULL five-size gate. Measured directly (Fix Round 1): `@resvg/resvg-js`
// 2.6.2, the version this project has installed, does not call napi-rs's
// `adjust_external_memory()`, so V8 never sees the native (Rust-side) memory a
// render allocates and never collects it under pressure -- RSS climbed from
// 117 MB to 4.2 GB over 200 renders at 1600px in a tight loop, and explicit
// `global.gc()` every 10 iterations made NO measurable difference (still ~4.2
// GB). The fix landed upstream in 2.7.0-alpha.0 (2026-01-22, "more aggressive
// GC to prevent continued growth of memory usage") but only as an alpha -- no
// stable release carries it yet, so upgrading is not on the table here. Since
// nothing short of process exit reliably frees this memory, the FULL five-size
// gate now runs each batch of combinations in its OWN child process: the
// orchestrator below spawns this same file with `--from`/`--to`, one batch at a
// time, sequentially, and the OS reclaims everything when a batch's process
// exits before the next one starts. Measured growth across the real 5-size
// mix (256/500/848/1080/1600px) on the heaviest combination: about 38 MB of
// RSS per combination. BATCH_SIZE below is chosen with that measurement, not
// guessed.
//
//   node tools/combination-sweep.mjs                    (848 px only, ~21 min, single process)
//   node tools/combination-sweep.mjs full                (5 sizes, ~103 min, batched child processes)
//   node tools/combination-sweep.mjs full --from=0 --to=30  (diagnostic slice, single process, any size set)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { Resvg } from "@resvg/resvg-js";

import { solve, payloadFor } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import * as SHEET from "./sheet-code.mjs";
import {
  renderSvg, MARKS, IRIS_SHAPE_NAMES,
  HUSH, STATIC, BEAT, IRIS_BOUGHT, IRIS_EARNED, VESSEL, BREAK, TINT,
} from "./render-token.mjs";
import { scanResult } from "./test/helpers/decode.mjs";

const SELF = fileURLToPath(import.meta.url);
// The reference code, shared so no sheet can be judged on a heart that will
// never mint. See sheet-code.mjs -- this used to be four hardcoded lines in ten
// separate files, all of them naming a domain that was decided against.
const { PAYLOAD, DEST, CODE, TARGET } = SHEET;
const OUT = new URL("./out/marks", import.meta.url).pathname;

const args = process.argv.slice(2);
const FULL = args.includes("full");
const fromArg = args.find(a => a.startsWith("--from="));
const toArg = args.find(a => a.startsWith("--to="));
const FROM = fromArg ? Number(fromArg.split("=")[1]) : 0;
const TO = toArg ? Number(toArg.split("=")[1]) : undefined;
const SLICED = fromArg !== undefined || toArg !== undefined;
const IS_WORKER = process.env.MRO_SWEEP_WORKER === "1";
const SIZES = FULL ? [256, 500, 848, 1080, 1600] : [848];

// Measured (Fix Round 1): ~38 MB RSS growth per combination across all five
// real sizes, no manual gc() available to slow it. 30 combinations/batch puts
// a batch's estimated peak around 130 MB base + 30 x 38 MB =~ 1.3 GB, well
// under safe-build.sh's 3G MemoryMax with margin for variance.
const BATCH_SIZE = 30;

// The state every Mark set can coexist in: a whole heart at a 365-day streak --
// the only state Vessel and Break are even purchasable in, and live rather than
// resting or sunset so Break's rung-colour exchange has a rung to read. Note
// Ache draws NOTHING here -- a whole heart has no unearned cells left -- which
// is a property of the ladder, not a fault in the sweep.
// 2.M2. `years` IS NOT OPTIONAL HERE. renderSvg defaults it to 0, so this
// state rendered a 51-cell canvas -- while SIZES below defaults to 848, which
// is 16 x 53 and the exact multiple this sweep's whole decode gate rests on.
// Against 51 cells 848 is 16.63 px per module: a resample, which is precisely
// the non-integer scaling this project measured as destroying the artwork's
// three grey levels. The chain produces `rings(365) == 1`, so one ring is what
// a whole heart actually has.
const STATE = { level: 365, streak: 400, years: 1, lastDay: 20700, today: 20700 };

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

// Generated -- and its two counts asserted -- on EVERY invocation, worker or
// not, slice or not: it is pure combinatorics, costs nothing to render, and
// checking it unconditionally means a drifted mask table fails loudly no
// matter which entrypoint hit it first.
const { legalSets, combos: ALL_COMBOS } = generateCombinations();

// The three combinations a stale reading of an earlier ladder revision would
// have left untested. Asserted present in the FULL generated set (not
// per-slice -- a slice may legitimately not contain one of these).
const NAMED = [
  { name: "Break + Static", test: c => c.ids.length === 2 && c.ids.includes(BREAK) && c.ids.includes(STATIC) },
  { name: "Break + Beat", test: c => c.ids.length === 2 && c.ids.includes(BREAK) && c.ids.includes(BEAT) },
  { name: "Break + Iris", test: c => c.ids.includes(BREAK) && (c.ids.includes(IRIS_BOUGHT) || c.ids.includes(IRIS_EARNED)) },
];
for (const n of NAMED) {
  const found = ALL_COMBOS.find(n.test);
  if (!found) throw new Error(`named combination missing from the generated sweep: ${n.name}`);
  n.combo = found;
}

if (!IS_WORKER) {
  console.log(`generated ${legalSets.length} reachable Mark sets, ${ALL_COMBOS.length} renderable combinations`);
  for (const n of NAMED) console.log(`  named case present: ${n.name}  ->  [${n.combo.label}]`);
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

/** Render and decode one combination. The only function that touches resvg. */
function renderOne(combo) {
  const svg = build(combo);
  const ok = decodesAt(svg);
  const all = ok.length === SIZES.length;
  return { ...combo, all, ok, bytes: svg.length };
}

// ---------------------------------------------------------------------------
// Worker: render exactly the [FROM, TO) slice in THIS process, print one
// parseable RESULT line per combination (the only thing the orchestrator
// reads back), plus the same human-readable FAIL/progress lines a direct
// invocation always got.
// ---------------------------------------------------------------------------
function runSlice(slice, offset) {
  const results = [];
  for (let i = 0; i < slice.length; i++) {
    const combo = slice[i];
    const r = renderOne(combo);
    results.push(r);
    if (!r.all) console.log(`FAIL  [${combo.label}]  decoded at ${r.ok.join(",") || "no size"}`);
    const named = NAMED.find(n => n.combo === combo);
    if (named && r.all) console.log(`  [NAMED OK] ${named.name}  [${combo.label}]  decoded at ${r.ok.join(",")}`);
    if (IS_WORKER) console.log(`RESULT ${JSON.stringify(r)}`);
    if ((offset + i + 1) % 50 === 0) console.log(`  ...${offset + i + 1}/${ALL_COMBOS.length} combinations`);
  }
  return results;
}

/**
 * The maximal legal token drawn once so it can be looked at rather than
 * trusted: Hush, BEAT (the pricier side of pair 2 -- Fix Round 1), the bought
 * Iris in its leaf shape, Vessel, Tint.
 */
const MAX_LEGAL = { ids: [HUSH, BEAT, IRIS_BOUGHT, VESSEL, TINT], irisVariant: 2, tintVariant: 0,
  label: labelFor([HUSH, BEAT, IRIS_BOUGHT, VESSEL, TINT], 2, 0) };

/**
 * Tie MAX_LEGAL to what the sweep itself measured as largest, so a future
 * "obviously the pricier side" guess (the exact mistake Fix Round 1 fixes) can
 * never silently disagree with the sweep again. Compared by BYTE COUNT, not by
 * which Marks are named: Vessel and Tint are same-length hex substitutions (no
 * extra bytes), so several Mark sets legitimately tie for the sweep's largest,
 * and the one `results.reduce` happens to report first need not be MAX_LEGAL's
 * own five-Mark label to still be the SAME size.
 */
function crossCheckAgainstMaxLegal(results) {
  const worst = results.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  const maxLegalBytes = build(MAX_LEGAL).length;
  console.log(`\nsweep's largest: [${worst.label}] at ${worst.bytes} B`);
  console.log(`MAX_LEGAL       : [${MAX_LEGAL.label}] at ${maxLegalBytes} B`);
  if (maxLegalBytes !== worst.bytes) {
    throw new Error(
      `MAX_LEGAL (${maxLegalBytes} B) disagrees with the sweep's own largest `
      + `(${worst.bytes} B, [${worst.label}]) -- the sweep is the authority; go `
      + `update contracts/test/GasBudget.t.sol's MAX_MARKS and this file's `
      + `MAX_LEGAL to match what the sweep actually found, do not adjust this check`
    );
  }
  console.log("MAX_LEGAL ties the sweep's own largest byte count -- confirmed, not assumed.");
}

function finalize(results, { isFullCoverage }) {
  const failures = results.filter(r => !r.all).length;
  const bytes = results.map(r => r.bytes);
  console.log(`\n${results.length} combinations, ${SIZES.length} decode size(s) each`);
  console.log(`decode failures: ${failures}`);
  console.log(`svg bytes: min ${Math.min(...bytes)}, max ${Math.max(...bytes)}`);
  const worst = results.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  console.log(`largest: [${worst.label}] at ${worst.bytes} B`);
  for (const n of NAMED) {
    const r = results.find(x => x.ids === n.combo.ids && x.irisVariant === n.combo.irisVariant
      && x.tintVariant === n.combo.tintVariant);
    if (r) console.log(`named result -- ${n.name}: ${r.all ? "PASS" : "FAIL"} (decoded at ${r.ok.join(",") || "no size"})`);
  }

  if (isFullCoverage) {
    crossCheckAgainstMaxLegal(results);
    const maximal = build(MAX_LEGAL);
    writeFileSync(`${OUT}/all-marks.png`,
      new Resvg(maximal, { fitTo: { mode: "width", value: 700 } }).render().asPng());
    console.log(`\nwrote ${OUT}/all-marks.png (the maximal legal set: ${MAX_LEGAL.label})`);
  }

  process.exitCode = failures ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------
const SLICE = ALL_COMBOS.slice(FROM, TO ?? ALL_COMBOS.length);

if (FULL && !SLICED && !IS_WORKER) {
  // Orchestrator: batch into child processes so the OS reclaims each batch's
  // native rendering memory before the next one starts -- see the file header.
  console.log(`orchestrating ${ALL_COMBOS.length} combinations x ${SIZES.length} sizes `
    + `in batches of ${BATCH_SIZE} (${Math.ceil(ALL_COMBOS.length / BATCH_SIZE)} batches)`);
  const results = [];
  for (let start = 0; start < ALL_COMBOS.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, ALL_COMBOS.length);
    console.log(`batch ${start}-${end - 1} of ${ALL_COMBOS.length}...`);
    const r = spawnSync(process.execPath, [SELF, "full", `--from=${start}`, `--to=${end}`], {
      encoding: "utf8",
      env: { ...process.env, MRO_SWEEP_WORKER: "1" },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error || r.status !== 0) {
      console.error(r.stdout);
      console.error(r.stderr);
      throw new Error(
        `batch ${start}-${end - 1} did not exit cleanly (status ${r.status}, `
        + `${r.error ?? "no spawn error"}) -- likely OOM-killed or crashed, not a `
        + `decode failure (a decode failure still exits 0 and reports itself in `
        + `its RESULT lines). Stopping rather than continuing past a batch we `
        + `cannot trust.`
      );
    }
    for (const line of r.stdout.split("\n")) {
      if (!line.startsWith("RESULT ")) continue;
      results.push(JSON.parse(line.slice("RESULT ".length)));
    }
    const batchFailures = results.slice(-  (end - start)).filter(x => !x.all).length;
    console.log(`  batch done: ${end - start} combinations, ${batchFailures} decode failures so far this batch`);
  }
  finalize(results, { isFullCoverage: true });
} else {
  // Single process: the cheap 848-only default, a diagnostic --from/--to
  // slice run directly by a human, or a batch worker spawned above.
  const results = runSlice(SLICE, FROM);
  if (!IS_WORKER) finalize(results, { isFullCoverage: SLICE.length === ALL_COMBOS.length });
}
