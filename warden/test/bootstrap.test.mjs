// The assembly nothing tested.
//
// src/main.mjs is the only configuration of this service that ever runs in
// production, and no test can import it -- importing it opens a real database,
// binds a real socket and installs signal handlers at module load. So every
// policy main.mjs built was, by construction, the one part of this service
// with no test at all, while each test built a DIFFERENT configuration by
// hand: the end-to-end test passes `allowRegistration: () => true` and a
// pass-through `paid`, where production passes a real limiter and a stub that
// refuses. Two halves each correct with nothing joining them is exactly how
// `mint` and `upgrade` came to be built, tested, and never registered.
//
// The three factories now live in src/bootstrap.mjs, main.mjs imports them,
// and this file drives them directly -- including through the real `mint` and
// `upgrade` tools, so the join itself is what is under test and not just the
// pieces.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  makeAllowRegistration,
  makePaidStub,
  makeSpawnSolve,
  MAX_TOTAL_KEYS,
  REGISTRATION_MAX_PER_WINDOW,
  REGISTRATION_WINDOW_MS,
  SOLVE_HEAP_ARG,
  SOLVE_TIMEOUT_MS,
  WORKER_PATH, makeAllowToolCall, MCP_MAX_PER_WINDOW, MCP_WINDOW_MS } from "../src/bootstrap.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { openChain } from "./chain-stub.mjs";

// -- the registration limiter ---------------------------------------------

/// A clock the test advances by hand, so the sliding window is exercised
/// without ever waiting a real minute.
function fakeClock(start = 1_000_000) {
  const clock = { now: start, tick: (ms) => (clock.now += ms) };
  return clock;
}

/// A mirror stub that answers keyCount and FAILS LOUDLY if the limiter reaches
/// for allKeys -- which returns every stored row, JWK JSON included, just to
/// read one integer. This box has been OOM-killed twice.
const countingMirror = (n = 0) => ({
  keyCount: () => n,
  allKeys: () => { throw new Error("the limiter must count with COUNT(*), never allKeys()"); },
});

test("the limiter allows exactly the window's worth and then refuses", () => {
  const clock = fakeClock();
  const allow = makeAllowRegistration(countingMirror(0), () => clock.now);
  for (let i = 0; i < REGISTRATION_MAX_PER_WINDOW; i++) {
    assert.equal(allow("key-a"), true, `registration ${i + 1} should be allowed`);
  }
  assert.equal(allow("key-a"), false, "the 21st in one minute is refused");
});

test("one key exhausting its budget does not block a different key", () => {
  const clock = fakeClock();
  const allow = makeAllowRegistration(countingMirror(0), () => clock.now);
  for (let i = 0; i < REGISTRATION_MAX_PER_WINDOW; i++) allow("noisy-key");
  assert.equal(allow("noisy-key"), false);

  // THE WHOLE POINT OF THE FIX. The old limiter was global, so one caller's
  // twenty requests closed the only unsigned way in for every other agent.
  assert.equal(allow("quiet-key"), true, "a different key must have its own budget");
});

test("the window slides: the budget returns once the minute has passed", () => {
  const clock = fakeClock();
  const allow = makeAllowRegistration(countingMirror(0), () => clock.now);
  for (let i = 0; i < REGISTRATION_MAX_PER_WINDOW; i++) allow("key-a");
  assert.equal(allow("key-a"), false);

  // Still inside the window at exactly its length -- the check is strictly
  // greater-than, so the boundary is not a free extra registration.
  clock.tick(REGISTRATION_WINDOW_MS);
  assert.equal(allow("key-a"), false, "the window boundary must not release the budget early");

  clock.tick(1);
  assert.equal(allow("key-a"), true, "one millisecond past the window, the oldest slot is free");
});

test("the 10,000-key total cap refuses every key, whatever its own budget says", () => {
  const clock = fakeClock();
  const allow = makeAllowRegistration(countingMirror(MAX_TOTAL_KEYS), () => clock.now);
  assert.equal(allow("a-brand-new-key"), false);
  // One below the cap, the same key is admitted -- so the refusal above is the
  // cap and not something else.
  const under = makeAllowRegistration(countingMirror(MAX_TOTAL_KEYS - 1), () => clock.now);
  assert.equal(under("a-brand-new-key"), true);
});

test("the limiter reads the real mirror, and keyCount matches what is stored", () => {
  const q = queries(openDb(":memory:"));
  assert.equal(q.keyCount(), 0);
  q.insertKey({ keyId: "k1", jwk: { kty: "OKP" }, directory: null, registeredAt: 1 });
  q.insertKey({ keyId: "k2", jwk: { kty: "OKP" }, directory: null, registeredAt: 2 });
  assert.equal(q.keyCount(), 2);
  assert.equal(q.keyCount(), q.allKeys().length, "COUNT(*) and the rows must agree");

  const allow = makeAllowRegistration(q);
  assert.equal(allow("k3"), true);
});

test("a refused registration is not remembered as a spent slot", () => {
  const clock = fakeClock();
  const allow = makeAllowRegistration(countingMirror(MAX_TOTAL_KEYS), () => clock.now);
  // Refused a hundred times by the total cap. When the cap lifts, the key must
  // still have its whole minute's budget: a refusal is not a registration.
  for (let i = 0; i < 100; i++) assert.equal(allow("key-a"), false);
  const lifted = makeAllowRegistration(countingMirror(0), () => clock.now);
  for (let i = 0; i < REGISTRATION_MAX_PER_WINDOW; i++) assert.equal(lifted("key-a"), true);
});

// -- the paid stub ---------------------------------------------------------

