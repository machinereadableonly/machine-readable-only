// One fast day of the runner, with the chain, the door and the clock's log all
// replaced by fakes: what it does per agent, in what order, and what it records.
//
// Nothing here touches a network, a key or a real file except the three small
// tests that exercise the state file and the log sink on a temp directory.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { AGENTS } from "../tools/year/scenario.mjs";
import {
  runDay, emptyState, agentSpecs, creditedDays, clockFailing, nextWakeMs,
  yearPaths, makeLog, loadState, writeState, passDeadlineMs,
  agentIsDone, foundingAllDone, firstPassFits, deferFirstPass, daySecondsFrom, isEntry,
  DAY_SECONDS, DEAD_TREASURY, FIRST_PASS_MIN_MS, MINT_USDC, RETRY_PAUSE_MS, SITE, ORIGIN,
} from "../tools/year/runner.mjs";

const byName = (name) => AGENTS.find((a) => a.name === name);
const spec = (name, over = {}) => ({ ...byName(name), identity: name, wallet: name, ...over });

/// A payment demand as the agent adapter hands one back: only the amount is read.
const demand = (amount) => ({ accepts: [{ amount, payTo: DEAD_TREASURY }] });

/**
 * A door that answers from a script and records every call.
 *
 * `script[name][action]` is either one answer or a queue of them; anything not
 * scripted gets the ordinary success. Every call records the IDENTITY it was
 * made with, which is the only way to see A11 carry on under its new key.
 */
function fakeDoor(script = {}) {
  const calls = [];
  let nextToken = 1;
  const make = (s) => {
    calls.push({ made: { name: s.name, identity: s.identity, wallet: s.wallet } });
    const pop = (action, fallback) => {
      const answer = script[s.name]?.[action];
      const one = Array.isArray(answer) ? (answer.length ? answer.shift() : fallback) : (answer ?? fallback);
      // A scripted Error is a door that threw: a lost answer, not a refusal.
      if (one instanceof Error) throw one;
      return one;
    };
    const record = (action, fields) => calls.push({ agent: s.name, identity: s.identity, action, ...fields });
    return {
      register: async () => { record("register", {}); return pop("register", { ok: true }); },
      mint: async (to, payTo) => { record("mint", { to, payTo }); return pop("mint", { ok: true, tokenId: nextToken++ }); },
      beat: async (tokenId) => { record("beat", { tokenId }); return pop("beat", { ok: true, accepted: true }); },
      upgrade: async (tokenId, id, variant, opts = {}) => {
        record("upgrade", { tokenId, id, variant, pay: opts.pay, payTo: opts.expectedPayTo });
        return pop("upgrade", {
          outcome: opts.pay ? "applied-queued" : "demand-only",
          demand: opts.pay ? undefined : demand("5000000"),
          result: { ok: true }, paid: opts.pay === true,
        });
      },
      seed: async (parentId, to) => { record("seed", { parentId, to }); return pop("seed", { ok: true, tokenId: 99 }); },
      // The `status` tool with no argument: the caller's own tokens, as
      // warden/src/mcp/tools/status.mjs answers it.
      status: async () => {
        record("status", {});
        return pop("status", { ok: true, tokens: [], contract: "0xc0", chainId: 84532 });
      },
      ownerCallFor: async (tool, tokenId) => {
        record(`call:${tool}`, { tokenId });
        return pop(`call:${tool}`, { ok: true, contract: "0xc0", function: tool, args: [tokenId] });
      },
    };
  };
  return { calls, make };
}

/// The chain as the runner uses it: reads from a script, sends recorded.
function fakeChain({ today = 0, views = {}, balances = {}, testUsdc = 30_000_000n, seeds = 0, owners = {}, fail = {} } = {}) {
  const sent = [];
  const view = (id) => ({ level: 1, streak: 1, marks: 0n, mintDay: 0, runFloor: 1, resting: false, ...(views[id] ?? {}) });
  return {
    sent,
    today: async () => today,
    viewOf: async (id) => view(id),
    seedsAvailable: async () => seeds,
    ownerOf: async (id) => owners[id] ?? "0xaddr-nobody",
    usdcBalance: async (address) => balances[address] ?? (address === "0xaddr-test" ? testUsdc : 0n),
    sendUsdc: async (fromKey, to, amount) => {
      sent.push({ sendUsdc: { fromKey, to, amount } });
      if (fail.sendUsdc) throw new Error(fail.sendUsdc);
      return { status: "success" };
    },
    ownerCall: async (fromKey, call) => {
      sent.push({ ownerCall: { fromKey, call } });
      if (fail.ownerCall) throw new Error(fail.ownerCall);
      return { status: "success" };
    },
    transfer: async (fromKey, from, to, id) => {
      sent.push({ transfer: { fromKey, from, to, id } });
      return { status: "success" };
    },
  };
}

/// One pass, with every seam a fake. Returns everything it touched.
async function pass({
  day = 0, specs = [], state = emptyState(), chain, door, log = [], clock = [],
  treasury = DEAD_TREASURY, time = { ms: 0 }, deadline = Number.POSITIVE_INFINITY,
} = {}) {
  const d = door ?? fakeDoor();
  const c = chain ?? fakeChain({ today: day });
  const lines = [];
  const slept = [];
  const saved = [];
  await runDay({
    day, agents: specs, state, chain: c,
    makeAgentFor: d.make,
    log: (l) => lines.push(l),
    testWallet: { key: "key:test", address: "0xaddr-test" },
    keyFor: (name) => `key:${name}`,
    addressFor: (name) => `0xaddr-${name}`,
    treasury,
    readLog: () => log,
    readClockLog: () => clock,
    // A wait costs the day the time it takes, as it does in the run.
    sleep: async (ms) => { slept.push(ms); time.ms += ms; },
    now: () => time.ms,
    deadline,
    save: () => saved.push(structuredClone(state)),
  });
  return { state, lines, slept, saved, calls: d.calls, sent: c.sent };
}

const linesFor = (lines, action) => lines.filter((l) => l.action === action);
const callsFor = (calls, action) => calls.filter((c) => c.action === action);

// ---------------------------------------------------------------- minting

test("day 0 mints A1 to A3, each to its own wallet, and records the token ids", async () => {
  const out = await pass({ day: 0, specs: [spec("A1"), spec("A2"), spec("A3"), spec("A4")] });

  const mints = callsFor(out.calls, "mint");
  assert.deepEqual(mints.map((m) => m.agent), ["A1", "A2", "A3"]);
  assert.deepEqual(mints.map((m) => m.to), ["0xaddr-A1", "0xaddr-A2", "0xaddr-A3"]);
  // The treasury is pinned from configuration, never from the demand.
  assert.deepEqual(new Set(mints.map((m) => m.payTo)), new Set([DEAD_TREASURY]));

  assert.deepEqual(out.state.tokens, { A1: 1, A2: 2, A3: 3 });
  const logged = linesFor(out.lines, "mint");
  assert.equal(logged.length, 3);
  assert.deepEqual(logged[0], { day: 0, chainDay: 0, agent: "A1", tokenId: 1, action: "mint", ok: true, reason: null });
});

