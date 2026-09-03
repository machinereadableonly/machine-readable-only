// One Clock run, end to end, against stubs. No network, no key, no chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData } from "viem";
import { MRO_ABI } from "../src/clock/abi.mjs";
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";
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
///
/// IT ALSO ENCODES. Recording arguments proves nothing about whether the
/// contract would accept them: on 2026-09-03 the Clock passed a base64url key
/// id to a bytes32 parameter and every test still passed, because no test
/// double had ever tried to encode a call. encodeFunctionData against the real
/// ABI turns a wrong type into a failure here rather than on the chain.
function assertEncodable(functionName, args) {
  try {
    encodeFunctionData({ abi: MRO_ABI, functionName, args });
  } catch (e) {
    assert.fail(`${functionName} args are not ABI-encodable: ${e.shortMessage ?? e.message}`);
  }
}

function okWriter(overrides = {}) {
  const sent = [];
  return {
    sent,
    formatGas: (w) => `${w} wei`,
    async gasOk() { return { ok: true, gasPrice: 6_000_000n, capWei: 50_000_000n }; },
    async startRun() { return 0; },
    async send(functionName, args, opts) {
      assertEncodable(functionName, args);
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

/// A chain that holds token `tokenId` for a given owner and agent key, so the
/// Clock can tell ITS OWN mint apart from somebody else's token at the same id.
const chainHolding = ({ owner, agentKeyId }) => ({
  ...noChain,
  async readContract({ functionName }) {
    if (functionName === "ownerOf") return owner;
    if (functionName === "viewOf") return { agentKeyId };
    throw new Error(`unexpected read: ${functionName}`);
  },
});

const MINE = { owner: "0x" + "11".repeat(20), agentKeyId: keyIdToBytes32("k1") };

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

/// TokenExists, every time, so the two tests below differ only in WHOSE token
/// the chain already holds at that id.
const tokenExistsWriter = () => okWriter({
  async send(fn, args, opts) {
    assertEncodable(fn, args);
    this.sent.push({ functionName: fn, args, label: opts?.label });
    return { ok: false, reason: "reverted-on-simulate", errorName: "TokenExists", errorArgs: ["1"] };
  },
});

// Cause one: a previous run landed this very mint. The mirror was behind, not
// wrong, and retrying it every night forever is noise.
test("a mint the chain already has AS THIS MINT is marked written", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  const alerts = [];
  const summary = await runClock({
    ...baseArgs(q), publicClient: chainHolding(MINE),
    writer: tokenExistsWriter(), alert: (m) => alerts.push(m),
  });
  assert.deepEqual(summary.minted, []);
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "written");
  assert.ok(alerts.some((a) => /already on chain as this mint/.test(a)));
});

// Cause two, and the one that cost a real paid mint on 2026-09-03. A DIFFERENT
// token holds that id, so this mint never happened. Closing the row here would
// report success for a token that does not exist, to an agent that has paid.
test("a mint blocked by SOMEBODY ELSE'S token is left queued, not closed", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  const alerts = [];
  const summary = await runClock({
    ...baseArgs(q),
    publicClient: chainHolding({ owner: "0x" + "99".repeat(20), agentKeyId: "someone-else" }),
    writer: tokenExistsWriter(), alert: (m) => alerts.push(m),
  });
  assert.deepEqual(summary.minted, []);
  assert.equal(
    db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "queued",
    "a PAID mint that did not happen must not be marked written"
  );
  assert.deepEqual(summary.stuckMints, [1]);
  assert.ok(alerts.some((a) => /DIFFERENT token/.test(a) && /needs a human/.test(a)));
});

// An unreadable chain is neither cause. Guessing either way is what the fix is
// for, so the row stays queued and a human is told.
test("a mint whose id cannot be identified on chain is left queued", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  const alerts = [];
  const summary = await runClock({
    ...baseArgs(q),
    publicClient: { ...noChain, async readContract() { throw new Error("rpc down"); } },
    writer: tokenExistsWriter(), alert: (m) => alerts.push(m),
  });
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "queued");
  assert.deepEqual(summary.stuckMints, [1]);
  assert.ok(alerts.some((a) => /could not be identified/.test(a)));
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

