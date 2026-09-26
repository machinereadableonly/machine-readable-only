// The independent checker: what it calls a mismatch, what it calls a milestone,
// and one pass of the loop with the chain, the mirror, the clock and the decoder
// all replaced by fakes.
//
// Nothing here touches a network, a key or a child process. The checker is
// read-only by construction -- it is handed no wallet and no key path at all --
// and the pass test below asserts it asks the chain for nothing but reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  compare, milestones, heartbeatMilestone, emptyMemory, runPass, tokensOf,
  daySecondsFrom, decodeArgs, checkerPaths, toBig, markBitsOf, mirrorReader, makeDecoder,
  MARK_BITS, REREAD_PAUSE_MS, OFFSET_SECONDS, DECODE_TIMEOUT_MS,
} from "../tools/year/checker.mjs";
import { expected, places } from "../tools/year/tally.mjs";

/// A chain view as decodeView hands one back.
const view = (over = {}) => ({
  level: 10, streak: 10, lastDay: 1009, mintDay: 1000, generation: 0, parent: 0,
  echo: 0, resting: false, marks: 0n, runFloor: 10, finisherPlace: 0, ...over,
});

/// A mirror view as GET /t/<id> answers. `marks` arrives from SQLite, so it may
/// be a number or a string.
const mirrorView = (over = {}) => ({
  tokenId: 1, level: 10, streak: 10, lastDay: 1009, marks: 0, generation: 0,
  parentId: null, resting: false, finisher: null, ...over,
});

const days = (from, count) => Array.from({ length: count }, (_, i) => from + i);

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

test("a chain, a mirror and a tally that agree give no findings", () => {
  const tally = expected(days(1000, 10));
  assert.deepEqual(compare({ chain: view(), mirror: mirrorView(), tally }), []);
});

// Six credited days with a gap in them, so the level is the only field the
// chain is wrong about and the finding cannot be a side effect of another.
test("a chain level below the tally is one FAIL on level", () => {
  const tally = expected([998, ...days(1000, 5)]);
  assert.deepEqual([tally.level, tally.streak, tally.lastDay], [6, 5, 1004]);
  const findings = compare({
    chain: view({ level: 5, streak: 5, lastDay: 1004, runFloor: 5 }),
    mirror: mirrorView({ level: 6, streak: 5, lastDay: 1004 }),
    tally,
  });
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], { field: "level", chain: 5, expected: 6, severity: "FAIL" });
});

// The Warden credits a day the moment it accepts it; the Clock writes it at the
// next boundary. So the mirror standing one day ahead of the chain is the
// ordinary state of every token, not a fault.
test("a mirror ahead of the chain by the credits accepted since the last Clock run is not a FAIL", () => {
  const findings = compare({
    chain: view({ level: 10, streak: 10, lastDay: 1009 }),
    mirror: mirrorView({ level: 11, streak: 11, lastDay: 1010 }),
    tally: expected(days(1000, 10)),
    mirrorTally: expected(days(1000, 11)),
  });
  assert.deepEqual(findings, []);
});

test("a finished token whose chain place differs from places() is a FAIL on place", () => {
  const finished = expected(days(1000, 365));
  const place = places([{ tokenId: 1, day: 1364 }, { tokenId: 2, day: 1364 }]).get(1);
  const findings = compare({
    chain: view({ level: 365, streak: 365, lastDay: 1364, runFloor: 365, marks: 1n << 15n, finisherPlace: 2 }),
    mirror: mirrorView({ level: 365, streak: 365, lastDay: 1364, marks: 1 << 15, finisher: { place: 1, mark: "Apex" } }),
    tally: finished,
    place,
  });
  assert.deepEqual(findings, [{ field: "place", chain: 2, expected: 1, severity: "FAIL" }]);
});