test("a mint registers the key at the door first, and only once", async () => {
  const out = await pass({ day: 0, specs: [spec("A1")] });
  assert.deepEqual(out.calls.filter((c) => c.action).map((c) => c.action), ["register", "mint"]);
});

test("a mint tops the agent up to one USDC from the test wallet, and not when it already holds it", async () => {
  const short = await pass({
    day: 0, specs: [spec("A1")],
    chain: fakeChain({ balances: { "0xaddr-A1": 250_000n, "0xaddr-test": 30_000_000n } }),
  });
  assert.deepEqual(short.sent[0].sendUsdc, { fromKey: "key:test", to: "0xaddr-A1", amount: MINT_USDC - 250_000n });

  const funded = await pass({
    day: 0, specs: [spec("A1")],
    chain: fakeChain({ balances: { "0xaddr-A1": MINT_USDC, "0xaddr-test": 30_000_000n } }),
  });
  assert.deepEqual(funded.sent, []);
});

// A mint nobody can fund costs that agent a day, not the run: USDC arriving
// later is used, and the mint falls due again on every later day.
test("a mint nobody can fund is loud, skips that agent, and leaves the run going", async () => {
  const out = await pass({ day: 0, specs: [spec("A1"), spec("A2")], chain: fakeChain({ testUsdc: 0n }) });
  assert.equal(out.state.paused, null);
  assert.equal(callsFor(out.calls, "mint").length, 0);
  assert.deepEqual(out.lines.map((l) => [l.agent, l.action, l.reason]), [
    ["A1", "mint", "mint-unfunded"], ["A2", "mint", "mint-unfunded"],
  ]);
  assert.deepEqual(out.state.tokens, {});
  assert.deepEqual(out.sent, []);

  // And with money there the next day, both mint.
  const later = await pass({ day: 1, specs: [spec("A1"), spec("A2")], chain: fakeChain({ today: 1 }) });
  assert.deepEqual(later.state.tokens, { A1: 1, A2: 2 });
});

// The flake this covers is a settlement that fails after the authorisation was
// signed: the agent adapter reports `payment-failed`, and the mint is due again
// on the next pass, not again inside this one.
test("a mint answered by a second demand is retried on the next pass, never twice in one", async () => {
  const state = emptyState();
  const flake = await pass({
    day: 0, specs: [spec("A1")], state,
    chain: fakeChain({ balances: { "0xaddr-test": 30_000_000n } }),
    door: fakeDoor({ A1: { mint: [{ ok: false, reason: "payment-failed" }] } }),
  });
  assert.equal(callsFor(flake.calls, "mint").length, 1);
  assert.deepEqual(flake.state.tokens, {});
  assert.equal(linesFor(flake.lines, "mint")[0].reason, "payment-failed");

  const again = await pass({
    day: 1, specs: [spec("A1")], state,
    chain: fakeChain({ today: 1, balances: { "0xaddr-test": 30_000_000n } }),
  });
  assert.equal(callsFor(again.calls, "mint").length, 1, "a missing token is minted on a later day too");
  assert.equal(again.state.tokens.A1, 1);
});

// ---------------------------------------------------------------- check-in

test("a check-in that answers chain-unavailable twice then ok is attempted three times", async () => {
  const state = { ...emptyState(), tokens: { A2: 5 } };
  const out = await pass({
    day: 4, specs: [spec("A2")], state,
    door: fakeDoor({ A2: { beat: [
      { ok: false, reason: "chain-unavailable" },
      { ok: false, reason: "chain-unavailable" },
      { ok: true, accepted: true },
    ] } }),
  });
  const beats = callsFor(out.calls, "beat");
  assert.equal(beats.length, 3);
  assert.deepEqual(beats.map((b) => b.tokenId), [5, 5, 5]);
  assert.deepEqual(out.slept, [RETRY_PAUSE_MS, RETRY_PAUSE_MS]);

  const logged = linesFor(out.lines, "checkin");
  assert.deepEqual(logged.map((l) => [l.attempt, l.ok, l.reason]), [[1, false, "chain-unavailable"], [2, false, "chain-unavailable"], [3, true, null]]);
});

test("a refusal a retry cannot change is asked once", async () => {
  const out = await pass({
    day: 4, specs: [spec("A2")], state: { ...emptyState(), tokens: { A2: 5 } },
    door: fakeDoor({ A2: { beat: { ok: false, reason: "already-credited-today" } } }),
  });
  assert.equal(callsFor(out.calls, "beat").length, 1);
  assert.deepEqual(out.slept, []);
});

test("an agent with no token yet, and one on a day it misses, is not checked in", async () => {
  const early = await pass({ day: 4, specs: [spec("A12")] });
  assert.equal(callsFor(early.calls, "beat").length, 0);

  // A8 misses every tenth day after its mint on D3.
  const missed = await pass({ day: 13, specs: [spec("A8")], state: { ...emptyState(), tokens: { A8: 8 } } });
  assert.equal(callsFor(missed.calls, "beat").length, 0);
});

// ---------------------------------------------------------------- pausing

test("a paused run does nothing but log", async () => {
  const state = { ...emptyState(), tokens: { A1: 1 }, paused: "clock-failing" };
  const out = await pass({ day: 9, specs: [spec("A1")], state });
  assert.deepEqual(out.calls, []);
  assert.deepEqual(out.lines.map((l) => [l.action, l.reason]), [["run-paused", "clock-failing"]]);
});

test("three consecutive clock failures pause the run, two do not", async () => {
  const failing = await pass({
    day: 9, specs: [spec("A1")], state: { ...emptyState(), tokens: { A1: 1 } },
    clock: [{ exit: 0 }, { exit: 1 }, { exit: 1 }, { exit: 2 }],
  });
  assert.equal(failing.state.paused, "clock-failing");
  assert.deepEqual(failing.calls, []);

  const recovered = await pass({
    day: 9, specs: [spec("A1")], state: { ...emptyState(), tokens: { A1: 1 } },
    clock: [{ exit: 1 }, { exit: 1 }, { exit: 0 }],
  });
  assert.equal(recovered.state.paused, null);
  assert.equal(callsFor(recovered.calls, "beat").length, 1);
});

test("clockFailing reads the last three lines only, and needs three of them", () => {
  assert.equal(clockFailing([]), false);
  assert.equal(clockFailing([{ exit: 1 }, { exit: 1 }]), false);
  assert.equal(clockFailing([{ exit: 1 }, { exit: 1 }, { exit: 1 }]), true);
  assert.equal(clockFailing([{ exit: 1 }, { exit: 1 }, { exit: 1 }, { exit: 0 }]), false);
  assert.equal(clockFailing([{ exit: 0 }, { exit: 3 }, { exit: 1 }, { exit: 1 }]), true);
  // A line with no exit code at all is not a success.
  assert.equal(clockFailing([{}, {}, {}]), true);
});

