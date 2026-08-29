// Task 10c Phase 3, step 10: what a REAL domain costs the heart.
//
// Every bitmap this project has solved so far encodes `example.com`, which was
// never going to be the domain. That matters more than it sounds: QR version 5
// level L carries a fixed 108 data codewords, the payload eats them first, and
// whatever is left is the entire budget the QArt solver has for shaping the
// heart. A longer domain is therefore not a cosmetic change -- it is a direct
// subtraction from the artwork's fidelity, and it is PERMANENT PER TOKEN once
// minted.
//
// This measures the subtraction instead of predicting it. For each payload it
// reports the free-byte budget, the heart match of the shipped (robust) choice,
// and what the gate rejected on the way -- so the answer separates "the heart
// got worse" from "the code got fragile", which are different problems with
// different responses.
//
//   node tools/payload-length-check.mjs --domain example.com --ids 1,12,55
//
// Rows are appended to out/payload-rows.jsonl so a batch that dies does not
// cost the whole solve again, and so the two domains can be run as separate
// processes -- resvg's buffers are native and only a process exit returns them.
import { appendFileSync, mkdirSync } from "node:fs";

import { payloadFor, freeByteBudget, FREE_BITS, allMaskSolves, VERSION_SIZE } from "./qart.mjs";
import { robustSolve } from "./robust-solve.mjs";

/// Match is scored over EVERY module in the grid, not only the heart's own, so
/// this is the denominator a percentage here refers to. Naming it stops the
/// number being read as "percent of the heart", which it is not.
const TOTAL_MODULES = VERSION_SIZE * VERSION_SIZE;

/**
 * Solve one payload both ways and report what the realistic length costs.
 *
 * `bestMatch` is what the OLD selector (highest match, no decode gate) would
 * have shipped. Reporting both is the only way to say whether a drop in the
 * shipped match came from the longer payload or from the robustness gate
 * rejecting the leader -- two causes that a single number cannot tell apart.
 */
export function measure(domain, tokenId) {
  const payload = payloadFor(domain, tokenId);
  const freeBytes = freeByteBudget(payload.length);
  const tried = [];

  const chosen = robustSolve(payload, { onProgress: t => tried.push(t) });
  const bestMatch = Math.max(...allMaskSolves(payload).map(s => s.match));

  return {
    domain,
    tokenId,
    payload,
    payloadChars: payload.length,
    freeBytes,
    // Only the low five bits of each free byte are ours; the top three are
    // fixed to keep the payload printable. The shaping budget is the product.
    freeBits: freeBytes * FREE_BITS.length,
    totalModules: TOTAL_MODULES,
    chosenMask: chosen.mask,
    // Percentages, because every prior result in this project is quoted that
    // way; the raw fraction is what qart.mjs returns.
    chosenMatch: chosen.match * 100,
    bestMatch: bestMatch * 100,
    // What robustness cost on THIS payload, in points of heart match.
    gateCost: (bestMatch - chosen.match) * 100,
    masksRejected: chosen.gate.rejected,
    gateChecks: tried.reduce((n, t) => n + t.checked, 0),
    rejections: tried.filter(t => !t.ok).map(t => ({ mask: t.mask, match: t.match, failures: t.failures })),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = name => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

  const domain = arg("--domain") ?? "example.com";
  const ids = (arg("--ids") ?? "1").split(",").map(s => s.trim()).filter(Boolean);

  mkdirSync("out", { recursive: true });

  for (const id of ids) {
    const row = measure(domain, id);
    appendFileSync("out/payload-rows.jsonl", JSON.stringify(row) + "\n");
    console.log(
      `${row.payload.padEnd(40)} chars ${String(row.payloadChars).padStart(2)}  ` +
      `free ${String(row.freeBytes).padStart(2)}B/${String(row.freeBits).padStart(3)}b  ` +
      `mask ${row.chosenMask}  match ${row.chosenMatch.toFixed(1)}%  ` +
      `(best ${row.bestMatch.toFixed(1)}%, gate cost ${row.gateCost.toFixed(1)}pts, ` +
      `rejected ${row.masksRejected})`
    );
  }
}

if (process.argv[1]?.endsWith("payload-length-check.mjs")) await main();
