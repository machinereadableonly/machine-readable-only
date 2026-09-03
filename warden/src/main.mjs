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
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "./server.mjs";
import { makeAllowRegistration, makeSpawnSolve } from "./bootstrap.mjs";
import { makePaymentGateway, warmUp } from "./pay/x402.mjs";
import { makeMcpHandler } from "./mcp/server.mjs";
import { LADDER, assertLadderSane } from "./mcp/ladder.mjs";
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

// THE CLOCK'S KEY IS NOT THIS PROCESS'S BUSINESS, so it is removed from the
// environment before anything else runs.
//
// Both processes read the same configuration file, because they share a
// database, a contract and a chain id -- one file with one truth in it. But
// this process is the internet-facing one, and any bug that serialises
// process.env into an error page, a debug route or a crash dump would hand out
// the key that can mint every token in the collection. The Clock re-reads the
// file itself and is not reachable from outside.
//
// This is defence in depth, not a boundary: anyone who can run code as this
// user can read the file directly. It closes the cheap accident, not the
// determined attacker, and the boundary that actually matters is the one on
// chain -- the Clock is the warden and NOT the owner, so even the key itself
// cannot sunset the piece or change its renderer.
delete process.env.CLOCK_PRIVATE_KEY;

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
// Where every USDC payment lands. x402's `payTo`.
const treasuryAddress = requireEnv("TREASURY_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(treasuryAddress)) {
  throw new Error("TREASURY_ADDRESS must be a 20-byte hex address");
}
const stateDbPath = requireEnv("STATE_DB_PATH");

// The chain the contract above is deployed on, published to agents at
// mro://contract. It was hardcoded to 8453 beside an address read from the
// environment, so a Warden pointed at a Base Sepolia contract told every
// caller the token lived on Base mainnet -- an address and a chain id that do
// not belong together are worse than either alone. Required, and required to
// be a positive integer, because a wrong default here is exactly the silent
// failure being removed.
const chainId = Number(requireEnv("MRO_CHAIN_ID"));
if (!Number.isInteger(chainId) || chainId <= 0) {
  throw new Error("MRO_CHAIN_ID must be a positive integer, for example 8453 for Base mainnet");
}

// BASE SEPOLIA, the only chain a placeholder treasury is allowed on.
const BASE_SEPOLIA = 84_532;

// Addresses that are stand-ins, not destinations. TREASURY_ADDRESS carries a
// placeholder while the real one is being decided, and a placeholder is
// harmless on a testnet and unrecoverable on mainnet: USDC sent to either of
// these is gone, and x402 settles to whatever `payTo` says without asking. So
// the placeholder is allowed to run the piece on Base Sepolia and refuses to
// start anywhere else.
const PLACEHOLDER_TREASURIES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);
if (chainId !== BASE_SEPOLIA && PLACEHOLDER_TREASURIES.has(treasuryAddress.toLowerCase())) {
  throw new Error(
    `TREASURY_ADDRESS is a placeholder (${treasuryAddress}) and chain ${chainId} is not Base Sepolia: ` +
      "set the real treasury address before running anywhere real money can arrive"
  );
}

// The facilitator that verifies and settles USDC payments. Required, never
// defaulted: a wrong default here charges agents into the void.
//   testnet: https://x402.org/facilitator (no API key; Base Sepolia only --
//            its /supported lists eip155:84532 and no mainnet, measured
//            2026-08-31)
//   mainnet: https://api.cdp.coinbase.com/platform/v2/x402 (CDP API key)
// NOTE the spec's `https://facilitator.x402.org` does not resolve; the working
// testnet host is the path form above.
const facilitatorUrl = requireEnv("X402_FACILITATOR_URL");

// CAIP-2, derived from the chain the contract is on rather than configured
// separately. Two settings that must agree are one setting: quoting a price on
// a different chain than the token lives on is the same class of bug as the
// address/chain mismatch this file already removed once.
const paymentNetwork = `eip155:${chainId}`;

// The three policies this process runs on -- the registration limiter, the
// paid-tool stub and the solver spawn -- are built in ./bootstrap.mjs and
// imported above, NOT written here. Nothing can import this file to test them
// (see the header), so anything defined here is by construction untested. They
// are pure factories over there, and warden/test/bootstrap.test.mjs drives them
// directly.

async function main() {
  const db = openDb(stateDbPath);
  const q = queries(db);

  // Any row still marked 'solving' was abandoned by a previous process --
  // this is by definition safe to call once, before anything else serves a
  // request, because the solver claims one row at a time in a single
  // process (see queue.mjs's own comment on requeueOrphans).
  requeueOrphans(q);

  const chain = makeChainReader({ rpcUrl, contract });

  // Payment. NOTHING here talks to the facilitator yet -- the gateway builds
  // itself on the first paid call, because initialize() is a live HTTP call
  // that throws, and the whole process must not fail to boot because a third
  // party is down. See src/pay/x402.mjs.
  const paid = makePaymentGateway({
    facilitatorUrl,
    network: paymentNetwork,
    payTo: treasuryAddress,
  });

  // Ask it to build now anyway, and carry on regardless. Without this a
  // misconfigured facilitator or an unsupported network stays invisible until
  // the first paying agent hits it; with it, the boot log says so. warmUp
  // never rejects and never blocks the listen below.
  warmUp(paid).then((ready) => {
    console.log(
      ready
        ? `warden: payment ready (${paymentNetwork} via ${facilitatorUrl}, to ${treasuryAddress})`
        : "warden: payment NOT ready -- mint and upgrade will refuse until the facilitator answers"
    );
  });

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
  const doorHtml = readFileSync(fileURLToPath(new URL("../public/door.html", import.meta.url)), "utf8");

  const mcp = makeMcpHandler({
    q,
    chain,
    today: utcDay,
    contract,
    chainId,
    challengeSecret,
    domain,
    llmsTxt,
    paid,
    // The ten Marks, mirroring contracts/src/Ladder.sol. assertLadderSane
    // throws HERE, at boot, rather than letting a malformed entry reach an
    // agent as a runtime refusal -- a Mark that is priced and earned, or
    // priced differently from the chain, is a wiring error and not something
    // to discover after money has moved.
    catalogue: assertLadderSane(LADDER),
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
    // The two public documents. Read once at startup, like llmsTxt above, so
    // serving them costs no disk read per request. nginx proxies these
    // through rather than serving them itself -- see the note in server.mjs.
    doorHtml,
    llmsTxt,
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