test("a tool answering paused or sunset pauses the run loudly and stops the pass", async () => {
  for (const reason of ["paused", "sunset"]) {
    const out = await pass({
      day: 4, specs: [spec("A2"), spec("A3")],
      state: { ...emptyState(), tokens: { A2: 5, A3: 6 } },
      door: fakeDoor({ A2: { beat: { ok: false, reason } } }),
    });
    assert.equal(out.state.paused, reason);
    const paused = linesFor(out.lines, "run-paused");
    assert.deepEqual(paused.map((l) => l.reason), [reason]);
    assert.equal(callsFor(out.calls, "beat").length, 1, "A3 is not asked after the pause");
  }
});

// ---------------------------------------------------------------- Marks

test("an earned Mark is asked for free and recorded as requested", async () => {
  const state = { ...emptyState(), tokens: { A2: 5 } };
  const out = await pass({
    day: 8, specs: [spec("A2")], state,
    chain: fakeChain({ today: 8, views: { 5: { level: 8, streak: 8, runFloor: 8 } } }),
    // Days 0 to 8 credited: a run of 9, so Mark 2 (run 7) is due.
    log: Array.from({ length: 8 }, (_, i) => ({ action: "checkin", ok: true, tokenId: 5, chainDay: i + 1 })),
    // A free Mark answers with no demand at all, so the adapter reports it applied.
    door: fakeDoor({ A2: { upgrade: { outcome: "applied-queued", result: { ok: true, accepted: true } } } }),
  });
  const asked = callsFor(out.calls, "upgrade");
  assert.equal(asked.length, 1);
  assert.deepEqual([asked[0].id, asked[0].pay, asked[0].payTo], [2, false, DEAD_TREASURY]);
  assert.deepEqual(out.sent, [], "an earned Mark costs nothing, so nothing is funded");
  assert.deepEqual(out.state.requested, { A2: [2] });

  const logged = linesFor(out.lines, "mark");
  assert.deepEqual([logged[0].outcome, logged[0].price, logged[0].ok], ["applied-queued", "0", true]);
});

// The run gate must read the TALLY's bestRun, not the chain's runFloor: the
// chain exposes no bestRun, and a view handed straight to dueMarks would make
// every run Mark look due.
// Two things at once: the gate never reads the chain's runFloor, and today's own
// credit does not count -- the Clock has not written it yet.
test("the run gate reads the credits the Clock has written, not the chain's floor", async () => {
  const state = { ...emptyState(), tokens: { A2: 5 } };
  const out = await pass({
    day: 6, specs: [spec("A2")], state,
    // A runFloor high enough to open the Mark: only the tally may decide it.
    chain: fakeChain({ today: 6, views: { 5: { level: 6, streak: 6, runFloor: 300 } } }),
    log: Array.from({ length: 5 }, (_, i) => ({ action: "checkin", ok: true, tokenId: 5, chainDay: i + 1 })),
  });
  assert.equal(callsFor(out.calls, "beat").length, 1, "and today's check-in was accepted");
  assert.equal(callsFor(out.calls, "upgrade").length, 0, "six written days do not open the run-7 Mark");
});

test("a Mark the chain already carries is never ordered again", async () => {
  const out = await pass({
    day: 8, specs: [spec("A2")], state: { ...emptyState(), tokens: { A2: 5 } },
    chain: fakeChain({ today: 8, views: { 5: { level: 8, streak: 8, marks: 1n << 2n } } }),
    log: Array.from({ length: 8 }, (_, i) => ({ action: "checkin", ok: true, tokenId: 5, chainDay: i + 1 })),
  });
  assert.equal(callsFor(out.calls, "upgrade").length, 0);
});

test("a bought Mark with money behind it is funded at the ladder price, then paid for", async () => {
  const state = { ...emptyState(), tokens: { A5: 7 } };
  const out = await pass({
    day: 40, specs: [spec("A5")], state,
    chain: fakeChain({ today: 40, views: { 7: { level: 40, streak: 40 } }, balances: { "0xaddr-test": 30_000_000n } }),
  });
  // A5's Hush ($1) and Static ($5) are both open at level 40.
  const asked = callsFor(out.calls, "upgrade");
  assert.deepEqual(asked.map((a) => [a.id, a.pay]), [[1, true], [3, true]]);
  assert.deepEqual(out.sent.map((s) => s.sendUsdc), [
    { fromKey: "key:test", to: "0xaddr-A5", amount: 1_000_000n },
    { fromKey: "key:test", to: "0xaddr-A5", amount: 5_000_000n },
  ]);
  assert.deepEqual(out.state.requested, { A5: [1, 3] });
  assert.deepEqual(linesFor(out.lines, "mark").map((l) => [l.reason, l.outcome, l.price]), [
    [null, "applied-queued", "1000000"], [null, "applied-queued", "5000000"],
  ]);
});

test("a bought Mark with no money behind it reads the demand only, and is not asked again", async () => {
  const state = { ...emptyState(), tokens: { A5: 7 } };
  const out = await pass({
    day: 40, specs: [spec("A5")], state,
    chain: fakeChain({ today: 40, views: { 7: { level: 40, streak: 40 } }, balances: { "0xaddr-test": 500_000n } }),
  });
  const asked = callsFor(out.calls, "upgrade");
  assert.deepEqual(asked.map((a) => [a.id, a.pay]), [[1, false], [3, false]]);
  assert.deepEqual(out.sent, []);
  assert.deepEqual(out.state.requested, { A5: [1, 3] });
  assert.deepEqual(linesFor(out.lines, "mark").map((l) => l.outcome), ["demand-only", "demand-only"]);
});

// The reserve is the USDC still owed to mints nobody has paid for, so a Mark
// can never spend a mint's dollar.
test("a Mark never spends the USDC a mint still needs", async () => {
  const state = { ...emptyState(), tokens: { A5: 7 } };
  const out = await pass({
    // A12 has not minted, so one USDC is reserved; 5.5 does not cover a $5 Mark.
    day: 40, specs: [spec("A5"), spec("A12")], state,
    chain: fakeChain({ today: 40, views: { 7: { level: 40, streak: 40 } }, balances: { "0xaddr-test": 5_500_000n } }),
  });
  const asked = callsFor(out.calls, "upgrade");
  assert.deepEqual(asked.map((a) => [a.id, a.pay]), [[1, true], [3, false]]);
});

test("a refused Mark is left for the next pass", async () => {
  const state = { ...emptyState(), tokens: { A2: 5 } };
  const out = await pass({
    day: 8, specs: [spec("A2")], state,
    chain: fakeChain({ today: 8, views: { 5: { level: 8, streak: 8 } } }),
    log: Array.from({ length: 8 }, (_, i) => ({ action: "checkin", ok: true, tokenId: 5, chainDay: i + 1 })),
    door: fakeDoor({ A2: { upgrade: { outcome: "refused", result: { ok: false, reason: "mark-level-too-low" } } } }),
  });
  assert.deepEqual(out.state.requested, {});
  assert.deepEqual(linesFor(out.lines, "mark").map((l) => [l.ok, l.reason]), [[false, "mark-level-too-low"]]);
});

