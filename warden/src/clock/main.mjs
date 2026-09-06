// The Clock's entry point. The systemd timer runs this file; nothing else does.
//
//   node --env-file=.env src/clock/main.mjs
//
// NEVER IMPORT THIS FROM A TEST, and never from the Warden. Importing it opens
// the mirror, reads a private key out of the environment and talks to a chain,
// all as a side effect of module load. Everything it assembles lives in
// run.mjs, write.mjs, batch.mjs and reconcile.mjs, which are pure factories the
// tests drive directly.
//
// It exits non-zero when the run could not do its job, so the systemd unit
// records a failure rather than a silent success.
import { readFileSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http } from "viem";
import { openDb } from "../mirror/db.mjs";
import { queries } from "../mirror/queries.mjs";
import { makeWriter, chainFor } from "./write.mjs";
import { runClock } from "./run.mjs";
import { DEPLOY_BLOCK } from "./reconcile.mjs";
import { MRO_ABI } from "./abi.mjs";
import { utcDay } from "../mcp/tools/checkin.mjs";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

const rpcUrl = requireEnv("BASE_RPC_URL");
const contract = requireEnv("MRO_CONTRACT_ADDRESS");
const stateDbPath = requireEnv("STATE_DB_PATH");
const privateKey = requireEnv("CLOCK_PRIVATE_KEY");
const chainId = Number(requireEnv("MRO_CHAIN_ID"));

// The owner's dial, in gwei. Default 0.05, about eight times Base's 0.006
// floor. Above it the run writes NOTHING and tries again tomorrow -- pending
// rows keep their own day numbers, so a token's level and streak come out
// identical whenever the write lands.
const maxGasGwei = process.env.MAX_GAS_GWEI ?? "0.05";

/// Where the last reconciled block is remembered between runs. Without it every
/// run would re-read from the deploy block, which is only cheap while the
/// contract is young.
const CURSOR = process.env.CLOCK_CURSOR_PATH ?? `${stateDbPath}.reconcile-cursor`;

function readCursor() {
  let raw;
  try {
    raw = readFileSync(CURSOR, "utf8").trim();
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
    throw new Error(`could not read the reconcile cursor at ${CURSOR}: ${err.message}`);
  }
  if (raw === "") return null;
  // A cursor that is not a number is corruption, not a first run, for the same
  // reason: silently re-reading the whole chain is the expensive answer.
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`the reconcile cursor at ${CURSOR} is not a block number: ${JSON.stringify(raw.slice(0, 40))}`);
  }
}

function writeCursor(block) {
  mkdirSync(dirname(CURSOR), { recursive: true });
  writeFileSync(CURSOR, String(block));
}

// THE DEPLOY BLOCK IS CHECKED BEFORE ANYTHING IS WRITTEN, not when reconcile
// reaches for it.
//
// reconcile is deliberately the LAST step of a run, after mints, check-ins and
// Marks. So on a chain with no recorded deploy block -- which is every chain
// but Base Sepolia today -- the old behaviour was to do every write correctly
// and THEN throw, leaving the cursor unmoved so the same failure repeated every
// night. The writes were fine; the three things only reconcile can see
// (`Rested`, `Transfer`, `Rebound`) never reached the mirror, so a token its
// owner had sealed went on telling every scanner at /t/<id> that it was alive.
//
// Failing here instead costs one night's writes and says exactly what is
// missing, on the first run rather than the hundredth.
if (DEPLOY_BLOCK[chainId] === undefined) {
  throw new Error(
    `no deploy block recorded for chain ${chainId}: add it to DEPLOY_BLOCK in src/clock/reconcile.mjs ` +
      "as part of the deploy, or reconcile would guess at its own history " +
      `(known chains: ${Object.keys(DEPLOY_BLOCK).join(", ")})`
  );
}

/// Where the run lock lives. Beside the mirror, because the thing it protects
/// is one signer on one nonce writing to that mirror.
const LOCK = process.env.CLOCK_LOCK_PATH ?? `${stateDbPath}.run-lock`;

/**
 * One Clock at a time.
 *
 * 16.8. There was no lock of any kind. `Type=oneshot` stops systemd starting a
 * SECOND copy of the timer's own run, but it says nothing about a rehearsal
 * tool an operator starts by hand -- and this project has such tools, and has
 * used them against the live mirror. Two signers on one account means two
 * transactions built on the same nonce, and the second is simply lost.
 *
 * `wx` is the whole mechanism: an atomic create-if-absent. No daemon, no
 * dependency, and a crash that leaves the file behind is recoverable by
 * deleting it -- which the message says, because a lock nobody knows how to
 * clear is worse than no lock.
 */
// Whether THIS process owns the lock. Without it, a run that was refused the
// lock would release it on the way out and delete the lock belonging to the
// run that legitimately holds it -- turning the guard into the very race it
// exists to prevent.
let holdsLock = false;