// THE VARIANT HAS TO REACH THE CHAIN. applyMark takes three arguments, and the
// shape or ink an agent paid for lives only in this third one -- a Clock that
// drops it writes a target Iris to somebody who bought a leaf, permanently.
//
// The stub writer records arguments instead of encoding them, which is exactly
// why src/clock/abi.mjs went stale unnoticed. test/abi.test.mjs covers the
// encoding side; this covers the value being passed at all.
test("the Clock passes the variant to applyMark", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  db.exec("UPDATE mints SET status = 'written' WHERE tokenId = 1");
  q.reserveMark(1, 5, 2);                       // the bought Iris, leaf
  const writer = okWriter();
  await runClock({ ...baseArgs(q), writer });

  const call = writer.sent.find((c) => c.functionName === "applyMark");
  assert.deepEqual(call.args, [1n, 5, 2]);
});

test("a Mark with no variant still sends an explicit zero, never undefined", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  db.exec("UPDATE mints SET status = 'written' WHERE tokenId = 1");
  q.reserveMark(1, 1);
  const writer = okWriter();
  await runClock({ ...baseArgs(q), writer });

  const call = writer.sent.find((c) => c.functionName === "applyMark");
  assert.deepEqual(call.args, [1n, 1, 0]);
  assert.equal(typeof call.args[2], "number", "undefined encoded as a uint8 is a throw");
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

// --- a mark order the chain will never accept --------------------------------
//
// Before this, a refused order stayed 'queued' forever: every run re-sent the
// same doomed applyMark and alerted again, so a real problem arrived nightly
// and looked identical to the night before. `mints` already had 'failed' plus
// stuckMints for exactly this; mark_orders had neither.

/// A token that exists on chain with one Mark queued for it.
function queueMark(q, db, { tokenId = 1, upgradeId = 3, variant = 0 } = {}) {
  queueMint(q, db, tokenId);
  db.exec(`UPDATE mints SET status = 'written' WHERE tokenId = ${tokenId}`);
  q.reserveMark(tokenId, upgradeId, variant);
}

/// A writer that refuses one named function on SIMULATION, the way the chain
/// refuses a call it can already see will revert.
const refusingWriter = (errorName, functionName = "applyMark") => okWriter({
  async send(fn, args, opts) {
    if (fn !== functionName) return { ok: true, hash: "0x1" };
    this.sent.push({ functionName: fn, args, label: opts?.label });
    return { ok: false, reason: "reverted-on-simulate", errorName, detail: errorName };
  },
});

test("a mark order the chain refuses is failed once, not retried nightly", async () => {
  const { db, q } = mirror();
  queueMark(q, db, {});
  const alerts = [];
  const first = refusingWriter("MarkExcluded");
  const summary = await runClock({ ...baseArgs(q), writer: first, alert: (m) => alerts.push(m) });

  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "failed");
  assert.equal(summary.stuckMarks.length, 1);
  assert.equal(summary.stuckMarks[0].upgradeId, 3);
  assert.equal(alerts.filter((a) => /needs a human/.test(a)).length, 1);

  // The next run neither re-sends it nor alerts again. It is still reported --
  // in the summary and at log level -- so it cannot be forgotten either.
  const logs = [];
  const laterAlerts = [];
  const second = refusingWriter("MarkExcluded");
  const again = await runClock({
    ...baseArgs(q), writer: second, alert: (m) => laterAlerts.push(m), log: (m) => logs.push(m),
  });
  assert.equal(second.sent.filter((s) => s.functionName === "applyMark").length, 0,
    "the doomed call was sent a second time");
  assert.deepEqual(laterAlerts, [], "a standing failure alerted again and told nobody anything new");
  assert.equal(again.stuckMarks.length, 1, "and it is still reported");
  assert.equal(logs.filter((l) => /waiting for a human/.test(l)).length, 1);
});