// ---------------------------------------------------------------- owner calls

test("A11's transfer is sent from A11's wallet to A12's address, once", async () => {
  const state = { ...emptyState(), tokens: { A11: 11 } };
  const out = await pass({ day: 50, specs: [spec("A11")], state, chain: fakeChain({ today: 50 }) });

  assert.deepEqual(out.sent[0].transfer, { fromKey: "key:A11", from: "0xaddr-A11", to: "0xaddr-A12", id: 11 });
  assert.deepEqual(out.state.ownerDone, { A11: ["transfer"] });
  assert.deepEqual(linesFor(out.lines, "transfer").map((l) => [l.ok, l.tokenId]), [[true, 11]]);

  const later = await pass({ day: 52, specs: [spec("A11")], state, chain: fakeChain({ today: 52 }) });
  assert.equal(later.sent.filter((s) => s.transfer).length, 0);
});

test("A11's rebind is signed by the new key and sent by the wallet that now owns the token", async () => {
  const state = { ...emptyState(), tokens: { A11: 11 }, ownerDone: { A11: ["transfer"] } };
  const out = await pass({ day: 51, specs: [spec("A11")], state, chain: fakeChain({ today: 51 }) });

  // The new identity registers at the door and asks for the call itself: the
  // calldata binds the token to the key that made the request.
  assert.deepEqual(out.calls.filter((c) => c.identity === "A11b").map((c) => c.action).slice(0, 2), ["register", "call:rebind"]);
  assert.deepEqual(out.sent[0].ownerCall, {
    fromKey: "key:A12",
    call: { ok: true, contract: "0xc0", function: "rebind", args: [11] },
  });
  assert.deepEqual(out.state.rebindKey, { A11: "A11b" });

  // And from that moment A11 checks in under the new key, in this very pass.
  const beat = callsFor(out.calls, "beat");
  assert.deepEqual(beat.map((b) => [b.agent, b.identity]), [["A11", "A11b"]]);
});

test("A10's rest is signed and sent by its own wallet, and ends its check-ins", async () => {
  const state = { ...emptyState(), tokens: { A10: 10 } };
  const out = await pass({ day: 120, specs: [spec("A10")], state, chain: fakeChain({ today: 120 }) });

  assert.deepEqual(out.calls.filter((c) => c.action).map((c) => c.action), ["call:rest", "beat"]);
  assert.deepEqual(out.sent[0].ownerCall.fromKey, "key:A10");
  assert.deepEqual(out.state.ownerDone, { A10: ["rest"] });

  const after = await pass({ day: 121, specs: [spec("A10")], state, chain: fakeChain({ today: 121 }) });
  assert.equal(callsFor(after.calls, "beat").length, 0, "a sealed token is never checked in again");
});

// A restart can land after the day an owner action was due. Missing it would
// lose the transfer, the rebind or the rest for the whole run.
test("an owner action missed while the runner was down is caught up, in order", async () => {
  const state = { ...emptyState(), tokens: { A11: 11 } };
  const first = await pass({ day: 60, specs: [spec("A11")], state, chain: fakeChain({ today: 60 }) });
  assert.deepEqual(first.state.ownerDone, { A11: ["transfer"] });

  const second = await pass({ day: 60, specs: [spec("A11")], state, chain: fakeChain({ today: 60 }) });
  assert.deepEqual(second.state.ownerDone, { A11: ["transfer", "rebind"] });
});

test("an owner call the door refuses is logged and not marked done", async () => {
  const state = { ...emptyState(), tokens: { A10: 10 } };
  const out = await pass({
    day: 120, specs: [spec("A10")], state, chain: fakeChain({ today: 120 }),
    door: fakeDoor({ A10: { "call:rest": { ok: false, reason: "unknown-token" } } }),
  });
  assert.deepEqual(out.sent, []);
  assert.deepEqual(out.state.ownerDone, {});
  assert.deepEqual(linesFor(out.lines, "rest").map((l) => [l.ok, l.reason]), [[false, "unknown-token"]]);
});

// A reverted or unsendable owner call must not take the pass down with it: the
// other eleven agents still have a day to live.
test("a chain send that throws is logged for that agent and the pass continues", async () => {
  const state = { ...emptyState(), tokens: { A10: 10, A2: 5 } };
  const out = await pass({
    day: 120, specs: [spec("A10"), spec("A2")], state,
    chain: fakeChain({ today: 120, fail: { ownerCall: "execution reverted" } }),
  });
  assert.deepEqual(linesFor(out.lines, "rest").map((l) => [l.ok, l.reason]), [[false, "execution reverted"]]);
  assert.deepEqual(out.state.ownerDone, {});
  assert.equal(callsFor(out.calls, "beat").filter((b) => b.agent === "A2").length, 1);
});

// ------------------------------------------------- Marks: paying exactly once

// A Mark whose payment SETTLED is never ordered again, whatever the answer was:
// the authorisation is spent, and asking again signs a second one.
test("a Mark refused after its payment settled is never re-ordered", async () => {
  const only = spec("A5", { marks: [{ id: 1, when: { level: 1 } }] });
  const state = { ...emptyState(), tokens: { A5: 7 } };
  const first = await pass({
    day: 40, specs: [only], state,
    chain: fakeChain({ today: 40, views: { 7: { level: 40, streak: 40 } } }),
    door: fakeDoor({ A5: { upgrade: { outcome: "refused", paid: true, result: { ok: false, reason: "mark-excluded" } } } }),
  });
  assert.deepEqual(first.sent.map((s) => s.sendUsdc.amount), [1_000_000n]);
  assert.deepEqual(linesFor(first.lines, "fund").map((l) => [l.markId, l.amount]), [[1, "1000000"]]);
  assert.deepEqual(linesFor(first.lines, "mark").map((l) => [l.ok, l.settled, l.reason]), [[false, true, "mark-excluded"]]);
  assert.deepEqual(first.state.requested, { A5: [1] });

  const second = await pass({
    day: 41, specs: [only], state,
    chain: fakeChain({ today: 41, views: { 7: { level: 41, streak: 41 } } }),
  });
  assert.equal(callsFor(second.calls, "upgrade").length, 0);
  assert.deepEqual(second.sent, []);
});

