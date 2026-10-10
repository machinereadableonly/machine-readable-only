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
import { createPublicClient, http } from "viem";
import { openDb } from "../mirror/db.mjs";
import { queries } from "../mirror/queries.mjs";
import { makeWriter, chainFor } from "./write.mjs";
import { runClock, DEFAULT_CEILINGS } from "./run.mjs";
import { makeProver } from "./prove.mjs";
import { agreeingClient } from "./agree.mjs";
import { openLedger } from "./ledger.mjs";
import { DEPLOY_BLOCK } from "./reconcile.mjs";
import { readCursor, writeCursor, nextCursor, exitCodeFor, runFinishedLine } from "./cursor.mjs";
import { lockOwner, takeLock, releaseLock } from "./lock.mjs";
import { MRO_ABI } from "./abi.mjs";
import { utcDay } from "../mcp/tools/checkin.mjs";
import { dayMismatch } from "../day.mjs";
import { safeErrorText } from "./redact.mjs";
import { chainKeys } from "./split.mjs";
import { loadSplitSeed, splitSeedPath } from "./splitSeed.mjs";
import { loadBank, bankPath } from "../mcp/question.mjs";

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
// What every row is proven against. Read from the Clock's own configuration,
// never from the shared database the rows are in.
const domain = requireEnv("MRO_DOMAIN");
const treasury = requireEnv("TREASURY_ADDRESS");
const houseKeyId = process.env.MRO_HOUSE_KEY_ID || null;
/// A second, independent RPC. Every read that settles a row without a receipt,
/// proves a binding or proves a payment must agree on both. Required on mainnet.
const checkRpcUrl = process.env.CLOCK_CHECK_RPC_URL || null;
const ownerSafe = process.env.MRO_OWNER_SAFE || null;
if (chainId === 8453 && !ownerSafe) {
  throw new Error("MRO_OWNER_SAFE is required on Base mainnet: the Safe that must own the contract");
}
if (chainId === 8453 && !checkRpcUrl) {
  throw new Error("CLOCK_CHECK_RPC_URL is required on Base mainnet: a second RPC, from a different provider than BASE_RPC_URL");
}
/// Where the Clock records which proofs it has spent. Must be writable by the
/// Clock alone: the installed Clock keeps it in /var/lib/mro-clock.
const LEDGER = process.env.CLOCK_LEDGER_PATH ?? `${stateDbPath}.clock-ledger`;

