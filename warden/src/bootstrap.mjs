// The three pieces main.mjs assembles the real service out of.
//
// WHY THEY LIVE HERE AND NOT IN main.mjs. src/main.mjs is the only assembly
// that ever runs in production, and no test can import it: importing it opens
// a real database, binds a real socket and installs signal handlers as a side
// effect of module load. So everything main.mjs BUILT was, by construction,
// the only code in this service with no test at all -- while every test built
// a different configuration by hand. The end-to-end test passes
// `allowRegistration: () => true` and a pass-through `paid`; production passes
// a real limiter and a stub that refuses. Two halves each correct with nothing
// joining them is the exact shape of this build's worst defect (mint and
// upgrade were built, tested, and never registered on the MCP server).
//
// These three functions are pure factories -- no sockets, no database file, no
// child processes at import time -- so main.mjs stays a thin assembly and the
// policies it assembles are tested directly, as themselves.
import { execFile as nodeExecFile } from "node:child_process";
import { fileURLToPath } from "node:url";

/// The spec's registration dial: 20 per minute, per caller, and 10,000 keys in
/// total. Exported so a test asserts against the same numbers the service runs.
export const REGISTRATION_WINDOW_MS = 60_000;
export const REGISTRATION_MAX_PER_WINDOW = 20;
export const MAX_TOTAL_KEYS = 10_000;

/// Above this many tracked callers, prune every expired window rather than only
/// the caller's own. A flood of distinct thumbprints would otherwise leave one
/// Map entry behind for each, forever.
const SWEEP_ABOVE = 1024;

/**
 * Rate limiting for POST /keys.
 *
 * PER CALLER, not global. `registerRoute` now passes the RFC 7638 thumbprint of
 * the key being registered -- the one identity this endpoint has that the
 * caller cannot simply choose, because it is derived from a key it has just
 * proved possession of. A global window meant one caller's 20 requests locked
 * out every other agent in the world for the rest of the minute, and POST /keys
 * is the only way in for an agent with no domain of its own.
 *
 * Two limits, and they expire differently:
 *   - the sliding 60-second window lives in this process's memory, so it resets
 *     to empty on every restart;
 *   - the 10,000-key total is read live off the mirror with COUNT(*), so it
 *     does NOT reset, and it costs one integer rather than every stored JWK.
 *
 * `now` is injected so the window can be tested without waiting a minute.
 */
export function makeAllowRegistration(q, now = Date.now) {
  const windows = new Map();

  /// Drop timestamps that have fallen out of the window. Returns the same array.
  const prune = (at, stamps) => {
    while (stamps.length && at - stamps[0] > REGISTRATION_WINDOW_MS) stamps.shift();
    return stamps;
  };

  return function allowRegistration(keyId) {
    const at = now();

    if (windows.size > SWEEP_ABOVE) {
      for (const [id, stamps] of windows) {
        if (prune(at, stamps).length === 0) windows.delete(id);
      }
    }

    const stamps = prune(at, windows.get(keyId) ?? []);
    windows.set(keyId, stamps);
    if (stamps.length >= REGISTRATION_MAX_PER_WINDOW) return false;
    if (q.keyCount() >= MAX_TOTAL_KEYS) return false;
    stamps.push(at);
    return true;
  };
}

/**
 * The paid-tool wrapper `mint` and `upgrade` call through, when there is no
 * payment path yet.
 *
 * `makePaid()` in src/pay/x402.mjs is this project's real, tested seam for
 * this: it needs an x402ResourceServer and an `accepts` list. Building a real
 * one was attempted and abandoned, for two reasons checked by hand on
 * 2026-08-30, not guessed:
 *
 * 1. x402ResourceServer needs a payment SCHEME registered before it can build
 *    requirements for a network. @x402/evm's ExactEvmScheme is what knows how
 *    to accept USDC on an EVM chain (Base) -- it is a devDependency of
 *    @x402/mcp in this project's own lockfile, not an installed runtime
 *    dependency here: `import("@x402/evm")` throws ERR_MODULE_NOT_FOUND, and
 *    node_modules/@x402/evm does not exist. Adding a new npm dependency is not
 *    the bootstrap's call to make.
 * 2. Even reaching that point is worse than skipping it.
 *    x402ResourceServer.initialize() makes a LIVE HTTP call to the facilitator
 *    to fetch its supported payment kinds, and THROWS if that call fails (read
 *    directly out of @x402/core's initialize()) -- which would make the WHOLE
 *    PROCESS's startup, not just the two paid tools, depend on reaching a
 *    specific third-party host. And with no scheme registered,
 *    buildPaymentRequirements() returns an EMPTY accepts array rather than
 *    throwing, while createPaymentWrapper THROWS SYNCHRONOUSLY on an empty
 *    accepts array ("PaymentWrapperConfig.accepts must have at least one
 *    payment requirement" -- reproduced by hand). So the real path crashes the
 *    process at startup either way.
 *
 * So this fails closed, locally, with no network call: every paid tool call is
 * REFUSED, and refused as a structured value rather than a throw, because a
 * throw would be reported to the agent as "internal" and tell it nothing. Never
 * a crash, and never a free mint or Mark. Wiring the real path needs @x402/evm
 * added as a dependency and its ExactEvmScheme registered on a resourceServer
 * -- left for whoever picks up real payment collection.
 */
export function makePaidStub() {
  return (_handler) => async () => ({ ok: false, reason: "payment-not-configured" });
}

/// The solver child process's own file. worker.mjs documents its invocation as
/// `node --max-old-space-size=768 src/solve/worker.mjs <domain> <tokenId>` and
/// reads `process.argv.slice(2)` as `[domain, tokenId]`; makeSpawnSolve builds
/// exactly that.
export const WORKER_PATH = fileURLToPath(new URL("./solve/worker.mjs", import.meta.url));

/// Node's own ceiling for a solve, and the wall-clock cap on one. A robust
/// QArt solve measured 9,695 ms and 532 MB resident on 2026-08-30.
export const SOLVE_HEAP_ARG = "--max-old-space-size=768";
export const SOLVE_TIMEOUT_MS = 60_000;

/**
 * Build the `spawn(tokenId)` that runSolver drains the queue with.
 *
 * A CHILD PROCESS, not a call in this process -- queue.mjs's own header is why:
 * one solve measured 532 MB resident and about ten seconds, Node runs one
 * thread, and only a process exit actually returns resvg's native buffers.
 * `process.execPath` (not a bare "node") is what this process itself was
 * launched with, so it works under PM2's pinned interpreter the same way it
 * works from a shell with nvm sourced.
 *
 * `execFileImpl` is injected ONLY so a test can read back the argv this builds
 * without running a ten-second, half-gigabyte solve. Production takes the
 * default.
 */
export function makeSpawnSolve(forDomain, execFileImpl = nodeExecFile) {
  return (tokenId) =>
    new Promise((resolve, reject) => {
      execFileImpl(
        process.execPath,
        [SOLVE_HEAP_ARG, WORKER_PATH, forDomain, String(tokenId)],
        { timeout: SOLVE_TIMEOUT_MS },
        (err, stdout, stderr) => {
          if (err) return reject(new Error(String(stderr ?? "").trim() || err.message));
          let result;
          try {
            result = JSON.parse(String(stdout).trim().split("\n").pop());
          } catch {
            return reject(new Error(`worker produced no parseable result: ${String(stdout).slice(0, 200)}`));
          }
          if (!result.ok) return reject(new Error("worker reported failure"));
          resolve(result);
        }
      );
    });
}