// A gate refusal happens BEFORE any demand, so the Mark is asked again -- and
// the USDC already sitting in the agent's wallet is not sent twice.
test("a Mark refused before any payment is re-ordered, and only the shortfall moves", async () => {
  const only = spec("A5", { marks: [{ id: 1, when: { level: 1 } }] });
  const state = { ...emptyState(), tokens: { A5: 7 } };
  const refused = { outcome: "refused", paid: false, result: { ok: false, reason: "mark-level-too-low" } };
  const first = await pass({
    day: 40, specs: [only], state,
    chain: fakeChain({ today: 40, views: { 7: { level: 40, streak: 40 } } }),
    door: fakeDoor({ A5: { upgrade: refused } }),
  });
  assert.deepEqual(first.sent.map((s) => s.sendUsdc.amount), [1_000_000n]);
  assert.deepEqual(first.state.requested, {});

  // The agent still holds the price from that attempt: nothing needs to move.
  const second = await pass({
    day: 41, specs: [only], state,
    chain: fakeChain({ today: 41, views: { 7: { level: 41, streak: 41 } }, balances: { "0xaddr-A5": 1_000_000n } }),
  });
  const asked = callsFor(second.calls, "upgrade");
  assert.deepEqual(asked.map((a) => [a.id, a.pay]), [[1, true]]);
  assert.deepEqual(second.sent, [], "the price is already in the wallet");
  assert.deepEqual(linesFor(second.lines, "fund"), []);
  assert.deepEqual(second.state.requested, { A5: [1] });
});

test("a part-funded agent is topped up to the price, not by it", async () => {
  const only = spec("A5", { marks: [{ id: 3, when: { level: 30 } }] });
  const out = await pass({
    day: 40, specs: [only], state: { ...emptyState(), tokens: { A5: 7 } },
    chain: fakeChain({ today: 40, views: { 7: { level: 40, streak: 40 } }, balances: { "0xaddr-A5": 2_000_000n } }),
  });
  assert.deepEqual(out.sent.map((s) => s.sendUsdc.amount), [3_000_000n]);
});

// ------------------------------------------------- the pass has an end

test("the pass stops asking before the fast day does", () => {
  // A 300-second day ending at 300_300_000 ms, and 20 s of margin.
  assert.equal(passDeadlineMs(300_060_000, 300, 20), 300_280_000);
  assert.equal(passDeadlineMs(300_000_000, 300, 20), 300_280_000);
  // On the boundary itself the deadline belongs to the day just starting.
  assert.equal(passDeadlineMs(300_300_000, 300, 20), 300_580_000);
});

// One slow door must not spend the day before the twelfth agent is asked.
test("every agent gets a first attempt, however slow the door, and the rest is logged missed", async () => {
  const time = { ms: 0 };
  const all = AGENTS.map((a) => spec(a.name));
  const tokens = Object.fromEntries(all.map((a, i) => [a.name, i + 1]));
  const door = fakeDoor(Object.fromEntries(all.map((a) => [a.name, { beat: { ok: false, reason: "chain-unavailable" } }])));
  const slow = {
    calls: door.calls,
    make: (s) => {
      const built = door.make(s);
      return { ...built, beat: async (id) => { time.ms += 30_000; return built.beat(id); } };
    },
  };
  const out = await pass({
    day: 30, specs: all, state: { ...emptyState(), tokens },
    chain: fakeChain({ today: 30 }), door: slow, time, deadline: 200_000,
  });

  const beats = callsFor(out.calls, "beat");
  assert.equal(beats.length, 12, "all twelve were asked once");
  assert.deepEqual(new Set(beats.map((b) => b.attempt ?? 1)), new Set([1]));
  assert.deepEqual(out.slept, [], "no time was left to wait for a retry");
  assert.equal(linesFor(out.lines, "checkin").filter((l) => l.reason === "missed-deadline").length, 12);
});

test("retries stop when the next wait would not fit the day", async () => {
  const out = await pass({
    day: 4, specs: [spec("A2")], state: { ...emptyState(), tokens: { A2: 5 } },
    door: fakeDoor({ A2: { beat: { ok: false, reason: "chain-unavailable" } } }),
    // Room for one wait, and not for a second.
    deadline: 45_000,
  });
  assert.equal(callsFor(out.calls, "beat").length, 2);
  assert.deepEqual(out.slept, [RETRY_PAUSE_MS]);
  assert.deepEqual(linesFor(out.lines, "checkin").map((l) => [l.attempt, l.reason]), [
    [1, "chain-unavailable"], [2, "chain-unavailable"], [undefined, "missed-deadline"],
  ]);
});

// The deadline is read again before each agent in a retry round: the round's own
// calls can spend what was left of the day.
test("an agent the retry round runs out of time for is logged missed, not asked", async () => {
  const time = { ms: 0 };
  const failing = fakeDoor({
    A2: { beat: { ok: false, reason: "chain-unavailable" } },
    A3: { beat: { ok: false, reason: "chain-unavailable" } },
  });
  const slow = {
    calls: failing.calls,
    make: (s) => {
      const built = failing.make(s);
      return { ...built, beat: async (id) => { time.ms += 20_000; return built.beat(id); } };
    },
  };
  const out = await pass({
    day: 4, specs: [spec("A2"), spec("A3")], state: { ...emptyState(), tokens: { A2: 5, A3: 6 } },
    door: slow, time, deadline: 85_000,
  });
  const beats = callsFor(out.calls, "beat");
  assert.deepEqual(beats.filter((b) => b.agent === "A2").length, 2);
  assert.deepEqual(beats.filter((b) => b.agent === "A3").length, 1);
  assert.deepEqual(
    linesFor(out.lines, "checkin").filter((l) => l.reason === "missed-deadline").map((l) => l.agent),
    ["A2", "A3"],
  );
});

// ------------------------------------------------- owner calls, once only

// A transfer whose response was lost still moved the token. Sending a second
// one would refuse, and treating that as failure would strand the rebind.
test("a transfer is not sent again when the destination already holds the token", async () => {
  const state = { ...emptyState(), tokens: { A11: 11 } };
  const out = await pass({
    day: 50, specs: [spec("A11")], state,
    chain: fakeChain({ today: 50, owners: { 11: "0xADDR-A12" } }),
  });
  assert.equal(out.sent.filter((s) => s.transfer).length, 0);
  assert.deepEqual(linesFor(out.lines, "transfer").map((l) => [l.ok, l.reason]), [[true, "already-held"]]);
  assert.deepEqual(out.state.ownerDone, { A11: ["transfer"] });
});

test("a door refusal of paused or sunset pauses the run from an owner call and from a seed", async () => {
  const rest = await pass({
    day: 120, specs: [spec("A10")], state: { ...emptyState(), tokens: { A10: 10 } },
    chain: fakeChain({ today: 120 }),
    door: fakeDoor({ A10: { "call:rest": { ok: false, reason: "sunset" } } }),
  });
  assert.equal(rest.state.paused, "sunset");
  assert.deepEqual(rest.sent, []);

  const seed = await pass({
    day: 367, specs: [spec("A1")], state: { ...emptyState(), tokens: { A1: 1 } },
    chain: fakeChain({ today: 367, seeds: 1, views: { 1: { level: 365, streak: 365 } } }),
    door: fakeDoor({ A1: { seed: { ok: false, reason: "paused" } } }),
  });
  assert.equal(seed.state.paused, "paused");
  assert.equal(seed.state.seeded, false);
});

// ---------------------------------------------------------------- the child