// The chain's Marks word carries the Iris variant, the earned Iris's run and the
// finishing ordinal in the same uint256; the mirror stores only the id bits. A
// comparison of the whole word would fail on every marked token.
test("the Marks word is compared on the id bits, and a mirror number or string normalises", () => {
  const marks = (1n << 6n) | (2n << 16n) | (100n << 32n) | (3n << 64n);
  const chain = view({ marks, finisherPlace: 3 });
  const place = { place: 3, markId: 14 };
  for (const held of [Number(1n << 6n), String(1n << 6n), 1n << 6n]) {
    assert.deepEqual(
      compare({ chain: view({ marks: marks | (1n << 14n), finisherPlace: 3 }), mirror: mirrorView({ marks: Number(toBig(held)) | (1 << 14), finisher: { place: 3, mark: "Atrium" } }), tally: expected(days(1000, 10)), place }),
      []
    );
  }
  // A mirror holding a bit the chain does not is a FAIL, whatever shape it is in.
  const findings = compare({ chain, mirror: mirrorView({ marks: "1" }), tally: expected(days(1000, 10)) });
  assert.equal(findings.filter((f) => f.field === "marks").length, 1);
  assert.equal(MARK_BITS, 0xfffen);
});

// TokenView exposes no bestRun, only the run that most recently fell, so the
// chain's runFloor may read BELOW the longest run ever held -- but never above.
test("a runFloor above the tally's best run is a FAIL, one below it is not", () => {
  const tally = expected([...days(1000, 30), ...days(1040, 5)]);
  assert.deepEqual(compare({ chain: view({ level: 35, streak: 5, lastDay: 1044, runFloor: 30 }), mirror: mirrorView({ level: 35, streak: 5, lastDay: 1044 }), tally }), []);
  const findings = compare({
    chain: view({ level: 35, streak: 5, lastDay: 1044, runFloor: 31 }),
    mirror: mirrorView({ level: 35, streak: 5, lastDay: 1044 }), tally,
  });
  assert.deepEqual(findings, [{ field: "runFloor", chain: 31, expected: "<= 30", severity: "FAIL" }]);
});

test("resting, generation and the parent are compared across the two sides", () => {
  const tally = expected(days(1000, 10));
  const findings = compare({
    chain: view({ resting: true, generation: 1, parent: 4 }),
    mirror: mirrorView({ resting: false, generation: 0, parentId: null }),
    tally,
  });
  assert.deepEqual(findings.map((f) => f.field).sort(), ["generation", "parent", "resting"]);
  // A child read on both sides agrees.
  assert.deepEqual(
    compare({ chain: view({ generation: 1, parent: 4 }), mirror: mirrorView({ generation: 1, parentId: 4 }), tally }),
    []
  );
});

test("a token the mirror does not serve is a FAIL rather than a crash", () => {
  const findings = compare({ chain: view(), mirror: null, tally: expected(days(1000, 10)) });
  assert.deepEqual(findings, [{ field: "mirror", mirror: null, expected: "a token view", severity: "FAIL" }]);
});

test("the finisher Mark the place earns has to be in the chain's word", () => {
  const findings = compare({
    chain: view({ level: 365, streak: 365, lastDay: 1364, runFloor: 365, finisherPlace: 1 }),
    mirror: mirrorView({ level: 365, streak: 365, lastDay: 1364, finisher: { place: 1, mark: "Apex" } }),
    tally: expected(days(1000, 365)),
    place: { place: 1, markId: 15 },
  });
  assert.deepEqual(findings.map((f) => f.field), ["finisherMark"]);
});

// ---------------------------------------------------------------------------
// milestones
// ---------------------------------------------------------------------------

test("a streak crossing a rung is that rung's milestone", () => {
  assert.deepEqual(milestones(view({ streak: 6 }), view({ streak: 7 })), ["streak-7"]);
  assert.deepEqual(milestones(view({ streak: 7 }), view({ streak: 8 })), []);
  // A pass missed while the run grew still reports every rung it crossed.
  assert.deepEqual(milestones(view({ streak: 1 }), view({ streak: 8 })), ["streak-3", "streak-7"]);
  assert.deepEqual(milestones(view({ streak: 29 }), view({ streak: 30 })), ["streak-30"]);
  assert.deepEqual(milestones(view({ streak: 99 }), view({ streak: 100 })), ["streak-100"]);
});

