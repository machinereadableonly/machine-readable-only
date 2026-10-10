// The Clock and the daily split: the night's keys are revealed before anything
// else is written, and every mint, seed and credit carries its answer bit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, hexToString } from "viem";
import { MRO_ABI } from "../src/clock/abi.mjs";
import { runClock, MAX_KEYS_PER_REVEAL } from "../src/clock/run.mjs";
import { chainKeys, keyIndexFor, answerBit, silentBit, CHAIN_LENGTH } from "../src/clock/split.mjs";
import { DEPLOY_BLOCK } from "../src/clock/reconcile.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";
import { CODE_BYTES } from "../tools/code-bytes.mjs";

const TODAY = 20_700;
const QR = "ab".repeat(CODE_BYTES);
const SEED = "0x" + "33".repeat(32);
const KEYS = chainKeys(SEED);
const ANCHOR_DAY = TODAY - 10;
const keyOf = (day) => KEYS[keyIndexFor(day, ANCHOR_DAY)];
const BANK = [
  { id: "fog-or-thunder", text: "Fog or thunder?", answers: ["fog", "thunder"] },
  { id: "legs", text: "How many legs?", range: { min: 0, max: 100 } },
];

const noChain = {
  async getBlockNumber() { return DEPLOY_BLOCK[84532]; },
  async getLogs() { return []; },
};
const chainWith = ({ anchor = KEYS[0], revealed = keyIndexFor(TODAY - 1, ANCHOR_DAY) } = {}) => ({
  ...noChain,
  async readContract({ functionName }) {
    if (functionName === "splitAnchor") return anchor;
    if (functionName === "splitAnchorDay") return ANCHOR_DAY;
    if (functionName === "splitKeysRevealed") return revealed;
    throw new Error(`unexpected read: ${functionName}`);
  },
});

function encodes(functionName, args) {
  try {
    encodeFunctionData({ abi: MRO_ABI, functionName, args });
  } catch (e) {
    assert.fail(`${functionName} args are not ABI-encodable: ${e.shortMessage ?? e.message}`);
  }
}

/// Records every send, encoded against the real ABI; refuses `refuse` as a
/// simulate revert; lists in `landed` the sends it let through.
function writerRefusing(refuse = null) {
  const sent = [];
  const landed = [];
  return {
    sent,
    landed,
    formatGas: (w) => `${w} wei`,
    async gasOk() { return { ok: true, gasPrice: 1n, capWei: 2n }; },
    async startRun() { return 0; },
    async send(functionName, args) {
      encodes(functionName, args);
      sent.push({ functionName, args });
      if (functionName === refuse) return { ok: false, reason: "reverted-on-simulate" };
      landed.push({ functionName, args });
      return { ok: true, hash: `0x${sent.length}` };
    },
  };
}

const baseArgs = (q) => ({
  q, contract: "0xcontract", chainId: 84532, today: TODAY, log: () => {}, alert: () => {},
});

/// A written token 1 with one queued credit on `day`, optionally answered.
function rigWithOneCredit({ day, answer = null, questionId = null, n = null }) {
  const db = openDb(":memory:");
  const q = queries(db);
  seedPaidMint(q, { tokenId: 1, toAddress: "0x" + "11".repeat(20), keyId: "k1" });
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0x" + "11".repeat(20), lastDay: day - 1, mintDay: day - 5 });
  db.exec("UPDATE mints SET status = 'written' WHERE tokenId = 1");
  db.exec("UPDATE tokens SET status = 'written' WHERE tokenId = 1");
  q.insertCredit(1, day, "sig");
  if (questionId) {
    q.issueQuestion(1, day, questionId, 1, n);
    if (answer !== null) q.recordAnswer(1, day, answer, 2);
  }
  return { q, writer: writerRefusing() };
}

/// A paid, solved mint of `tokenId` on `day`.
function rigWithOneMint({ day, tokenId }) {
  const db = openDb(":memory:");
  const q = queries(db);
  seedPaidMint(q, { tokenId, toAddress: "0x" + "11".repeat(20), keyId: `k${tokenId}` });
  q.insertToken({ tokenId, keyId: `k${tokenId}`, owner: "0x" + "11".repeat(20), lastDay: day, mintDay: day });
  db.exec(`UPDATE mints SET qr = '${QR}', solveState = 'done' WHERE tokenId = ${tokenId}`);
  return { q, writer: writerRefusing() };
}

test("a run with writes reveals every key through yesterday first", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, questionId: "fog-or-thunder" });
  await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith({ revealed: 5 }), writer, splitKeys: KEYS, bank: BANK });
  assert.equal(writer.sent[0].functionName, "revealSplitKeys");
  assert.deepEqual(writer.sent[0].args[0], KEYS.slice(6, keyIndexFor(TODAY - 1, ANCHOR_DAY) + 1));
  const questions = JSON.parse(hexToString(writer.sent[0].args[1]));
  assert.deepEqual(questions, [{ day: TODAY - 1, question: "Fog or thunder?", answers: ["fog", "thunder"] }]);
});

