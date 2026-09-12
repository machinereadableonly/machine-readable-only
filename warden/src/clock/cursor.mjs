// The reconcile cursor, and what a finished run's exit code should be.
//
// EXTRACTED FROM main.mjs on 2026-09-06 so it could be tested at all. main.mjs
// is the one file under src/clock that no test may import: loading it opens the
// mirror, reads a private key out of the environment and talks to a chain, all
// as module-load side effects. That made these three functions the only Clock
// logic with zero coverage -- and they are exactly where two of the review's
// findings live (4.M3, the cursor advanced past a short read; 4.L4, an
// unreadable cursor treated as a first run).
//
// Pure functions over a path and a summary. No environment, no defaults read
// from process.env: main.mjs still owns all of that and passes it in.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The last reconciled block, or null when there genuinely is not one yet.
 *
 * @param path where the cursor is kept
 * @returns BigInt block number, or null for "no cursor yet"
 * @throws when the cursor exists but cannot be trusted
 */
export function readCursor(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8").trim();
  } catch (err) {
    // NO CURSOR YET is the ordinary first run: reconcile floors at the deploy
    // block, which re-reads history rather than skipping it.
    if (err.code === "ENOENT") return null;
    // 4.L4. ANYTHING ELSE IS NOT THAT. A permissions error or a corrupt file
    // used to land here silently and be treated as a first run -- which on
    // mainnet means reconciling from the deploy block, every night, against a
    // unit with TimeoutStartSec=600. The unit is killed, the cursor is never
    // written, and it repeats identically forever with nothing in the log
    // naming a cursor. A permanent silent stall, dressed as a fresh start.
    throw new Error(`could not read the reconcile cursor at ${path}: ${err.message}`);
  }
  if (raw === "") return null;
  // A cursor that is not a number is corruption, not a first run, for the same
  // reason: silently re-reading the whole chain is the expensive answer.
  try {
    return BigInt(raw);
  } catch {
    throw new Error(
      `the reconcile cursor at ${path} is not a block number: ${JSON.stringify(raw.slice(0, 40))}`
    );
  }
}

export function writeCursor(path, block) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, String(block));
}

/**
 * Should this run advance the cursor, and to what?
 *
 * 4.M3. THE CURSOR MOVES ONLY ON A RECONCILE THAT ACTUALLY COMPLETED.
 * Advancing it after a partial read would skip whatever was in the blocks it
 * never reached, and those events are never offered again. `Rested`,
 * `Transfer` and `Rebound` are visible ONLY to reconcile, so a skipped window
 * means a token its owner sealed goes on telling every scanner at /t/<id> that
 * it is alive, permanently.
 *
 * "Completed" is expressed as `reconciled.to` being present, and that is the
 * whole rule. A reconcile that THROWS leaves `summary.reconciled` null, so
 * nothing advances -- which is the case that matters.
 *
 * AN ABORTED RUN STILL ADVANCES THE CURSOR, and that is deliberate rather than
 * an oversight. Since 4.L9 the run reconciles even when a write phase aborted:
 * the abort is about WRITING, and reconcile is a read that ran to the head
 * regardless. Refusing to advance here would re-read the same window every
 * night for as long as the piece stayed paused, which is the expensive answer
 * to a question nobody asked. A first draft of this function had that wrong.
 *
 * @returns the block to write, or null to leave the cursor where it is
 */
export function nextCursor(summary) {
  const to = summary?.reconciled?.to;
  return to === undefined ? null : to;
}

/**
 * The exit code for a finished run, so systemd records what actually happened.
 *
 * A run that stopped on GAS is not a failure: it did exactly what it should,
 * and tomorrow's run writes the same rows with the same day numbers.
 *
 * A CONDEMNED CREDIT IS one, decided 2026-09-05. It used to exit zero --
 * `dropped` was logged per entry as "stays queued", which reads exactly like
 * the ordinary poison-row path, and systemd recorded success. A token's record
 * IS the artwork, so a day that cannot be written is not a routine refusal, and
 * this was the one queue with no terminal state and no failure signal at all.
 *
 * A STUCK SEED IS one too, for the same reason as a stuck mint: the row cannot
 * proceed on its own and a human has to decide. Nobody paid for it, but it
 * holds a seed the key earns once a year, and a seed row carries no
 * `reservedAt`, so staleRows and the expiry sweep are both blind to it. This is
 * the only place it can be signalled.
 *
 * A PAID MINT THAT CANNOT LAND UNDER ITS ID (`stuckMints`: a different token
 * holds it, it cannot be identified, or the chain refuses its day as StaleDay)
 * and A PAID MARK THE CHAIN REFUSED (`stuckMarks`) are failures too. Both were
 * collected and alerted, and then not read here, so systemd recorded success
 * on a night an agent's money sat in something that will never be written
 * (found 2026-09-12). Both stay failing every night until a human acts, the
 * same as a stuck mint.
 *
 * A DROPPED seed is deliberately NOT a failure. The drop is the remedy: the
 * year is already back and the agent can ask again.
 */
export function exitCodeFor(summary) {
  if (!summary) return 1;
  if (summary.aborted) return 1;
  if ((summary.stuck?.length ?? 0) > 0) return 1;
  if ((summary.stuckMints?.length ?? 0) > 0) return 1;
  if ((summary.stuckCredits?.length ?? 0) > 0) return 1;
  if ((summary.stuckSeeds?.length ?? 0) > 0) return 1;
  if ((summary.stuckMarks?.length ?? 0) > 0) return 1;
  return 0;
}