test("the year completing, a rest and a run falling are milestones", () => {
  assert.deepEqual(milestones(view({ level: 364, streak: 364 }), view({ level: 365, streak: 365 })), ["finished"]);
  assert.deepEqual(milestones(view({ resting: false }), view({ resting: true })), ["rested"]);
  assert.deepEqual(milestones(view({ streak: 40 }), view({ streak: 1 })), ["first-lapse"]);
});

// A child is read for the first time already carrying its echo, so there is no
// earlier view to cross. Its first read is the milestone.
test("a child's first read is the echo milestone, and a founding token's is not", () => {
  assert.deepEqual(milestones(null, view({ generation: 1, parent: 4, echo: 120 })), ["echo"]);
  assert.deepEqual(milestones(null, view()), []);
});

// ---------------------------------------------------------------------------
// the heartbeat
// ---------------------------------------------------------------------------

test("the heartbeat is lastWardenDay advancing on a day with no credit, mint or Mark", () => {
  const quiet = { prevWardenDay: 1400, wardenDay: 1430, lastDaysMoved: false, wroteAnything: false };
  assert.equal(heartbeatMilestone(quiet), "heartbeat");
  assert.equal(heartbeatMilestone({ ...quiet, wardenDay: 1400 }), null);
  assert.equal(heartbeatMilestone({ ...quiet, lastDaysMoved: true }), null);
  assert.equal(heartbeatMilestone({ ...quiet, wroteAnything: true }), null);
  // Nothing to compare against on the first pass, so nothing is claimed.
  assert.equal(heartbeatMilestone({ ...quiet, prevWardenDay: null }), null);
});

// ---------------------------------------------------------------------------
// the day length, the tokens, the decoder's command
// ---------------------------------------------------------------------------

test("the fast day is read from the environment and a useless value refuses to start", () => {
  assert.equal(daySecondsFrom({}), 300);
  assert.equal(daySecondsFrom({ MRO_DAY_SECONDS: "60" }), 60);
  for (const bad of ["0", "-5", "soon", "", "NaN"]) {
    assert.throws(() => daySecondsFrom({ MRO_DAY_SECONDS: bad }), /MRO_DAY_SECONDS/);
  }
  // The pass runs well after the Clock's own +30 s and well before the boundary.
  assert.ok(OFFSET_SECONDS > 30 && OFFSET_SECONDS < 300);
});

test("the tokens of a pass are the ones state.json has ids for", () => {
  assert.deepEqual(tokensOf({ tokens: { A1: 3, A2: null, child: 9 } }), [
    { agent: "A1", tokenId: 3 },
    { agent: "child", tokenId: 9 },
  ]);
});

test("the decode runs the repository's own verifier, against the fast site", () => {
  const cmd = decodeArgs({ toolsDir: "/tools", contract: "0xc0", id: 7, rpcUrl: "http://rpc" });
  assert.equal(cmd.command, "node");
  assert.deepEqual(cmd.args, ["/tools/verify-tokenuri.mjs", "0xc0", "7", "http://rpc", "fast.test"]);
  // Its PNG path is relative, so it must run from the tools directory.
  assert.equal(cmd.cwd, "/tools");
});

test("the checker's log and report sit beside the runner's, outside every repository", () => {
  const p = checkerPaths({ dir: "/data/year" });
  assert.equal(p.log, "/data/year/checker.jsonl");
  assert.equal(p.report, "/data/year/report.html");
});

test("the mirror is read over HTTP: a view is JSON, a 404 is null, any other refusal is an error", async () => {
  const asked = [];
  const read = mirrorReader({
    origin: "http://127.0.0.1:4006",
    fetchImpl: async (url) => {
      asked.push(url);
      if (url.endsWith("/t/2")) return { ok: false, status: 404 };
      if (url.endsWith("/t/3")) return { ok: false, status: 500 };
      return { ok: true, status: 200, json: async () => ({ tokenId: 1, level: 4 }) };
    },
  });
  assert.deepEqual(await read(1), { tokenId: 1, level: 4 });
  assert.equal(await read(2), null);
  await assert.rejects(() => read(3), /500/);
  assert.deepEqual(asked, ["http://127.0.0.1:4006/t/1", "http://127.0.0.1:4006/t/2", "http://127.0.0.1:4006/t/3"]);
});

