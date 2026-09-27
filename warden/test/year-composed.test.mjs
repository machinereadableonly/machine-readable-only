// The runner and the checker, joined by the real log file.
//
// Everywhere else the two are tested apart, each against lines it wrote itself --
// which cannot see the one failure that costs a whole run: the runner renaming a
// field the checker reads. So this drives runDay through the REAL log writer into
// a temp runner.jsonl, reads that file back with the checker's own reader, and
// judges it with the checker's own pass. A rename on either side turns red here.
//
// No network, no key, no chain: every seam is a fake, and the file is the only
// thing the two halves share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENTS } from "../tools/year/scenario.mjs";
import { emptyState, makeLog, readJsonl, runDay, DEAD_TREASURY } from "../tools/year/runner.mjs";
import { emptyMemory, runPass } from "../tools/year/checker.mjs";

const A1 = AGENTS[0];

/// A door that accepts everything: what it answers is not what is under test.
const door = () => ({
  register: async () => ({ ok: true }),
  mint: async () => ({ ok: true, tokenId: 1 }),
  beat: async () => ({ ok: true, credited: true }),
  upgrade: async () => ({ outcome: "demand-only", result: { ok: false }, paid: false }),
  seed: async () => ({ ok: false, reason: "parent-not-whole" }),
  status: async () => ({ ok: true, tokens: [] }),
});

/// Funded, nothing to seed, and one view per token id.
const runnerChain = (today, views) => ({
  today: async () => today,
  viewOf: async (id) => views[id],
  seedsAvailable: async () => 0,
  usdcBalance: async () => 30_000_000n,
  ownerOf: async () => "0xaddr-nobody",
  sendUsdc: async () => { throw new Error("nothing needed funding"); },
  ownerCall: async () => { throw new Error("no owner call in this run"); },
  transfer: async () => { throw new Error("no transfer in this run"); },
});

const chainView = (over = {}) => ({
  level: 2, streak: 2, lastDay: 1001, mintDay: 1000, generation: 0, parent: 0,
  echo: 0, resting: false, marks: 0n, runFloor: 2, finisherPlace: 0, ...over,
});

const mirrorView = (over = {}) => ({
  tokenId: 1, level: 2, streak: 2, lastDay: 1001, marks: 0, generation: 0,
  parentId: null, resting: false, finisher: null, ...over,
});

/// One fast day for one agent, written to the real log file.
async function liveADay({ day, chainDay, state, log, views }) {
  await runDay({
    day, chainDay, agents: [{ ...A1, identity: A1.name, wallet: A1.name }], state,
    chain: runnerChain(chainDay, views), makeAgentFor: door, log,
    testWallet: { key: "key:test", address: "0xaddr-test" },
    keyFor: (name) => `key:${name}`, addressFor: (name) => `0xaddr-${name}`,
    treasury: DEAD_TREASURY, deadline: Number.POSITIVE_INFINITY, now: () => 0,
  });
}

/// The checker's pass over that same file, with the chain and the mirror agreeing
/// with what the runner recorded.
async function checkIt({ dir, state, chain, mirror }) {
  const logged = [];
  await runPass({
    chain: {
      today: async () => 1002,
      lastWardenDay: async () => 1002,
      viewOf: async () => chain,
    },
    readMirror: async () => mirror,
    state, readLog: () => readJsonl(join(dir, "runner.jsonl")),
    log: (fields) => logged.push(fields), memory: emptyMemory(),
    sleep: async () => {},
  });
  return logged;
}

test("the checker judges the runner's own log file: a mint, a credit, and no finding", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-year-composed-"));
  const said = [];
  const real = console.error;
  console.error = (...args) => said.push(args.join(" "));
  try {
    const log = makeLog(join(dir, "runner.jsonl"));
    const state = emptyState();
    // Day zero mints; the day after is the token's first check-in.
    await liveADay({ day: 0, chainDay: 1000, state, log, views: {} });
    assert.equal(state.tokens.A1, 1);
    await liveADay({ day: 1, chainDay: 1001, state, log, views: { 1: chainView({ level: 1, streak: 1, lastDay: 1000, runFloor: 1 }) } });

    // Two days credited, so the chain should hold level 2 -- which the checker
    // works out from the runner's log alone.
    const rows = await checkIt({ dir, state, chain: chainView(), mirror: mirrorView() });
    const row = rows.find((l) => l.tokenId === 1);
    assert.equal(row.agent, "A1");
    assert.deepEqual(row.findings, [], "the two halves disagree about the log's own fields");
    assert.equal(row.ok, true);
    assert.deepEqual(said, []);

    // And the mint day the runner recorded is what the chain is held to: the one
    // comparison that has no other witness.
    const wrong = await checkIt({ dir, state, chain: chainView({ mintDay: 1001 }), mirror: mirrorView() });
    // A wrong mint day shifts every other expected value with it, which is why it
    // needs its own witness at all: the log's day is the only thing that can see it.
    assert.deepEqual(
      wrong.find((l) => l.tokenId === 1).findings.filter((f) => f.field === "mintDay").map((f) => f.expected),
      [1000],
    );
  } finally {
    console.error = real;
    rmSync(dir, { recursive: true, force: true });
  }
});