function takeLock() {
  try {
    closeSync(openSync(LOCK, "wx"));
    holdsLock = true;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    throw new Error(
      `another clock run holds ${LOCK}. Only one may write at a time: two signers ` +
        "on one account build two transactions on the same nonce. If no run is " +
        `actually in progress, delete ${LOCK} and start again.`
    );
  }
}

function releaseLock() {
  if (!holdsLock) return;
  holdsLock = false;
  try { unlinkSync(LOCK); } catch { /* already gone: nothing to release */ }
}

async function main() {
  const started = Date.now();
  takeLock();
  const db = openDb(stateDbPath);
  const q = queries(db);
  const chain = chainFor(chainId);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const writer = makeWriter({ rpcUrl, contract, chainId, privateKey, maxGasGwei, publicClient });

  // 15.10. THE DAY COMES FROM THE CONTRACT, not from this box.
  //
  // CLAUDE.md's own rule is "read the contract's today(), never the box's
  // clock", and this was the one place it was not followed: `utcDay()` read
  // Date.now(). The two agree to the second in normal operation, and disagree
  // exactly when it matters -- the Clock fires at 00:05 UTC, five minutes from
  // a boundary, and a box whose NTP has drifted picks the wrong day. Every
  // credit then selects on `today - 1`, so a whole night lands on the wrong
  // day number or is refused FutureDay by the chain that disagreed.
  //
  // A read that fails STOPS the run rather than falling back to the box. The
  // fallback is what made the rule ignorable.
  let today;
  try {
    today = Number(await publicClient.readContract({ address: contract, abi: MRO_ABI, functionName: "today" }));
  } catch (err) {
    throw new Error(`could not read today() from the contract, so the run has no day it can trust: ${err.message}`);
  }
  const boxDay = utcDay();
  if (today !== boxDay) {
    console.error(`clock: WARNING -- the contract says day ${today} and this box says ${boxDay}; using the contract`);
  }

  console.log(`clock: run starting, warden ${writer.address}, chain ${chainId}, day ${today}`);

  const summary = await runClock({
    q,
    writer,
    publicClient,
    contract,
    chainId,
    today,
    lastReconciledBlock: readCursor(),
  });

  // The cursor moves ONLY on a reconcile that actually completed. Advancing it
  // after a partial read would skip whatever was in the blocks it never got to,
  // and those events are never offered again.
  if (summary.reconciled?.to !== undefined) writeCursor(summary.reconciled.to);

  console.log(
    `clock: run finished in ${Date.now() - started}ms -- ` +
      `${summary.minted.length} minted, ${summary.credited.length} credited, ` +
      `${summary.healed.length} healed, ${summary.marks.length} marks, ` +
      `${summary.dropped.length} dropped, ${summary.stuck.length} stuck`
  );
  db.close();

  // A run that stopped on gas is NOT a failure: it did exactly what it should,
  // and tomorrow's run writes the same rows with the same day numbers. Anything
  // aborted, or any token stuck with a paid agent and no artwork, is.
  //
  // A CONDEMNED CREDIT FAILS THE RUN TOO, added 2026-09-05. It used to exit
  // ZERO: `dropped` was logged per entry as "stays queued", which reads exactly
  // like the ordinary poison-row path, and systemd recorded success. A token's
  // record is the artwork, so a day that cannot be written is not a routine
  // refusal -- and this was the one queue with no terminal state and no failure
  // signal at all.
  if (summary.aborted) {
    console.error(`clock: run ABORTED (${summary.aborted})`);
    process.exitCode = 1;
  } else if (summary.stuck.length > 0 || summary.stuckCredits.length > 0) {
    process.exitCode = 1;
  }
}

// 16.7. A SHUTDOWN HANDLER, because the unit has TimeoutStartSec=600 and no
// TimeoutStopSec, and there was no `process.on` anywhere under src/clock --
// against main.mjs, which installs two for the Warden. So a stop during a run
// was a SIGKILL, and a SIGKILL between a broadcast and its receipt is exactly
// the precondition that freezes a token's record (16.1/15.2).
//
// This cannot make an in-flight transaction safe -- nothing can, once it is
// broadcast -- but it stops the run BEFORE it starts another one, releases the
// lock so the next run is not blocked by a corpse, and says in the journal that
// the stop was deliberate rather than a crash.
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    if (stopping) return;   // a second signal must not race the first
    stopping = true;
    console.error(`clock: ${signal} received; releasing the run lock and exiting`);
    releaseLock();
    process.exit(1);
  });
}

main()
  .catch((err) => {
    console.error("clock: run failed:", err.message);
    process.exitCode = 1;
  })
  // ALWAYS, on every path. A lock the happy path releases and the error path
  // does not is a lock that turns one bad night into every night after it.
  .finally(releaseLock);