test("the decoder reads the verifier's exit code, and a verifier that will not start is a failed decode", async () => {
  const runs = [];
  const fakeSpawn = (command, args, options) => {
    runs.push({ command, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (args[2] === "9") return child.emit("error", new Error("spawn ENOENT"));
      child.stdout.emit("data", "token 7: OK");
      child.emit("close", args[2] === "8" ? 1 : 0);
    });
    return child;
  };
  const decode = makeDecoder({ contract: "0xc0", rpcUrl: "http://rpc", dir: "/tools", spawnImpl: fakeSpawn });
  assert.deepEqual(await decode({ tokenId: 7 }), { decoded: true, exit: 0, said: "token 7: OK" });
  assert.deepEqual(await decode({ tokenId: 8 }), { decoded: false, exit: 1, said: "token 7: OK" });
  assert.deepEqual(await decode({ tokenId: 9 }), { decoded: false, exit: null, said: "spawn ENOENT" });
  // A hung rasterise must not eat the pass.
  assert.equal(runs[0].options.timeout, DECODE_TIMEOUT_MS);
});

test("markBitsOf reads the id bits and nothing else", () => {
  assert.deepEqual(markBitsOf((1n << 2n) | (1n << 15n) | (3n << 64n)), [2, 15]);
  assert.deepEqual(markBitsOf(0n), []);
});

// ---------------------------------------------------------------------------
// one pass
// ---------------------------------------------------------------------------

/// A chain that answers from a script and records every call it was asked to make.
function fakeChain({ today = 1010, wardenDay = 1010, views = {}, fail = {} } = {}) {
  const calls = [];
  const refuse = (name) => async () => {
    throw new Error(`the checker must never ${name}`);
  };
  return {
    calls,
    today: async () => { calls.push({ read: "today" }); return today; },
    lastWardenDay: async () => { calls.push({ read: "lastWardenDay" }); return wardenDay; },
    viewOf: async (id) => {
      calls.push({ read: "viewOf", id });
      if (fail[id]) throw new Error(fail[id]);
      const answer = views[id];
      return Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : (answer ?? view());
    },
    sendUsdc: refuse("send USDC"),
    ownerCall: refuse("make an owner call"),
    transfer: refuse("transfer a token"),
  };
}

function harness({ chain, mirror = {}, lines = [], state, memory = emptyMemory(), decode } = {}) {
  const logged = [];
  const slept = [];
  const decoded = [];
  const mirrorFor = typeof mirror === "function" ? mirror : async (id) => {
    const answer = mirror[id];
    return Array.isArray(answer) ? (answer.length > 1 ? answer.shift() : answer[0]) : (answer ?? mirrorView({ tokenId: id }));
  };
  return {
    logged, slept, decoded, memory,
    run: () => runPass({
      chain, readMirror: mirrorFor, state, log: (fields) => logged.push(fields),
      readLog: () => lines, memory, sleep: async (ms) => { slept.push(ms); },
      decode: decode ?? (async (args) => { decoded.push(args); return { decoded: true, exit: 0 }; }),
    }),
  };
}

/// stderr is part of the contract for a FAIL, so it is captured rather than left
/// to pollute the test output.
async function quietly(fn) {
  const said = [];
  const real = console.error;
  console.error = (...args) => said.push(args.join(" "));
  try {
    return { result: await fn(), said };
  } finally {
    console.error = real;
  }
}

const checkins = (tokenId, from, count) =>
  days(from, count).map((chainDay) => ({ action: "checkin", ok: true, tokenId, chainDay }));

