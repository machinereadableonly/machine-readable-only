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
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http } from "viem";
import { openDb } from "../mirror/db.mjs";
import { queries } from "../mirror/queries.mjs";
import { makeWriter, chainFor } from "./write.mjs";
import { runClock } from "./run.mjs";
import { DEPLOY_BLOCK } from "./reconcile.mjs";
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
  try {
    const raw = readFileSync(CURSOR, "utf8").trim();
    return raw === "" ? null : BigInt(raw);
  } catch {
    // No cursor yet: reconcile floors at the deploy block instead. Any OTHER
    // read failure lands here too, and starting from the deploy block is the
    // safe direction -- it re-reads history rather than skipping it.
    return null;
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

async function main() {
  const started = Date.now();
  const db = openDb(stateDbPath);
  const q = queries(db);
  const chain = chainFor(chainId);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const writer = makeWriter({ rpcUrl, contract, chainId, privateKey, maxGasGwei, publicClient });

  console.log(`clock: run starting, warden ${writer.address}, chain ${chainId}`);

  const summary = await runClock({
    q,
    writer,
    publicClient,
    contract,
    chainId,
    today: utcDay(),
    lastReconciledBlock: readCursor(),
  });

  // The cursor moves ONLY on a reconcile that actually completed. Advancing it
  // after a partial read would skip whatever was in the blocks it never got to,
  // and those events are never offered again.
  if (summary.reconciled?.to !== undefined) writeCursor(summary.reconciled.to);

  console.log(
    `clock: run finished in ${Date.now() - started}ms -- ` +
      `${summary.minted.length} minted, ${summary.credited.length} credited, ` +
      `${summary.marks.length} marks, ${summary.dropped.length} dropped, ${summary.stuck.length} stuck`
  );
  db.close();

  // A run that stopped on gas is NOT a failure: it did exactly what it should,
  // and tomorrow's run writes the same rows with the same day numbers. Anything
  // aborted, or any token stuck with a paid agent and no artwork, is.
  if (summary.aborted) {
    console.error(`clock: run ABORTED (${summary.aborted})`);
    process.exitCode = 1;
  } else if (summary.stuck.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("clock: run failed:", err.message);
  process.exitCode = 1;
});