test("the paid stub refuses, and never runs the handler it wraps", async () => {
  const paid = makePaidStub();
  let handlerRan = false;
  const wrapped = paid(async () => { handlerRan = true; return { ok: true, freeMint: true }; });

  const result = await wrapped({ to: "0x" + "1".repeat(40) }, { keyId: "k1" });
  assert.deepEqual(result, { ok: false, reason: "payment-not-configured" });
  assert.equal(handlerRan, false, "an unsettled call must never reach the work it would pay for");
});

// A refusal, not a throw. A throw is caught by mcp/server.mjs and reported to
// the agent as `{ ok: false, reason: "internal" }`, which tells it nothing
// about what to do -- and a crash would take the process with it.
test("the paid stub refuses as a value rather than throwing", async () => {
  const wrapped = makePaidStub()(async () => ({ ok: true }));
  await assert.doesNotReject(() => wrapped({}, {}));
});

// THE JOIN, through the real tools rather than beside them. This is the
// configuration production actually runs.
test("mint under the production paid stub refuses and writes nothing", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const tool = makeMintTool({ q, chain: openChain(), paid: makePaidStub(), supplyCap: 10, today: () => 100 });

  const r = await tool.handler({ to: "0x" + "1".repeat(40) }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "payment-not-configured");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0, "no free token");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0, "no free mint row");
});

test("upgrade under the production paid stub refuses and reserves no mark", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: makePaidStub(),
  });

  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "payment-not-configured");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mark_orders").get().n, 0, "no free Mark");
});

// -- the solver spawn ------------------------------------------------------

/// A stand-in for node:child_process.execFile that records what it was asked to
/// run and then answers however the test wants. Nothing is spawned: a real
/// solve is about ten seconds and 532 MB.
function recordingExecFile(reply) {
  const calls = [];
  const impl = (file, args, options, cb) => {
    calls.push({ file, args, options });
    reply(cb);
  };
  return { calls, impl };
}

test("the spawn builds the argv worker.mjs actually reads", async () => {
  const solved = { ok: true, hex: "ab", mask: 3, match: 0.9 };
  const { calls, impl } = recordingExecFile((cb) => cb(null, JSON.stringify(solved) + "\n", ""));
  const spawn = makeSpawnSolve("example.com", impl);

  const result = await spawn(42);
  assert.deepEqual(result, solved);
  assert.equal(calls.length, 1);

  const call = calls[0];
  // The interpreter is THIS process's own, so it works under PM2's pinned
  // interpreter exactly as it does from a shell with nvm sourced.
  assert.equal(call.file, process.execPath);
  assert.deepEqual(call.args, [SOLVE_HEAP_ARG, WORKER_PATH, "example.com", "42"]);
  assert.equal(call.options.timeout, SOLVE_TIMEOUT_MS);
  // The token id is a STRING on the command line -- argv has no other kind.
  assert.equal(typeof call.args[3], "string");
});

// The argv above is only right if it is what the worker reads. This asserts
// against the worker's own source rather than against a copy of the contract,
// so a change to either side breaks this test.
test("worker.mjs reads exactly the two positional arguments the spawn passes", () => {
  const source = readFileSync(WORKER_PATH, "utf8");
  assert.ok(WORKER_PATH.endsWith("/src/solve/worker.mjs"), WORKER_PATH);
  assert.match(source, /const \[domain, tokenId\] = process\.argv\.slice\(2\);/);
  // Its documented invocation and the heap flag the spawn passes are the same.
  assert.ok(source.includes(SOLVE_HEAP_ARG), "worker.mjs documents a different heap size");
});

test("a worker that exits non-zero rejects with its stderr, not a bare exit code", async () => {
  const { impl } = recordingExecFile((cb) => cb(new Error("Command failed"), "", "solve failed for token 42: no solution\n"));
  await assert.rejects(makeSpawnSolve("example.com", impl)(42), /solve failed for token 42: no solution/);
});

test("a worker that prints nothing parseable rejects rather than resolving undefined", async () => {
  const { impl } = recordingExecFile((cb) => cb(null, "not json at all", ""));
  await assert.rejects(makeSpawnSolve("example.com", impl)(42), /no parseable result/);
});

test("a worker reporting ok:false rejects, so the row is failed and retried", async () => {
  const { impl } = recordingExecFile((cb) => cb(null, JSON.stringify({ ok: false }) + "\n", ""));
  await assert.rejects(makeSpawnSolve("example.com", impl)(42), /worker reported failure/);
});

// Diagnostics go to stderr by the worker's own contract, but a stray line on
// stdout must not break the read: the RESULT is the last line.
test("the result is read from the last line of stdout", async () => {
  const { impl } = recordingExecFile((cb) =>
    cb(null, "some noise\n" + JSON.stringify({ ok: true, hex: "cd" }) + "\n", ""));
  assert.deepEqual(await makeSpawnSolve("example.com", impl)(1), { ok: true, hex: "cd" });
});

// 14.6. /mcp had no limiter of any kind. These are the mechanics; the wiring
// -- that the route consults it, after admission, keyed on the VERIFIED key id
// -- is asserted in door.test.mjs against a real HTTP request.
test("the tool-call budget is per key, and refills as the window slides", () => {
  let now = 0;
  const allow = makeAllowToolCall(() => now);

  for (let i = 0; i < MCP_MAX_PER_WINDOW; i++) {
    assert.equal(allow("k1"), true, `call ${i + 1} must be allowed`);
  }
  assert.equal(allow("k1"), false, "the budget is spent");

  // One caller's loop must not shut anybody else out. That is the whole reason
  // this is keyed rather than global -- the same mistake POST /keys once made.
  assert.equal(allow("k2"), true);

  // Sliding, not fixed: the oldest call ages out and one slot returns.
  now += MCP_WINDOW_MS + 1;
  assert.equal(allow("k1"), true);
});