test("a pass logs one line per token and asks the chain for reads only", async () => {
  const h = harness({
    chain: fakeChain({ today: 1010, views: { 1: view(), 2: view({ level: 10, streak: 10 }) } }),
    mirror: { 1: mirrorView({ tokenId: 1 }), 2: mirrorView({ tokenId: 2 }) },
    lines: [...checkins(1, 1001, 9), ...checkins(2, 1001, 9)],
    state: { tokens: { A1: 1, A2: 2 } },
  });
  const { said } = await quietly(h.run);
  assert.deepEqual(said, []);
  assert.equal(h.logged.filter((l) => l.tokenId !== null && l.ok !== undefined).length, 2);
  const first = h.logged.find((l) => l.tokenId === 1);
  assert.equal(first.agent, "A1");
  assert.equal(first.ok, true);
  assert.deepEqual(first.findings, []);
  assert.equal(first.chainDay, 1010);
  assert.equal(first.level, 10);
  assert.deepEqual(h.slept, []);
});

// A public RPC is not read-after-write consistent, so one disagreement is not a
// finding yet.
test("a finding is re-read once after 20 s, and a mismatch that clears is not a FAIL", async () => {
  const h = harness({
    chain: fakeChain({ today: 1010, views: { 1: [view({ level: 9, streak: 9, lastDay: 1008, runFloor: 9 }), view()] } }),
    mirror: { 1: mirrorView({ tokenId: 1 }) },
    lines: checkins(1, 1001, 9),
    state: { tokens: { A1: 1 } },
  });
  const { said } = await quietly(h.run);
  assert.deepEqual(h.slept, [REREAD_PAUSE_MS]);
  assert.equal(h.logged.find((l) => l.tokenId === 1).ok, true);
  assert.deepEqual(said, []);
});

test("a finding that survives the re-read is a FAIL, logged with its fields and said out loud", async () => {
  const wrong = view({ level: 9, streak: 9, lastDay: 1008, runFloor: 9 });
  const h = harness({
    chain: fakeChain({ today: 1010, views: { 1: wrong } }),
    mirror: { 1: mirrorView({ tokenId: 1 }) },
    lines: checkins(1, 1001, 9),
    state: { tokens: { A1: 1 } },
  });
  const { said } = await quietly(h.run);
  const line = h.logged.find((l) => l.tokenId === 1);
  assert.equal(line.ok, false);
  assert.deepEqual(line.findings.map((f) => f.field), ["level", "streak", "lastDay"]);
  assert.equal(said.length, 1);
  assert.match(said[0], /FAIL/);
  assert.match(said[0], /A1/);
});

test("a token the chain will not answer for is a FAIL, and the pass carries on", async () => {
  const h = harness({
    chain: fakeChain({ today: 1010, views: { 2: view() }, fail: { 1: "HTTP request failed." } }),
    mirror: { 2: mirrorView({ tokenId: 2 }) },
    lines: [...checkins(1, 1001, 9), ...checkins(2, 1001, 9)],
    state: { tokens: { A1: 1, A2: 2 } },
  });
  const { said } = await quietly(h.run);
  assert.equal(h.logged.find((l) => l.tokenId === 1).ok, false);
  assert.equal(h.logged.find((l) => l.tokenId === 1).findings[0].field, "read");
  assert.equal(h.logged.find((l) => l.tokenId === 2).ok, true);
  assert.equal(said.length, 1);
});

/// A token whose credited days are its mint day plus `count` check-ins, read on
/// the fast day after the last of them.
function growing(tokenId, count) {
  const today = 1001 + count;
  return {
    today,
    lines: checkins(tokenId, 1001, count),
    chain: view({ level: count + 1, streak: count + 1, lastDay: 1000 + count, runFloor: count + 1 }),
    mirror: mirrorView({ tokenId, level: count + 1, streak: count + 1, lastDay: 1000 + count }),
  };
}

