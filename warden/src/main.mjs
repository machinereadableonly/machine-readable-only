// The Warden's process entrypoint. PM2 runs this file (see
// ecosystem.config.cjs); nothing else does.
//
// warden/src/server.mjs exports ONE thing, createServer(config), and it is
// deliberately a pure factory: every test builds its own server with its own
// stubs and never touches a real socket, a real database file, or the
// network. That purity is exactly why nothing outside the tests ever called
// it -- `npm start` ran a module that defined a server and never started
// one. This file is what assembles the real dependencies and actually
// listens.
//
// NEVER IMPORT THIS FROM A TEST. Importing it opens a real database file,
// binds a real socket, and registers real SIGTERM/SIGINT handlers as a side
// effect of module load -- the opposite of what createServer's purity gives
// the test suite. (In practice it also can't be imported without a full set
// of environment variables set, since requireEnv() below runs at module
// load and throws on the first missing one.)
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.mjs";
import { makeMcpHandler } from "./mcp/server.mjs";
import { tokenView } from "./mcp/tokenView.mjs";
import { openDb } from "./mirror/db.mjs";
import { queries } from "./mirror/queries.mjs";
import { makeChainReader } from "./chain/read.mjs";
import { requeueOrphans, runSolver } from "./solve/queue.mjs";
import { utcDay } from "./mcp/tools/checkin.mjs";

/**
 * Read a required environment variable, failing loudly and by NAME.
 *
 * A Warden started with no CHALLENGE_SECRET would issue forgeable
 * challenges; one started with no MRO_DOMAIN would pin the RFC 9421
 * signature authority to the literal string "undefined" (or worse, to
 * whatever `new URL()` makes of it) rather than refusing to start. Both are
 * silent-failure shapes a default value would hide. This throws instead, and
 * names exactly which variable is missing, so a misconfigured deploy fails
 * at startup -- loud, and before it has admitted a single request -- rather
 * than at the first request, or never.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing required environment variable: ${name}`);
  return value;
}

const PORT = Number(process.env.PORT) || 3006;
// Loopback only, ALWAYS -- never read from the environment. Public traffic
// reaches this process through nginx (see nginx.conf.example and DEPLOY.md);
// binding 0.0.0.0 would expose it directly, which is the one thing this
// project's port rules forbid outright. Hardcoding this means no
// misconfigured HOST value in ecosystem.config.cjs, or in a shell some
// future operator runs this from, can change what this binds to.
const HOST = "127.0.0.1";

const domain = requireEnv("MRO_DOMAIN");
const challengeSecret = requireEnv("CHALLENGE_SECRET");
const rpcUrl = requireEnv("BASE_RPC_URL");
const contract = requireEnv("MRO_CONTRACT_ADDRESS");
// Not consumed by anything below yet -- see makePaidStub()'s comment for
// why -- but it is still required here and validated the same way the other
// five are. The day real payment collection is wired, this is the address
// x402's `payTo` must use, and failing loudly now means it is never
// discovered missing only once that wiring lands.
const treasuryAddress = requireEnv("TREASURY_ADDRESS");
const stateDbPath = requireEnv("STATE_DB_PATH");

/**
 * Registration rate limiting for POST /keys.
 *
 * The spec's dial is 20 registrations per minute per source and 10,000 keys
 * total. `allowRegistration` is called as `allow()` -- server.mjs's
 * registerRoute never passes the request or a source IP through to it -- so
 * a PER-SOURCE limit cannot be enforced at this seam as the router is built.
 * What this implements instead:
 *   - a GLOBAL sliding window, 20 registrations per minute, all sources
 *     combined (not per source -- there is no source to key on here);
 *   - the 10,000-key total cap, read live off the mirror on every call.
 * It resets to an empty window on every restart, because the window lives in
 * a plain array in this process's memory, not in the mirror. The total cap
 * does NOT reset, because it is read from the database, not from memory.
 */
function makeAllowRegistration(q) {
  const WINDOW_MS = 60_000;
  const MAX_PER_WINDOW = 20;
  const MAX_TOTAL_KEYS = 10_000;
  const recent = [];
  return function allowRegistration() {
    const now = Date.now();
    while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
    if (recent.length >= MAX_PER_WINDOW) return false;
    if (q.allKeys().length >= MAX_TOTAL_KEYS) return false;
    recent.push(now);
    return true;
  };
}

/**
 * The paid-tool wrapper `mint` and `upgrade` call through.
 *
 * `makePaid()` in src/pay/x402.mjs is this project's real, tested seam for
 * this: it just needs an x402ResourceServer and an `accepts` list. Building
 * a real one was attempted here and abandoned, for two reasons checked by
 * hand on 2026-08-30, not guessed:
 *
 * 1. x402ResourceServer needs a payment SCHEME registered before it can
 *    build requirements for a network. @x402/evm's ExactEvmScheme is what
 *    knows how to accept USDC on an EVM chain (Base) -- it is a
 *    devDependency of @x402/mcp in this project's own lockfile, not an
 *    installed runtime dependency here: `import("@x402/evm")` throws
 *    ERR_MODULE_NOT_FOUND, and node_modules/@x402/evm does not exist.
 *    Adding a new npm dependency is not this bootstrap's call to make.
 * 2. Even reaching that point is worse than skipping it.
 *    x402ResourceServer.initialize() makes a LIVE HTTP call to the
 *    facilitator to fetch its supported payment kinds, and THROWS if that
 *    call fails (read directly out of @x402/core's initialize()) -- which
 *    would make this WHOLE PROCESS's startup, not just the two paid tools,
 *    depend on reaching a specific third-party host over the network. And
 *    with no scheme registered, buildPaymentRequirements() returns an EMPTY
 *    accepts array rather than throwing, but createPaymentWrapper THROWS
 *    SYNCHRONOUSLY on an empty accepts array ("PaymentWrapperConfig.accepts
 *    must have at least one payment requirement" -- reproduced by hand).
 *    So the real path crashes the process at startup either way.
 *
 * So this fails closed, locally, with no network call: every paid tool call
 * is refused. Never a crash, and never a free mint or Mark. Wiring the real
 * path needs @x402/evm added as a dependency and its ExactEvmScheme
 * registered on a resourceServer here -- left for whoever picks up real
 * payment collection.
 */