function ceilingFrom(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${name} must be a whole number, got ${JSON.stringify(raw)}`);
  return n;
}
const ceilings = {
  mints: ceilingFrom("CLOCK_MAX_MINTS", DEFAULT_CEILINGS.mints),
  seeds: ceilingFrom("CLOCK_MAX_SEEDS", DEFAULT_CEILINGS.seeds),
  marks: ceilingFrom("CLOCK_MAX_MARKS", DEFAULT_CEILINGS.marks),
  credits: ceilingFrom("CLOCK_MAX_CREDITS", DEFAULT_CEILINGS.credits),
};

// The owner's dial, in gwei. Default 0.05, about eight times Base's 0.006
// floor. Above it the run writes NOTHING and tries again tomorrow -- pending
// rows keep their own day numbers, so a token's level and streak come out
// identical whenever the write lands.
const maxGasGwei = process.env.MAX_GAS_GWEI ?? "0.05";

/// Where the last reconciled block is remembered between runs. Without it every
/// run would re-read from the deploy block, which is only cheap while the
/// contract is young.
const CURSOR = process.env.CLOCK_CURSOR_PATH ?? `${stateDbPath}.reconcile-cursor`;

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

/// Who this run is, so a lock left by a run that died can be told from a live
/// one. The rule lives in lock.mjs, which is tested directly.
const owner = lockOwner();
const take = () => takeLock(LOCK, owner);
const release = () => releaseLock(LOCK, owner);

async function main() {
  const started = Date.now();
  take();
  const db = openDb(stateDbPath);
  const q = queries(db);
  const chain = chainFor(chainId);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const writer = makeWriter({ rpcUrl, contract, chainId, privateKey, maxGasGwei, publicClient });
  const checkClient = agreeingClient(
    publicClient,
    checkRpcUrl && createPublicClient({ chain, transport: http(checkRpcUrl) }),
  );

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
    // 16.10. safeErrorText, NOT err.message: viem puts the request url in
    // `message` and the url is where a managed provider keeps its api key.
    // This log is appended to by systemd and read the morning after.
    throw new Error(
      `could not read today() from the contract, so the run has no day it can trust: ${safeErrorText(err)}`
    );
  }
  // TEST-ONLY: the fork rehearsal moves the chain's clock forward days at a time.
  // The installer refuses this variable, so the installed Clock never takes it.
  const offset = Number(process.env.CLOCK_TEST_BOX_DAY_OFFSET ?? 0);
  // A malformed value would make the day check below compare against NaN and pass.
  if (!Number.isInteger(offset)) throw new Error("CLOCK_TEST_BOX_DAY_OFFSET must be a whole number of days");
  const boxDay = utcDay() + offset;
  // More than a day apart, one of the two is lying or broken, and the RPC's
  // day decides which split keys are revealed: refuse the night.
  if (dayMismatch(today, boxDay)) {
    throw new Error(`the contract says day ${today} and this box says ${boxDay}; refusing to run on either`);
  }
  if (today !== boxDay) {
    console.error(`clock: WARNING -- the contract says day ${today} and this box says ${boxDay}; using the contract`);
  }

  console.log(`clock: run starting, warden ${writer.address}, chain ${chainId}, day ${today}`);
  // Said every run, so a mainnet night without attribution is visible in the
  // log rather than discovered on a leaderboard. See builder-code.mjs.
  console.log(`clock: builder code ${writer.builderCode ?? "none yet -- see DEPLOY.md section 10"}`);

  // The split seed and the question bank. Neither failure throws: without
  // them runClock writes nothing and fails the night, which is a red line in
  // the log rather than a crash loop.
  let splitKeys = null;
  try {
    splitKeys = chainKeys(loadSplitSeed(splitSeedPath()));
  } catch (err) {
    console.error(`clock: ${safeErrorText(err)}`);
  }
  let bank = null;
  try {
    bank = loadBank(bankPath());
  } catch (err) {
    console.error(`clock: ${safeErrorText(err)}`);
  }

  // NOTHING IS SIGNED BEFORE THE SAFE OWNS THE CONTRACT.
  if (ownerSafe) {
    const [owner, pending] = await Promise.all(
      ["owner", "pendingOwner"].map((functionName) => checkClient.readContract({ address: contract, abi: MRO_ABI, functionName })),
    );
    if (String(owner).toLowerCase() !== ownerSafe.toLowerCase() || BigInt(pending) !== 0n) {
      throw new Error(`the contract's owner is ${owner} with ${pending} pending, not the Safe ${ownerSafe} alone: refusing to sign`);
    }
  }

  const ledger = openLedger(LEDGER);
  const prover = makeProver({ q, publicClient: checkClient, contract, chainId, domain, treasury, houseKeyId, ledger, bank });

  const summary = await runClock({
    q,
    prover,
    ceilings,
    splitKeys,
    bank,
    writer,
    publicClient,
    checkClient,
    contract,
    chainId,
    today,
    boxDay,
    lastReconciledBlock: readCursor(CURSOR, { chainId, contract, log: console.error }),
    // Saved as each page is applied, so a night that fails half way keeps what
    // it read instead of re-reading it tomorrow on top of a longer backlog.
    saveCursor: (block) => writeCursor(CURSOR, block, { chainId, contract }),
  });

  // The cursor moves ONLY on a reconcile that actually completed -- see
  // nextCursor, which owns that rule and is tested on its own. The pages above
  // have usually written it already; this is what moves it on a night with no
  // page to read.
  const advanceTo = nextCursor(summary, readCursor(CURSOR, { chainId, contract, log: console.error }));
  if (advanceTo !== null) writeCursor(CURSOR, advanceTo, { chainId, contract });

  console.log(runFinishedLine(summary, Date.now() - started));
  ledger.close();
  db.close();

  // What the run reports to systemd. The rule lives in exitCodeFor, which is
  // tested directly; this only says the aborted case out loud.
  if (summary.aborted) console.error(`clock: run ABORTED (${summary.aborted})`);
  process.exitCode = exitCodeFor(summary);
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
    release();
    process.exit(1);
  });
}

main()
  .catch((err) => {
    // 16.10. Anything uncaught lands here, and reconcile's getBlockNumber and
    // getLogs are uncaught by design (runClock's reconcile step), so a viem
    // error reaches this line with the endpoint url inside it.
    console.error("clock: run failed:", safeErrorText(err));
    process.exitCode = 1;
  })
  // ALWAYS, on every path. A lock the happy path releases and the error path
  // does not is a lock that turns one bad night into every night after it.
  .finally(release);