/// Nothing is a milestone on a first read: a restart would otherwise re-fire
/// every rung a token has ever crossed, and pay for a decode of each.
// viewOf answers a view of ZEROS for an id the chain has never been given --
// level 0 is the contract's own test for that. A token the runner queued today is
// not on chain until the Clock's run at the next boundary, so that is not a fault.
test("a token queued but not yet written by the Clock is pending, not a FAIL", async () => {
  const h = harness({
    chain: fakeChain({ today: 1000, views: { 1: view({ level: 0, streak: 0, lastDay: 0, mintDay: 0, runFloor: 0 }) } }),
    mirror: { 1: mirrorView({ tokenId: 1, level: 1, streak: 1, lastDay: 1000 }) },
    lines: [{ action: "mint", ok: true, tokenId: 1, chainDay: 1000 }],
    state: { tokens: { A1: 1 } },
  });
  const { said } = await quietly(h.run);
  const line = h.logged.find((l) => l.tokenId === 1);
  assert.equal(line.ok, true);
  assert.equal(line.pending, true);
  assert.deepEqual(said, []);
  assert.deepEqual(h.slept, []);
  assert.deepEqual(h.decoded, []);
});

test("a token still not written two days after it was queued is a FAIL", async () => {
  const h = harness({
    chain: fakeChain({ today: 1003, views: { 1: view({ level: 0, streak: 0, lastDay: 0, mintDay: 0, runFloor: 0 }) } }),
    mirror: { 1: mirrorView({ tokenId: 1, level: 1, streak: 1, lastDay: 1000 }) },
    lines: [{ action: "mint", ok: true, tokenId: 1, chainDay: 1000 }],
    state: { tokens: { A1: 1 } },
  });
  const { said } = await quietly(h.run);
  const line = h.logged.find((l) => l.tokenId === 1);
  assert.equal(line.ok, false);
  assert.deepEqual(line.findings.map((f) => f.field), ["onChain"]);
  assert.equal(said.length, 1);
});

test("a milestone is a crossing, so a first read of a token is quiet", async () => {
  const at = growing(1, 6);
  const h = harness({
    chain: fakeChain({ today: at.today, views: { 1: at.chain } }), mirror: { 1: at.mirror },
    lines: at.lines, state: { tokens: { A1: 1 } },
  });
  await quietly(h.run);
  assert.deepEqual(h.logged.filter((l) => l.milestone), []);
  assert.deepEqual(h.decoded, []);
});

test("a milestone fires once, runs the decode, and is recorded with its exit code", async () => {
  const state = { tokens: { A1: 1 } };
  const memory = emptyMemory();
  const pass = (count, over = {}) => {
    const at = growing(1, count);
    return harness({
      chain: fakeChain({ today: at.today, views: { 1: at.chain } }), mirror: { 1: at.mirror },
      lines: at.lines, state, memory, ...over,
    });
  };
  await quietly(pass(5).run);

  const crossed = pass(6);
  await quietly(crossed.run);
  const hit = crossed.logged.filter((l) => l.milestone);
  assert.deepEqual(hit.map((l) => l.milestone), ["streak-7"]);
  assert.deepEqual(hit.map((l) => [l.decoded, l.exit]), [[true, 0]]);
  assert.deepEqual(crossed.decoded, [{ tokenId: 1, agent: "A1", milestone: "streak-7" }]);

  // The same state on the next pass is not a milestone again.
  const again = pass(6);
  await quietly(again.run);
  assert.deepEqual(again.logged.filter((l) => l.milestone), []);
  assert.deepEqual(again.decoded, []);
});

test("a decode that fails is recorded as a failure, not as a pass", async () => {
  const state = { tokens: { A1: 1 } };
  const memory = emptyMemory();
  const pass = (count) => {
    const at = growing(1, count);
    return harness({
      chain: fakeChain({ today: at.today, views: { 1: at.chain } }), mirror: { 1: at.mirror },
      lines: at.lines, state, memory, decode: async () => ({ decoded: false, exit: 1 }),
    });
  };
  await quietly(pass(5).run);
  const crossed = pass(6);
  const { said } = await quietly(crossed.run);
  assert.deepEqual(crossed.logged.filter((l) => l.milestone).map((l) => [l.milestone, l.decoded, l.exit]), [["streak-7", false, 1]]);
  assert.equal(said.length, 1);
  assert.match(said[0], /streak-7/);
});

