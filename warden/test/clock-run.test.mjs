// One Clock run, end to end, against stubs. No network, no key, no chain.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeFunctionData } from "viem";
import { MRO_ABI } from "../src/clock/abi.mjs";
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";
import { runClock, CHECKIN_CHUNK } from "../src/clock/run.mjs";
import { MAX_TX_GAS } from "../src/clock/write.mjs";
// DERIVED, not hardcoded: this changes with every redeploy, and a test that
// pins the old value fails for a reason that has nothing to do with what it
// is testing. The 2026-09-06 redeploy broke two tests exactly that way.
import { DEPLOY_BLOCK } from "../src/clock/reconcile.mjs";

const FLOOR = DEPLOY_BLOCK[84532];
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

const TODAY = 20_700;
const QR = "ab".repeat(172);

function mirror() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

/// A token that has been paid for and solved, ready to mint.
function queueMint(q, db, tokenId, { solveState = "done" } = {}) {
  seedPaidMint(q, { tokenId, toAddress: "0x" + "11".repeat(20), keyId: `k${tokenId}` });
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
  async getBlockNumber() { return FLOOR; },
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

// CHANGED 2026-09-05, deliberately. This used to assert the refused row "stays
// queued for another night", which was the defect rather than the intent: a
// `Resting` credit is condemned for a reason that will be identical tomorrow,
// so re-offering it every night forever produced one alert a night and no
// progress -- and `mints` and `mark_orders` both had a terminal state for
// exactly this while `credits` did not. The row is now terminal and the run
// fails, so somebody sees it once and can act.
test("a refused entry is dropped, the rest land, and the dropped row goes terminal", async () => {
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
  assert.equal(db.prepare("SELECT status FROM credits WHERE tokenId = 2").get().status, "failed");
  assert.deepEqual(summary.stuckCredits.map((d) => d.entry.tokenId), [2]);
  assert.ok(alerts.some((a) => /token 2 day .* was refused \(Resting\) and needs a human/.test(a)));
  // And it is not offered again: the next run sees nothing to do for token 2.
  assert.deepEqual(q.pendingCredits(TODAY).map((e) => e.tokenId), []);
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

test("the chunk size is the one the contract suite measures, and is applied", async () => {
  // contracts/test/CheckIn.t.sol proves ONE number fits the Clock's guard: a
  // full chunk, isolated, padded as write.mjs pads it, leaving CHUNK_MARGIN
  // under MAX_TX_GAS. That proof is worth nothing for a different number, so
  // both constants are read out of the Solidity source and must be these.
  const sol = readFileSync(new URL("../../contracts/test/CheckIn.t.sol", import.meta.url), "utf8");
  const chunk = sol.match(/uint32 internal constant CHECKIN_CHUNK = ([\d_]+);/);
  const cap = sol.match(/uint256 internal constant MAX_TX_GAS = ([\d_]+);/);
  assert.ok(chunk && cap, "CheckIn.t.sol no longer declares CHECKIN_CHUNK and MAX_TX_GAS");
  assert.equal(CHECKIN_CHUNK, Number(chunk[1].replaceAll("_", "")), "run.mjs and CheckIn.t.sol disagree on the chunk size");
  assert.equal(MAX_TX_GAS, BigInt(cap[1].replaceAll("_", "")), "write.mjs and CheckIn.t.sol disagree on the gas guard");

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

// 4.L9. A run-level refusal used to `return summary` from inside the mints
// loop, which skipped reconcile with it -- so a paused or sunset contract
// stopped the mirror LEARNING as well as writing, for as long as the pause
// lasted. `Rested` is exactly what a token owner does while the piece is shut,
// and reconcile makes no writes to the chain, so it cannot fail for the reason
// that stopped the sends.
test("a run aborted by the contract still reconciles, and still sends nothing more", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  queueMint(q, db, 2);
  q.creditDay(1, TODAY - 1, 2, 2);              // a check-in that must NOT be sent
  q.reserveMark(1, 1, 0);                       // and a Mark that must not either

  let logsRead = 0;
  const paused = {
    ...noChain,
    // Past the deploy block by enough that reconcile has a window to read:
    // `noChain`'s head IS the deploy block, so reconcile there returns before
    // asking for a single log. Measured, not assumed -- the first version of
    // this test asserted on getLogs and failed for that reason.
    async getBlockNumber() { return FLOOR + 100n; },
    async getLogs() { logsRead += 1; return []; },
  };
  const writer = okWriter({
    async send(functionName, args, opts) {
      assertEncodable(functionName, args);
      writer.sent.push({ functionName, args, label: opts?.label });
      return { ok: false, reason: "reverted-on-simulate", errorName: "EnforcedPause" };
    },
  });

  const summary = await runClock({ ...baseArgs(q), publicClient: paused, writer });

  assert.equal(summary.aborted, "EnforcedPause", "the run still reports the abort, so it exits non-zero");
  assert.equal(writer.sent.length, 1, "it stopped at the first refusal rather than sending the queue");
  assert.equal(writer.sent[0].functionName, "mint");
  assert.ok(logsRead > 0, "reconcile still ran");
  assert.ok(summary.reconciled, "and its result is in the summary");
  // Nothing was recorded as done, because nothing was.
  assert.deepEqual(summary.minted, []);
  assert.deepEqual(summary.credited, []);
  assert.deepEqual(summary.marks, []);
});

// 4.L3. STALE_AFTER_RUNS was exported and read by nothing, and the spec's
// three-run alert did not exist -- so a row that failed quietly every night
// produced one ordinary log line a night and no signal at all. The window is
// measured from what the mirror already stores, which is why this needs no
// schema change and no run counter.
test("a row still queued after three runs raises an alert naming what it is", async () => {
  const { db, q } = mirror();
  // A credit for a day three runs ago that never landed.
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0x" + "11".repeat(20), lastDay: TODAY - 9, mintDay: TODAY - 9 });
  // `creditDay` advances the TOKEN row; the queue row is `insertCredit`. Both
  // are needed, and asserting on the wrong one is what this test did first.
  q.insertCredit(1, TODAY - 4, "sig");
  // And a paid mint reserved four days ago whose artwork never solved.
  queueMint(q, db, 2, { solveState: "failed" });
  db.exec(`UPDATE mints SET reservedAt = ${Date.now() - 4 * 86_400_000} WHERE tokenId = 2`);

  // The check-in must still be QUEUED when staleness is counted, so the writer
  // refuses it in a way that is not terminal -- exactly the case the alert is
  // for. `send-failed` is a bad minute on a public RPC, which is why the row is
  // kept rather than condemned, and why it can then sit there unnoticed.
  const alerts = [];
  const flaky = okWriter({
    async send(functionName, args, opts) {
      assertEncodable(functionName, args);
      flaky.sent.push({ functionName, args, label: opts?.label });
      if (functionName === "batchCheckIn") return { ok: false, reason: "send-failed" };
      return { ok: true, hash: "0x1" };
    },
  });
  const summary = await runClock({ ...baseArgs(q), writer: flaky, alert: (m) => alerts.push(m) });

  const stale = alerts.find((a) => a.includes("queued for 3 runs or more"));
  assert.ok(stale, `expected a staleness alert, got ${JSON.stringify(alerts)}`);
  assert.match(stale, /1 mint\(s\)/);
  assert.match(stale, /1 credit\(s\)/);
  assert.equal(summary.stale.credits.length, 1);
  assert.equal(summary.stale.mints.length, 1);
});

test("CONTROL: a fresh queue raises no staleness alert", async () => {
  const { db, q } = mirror();
  queueMint(q, db, 1);
  db.exec(`UPDATE mints SET reservedAt = ${Date.now()} WHERE tokenId = 1`);
  const alerts = [];
  await runClock({ ...baseArgs(q), writer: okWriter(), alert: (m) => alerts.push(m) });
  assert.equal(alerts.filter((a) => a.includes("queued for")).length, 0);
});

// ---------------------------------------------------------------------------
// A chain that disagrees with itself -- test gap 31 / finding 4.M2
// ---------------------------------------------------------------------------

// THE STUB WAS MORE CONSISTENT THAN THE REAL CHAIN. `noChain.getBlockNumber`
// always returns the deploy-era head and `getLogs` always returns [], so no
// test ever exercised a head that disagrees with what getLogs can actually see.
//
// That disagreement is measured, not hypothetical: batch.mjs's own comment
// records that this RPC is load-balanced and NOT read-after-write consistent,
// so the head can move backwards between two calls in the ordinary case. If
// reconcile read up to the raw head and advanced the cursor there, every block
// the lagging replica had not yet served would be skipped -- and skipped blocks
// are never offered again, so a `Rested` in one of them is lost permanently and
// that token tells /t/<id> it is alive forever.
//
// The mitigation is CONFIRMATIONS: reconcile trails the head by 12 blocks. These
// pin that it is real, because it is the only thing standing between a
// load-balanced RPC and an irreversible read.
test("reconcile trails the head, so a lagging replica cannot cost blocks", async () => {
  const { db, q } = mirror();
  const HEAD = 46_200_000n;
  const asked = [];
  const laggingChain = {
    async getBlockNumber() { return HEAD; },
    async getLogs({ fromBlock, toBlock }) {
      asked.push([fromBlock, toBlock]);
      // The replica serving logs is behind the one serving the head: it has
      // nothing for the last twelve blocks.
      return [];
    },
  };

  const summary = await runClock({
    ...baseArgs(q),
    publicClient: laggingChain,
    writer: okWriter(),
    lastReconciledBlock: HEAD - 100n,
  });

  assert.equal(
    summary.reconciled.to,
    HEAD - 12n,
    "the cursor must stop CONFIRMATIONS short of the head, not at it",
  );
  const highest = asked.reduce((max, [, to]) => (to > max ? to : max), 0n);
  assert.equal(highest, HEAD - 12n, "and no window may ask for a block past that");
  assert.ok(highest < HEAD, "the raw head is never read");
  db.close();
});

// The other half: when the head has NOT advanced past what was already
// reconciled, the run must ask the node for nothing rather than read a window
// that runs backwards.
test("a head that has not advanced asks the node for nothing", async () => {
  const { db, q } = mirror();
  const HEAD = 46_200_000n;
  const asked = [];
  const stalled = {
    async getBlockNumber() { return HEAD; },
    async getLogs({ fromBlock, toBlock }) { asked.push([fromBlock, toBlock]); return []; },
  };

  // Last night reconciled to exactly the trailing head, so there is nothing new.
  const summary = await runClock({
    ...baseArgs(q),
    publicClient: stalled,
    writer: okWriter(),
    lastReconciledBlock: HEAD - 12n,
  });

  assert.deepEqual(asked, [], "an empty window must cost no RPC call at all");
  assert.equal(summary.reconciled.pages, 0);
  db.close();
});

// And the case that would actually lose data if the trailing were removed: a
// head that moves BACKWARDS between two runs, which is what a load-balanced
// RPC does. The cursor must not be dragged backwards with it, and the next run
// must not re-read from a lower point and call that progress.
test("a head that moves backwards between runs does not drag the cursor back", async () => {
  const { db, q } = mirror();
  let head = 46_200_000n;
  const flapping = {
    async getBlockNumber() { return head; },
    async getLogs() { return []; },
  };

  const first = await runClock({
    ...baseArgs(q), publicClient: flapping, writer: okWriter(), lastReconciledBlock: head - 100n,
  });
  assert.equal(first.reconciled.to, 46_200_000n - 12n);

  // The next call lands on a replica 50 blocks behind.
  head = 46_199_950n;
  const second = await runClock({
    ...baseArgs(q), publicClient: flapping, writer: okWriter(), lastReconciledBlock: first.reconciled.to,
  });

  // reconcile reports the window it could see. main.mjs writes that, so the
  // property asserted here is what the run REPORTS, and it must never claim to
  // have read past what this replica served.
  assert.ok(
    second.reconciled.to <= head - 12n,
    `reported ${second.reconciled.to}, which is past what this replica could serve`,
  );
  assert.ok(second.reconciled.from > second.reconciled.to, "the window is empty and known to be");
  db.close();
});