test("a run whose keys are already revealed still marks the night with an empty reveal", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.sent.map((s) => s.functionName), ["revealSplitKeys", "batchCheckIn"]);
  assert.deepEqual(writer.sent[0].args[0], []);
});

test("a run with nothing to write reveals nothing", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const writer = writerRefusing();
  await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith({ revealed: 5 }), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.sent, []);
});

test("an answered credit carries the split's bit and its index", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, answer: 1, questionId: "fog-or-thunder" });
  await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  const batch = writer.sent.find((s) => s.functionName === "batchCheckIn");
  const want = answerBit({ keyHex: keyOf(TODAY - 1), n: 2, answer: 1, tokenId: 1 });
  assert.equal(batch.args[2], want ? "0x80" : "0x00");
  assert.equal(batch.args[3], "0x01");
});

test("a range answer's set size is max - min + 1", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, answer: 37, questionId: "legs" });
  await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  const batch = writer.sent.find((s) => s.functionName === "batchCheckIn");
  const want = answerBit({ keyHex: keyOf(TODAY - 1), n: 101, answer: 37, tokenId: 1 });
  assert.equal(batch.args[2], want ? "0x80" : "0x00");
  assert.equal(batch.args[3], "0x25");
});

test("a silent credit carries the token's coin flip and 0xff", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  const batch = writer.sent.find((s) => s.functionName === "batchCheckIn");
  assert.equal(batch.args[2], silentBit(keyOf(TODAY - 1), 1) ? "0x80" : "0x00");
  assert.equal(batch.args[3], "0xff");
});

test("a mint carries the mint day's coin flip", async () => {
  for (const tokenId of [7, 8, 9, 10]) {
    const { q, writer } = rigWithOneMint({ day: TODAY - 1, tokenId });
    await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
    const mint = writer.sent.find((s) => s.functionName === "mint");
    assert.equal(mint.args.at(-1), silentBit(keyOf(TODAY - 1), tokenId) === 1);
  }
});

test("no seed: nothing is written", async () => {
  const said = [];
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: null, bank: BANK, alert: (m) => said.push(m) });
  assert.deepEqual(writer.sent, []);
  assert.ok(summary.aborted);
  assert.ok(said.some((m) => /split seed/.test(m)));
});

test("a seed that does not hash to the chain's anchor writes nothing, and names no key", async () => {
  const said = [];
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith({ anchor: "0x" + "44".repeat(32) }), writer, splitKeys: KEYS, bank: BANK, alert: (m) => said.push(m) });
  assert.deepEqual(writer.sent, []);
  assert.ok(summary.aborted);
  assert.ok(said.length > 0);
  for (const m of said) {
    assert.ok(!m.includes(SEED.slice(2)), "the seed is never said");
    assert.ok(!KEYS.slice(0, 50).some((k) => m.includes(k.slice(2))), "no key is said");
  }
});

test("a contract with no anchor writes nothing", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith({ anchor: "0x" + "00".repeat(32) }), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.sent, []);
  assert.ok(summary.aborted);
});

test("a credit whose question left the bank writes nothing", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, answer: 0, questionId: "gone" });
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.sent, []);
  assert.ok(summary.aborted);
});

test("a recorded answer outside its question's set writes nothing", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, answer: 5, questionId: "fog-or-thunder" });
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.sent, []);
  assert.ok(summary.aborted);
});

test("a failed reveal writes nothing else", async () => {
  const { q } = rigWithOneCredit({ day: TODAY - 1 });
  const writer = writerRefusing("revealSplitKeys");
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith({ revealed: 5 }), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.landed, []);
  assert.ok(summary.aborted);
});

// ---------------------------------------------------------------------------
// Loading the seed. Every refusal is a fixed sentence: never the path (it
// carries the home directory) and never the value.
// ---------------------------------------------------------------------------

import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSplitSeed, splitSeedPath } from "../src/clock/splitSeed.mjs";
import { trustingProver } from "./trusting-prover.mjs";

const seedFile = (text, mode = 0o600) => {
  const path = join(mkdtempSync(join(tmpdir(), "mro-seed-")), "seed");
  writeFileSync(path, text, { mode });
  chmodSync(path, mode);
  return path;
};

test("a 0600 seed file loads, with or without 0x and a trailing newline", () => {
  assert.equal(loadSplitSeed(seedFile(SEED + "\n")), SEED);
  assert.equal(loadSplitSeed(seedFile(SEED.slice(2))), SEED);
});