// THE CONTROL. A refusal that is not the chain's own verdict -- a public RPC
// having a bad minute -- must NOT be terminal, or a token that paid $1,250.00
// for a Vessel loses it to a dropped connection.
test("a transient send failure leaves the order queued and it is retried", async () => {
  const { db, q } = mirror();
  queueMark(q, db, { upgradeId: 7 });
  const flaky = okWriter({
    async send(fn, args, opts) {
      if (fn !== "applyMark") return { ok: true, hash: "0x1" };
      this.sent.push({ functionName: fn, args, label: opts?.label });
      return { ok: false, reason: "send-failed", detail: "socket hang up" };
    },
  });
  const summary = await runClock({ ...baseArgs(q), writer: flaky });

  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "queued");
  assert.deepEqual(summary.stuckMarks, []);

  const second = okWriter();
  await runClock({ ...baseArgs(q), writer: second });
  assert.equal(second.sent.filter((s) => s.functionName === "applyMark").length, 1,
    "the retry never happened");
  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "written");
});

// The chain already has it, so the agent has what it paid for and only the
// mirror was behind. Same answer as TokenExists gives a mint.
test("MarkAlreadyApplied catches the mirror up instead of failing the order", async () => {
  const { db, q } = mirror();
  queueMark(q, db, { upgradeId: 4 });
  const alerts = [];
  const writer = refusingWriter("MarkAlreadyApplied");
  const summary = await runClock({ ...baseArgs(q), writer, alert: (m) => alerts.push(m) });

  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "written");
  assert.equal(q.getToken(1).marks, 1 << 4, "the mirror's mask caught up");
  assert.deepEqual(summary.stuckMarks, []);
  assert.equal(alerts.filter((a) => /already on token/.test(a)).length, 1);
});

// N1, from the final re-review of Plan 5. Making EVERY simulated revert terminal
// was too broad: three of applyMark's named errors mean "the chain is behind",
// not "refused forever", and since a failed row also closes the other side of
// its pair, treating one as final forfeits a Mark nobody refused.
test("a revert that means the chain is behind stays queued, and lands on the retry", async () => {
  const { db, q } = mirror();
  // NoSuchToken is the reachable one: a mint whose send failed is explicitly not
  // run-level, so the Clock goes on to applyMark for a token the chain has not
  // seen yet. Under a blanket rule that cost the agent a paid Hush AND the free
  // Ache in its pair, to one dropped socket.
  queueMark(q, db, { upgradeId: 1 });
  const behind = refusingWriter("NoSuchToken");
  const summary = await runClock({ ...baseArgs(q), writer: behind });

  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "queued");
  assert.deepEqual(summary.stuckMarks, []);

  const second = okWriter();
  await runClock({ ...baseArgs(q), writer: second });
  assert.equal(second.sent.filter((s) => s.functionName === "applyMark").length, 1,
    "the order was never retried once the token existed");
  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "written");
});

test("the gates the mirror can be wrong about are not terminal either", async () => {
  // MarkGate is a level or streak the chain has not credited yet, and
  // MarkRequires is an Iris still queued in this very run. Both resolve on their
  // own; neither is the chain refusing the Mark itself.
  for (const errorName of ["MarkGate", "MarkRequires", "MarkInactive"]) {
    const { db, q } = mirror();
    queueMark(q, db, { upgradeId: 9 });
    const summary = await runClock({ ...baseArgs(q), writer: refusingWriter(errorName) });
    assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status,
      "queued", `${errorName} was treated as final`);
    assert.deepEqual(summary.stuckMarks, [], `${errorName} was reported as stuck`);
  }
});

// TODAY'S STATE, and the reason this is not merely theoretical. The deployed
// contract has the TWO-argument applyMark, so the Clock's three-argument call
// reverts with no named error at all. That must leave the queue intact for the
// redeploy rather than killing every order taken before it.
test("a revert with no named error is not terminal", async () => {
  const { db, q } = mirror();
  queueMark(q, db, { upgradeId: 3 });
  const summary = await runClock({ ...baseArgs(q), writer: refusingWriter(null) });

  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "queued");
  assert.deepEqual(summary.stuckMarks, []);
});
