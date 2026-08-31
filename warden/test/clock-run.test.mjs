// One Clock run, end to end, against stubs. No network, no key, no chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runClock, CHECKIN_CHUNK } from "../src/clock/run.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";

const TODAY = 20_700;
const QR = "ab".repeat(172);

function mirror() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

/// A token that has been paid for and solved, ready to mint.
function queueMint(q, db, tokenId, { solveState = "done" } = {}) {
  q.insertMint({ tokenId, toAddress: "0x" + "11".repeat(20), keyId: `k${tokenId}` });
  q.insertToken({ tokenId, keyId: `k${tokenId}`, owner: "0x" + "11".repeat(20), lastDay: TODAY - 5, mintDay: TODAY - 5 });
  db.exec(`UPDATE mints SET qr = '${QR}', solveState = '${solveState}' WHERE tokenId = ${tokenId}`);
}

/// A writer that says yes to everything and records what it was asked to send.
function okWriter(overrides = {}) {
  const sent = [];
  return {
    sent,
    formatGas: (w) => `${w} wei`,
    async gasOk() { return { ok: true, gasPrice: 6_000_000n, capWei: 50_000_000n }; },
    async startRun() { return 0; },
    async send(functionName, args, opts) {
      sent.push({ functionName, args, label: opts?.label });
      return { ok: true, hash: `0x${sent.length}` };
    },
    ...overrides,
  };
}

const noChain = {
  async getBlockNumber() { return 46_163_891n; },
  async getLogs() { return []; },
};

const baseArgs = (q) => ({
  q,
  publicClient: noChain,
  contract: "0xcontract",
  chainId: 84532,
  today: TODAY,
  log: () => {},
  alert: () => {},
});

// THE GAS GUARD STOPS THE WHOLE RUN. Writing the mints and abandoning the
// check-ins would leave the mirror half-applied; waiting costs only latency,
// because a pending row keeps its own day number.
test("gas above the cap writes nothing at all", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  const writer = okWriter({
    async gasOk() { return { ok: false, gasPrice: 900_000_000n, capWei: 50_000_000n }; },
  });
  const alerts = [];
  const summary = await runClock({ ...baseArgs(q), writer, alert: (m) => alerts.push(m) });

  assert.equal(summary.gasStopped, true);
  assert.deepEqual(summary.minted, []);
  assert.equal(writer.sent.length, 0, "not one transaction was sent");
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "queued");
  assert.match(alerts[0], /above the cap/);
});

test("a solved, paid mint is written and both rows move to written", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  const writer = okWriter();
  const summary = await runClock({ ...baseArgs(q), writer });

  assert.deepEqual(summary.minted, [1]);
  assert.equal(writer.sent[0].functionName, "mint");
  assert.equal(writer.sent[0].args[0], 1n, "the id is passed as the uint256 the contract takes");
  assert.equal(writer.sent[0].args[3], `0x${QR}`, "the solved bitmap, hex-prefixed");
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "written");
  assert.equal(q.getToken(1).status, "written");
});

// The contract writes `code` once and permanently, so a placeholder makes a
// permanently broken artwork out of a merely delayed one. The agent has paid.
test("a mint whose artwork never solved is NOT written, and a human is told", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1, { solveState: "failed" });
  const writer = okWriter();
  const alerts = [];
  const summary = await runClock({ ...baseArgs(q), writer, alert: (m) => alerts.push(m) });

  assert.deepEqual(summary.minted, []);
  assert.deepEqual(summary.stuck, [1]);
  assert.equal(writer.sent.filter((s) => s.functionName === "mint").length, 0);
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "queued");
  assert.match(alerts[0], /paid for but its artwork failed to solve/);
});

test("only days that have CLOSED are written: today's check-in waits for tomorrow", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  db.exec("UPDATE mints SET status = 'written' WHERE tokenId = 1");
  q.insertCredit(1, TODAY - 1, "sig-yesterday");
  q.insertCredit(1, TODAY, "sig-today");

  const writer = okWriter();
  const summary = await runClock({ ...baseArgs(q), writer });

  assert.deepEqual(summary.credited.map((e) => e.day), [TODAY - 1]);
  const batch = writer.sent.find((s) => s.functionName === "batchCheckIn");
  assert.deepEqual(batch.args[1], [TODAY - 1]);
  assert.equal(db.prepare(`SELECT status FROM credits WHERE day = ${TODAY}`).get().status, "queued");
});

test("mints are written BEFORE check-ins, so a token minted this run can be credited in it", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  q.insertCredit(1, TODAY - 1, "sig");
  const writer = okWriter();
  await runClock({ ...baseArgs(q), writer });

  const order = writer.sent.map((s) => s.functionName);
  assert.equal(order.indexOf("mint") < order.indexOf("batchCheckIn"), true, `order was ${order.join(", ")}`);
});