function makePaidStub() {
  return (_handler) => async () => ({ ok: false, reason: "payment-not-configured" });
}

const WORKER_PATH = fileURLToPath(new URL("./solve/worker.mjs", import.meta.url));

/**
 * Build the `spawn(tokenId)` runSolver drains the queue with.
 *
 * A CHILD PROCESS, not a call in this process -- queue.mjs's own header is
 * why: one solve measured 532 MB resident and about ten seconds, Node runs
 * one thread, and only a process exit actually returns resvg's native
 * buffers. `--max-old-space-size=768` and the argument order match
 * worker.mjs's own documented invocation exactly. `process.execPath` (not a
 * bare "node") is what this process itself was launched with, so it works
 * under PM2's pinned interpreter the same way it works from a shell with nvm
 * sourced.
 */
function makeSpawnSolve(forDomain) {
  return (tokenId) =>
    new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        ["--max-old-space-size=768", WORKER_PATH, forDomain, String(tokenId)],
        { timeout: 60_000 },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(stderr.trim() || err.message));
          let result;
          try {
            result = JSON.parse(stdout.trim().split("\n").pop());
          } catch {
            return reject(new Error(`worker produced no parseable result: ${stdout.slice(0, 200)}`));
          }
          if (!result.ok) return reject(new Error("worker reported failure"));
          resolve(result);
        }
      );
    });
}

async function main() {
  const db = openDb(stateDbPath);
  const q = queries(db);

  // Any row still marked 'solving' was abandoned by a previous process --
  // this is by definition safe to call once, before anything else serves a
  // request, because the solver claims one row at a time in a single
  // process (see queue.mjs's own comment on requeueOrphans).
  requeueOrphans(q);

  const chain = makeChainReader({ rpcUrl, contract });
  const paid = makePaidStub();

  // The static JWKS nginx serves from
  // public/.well-known/http-message-signatures-directory is a file on disk,
  // not proxied to this process (see nginx.conf.example). Passing
  // directoryPath makes the router rewrite that file on every successful
  // POST /keys, so a key registered through the easy path is actually
  // servable. mkdirSync is idempotent -- a no-op if the directory already
  // exists.
  const wellKnownDir = fileURLToPath(new URL("../public/.well-known/", import.meta.url));
  mkdirSync(wellKnownDir, { recursive: true });
  const directoryPath = fileURLToPath(
    new URL("../public/.well-known/http-message-signatures-directory", import.meta.url)
  );
  const llmsTxt = readFileSync(fileURLToPath(new URL("../public/llms.txt", import.meta.url)), "utf8");

  const mcp = makeMcpHandler({
    q,
    chain,
    today: utcDay,
    contract,
    challengeSecret,
    domain,
    llmsTxt,
    paid,
    // No Mark catalogue is wired yet. Every `upgrade` call is refused at its
    // own gate ("mark-inactive") before it would ever reach payment. Pricing
    // and per-Mark gates (minLevel, needsWhole, minStreak, supply) are
    // undocumented product decisions belonging to whoever builds that
    // catalogue for real -- not something to invent here.
    catalogue: {},
    // Mirrors the contract's default supplyCap (MachineReadableOnly.sol:
    // `supplyCap = 10_000`). This is only a soft pre-payment check -- the
    // contract enforces the real cap on chain regardless -- and it does not
    // track a later on-chain change via setUpgrade.
    supplyCap: 10_000,
  });

  const server = createServer({
    stateDbPath,
    domain,
    challengeSecret,
    tokenView,
    mcp,
    allowRegistration: makeAllowRegistration(q),
    directoryPath,
  });

  // Drain whatever is pending (including what requeueOrphans just restored)
  // without blocking the server from listening -- a solve is ~10 seconds,
  // and an agent's first request should not wait on it. Re-run periodically
  // so tokens minted later also eventually get solved; the Clock (Plan 3)
  // does not need the bitmap until 00:05 UTC, which is hours of slack.
  const spawnSolve = makeSpawnSolve(domain);
  let solving = false;
  const drainQueue = () => {
    if (solving) return;
    solving = true;
    runSolver(q, spawnSolve)
      .catch((err) => console.error("warden: solver run failed:", err.message))
      .finally(() => {
        solving = false;
      });
  };
  drainQueue();
  const solverTimer = setInterval(drainQueue, 5 * 60_000);
  solverTimer.unref();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
  console.log(`warden: listening on http://${HOST}:${PORT} (domain ${domain}, treasury ${treasuryAddress})`);

  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`warden: ${signal} received, shutting down`);
    clearInterval(solverTimer);
    const closed = new Promise((resolve) => server.close(resolve));
    // A client holding a keep-alive connection open could otherwise stall
    // server.close()'s callback indefinitely. PM2 restarts should not hang
    // on that -- fall through to closing the database and exiting either way.
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 5000))]);
    try {
      db.close();
    } catch (err) {
      console.error("warden: error closing database:", err.message);
    }
    process.exit(0);
  }
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("warden: failed to start:", err.message);
  process.exit(1);
});