// The end phase: every token finished or resting, the Clock writing nothing, and
// the heartbeat the operator's presence depends on.
test("the heartbeat is logged once, and never puts a decode on the chain's own write", async () => {
  const state = { tokens: { A1: 1 } };
  const memory = emptyMemory();
  const rested = view({ level: 40, streak: 40, lastDay: 1039, runFloor: 40, resting: true });
  const mirrored = mirrorView({ tokenId: 1, level: 40, streak: 40, lastDay: 1039, resting: true });
  const lines = checkins(1, 1001, 39);
  const settle = harness({ chain: fakeChain({ today: 1040, wardenDay: 1040, views: { 1: rested } }), mirror: { 1: mirrored }, lines, state, memory });
  await quietly(settle.run);

  const beat = harness({ chain: fakeChain({ today: 1070, wardenDay: 1070, views: { 1: rested } }), mirror: { 1: mirrored }, lines, state, memory });
  await quietly(beat.run);
  const hit = beat.logged.filter((l) => l.milestone === "heartbeat");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].tokenId, null);
  assert.equal(hit[0].decoded, null);
  assert.deepEqual(beat.decoded, []);
});

/// Two tokens one credit short of the year, and the same two once the finishing
/// night has landed. The mirror is a day AHEAD in both: it credited the day the
/// Clock has not written yet, and it carries no place until the chain says so.
function finishingPair() {
  const lines = [...checkins(1, 1001, 364), ...checkins(2, 1001, 364)];
  const nearly = (id) => ({
    chain: view({ level: 364, streak: 364, lastDay: 1363, runFloor: 364 }),
    mirror: mirrorView({ tokenId: id, level: 365, streak: 365, lastDay: 1364 }),
  });
  const done = (id, place, mark) => ({
    chain: view({ level: 365, streak: 365, lastDay: 1364, runFloor: 365, marks: 1n << BigInt(place === 1 ? 15 : 14), finisherPlace: place }),
    mirror: mirrorView({
      tokenId: id, level: 365, streak: 365, lastDay: 1364,
      marks: 1 << (place === 1 ? 15 : 14), finisher: { place, mark },
    }),
  });
  return { lines, nearly, done };
}

test("two tokens finishing the same day take their places by lowest id", async () => {
  const { lines, nearly, done } = finishingPair();
  const state = { tokens: { A1: 1, A2: 2 } };
  const memory = emptyMemory();
  const before = harness({
    chain: fakeChain({ today: 1364, views: { 1: nearly(1).chain, 2: nearly(2).chain } }),
    mirror: { 1: nearly(1).mirror, 2: nearly(2).mirror }, lines, state, memory,
  });
  const quiet = await quietly(before.run);
  assert.deepEqual(quiet.said, []);

  const after = harness({
    chain: fakeChain({ today: 1365, views: { 1: done(1, 1).chain, 2: done(2, 2).chain } }),
    mirror: { 1: done(1, 1, "Apex").mirror, 2: done(2, 2, "Atrium").mirror }, lines, state, memory,
  });
  const { said } = await quietly(after.run);
  assert.deepEqual(said, []);
  const rows = after.logged.filter((l) => l.ok !== undefined);
  assert.deepEqual(rows.map((l) => [l.tokenId, l.place, l.ok]), [[1, 1, true], [2, 2, true]]);
  assert.deepEqual(after.logged.filter((l) => l.milestone === "finished").map((l) => l.tokenId), [1, 2]);
});

test("the place the lower id should have held is a FAIL when the chain gave it away", async () => {
  const { lines, done } = finishingPair();
  const swapped = harness({
    chain: fakeChain({ today: 1365, views: { 1: done(1, 2).chain, 2: done(2, 1).chain } }),
    mirror: { 1: done(1, 2, "Atrium").mirror, 2: done(2, 1, "Apex").mirror },
    lines, state: { tokens: { A1: 1, A2: 2 } },
  });
  const { said } = await quietly(swapped.run);
  assert.equal(said.length, 2);
  assert.deepEqual(swapped.logged.filter((l) => l.ok === false).map((l) => l.tokenId), [1, 2]);
});