test("A1 seeds once the chain has a seed to give, and never twice", async () => {
  const state = { ...emptyState(), tokens: { A1: 1 } };
  const none = await pass({
    day: 366, specs: [spec("A1")], state,
    chain: fakeChain({ today: 366, seeds: 0, views: { 1: { level: 365, streak: 365 } } }),
  });
  assert.equal(callsFor(none.calls, "seed").length, 0);

  const out = await pass({
    day: 367, specs: [spec("A1")], state,
    chain: fakeChain({ today: 367, seeds: 1, views: { 1: { level: 365, streak: 365 } } }),
  });
  const seeded = callsFor(out.calls, "seed");
  assert.deepEqual(seeded.map((s) => [s.parentId, s.to]), [[1, "0xaddr-A1"]]);
  assert.equal(out.state.seeded, true);
  assert.equal(out.state.childId, 99);
  assert.equal(out.state.childDay, 367);
  assert.equal(out.state.tokens.child, 99);
  assert.deepEqual(linesFor(out.lines, "seed").map((l) => [l.ok, l.tokenId]), [[true, 99]]);

  const again = await pass({
    day: 368, specs: [spec("A1")], state,
    chain: fakeChain({ today: 368, seeds: 1, views: { 1: { level: 365, streak: 365 } } }),
  });
  assert.equal(callsFor(again.calls, "seed").length, 0);
});

test("the child is an agent of the run, checking in daily under its parent's key", async () => {
  const state = { ...emptyState(), tokens: { A1: 1, child: 99 }, seeded: true, childId: 99, childDay: 367 };
  const specs = agentSpecs(state);
  const child = specs.find((s) => s.name === "child");
  assert.deepEqual([child.identity, child.wallet, child.mintDay, child.marks], ["A1", "A1", 367, []]);

  const out = await pass({ day: 368, specs: [child], state, chain: fakeChain({ today: 368 }) });
  assert.deepEqual(callsFor(out.calls, "beat").map((b) => [b.agent, b.identity, b.tokenId]), [["child", "A1", 99]]);
  // The seed day itself is the child's first credit, so it is not checked in then.
  const seedDay = await pass({ day: 367, specs: [child], state, chain: fakeChain({ today: 367 }) });
  assert.equal(callsFor(seedDay.calls, "beat").length, 0);
});

test("agentSpecs carries the twelve, the rebind key, and the child only once seeded", () => {
  const plain = agentSpecs(emptyState());
  assert.equal(plain.length, 12);
  assert.deepEqual(plain.map((s) => s.identity), plain.map((s) => s.name));

  const rebound = agentSpecs({ ...emptyState(), rebindKey: { A11: "A11b" } });
  assert.equal(rebound.find((s) => s.name === "A11").identity, "A11b");
  assert.equal(agentSpecs({ ...emptyState(), seeded: true, childDay: 40, childId: 99 }).length, 13);
});

// ---------------------------------------------------------------- the record

test("every line carries the run day, the chain day and the agent's token", async () => {
  const out = await pass({
    day: 4, specs: [spec("A2")], state: { ...emptyState(), tokens: { A2: 5 } },
    chain: fakeChain({ today: 1004 }),
  });
  for (const l of out.lines) {
    assert.deepEqual(Object.keys(l).slice(0, 6), ["day", "chainDay", "agent", "tokenId", "action", "ok"]);
    assert.equal(l.day, 4);
    assert.equal(l.chainDay, 1004, "the chain's own day, read from the contract");
  }
});

test("the state is written after every agent, so a restart resumes mid-pass", async () => {
  const out = await pass({ day: 0, specs: [spec("A1"), spec("A2"), spec("A3")] });
  assert.equal(out.saved.length, 3);
  assert.deepEqual(out.saved.map((s) => Object.keys(s.tokens).length), [1, 2, 3]);
});

test("creditedDays is the chain's mint day plus every accepted check-in", () => {
  const lines = [
    { action: "checkin", ok: true, tokenId: 5, chainDay: 11 },
    { action: "checkin", ok: false, tokenId: 5, chainDay: 12 },
    { action: "checkin", ok: true, tokenId: 6, chainDay: 12 },
    { action: "mint", ok: true, tokenId: 5, chainDay: 10 },
    { action: "checkin", ok: true, tokenId: 5, chainDay: 13 },
  ];
  assert.deepEqual(creditedDays(lines, 5, 10), [10, 11, 13]);
  // A credit on the mint day itself counts once: the chain credits a day once.
  assert.deepEqual(creditedDays(lines, 6, 12), [12]);
  assert.deepEqual(creditedDays([], 5, 10), [10]);
});

// ---------------------------------------------------------------- the clock

test("the next wake is sixty seconds into the next fast day", () => {
  // A 300-second day: 1000 * 300 = 300000 s is the start of day 1000.
  assert.equal(nextWakeMs(300_000_000, 300, 60), 300_060_000);
  assert.equal(nextWakeMs(300_060_000, 300, 60), 300_360_000, "the boundary itself waits for the next day");
  assert.equal(nextWakeMs(300_120_000, 300, 60), 300_360_000);
  // A pass that ran past the next boundary skips it rather than overlapping.
  assert.equal(nextWakeMs(300_400_000, 300, 60), 300_660_000);
});

// ---------------------------------------------------------------- the files

test("the data directory comes from the environment, with no path written in code", () => {
  const p = yearPaths("/somewhere/else");
  assert.equal(p.state, "/somewhere/else/state.json");
  assert.equal(p.runnerLog, "/somewhere/else/runner.jsonl");
  assert.equal(p.clockLog, "/somewhere/else/clock.jsonl");
  assert.equal(p.contract, "/somewhere/else/contract.address");
  assert.equal(p.treasury, "/somewhere/else/treasury.address");
  assert.equal(p.wallet("A1"), "/somewhere/else/wallets/A1.key");
  assert.equal(p.identity("A11b"), "/somewhere/else/identities/A11b.jwk.json");
  // The default is read from the environment at the call, never hard-coded.
  const saved = process.env.MRO_YEAR_DIR;
  process.env.MRO_YEAR_DIR = "/from/env";
  try { assert.equal(yearPaths().dir, "/from/env"); } finally {
    if (saved === undefined) delete process.env.MRO_YEAR_DIR; else process.env.MRO_YEAR_DIR = saved;
  }
});

test("the door is the fast site on the loopback port", () => {
  assert.equal(SITE, "https://fast.test");
  assert.equal(ORIGIN, "http://127.0.0.1:4006");
});