test("a refused entry is dropped, the rest land, and the dropped row stays queued for another night", async () => {
  const { db, q } = mirror();
  for (const id of [1, 2]) {
    queueMint(q, db, id);
    db.exec(`UPDATE mints SET status = 'written' WHERE tokenId = ${id}`);
  }
  q.insertCredit(1, TODAY - 1, "sig1");
  q.insertCredit(2, TODAY - 1, "sig2");

  let call = 0;
  const writer = okWriter({
    async send(fn, args, opts) {
      this.sent.push({ functionName: fn, args, label: opts?.label });
      if (fn === "batchCheckIn" && ++call === 1) {
        return { ok: false, reason: "reverted-on-simulate", errorName: "Resting", errorArgs: ["2"] };
      }
      return { ok: true, hash: "0x1" };
    },
  });
  const alerts = [];
  const summary = await runClock({ ...baseArgs(q), writer, alert: (m) => alerts.push(m) });

  assert.deepEqual(summary.credited.map((e) => e.tokenId), [1]);
  assert.deepEqual(summary.dropped.map((d) => [d.entry.tokenId, d.reason]), [[2, "Resting"]]);
  assert.equal(db.prepare("SELECT status FROM credits WHERE tokenId = 1").get().status, "written");
  assert.equal(db.prepare("SELECT status FROM credits WHERE tokenId = 2").get().status, "queued");
  assert.ok(alerts.some((a) => /token 2 day .* was refused \(Resting\)/.test(a)));
});

// Continuing through a queue of mints while the piece is paused turns one
// refusal into a hundred.
for (const errorName of ["NotWarden", "Sunset", "EnforcedPause"]) {
  test(`${errorName} on a mint aborts the run instead of trying every other row`, async () => {
    const { db, q } = mirror();
    for (const id of [1, 2, 3]) queueMint(q, db, id);
    const writer = okWriter({
      async send(fn, args, opts) {
        this.sent.push({ functionName: fn, args, label: opts?.label });
        return { ok: false, reason: "reverted-on-simulate", errorName, errorArgs: [] };
      },
    });
    const summary = await runClock({ ...baseArgs(q), writer });
    assert.equal(summary.aborted, errorName);
    assert.equal(writer.sent.length, 1, "one attempt, then stop");
  });
}

// The mirror was behind, not wrong. Retrying this every night forever is noise.
test("a mint the chain already has is marked written rather than retried nightly", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  const alerts = [];
  const writer = okWriter({
    async send(fn, args, opts) {
      this.sent.push({ functionName: fn, args, label: opts?.label });
      return { ok: false, reason: "reverted-on-simulate", errorName: "TokenExists", errorArgs: ["1"] };
    },
  });
  const summary = await runClock({ ...baseArgs(q), writer, alert: (m) => alerts.push(m) });
  assert.deepEqual(summary.minted, []);
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "written");
  assert.ok(alerts.some((a) => /already existed on chain/.test(a)));
});

test("a Mark that lands is written and its bit is set", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  db.exec("UPDATE mints SET status = 'written' WHERE tokenId = 1");
  q.reserveMark(1, 2);
  const writer = okWriter();
  const summary = await runClock({ ...baseArgs(q), writer });

  // Compared field by field, not deep-equal against a literal: node:sqlite
  // returns rows with a null prototype, so an identical-looking object is not
  // deep-equal to one built with braces.
  assert.equal(summary.marks.length, 1);
  assert.equal(summary.marks[0].tokenId, 1);
  assert.equal(summary.marks[0].upgradeId, 2);
  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "written");
  assert.equal(q.getToken(1).marks, 1 << 2);
});

// A crash mid-run must not double-write. Nothing is chosen from a counter;
// everything is chosen by reading rows the last run left queued.
test("running twice writes each row exactly once", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  q.insertCredit(1, TODAY - 1, "sig");

  const first = okWriter();
  await runClock({ ...baseArgs(q), writer: first });
  const second = okWriter();
  const summary = await runClock({ ...baseArgs(q), writer: second });

  assert.deepEqual(summary.minted, [], "nothing left to mint");
  assert.deepEqual(summary.credited, [], "nothing left to credit");
  assert.equal(second.sent.length, 0, "the second run sent no transactions at all");
});

test("an empty queue is a clean no-op, not an EmptyBatch revert", async () => {
  const { q } = mirror();
  const writer = okWriter();
  const summary = await runClock({ ...baseArgs(q), writer });
  assert.equal(writer.sent.length, 0);
  assert.equal(summary.aborted, null);
});

test("the chunk size is the spec's, and is applied", async () => {
  assert.equal(CHECKIN_CHUNK, 1500);
  const { db, q } = mirror();
  queueMint(q, db, 1);
  db.exec("UPDATE mints SET status = 'written' WHERE tokenId = 1");
  for (let day = TODAY - 5; day < TODAY - 1; day += 1) q.insertCredit(1, day, `s${day}`);

  const writer = okWriter();
  await runClock({ ...baseArgs(q), writer, chunkSize: 2 });
  const batches = writer.sent.filter((s) => s.functionName === "batchCheckIn");
  assert.equal(batches.length, 2, "four entries at a chunk size of two");
});

test("reconcile refuses to guess at its history on an unknown chain", async () => {
  const { q } = mirror();
  await assert.rejects(
    () => runClock({ ...baseArgs(q), chainId: 1, writer: okWriter() }),
    /no deploy block recorded for chain 1/
  );
});
