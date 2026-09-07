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
import { getAddress } from "viem";
import { createServer } from "./server.mjs";
import { makeAllowRegistration, makeAllowToolCall, makeSpawnSolve } from "./bootstrap.mjs";
import { makePaymentGateway, warmUp } from "./pay/x402.mjs";
import { makeCdpAuthHeaders, isCdpFacilitator } from "./pay/cdp.mjs";
import { makeMcpHandler } from "./mcp/server.mjs";
import { LADDER, assertLadderSane } from "./mcp/ladder.mjs";
import { tokenView } from "./mcp/tokenView.mjs";
import { openDb } from "./mirror/db.mjs";
import { queries } from "./mirror/queries.mjs";
import { makeChainReader } from "./chain/read.mjs";
import { verifyChainId, verifyDecoder, treasuryBalance } from "./chain/preflight.mjs";
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
// AND IT MUST CARRY ITS CHECKSUM. The shape check above accepts any 40 hex
// characters, so a single mistyped digit in the real treasury produces a
// well-formed address that passes everything -- and x402 settles to whatever
// `payTo` says without asking, so every dollar the piece ever earns would go
// somewhere nobody controls, reported as a success each time. EIP-55 mixed case
// is a checksum over the address, so the canonical form catches exactly that
// typo.
//
// THE TEST IS EQUALITY WITH THE CANONICAL FORM, and that shape was measured
// rather than assumed. viem's `getAddress` does NOT throw on a bad checksum --
// it RE-checksums -- so `try { getAddress(a) } catch` would never once fire.
// And `isAddress(a, { strict: true })` returns true for an all-lowercase
// address, which carries no checksum at all and so cannot catch a typo either.
// Only "the string set here is the string EIP-55 produces" rejects both. If
// this throws, paste the mixed-case form the error names.
if (getAddress(treasuryAddress) !== treasuryAddress) {
  throw new Error(
    `TREASURY_ADDRESS ${treasuryAddress} is not in EIP-55 checksummed form: set it to ` +
      `${getAddress(treasuryAddress)}, so that a single mistyped character cannot be a valid address`
  );
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

// THE FACILITATOR'S CREDENTIAL, required only by the one that asks for it.
//
// Coinbase's CDP host is the only facilitator that settles on Base mainnet, and
// it answers 401 without a Bearer token. Until 2026-09-05 there was no slot for
// that credential at all, so a mainnet cutover would have produced a piece that
// boots, logs "payment NOT ready", and then refuses every mint and every
// upgrade with `payment-unavailable` for as long as it runs. Nothing would be
// charged and nothing given away -- it fails closed -- but nobody could enter.
//
// REFUSED AT STARTUP rather than warned about, and for the same reason the
// placeholder treasury above is: the testnet facilitator needs no key, so this
// is a mainnet-only misconfiguration that no testnet run can ever surface. The
// first chance to catch it is the boot that would have been broken.
const cdpKeyId = process.env.CDP_API_KEY_ID ?? "";
const cdpKeySecret = process.env.CDP_API_KEY_SECRET ?? "";
if (isCdpFacilitator(facilitatorUrl) && !(cdpKeyId && cdpKeySecret)) {
  throw new Error(
    `X402_FACILITATOR_URL is Coinbase's CDP host (${facilitatorUrl}), which answers 401 without a key: ` +
      "set CDP_API_KEY_ID and CDP_API_KEY_SECRET, or no agent will be able to pay"
  );
}
// Undefined for the testnet host, which is its correct configuration rather
// than a missing setting -- @x402/core sends no auth headers when it is absent.
const createAuthHeaders = isCdpFacilitator(facilitatorUrl)
  ? makeCdpAuthHeaders({ keyId: cdpKeyId, secret: cdpKeySecret, facilitatorUrl })
  : undefined;

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
  // BEFORE ANYTHING ELSE: is MRO_CHAIN_ID the chain BASE_RPC_URL actually
  // serves? That id decides the network agents are quoted prices on and whether
  // a placeholder treasury may run, and nothing checked it against reality --
  // so a promotion that moved the RPC and the contract to mainnet and left the
  // id behind would boot cleanly, quote testnet USDC, and write real tokens.
  // Throws on a mismatch, and after three tries on an RPC that will not answer.
  // See chain/preflight.mjs for why an outage refuses rather than proceeds.
  await verifyChainId({ rpcUrl, chainId });

  // AND SECOND: can this build decode what that contract returns? read.mjs
  // decodes `viewOf` through the generated ABI and returns null when the decode
  // throws -- the same null an unreachable RPC produces -- so a contract whose
  // TokenView has moved makes `mint`, `status`, `/t/<id>`, `boundKeyOf` and
  // `freeIdFrom` all answer `chain-unavailable` permanently, with nothing in
  // the log saying why. The skew is knowable here, once, before the socket is
  // bound. Throws on a decode failure immediately, and after three tries on an
  // RPC that will not answer. See chain/preflight.mjs.
  const probe = await verifyDecoder({ rpcUrl, contract });
  console.error(`warden: decoder verified against ${contract} (viewOf returned ${Object.keys(probe).length} fields)`);

  // NOT A GATE. The treasury is validated for shape and checksum and nothing
  // else, so a valid-but-wrong address is invisible: settlements to it succeed.
  // Printing its balance every boot is what makes the first one attributable.
  const balance = await treasuryBalance({ network: paymentNetwork, treasury: treasuryAddress, rpcUrl });
  console.error(
    balance
      ? `warden: treasury ${treasuryAddress} holds ${balance.amount} ${balance.symbol} on chain ${chainId}`
      : `warden: treasury ${treasuryAddress} balance could not be read (chain ${chainId})`
  );

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
    createAuthHeaders,
    // What turns a reservation into a sale. Until this fires the row the tool
    // wrote is 'awaiting-payment' and the Clock will not touch it, so a
    // settlement that never lands costs the piece nothing and costs the agent
    // nothing.
    onSettled: (payNonce, tx) => {
      const moved = q.settleByNonce(payNonce, tx);
      if (moved) console.log(`warden: settled ${moved.kind} for token ${moved.tokenId} (${tx})`);
      return moved;
    },
    // And the other direction: a reservation whose settlement never happened is
    // released at once, so the agent is free to try again rather than waiting
    // for the row to age out.
    onUnsettled: (payNonce) => q.releaseReservation(payNonce),
  });

  // Ask it to build now. Without this a misconfigured facilitator or an
  // unsupported network stays invisible until the first paying agent hits it;
  // with it, the boot says so. warmUp never rejects and never blocks the listen
  // below.
  //
  // WHAT A FAILURE MEANS DEPENDS ON THE CHAIN, which is why the two are treated
  // differently. On Base Sepolia a dead facilitator is an inconvenience: the
  // gateway's retry is not sticky, so the piece heals itself the moment the
  // host comes back, and running on regardless is right. Anywhere real money
  // can arrive it means no agent can enter at all -- and the likeliest cause is
  // a credential this deploy got wrong, which will not heal by waiting. So it
  // exits, the same shape and for the same reason as the placeholder-treasury
  // refusal above.
  warmUp(paid).then((ready) => {
    if (ready) {
      console.log(`warden: payment ready (${paymentNetwork} via ${facilitatorUrl}, to ${treasuryAddress})`);
      return;
    }
    if (chainId !== BASE_SEPOLIA) {
      console.error(
        `warden: payment is NOT ready on chain ${chainId} via ${facilitatorUrl} -- ` +
          "refusing to run a piece nobody can enter. Check the facilitator url and its credentials."
      );
      process.exit(1);
    }
    console.log("warden: payment NOT ready -- mint and upgrade will refuse until the facilitator answers");
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
    // THE SUPPLY CAP IS NOT PASSED IN. It used to be the constant 10_000,
    // mirroring the contract's default, compared against this database's own
    // row count -- and both halves could disagree with the chain, because the
    // cap is an owner dial and the count is a fact about the mirror. `mint` and
    // `seed` read `supplyCap()` and `totalMinted()` from the chain instead, in
    // gates.mjs supplyBlock, like every other contract gate.
  });

  const server = createServer({
    stateDbPath,
    domain,
    challengeSecret,
    tokenView,
    // /t/<id> publishes these so a scanner can check the token against the
    // chain rather than against this service. createServer requires them.
    contract,
    chainId,
    mcp,
    allowRegistration: makeAllowRegistration(q),
    // The per-key budget on /mcp. createServer defaults to a real one, so this
    // is not load-bearing -- it is here so the policy this process runs is
    // named in the assembly rather than acquired by default.
    allowToolCall: makeAllowToolCall(),
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