test("the log sink stamps every line with a timestamp and one JSON object per line", () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-year-runner-"));
  try {
    const log = makeLog(join(dir, "runner.jsonl"));
    log({ day: 1, action: "mint", ok: true });
    log({ day: 1, action: "checkin", ok: false, reason: "chain-unavailable" });
    const lines = readFileSync(join(dir, "runner.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(lines[0].action, "mint");
    assert.equal(lines[1].reason, "chain-unavailable");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ------------------------------------------------- the child's own ending

// Without this the child checks in every day for ever, so no day is ever silent
// and the heartbeat the end phase exists to prove never fires.
test("a check-in refused year-complete records that agent as done, and a rest counts too", async () => {
  const out = await pass({
    day: 400, specs: [spec("A2")], state: { ...emptyState(), tokens: { A2: 5 } },
    chain: fakeChain({ today: 400 }),
    door: fakeDoor({ A2: { beat: { ok: false, reason: "year-complete" } } }),
  });
  assert.deepEqual(out.state.done, { A2: true });
  assert.equal(agentIsDone(out.state, "A2"), true);

  // A sealed token is done as well: it can never be credited again.
  assert.equal(agentIsDone({ ...emptyState(), ownerDone: { A10: ["rest"] } }, "A10"), true);
  assert.equal(agentIsDone(emptyState(), "A10"), false);
});

test("the child checks in until every founding agent is done, and then stops", async () => {
  const all = Object.fromEntries(AGENTS.filter((a) => a.name !== "A10").map((a) => [a.name, true]));
  const base = { ...emptyState(), tokens: { A1: 1, child: 99 }, seeded: true, childId: 99, childDay: 300 };

  // Eleven done and A10 neither finished nor sealed: the child still returns.
  const going = { ...base, done: all };
  assert.equal(foundingAllDone(going), false);
  const busy = await pass({
    day: 400, specs: [agentSpecs(going).find((s) => s.name === "child")], state: going,
    chain: fakeChain({ today: 400 }),
  });
  assert.deepEqual(callsFor(busy.calls, "beat").map((b) => b.tokenId), [99]);

  // A10 rests, which is the twelfth ending: from that day the child stops.
  const over = { ...base, done: all, ownerDone: { A10: ["rest"] } };
  assert.equal(foundingAllDone(over), true);
  const quiet = await pass({
    day: 401, specs: [agentSpecs(over).find((s) => s.name === "child")], state: over,
    chain: fakeChain({ today: 401 }),
  });
  assert.deepEqual(callsFor(quiet.calls, "beat"), []);
});

// ------------------------------------------------- the first pass of a run

// A pass started near a boundary can split A1-A3's mints across two fast days,
// which is a permanent mintDay FAIL and a lost day one -- and Break, at a run of
// 365, is then unreachable for the whole year.
test("a first pass with too little of the fast day left is not run", () => {
  // A 300-second day ending at 300_300_000 ms, less the pass's own 20 s margin.
  assert.equal(passDeadlineMs(300_060_000, 300), 300_280_000);
  assert.equal(firstPassFits(300_060_000, 300), true);
  assert.equal(firstPassFits(300_280_000 - FIRST_PASS_MIN_MS, 300), true);
  assert.equal(firstPassFits(300_280_000 - FIRST_PASS_MIN_MS + 1000, 300), false);
  // Past the deadline entirely, there is nothing left to defer from.
  assert.equal(firstPassFits(300_290_000, 300), false);
  assert.equal(FIRST_PASS_MIN_MS, 90_000);
});

// The deferral belongs to the start of a RUN, not the start of a process. PM2
// restarts the runner for its own reasons, and one landing in the last seconds of
// a fast day would cost all twelve agents that day's credit and break every
// streak -- which is far worse than the boundary it was guarding against.
test("only a run that has not begun defers its first pass", () => {
  const late = 300_279_000;   // under 90 s of the fast day left
  const early = 300_060_000;  // the ordinary wake, with the day ahead of it

  // Day zero, with nowhere to put a mint: wait for the next fast day.
  assert.equal(deferFirstPass(emptyState(), late, 300), true);
  assert.equal(deferFirstPass(emptyState(), early, 300), false);

  // A restart mid-run: the day is already this token's, and skipping it breaks
  // twelve streaks.
  const going = { ...emptyState(), startDay: 1000, tokens: { A1: 1 } };
  assert.equal(deferFirstPass(going, late, 300), false);
  assert.equal(deferFirstPass(going, early, 300), false);

  // A deferral leaves startDay null, so the next wake asks the same question and
  // that day's answer is yes.
  assert.equal(emptyState().startDay, null);
});

test("the runner refuses a fast day it cannot use rather than sleeping on NaN", () => {
  assert.equal(daySecondsFrom({}), DAY_SECONDS);
  assert.equal(daySecondsFrom({ MRO_DAY_SECONDS: "300" }), 300);
  for (const bad of ["0", "-5", "soon", "", "NaN", "60"]) {
    assert.throws(() => daySecondsFrom({ MRO_DAY_SECONDS: bad }), /MRO_DAY_SECONDS/);
  }
  // The checker's own copy is this function with its longer offset as the floor.
  assert.equal(daySecondsFrom({ MRO_DAY_SECONDS: "61" }), 61);
  assert.throws(() => daySecondsFrom({ MRO_DAY_SECONDS: "200" }, 240), /greater than the 240/);
});

// ------------------------------------------------- a lost answer, recovered

// The Clock mints from a row the Warden has already written, so an answer lost in
// transit leaves a token nobody owns a record of -- and an agent with no token id
// never checks in again for the rest of the year.
test("a mint the door says is already done adopts the token the door lists as ours", async () => {
  const state = emptyState();
  const out = await pass({
    day: 0, specs: [spec("A1")], state,
    door: fakeDoor({ A1: {
      mint: { ok: false, reason: "already-minted" },
      status: { ok: true, tokens: [{ tokenId: 4, level: 1, generation: 0, parentId: null }], contract: "0xc0", chainId: 84532 },
    } }),
  });
  assert.equal(out.state.tokens.A1, 4);
  assert.deepEqual(callsFor(out.calls, "status").map((c) => [c.agent, c.identity]), [["A1", "A1"]]);
  assert.deepEqual(linesFor(out.lines, "token-adopted").map((l) => [l.ok, l.tokenId, l.reason]), [[true, 4, "already-minted"]]);
});

test("a mint whose answer never came back adopts the token too, and a child is never taken for it", async () => {
  const state = emptyState();
  const out = await pass({
    day: 0, specs: [spec("A1")], state,
    door: fakeDoor({ A1: {
      mint: new Error("socket hang up"),
      // A child of somebody else's token is not this agent's founding token.
      status: { ok: true, tokens: [
        { tokenId: 12, level: 1, generation: 1, parentId: 3 },
        { tokenId: 7, level: 1, generation: 0, parentId: null },
      ] },
    } }),
  });
  assert.equal(out.state.tokens.A1, 7);
  assert.deepEqual(linesFor(out.lines, "mint").map((l) => [l.ok, l.reason]), [[false, "socket hang up"]]);
});

test("a mint refused with no token of ours to find leaves the mint due again, silently", async () => {
  const state = emptyState();
  const out = await pass({
    day: 0, specs: [spec("A1")], state,
    door: fakeDoor({ A1: { mint: { ok: false, reason: "payment-failed" } } }),
  });
  assert.deepEqual(out.state.tokens, {});
  assert.deepEqual(linesFor(out.lines, "token-adopted"), []);
});

// A seed is spent once per agent-year and the chain offers no second one, so a
// lost seed answer is the one failure the runner cannot simply retry.
test("a seed whose answer was lost adopts the child the door lists under the parent", async () => {
  const state = { ...emptyState(), tokens: { A1: 1 } };
  const door = fakeDoor({ A1: { status: { ok: true, tokens: [
    { tokenId: 1, level: 365, generation: 0, parentId: null },
    { tokenId: 99, level: 1, generation: 1, parentId: 1 },
  ] } } });
  const out = await pass({
    day: 368, specs: [spec("A1")], state, door,
    chain: fakeChain({ today: 368, seeds: 0, views: { 1: { level: 365, streak: 365 } } }),
    // The attempt that was lost: only a seed already tried can have been spent.
    log: [{ action: "seed", ok: false, tokenId: 1, chainDay: 367, reason: "chain-unavailable" }],
  });
  assert.equal(out.state.seeded, true);
  assert.equal(out.state.childId, 99);
  assert.equal(out.state.tokens.child, 99);
  assert.deepEqual(linesFor(out.lines, "token-adopted").map((l) => [l.ok, l.tokenId]), [[true, 99]]);
  assert.equal(agentSpecs(out.state).filter((s) => s.name === "child").length, 1);
});

test("a spent seed with no child to be found is logged, not passed over in silence", async () => {
  const state = { ...emptyState(), tokens: { A1: 1 } };
  const out = await pass({
    day: 368, specs: [spec("A1")], state,
    chain: fakeChain({ today: 368, seeds: 0, views: { 1: { level: 365, streak: 365 } } }),
    log: [{ action: "seed", ok: false, tokenId: 1, chainDay: 367, reason: "chain-unavailable" }],
  });
  assert.equal(out.state.seeded, false);
  assert.deepEqual(linesFor(out.lines, "seed").map((l) => [l.ok, l.reason]), [[false, "no-seed-available"]]);
});

// And before any seed has been attempted, no seed is due and nothing is missing:
// A1 spends 365 days in exactly that state.
test("a parent whose year is not over asks the door nothing about a child", async () => {
  const out = await pass({
    day: 40, specs: [spec("A1")], state: { ...emptyState(), tokens: { A1: 1 } },
    chain: fakeChain({ today: 40, seeds: 0, views: { 1: { level: 40, streak: 40 } } }),
  });
  assert.deepEqual(callsFor(out.calls, "status"), []);
  assert.deepEqual(linesFor(out.lines, "seed"), []);
});

// ------------------------------------------------- the money that did not move

// topUp answers whether the USDC actually moved. The bank is read once to decide
// and once to send, so a balance that falls between the two must not leave the
// call paying with money the wallet does not hold.
test("a top-up that could not move the price reads the demand instead of paying", async () => {
  const chain = fakeChain({ today: 40, views: { 7: { level: 40, streak: 40 } } });
  let bankReads = 0;
  chain.usdcBalance = async (address) => {
    if (address !== "0xaddr-test") return 0n;
    return bankReads++ === 0 ? 30_000_000n : 0n;
  };
  const out = await pass({
    day: 40, specs: [spec("A5", { marks: [{ id: 1, when: { level: 1 } }] })],
    state: { ...emptyState(), tokens: { A5: 7 } }, chain,
  });
  assert.deepEqual(out.sent, []);
  assert.deepEqual(callsFor(out.calls, "upgrade").map((a) => [a.id, a.pay]), [[1, false]]);
  assert.deepEqual(linesFor(out.lines, "fund").map((l) => [l.ok, l.reason, l.markId]), [[false, "mark-unfunded", 1]]);
  assert.deepEqual(linesFor(out.lines, "mark").map((l) => l.outcome), ["demand-only"]);
});

// ------------------------------------------------- a pause is still a record

test("agents still waiting when a pause lands are logged missed, not dropped", async () => {
  const out = await pass({
    day: 4, specs: [spec("A2"), spec("A3")],
    state: { ...emptyState(), tokens: { A2: 5, A3: 6 } },
    door: fakeDoor({
      A2: { beat: { ok: false, reason: "chain-unavailable" } },
      A3: { beat: [{ ok: false, reason: "chain-unavailable" }, { ok: false, reason: "paused" }] },
    }),
  });
  assert.equal(out.state.paused, "paused");
  assert.deepEqual(
    linesFor(out.lines, "checkin").filter((l) => l.reason === "missed-deadline").map((l) => l.agent),
    ["A2"],
  );
});

test("a pause in the first sweep still logs the agents already waiting on a retry", async () => {
  const out = await pass({
    day: 4, specs: [spec("A2"), spec("A3")],
    state: { ...emptyState(), tokens: { A2: 5, A3: 6 } },
    door: fakeDoor({
      A2: { beat: { ok: false, reason: "chain-unavailable" } },
      A3: { beat: { ok: false, reason: "sunset" } },
    }),
  });
  assert.equal(out.state.paused, "sunset");
  assert.deepEqual(
    linesFor(out.lines, "checkin").filter((l) => l.reason === "missed-deadline").map((l) => l.agent),
    ["A2"],
  );
});

test("the state file is replaced by a rename, leaving no half-written file behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-year-runner-"));
  try {
    const path = join(dir, "state.json");
    assert.deepEqual(loadState(path), emptyState());
    const state = { ...emptyState(), tokens: { A1: 1 }, startDay: 1000 };
    writeState(path, state);
    assert.deepEqual(loadState(path), state);
    writeState(path, { ...state, tokens: { A1: 1, A2: 2 } });
    assert.deepEqual(readdirSync(dir), ["state.json"]);
    assert.deepEqual(loadState(path).tokens, { A1: 1, A2: 2 });
    // A state file written by an older shape keeps its fields and gains the rest.
    writeFileSync(path, JSON.stringify({ tokens: { A1: 7 } }));
    assert.deepEqual(loadState(path), { ...emptyState(), tokens: { A1: 7 } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a script started by PM2 knows it is the entry point", () => {
  const script = "/srv/tree/warden/tools/year/runner.mjs";
  const url = pathToFileURL(script).href;
  const container = "/pm2/lib/ProcessContainerFork.js";
  assert.equal(isEntry(url, ["node", script], {}), true, "plain node");
  assert.equal(isEntry(url, ["node", container], { pm_exec_path: script }), true, "PM2 fork mode");
  assert.equal(isEntry(url, ["node", container], {}), false, "imported, not run");
  assert.equal(isEntry(url, ["node", "/other.mjs"], { pm_exec_path: "/other.mjs" }), false, "another script");
});

// The checker is started by PM2 too, and the argv[1] form would have it import
// its own module and do nothing. Asserted on the SOURCE because the guard runs
// at load: importing checker.mjs to look at it is the one thing that cannot ask.
test("the checker's entry guard is isEntry, not argv[1]", () => {
  const source = readFileSync(new URL("../tools/year/checker.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(isEntry\(import\.meta\.url\)\)/, "the checker's entry guard is not isEntry");
  assert.ok(!source.includes("process.argv[1]"), "the checker still compares argv[1] itself");
});