test("a seed readable by anyone else is refused, naming neither path nor value", () => {
  const path = seedFile(SEED, 0o644);
  assert.throws(() => loadSplitSeed(path), (err) => {
    assert.match(err.message, /readable by other users/);
    assert.ok(!err.message.includes(path) && !err.message.includes(SEED.slice(2)));
    return true;
  });
});

test("a malformed seed is refused without quoting it", () => {
  const bad = "0x" + "zz".repeat(32);
  assert.throws(() => loadSplitSeed(seedFile(bad)), (err) => !err.message.includes("zz") && /64 hex/.test(err.message));
});

test("a missing seed is refused without naming the path", () => {
  const path = join(tmpdir(), "mro-no-such-seed-dir", "seed");
  assert.throws(() => loadSplitSeed(path), (err) => !err.message.includes(path) && /split seed not found/.test(err.message));
});

test("the seed path defaults outside the worktree and can be overridden", () => {
  assert.match(splitSeedPath({}), /\.mro-split[/\\]seed$/);
  assert.equal(splitSeedPath({ MRO_SPLIT_SEED_FILE: "/elsewhere/seed" }), "/elsewhere/seed");
});

test("the first question issued on a day is that day's question for every token", () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.issueQuestion(1, 500, "fog-or-thunder", 1);
  // A bank edit and a restart would pick another; the day keeps the first.
  assert.equal(q.issueQuestion(2, 500, "legs", 2).questionId, "fog-or-thunder");
  assert.equal(q.issueQuestion(3, 501, "legs", 3).questionId, "legs", "a new day picks afresh");
});

test("a day that somehow holds two questions writes nothing", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, answer: 0, questionId: "fog-or-thunder" });
  await runClock({ prover: trustingProver(),
    ...baseArgs(q),
    q: { ...q, questionsForDays: () => [{ day: TODAY - 1, questionId: "fog-or-thunder" }, { day: TODAY - 1, questionId: "legs" }] },
    publicClient: chainWith({ revealed: 5 }), writer, splitKeys: KEYS, bank: BANK,
  });
  assert.deepEqual(writer.sent, []);
});

// A HOSTILE RPC CHOOSES today(). The reveal follows the earlier of its day and
// the box's, never reaches the seed, and is bounded per night.
test("an RPC claiming a later day cannot advance the reveal past the box's day", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  await runClock({ prover: trustingProver(), ...baseArgs(q), today: TODAY + 60, boxDay: TODAY, publicClient: chainWith({ revealed: 5 }), writer, splitKeys: KEYS, bank: BANK });
  assert.deepEqual(writer.sent[0].args[0], KEYS.slice(6, keyIndexFor(TODAY - 1, ANCHOR_DAY) + 1));
});

test("one night reveals at most MAX_KEYS_PER_REVEAL keys", async () => {
  const today = ANCHOR_DAY + 100;
  const { q, writer } = rigWithOneCredit({ day: today - 1 });
  await runClock({ prover: trustingProver(), ...baseArgs(q), today, boxDay: today, publicClient: chainWith({ revealed: 0 }), writer, splitKeys: KEYS, bank: BANK });
  assert.equal(writer.sent[0].args[0].length, MAX_KEYS_PER_REVEAL);
  assert.deepEqual(writer.sent[0].args[0], KEYS.slice(1, MAX_KEYS_PER_REVEAL + 1));
});

test("the seed itself is never revealed, however late the day", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1 });
  const readSplit = async () => ({ anchor: KEYS[0], anchorDay: TODAY - 40_000, revealed: CHAIN_LENGTH - 2 });
  await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: noChain, readSplit, writer, splitKeys: KEYS, bank: BANK });
  const keys = writer.sent[0].args[0];
  assert.deepEqual(keys, [KEYS[CHAIN_LENGTH - 1]]);
  assert.ok(!keys.includes(KEYS[CHAIN_LENGTH]), "the seed went out");
});

test("a queued credit whose question now offers a different number of answers writes nothing", async () => {
  // Asked when "fog-or-thunder" offered three answers; the bank now offers two.
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, questionId: "fog-or-thunder", answer: 1, n: 3 });
  const alerts = [];
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer,
    splitKeys: KEYS, bank: BANK, alert: (m) => alerts.push(m) });
  assert.equal(summary.aborted, "split");
  assert.equal(writer.sent.length, 0);
  assert.ok(alerts.some((a) => /different number of answers from when it was asked/.test(a)));
});

test("CONTROL: the same credit with the answer count it was asked with is written", async () => {
  const { q, writer } = rigWithOneCredit({ day: TODAY - 1, questionId: "fog-or-thunder", answer: 1, n: 2 });
  const summary = await runClock({ prover: trustingProver(), ...baseArgs(q), publicClient: chainWith(), writer, splitKeys: KEYS, bank: BANK });
  assert.equal(summary.aborted, null);
  assert.deepEqual(writer.sent.map((x) => x.functionName), ["revealSplitKeys", "batchCheckIn"]);
});
