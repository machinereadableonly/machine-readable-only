// ASKING THE CHAIN WHETHER THE MONEY ACTUALLY MOVED.
//
// A settlement whose answer was lost leaves a row in 'payment-unresolved': the
// EIP-3009 transfer may be mined or may never have been submitted, and nothing
// in this service can tell which. The chain can, but only if it is asked the
// right question.
//
// `authorizationState(payer, nonce)` IS THE WRONG QUESTION, and this file is
// mostly about why. An EIP-3009 token sets that flag on ANY use of the nonce
// and on `cancelAuthorization` too, so a payer could cancel its own
// authorisation between verification and settlement and read back as having
// paid -- a free mint, or a free Mark worth $1,250. The right question is a
// pair of logs: `AuthorizationUsed(payer, nonce)` emitted by the asset, and a
// `Transfer` of the demanded amount to the treasury IN THE SAME TRANSACTION.
//
// WHY THE CLOCK AND NOT THE MOMENT OF FAILURE. A public RPC is not
// read-after-write consistent (measured 2026-09-10, see the clock-live-lessons
// memory): a read issued straight after a transfer can land on a node that has
// not imported it. By the next 00:05 run the question has one answer -- and
// nothing is released until chain time is past the authorisation's own
// deadline, because before that the transfer can still land.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { resolveUnresolvedPayments, RELEASE_MARGIN_SECONDS } from "../src/clock/unresolved.mjs";
import { exitCodeFor } from "../src/clock/cursor.mjs";
import { runClock } from "../src/clock/run.mjs";
import { DEPLOY_BLOCK } from "../src/clock/reconcile.mjs";

const KEY_ID = "k-unresolved";
const TO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const TREASURY = "0x3333333333333333333333333333333333333333";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NONCE = "0x" + "11".repeat(32);
const AMOUNT = "1000000";
const BLOCK = 47_321_628;
const RESERVED_AT = 1_759_000_000_000;
const VALID_BEFORE = Math.floor(RESERVED_AT / 1000) + 300;
const SETTLE_TX = "0x" + "ab".repeat(32);

/// A mirror holding one mint whose settlement outcome was never learned, with
/// everything the resolver needs to put the question.
function heldMint({ facts = {}, payNonce = NONCE } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.transact(() => {
    q.insertToken({ tokenId: 1, keyId: KEY_ID, owner: TO, lastDay: 20_700, mintDay: 20_700 });
    q.insertMint({ tokenId: 1, toAddress: TO, keyId: KEY_ID, payNonce, now: RESERVED_AT });
    q.setPaymentFacts({
      payNonce,
      payer: PAYER,
      asset: USDC,
      payTo: TREASURY,
      amount: AMOUNT,
      validBefore: VALID_BEFORE,
      block: BLOCK,
      ...facts,
    });
  });
  assert.ok(q.holdUnresolvedPayment({ payNonce, payer: PAYER, asset: USDC }), "the row must start held");
  return { db, q };
}

/// The two logs a genuine settlement leaves: the authorisation spent, and the
/// money moving to the treasury, in one transaction.
const settlementLogs = ({ to = TREASURY, value = AMOUNT, transactionHash = SETTLE_TX, nonce = NONCE } = {}) => [
  { event: "AuthorizationUsed", address: USDC, blockNumber: BLOCK + 3, transactionHash, args: { authorizer: PAYER, nonce } },
  { event: "Transfer", address: USDC, blockNumber: BLOCK + 3, transactionHash, args: { from: PAYER, to, value: BigInt(value) } },
];

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * A chain that answers from a list of logs, the way viem's getLogs does:
 * filtered by address, by the event's own name, by the indexed arguments given,
 * and by the block range asked for.
 */
function chainWith({ logs = [], headBlock = BLOCK + 500, headTime = VALID_BEFORE + RELEASE_MARGIN_SECONDS + 60, ranges = [] } = {}) {
  return {
    async getBlock() {
      return { number: BigInt(headBlock), timestamp: BigInt(headTime) };
    },
    async getLogs({ address, event, args = {}, fromBlock, toBlock }) {
      ranges.push({ event: event.name, from: Number(fromBlock), to: Number(toBlock) });
      return logs.filter(
        (l) =>
          same(l.address, address) &&
          l.event === event.name &&
          l.blockNumber >= Number(fromBlock) &&
          l.blockNumber <= Number(toBlock) &&
          Object.entries(args).every(([k, v]) =>
            typeof v === "string" && v.startsWith("0x") ? same(l.args[k], v) : l.args[k] === v
          )
      ).map((l) => ({ ...l, blockNumber: BigInt(l.blockNumber) }));
    },
  };
}

const run = (q, publicClient, said = []) =>
  resolveUnresolvedPayments({ q, publicClient, alert: (m) => said.push(m), log: () => {} });

test("an authorisation spent on the transfer this service demanded promotes the held row", async () => {
  const { db, q } = heldMint();
  const said = [];
  const ranges = [];

  const summary = await run(q, chainWith({ logs: settlementLogs(), ranges }), said);

  const row = db.prepare("SELECT status, paymentTx FROM mints WHERE tokenId = 1").get();
  assert.equal(row.status, "queued", "the money moved, so the agent gets what it paid for");
  assert.equal(row.paymentTx, SETTLE_TX, "and the transfer the Clock found becomes the receipt it never had");
  assert.deepEqual(summary.resolvedPaid, [1], "and the night reports it, because a human was told to expect it");
  assert.deepEqual(summary.unresolvedPayments, []);
  assert.match(said.join(" "), /WAS PAID FOR/);

  // THE WINDOW IS BOUNDED BY THE AUTHORISATION, not by "since the reservation".
  // The public node refuses a span over a thousand blocks and has moved that
  // cap without notice, so a search from the reservation to the head would be
  // forty-three requests a night and die the first time the cap dropped.
  assert.ok(ranges.length > 0);
  for (const r of ranges) assert.ok(r.to - r.from <= 1_000, "no request may exceed the node's log span");
});

// THE ATTACK THE OLD ORACLE ALLOWED. `authorizationState` is true after a
// cancellation, so a payer could cancel its own authorisation between
// verification and settlement, have the settlement refused, and be handed the
// token anyway.
test("a CANCELLED authorisation is not a payment", async () => {
  const { db, q } = heldMint();
  const said = [];

  const summary = await run(
    q,
    chainWith({
      logs: [
        { event: "AuthorizationCanceled", address: USDC, blockNumber: BLOCK + 2, transactionHash: "0xc", args: { authorizer: PAYER, nonce: NONCE } },
      ],
    }),
    said
  );

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0, "no money moved, so nothing is owed");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0, "and the token row goes with it");
  assert.equal(q.hasMinted(KEY_ID), false, "the key is free to mint again");
  assert.deepEqual(summary.resolvedUnpaid, [1]);
  assert.match(said.join(" "), /cancelled/, "and a release is ALERTED, never merely logged");
});

// THE SECOND HALF OF THE SAME ATTACK, and the one a bare flag cannot see at
// all: the nonce IS spent, on a transfer the payer sent to itself for dust.
test("an authorisation spent on somebody else's transfer is not a payment", async () => {
  const { db, q } = heldMint();
  const said = [];

  const summary = await run(q, chainWith({ logs: settlementLogs({ to: PAYER, value: "1" }) }), said);

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
  assert.deepEqual(summary.resolvedUnpaid, [1]);
  assert.match(said.join(" "), /spent, but on no transfer/);
});

// A transfer of the right amount to the right address is not enough either:
// anyone can put one in the block an unrelated authorisation was spent in.
test("the transfer must be in the SAME transaction as the authorisation", async () => {
  const { q } = heldMint();
  const logs = settlementLogs();
  logs[1].transactionHash = "0x" + "cd".repeat(32);

  const summary = await run(q, chainWith({ logs }));
  assert.deepEqual(summary.resolvedUnpaid, [1]);
  assert.deepEqual(summary.resolvedPaid, []);
});

test("a transfer of the wrong amount is not this payment", async () => {
  const { q } = heldMint();
  const summary = await run(q, chainWith({ logs: settlementLogs({ value: "999999" }) }));
  assert.deepEqual(summary.resolvedUnpaid, [1]);
});

// THE RELEASE WINDOW. `nothing found` means "not spent YET" while the
// authorisation is still live: the facilitator can submit it at any moment
// before validBefore, and a row released here is one an agent pays for and
// never receives.
test("a held row is NOT released while its authorisation can still be spent", async () => {
  const { db, q } = heldMint();
  const said = [];

  const summary = await run(q, chainWith({ logs: [], headTime: VALID_BEFORE - 10 }), said);

  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "payment-unresolved");
  assert.deepEqual(summary.deferredPayments, [1]);
  assert.deepEqual(summary.resolvedUnpaid, [], "nothing is released on a question that has no answer yet");
  // A row waiting for its own deadline is not a row waiting for a human, so it
  // does not fail the run.
  assert.deepEqual(summary.unresolvedPayments, []);
  assert.equal(exitCodeFor(summary), 0);
  assert.deepEqual(said, [], "and nobody is woken up for a payment that is simply young");
});

test("and IS released once chain time is past that deadline and its margin", async () => {
  const { db, q } = heldMint();
  const said = [];

  const summary = await run(
    q,
    chainWith({ logs: [], headTime: VALID_BEFORE + RELEASE_MARGIN_SECONDS + 1 }),
    said
  );

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
  assert.deepEqual(summary.resolvedUnpaid, [1]);
  assert.match(said.join(" "), /expired without ever being spent/);
});

// The boundary from the other side, because a margin that is merely PRESENT
// proves nothing about where it sits.
test("exactly at the deadline plus the margin it is still held", async () => {
  const { q } = heldMint();
  const summary = await run(q, chainWith({ logs: [], headTime: VALID_BEFORE + RELEASE_MARGIN_SECONDS }));
  assert.deepEqual(summary.deferredPayments, [1]);
});

test("a chain read that FAILS leaves the row exactly as it was, and fails the run", async () => {
  const { db, q } = heldMint();
  const chain = chainWith({ logs: [] });
  chain.getLogs = async () => { throw new Error("rpc is down"); };

  const summary = await run(q, chain);

  assert.equal(
    db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status,
    "payment-unresolved",
    "an unanswered question must never be answered by guessing"
  );
  assert.deepEqual(summary.unresolvedPayments, [1]);
  assert.equal(exitCodeFor({ unresolvedPayments: [1] }), 1, "and systemd must hear about it every night");
});

test("a chain with no head answers nothing and asks nothing", async () => {
  const { q } = heldMint();
  let asked = false;
  const summary = await run(q, {
    getBlock: async () => { throw new Error("no head"); },
    getLogs: async () => { asked = true; return []; },
  });

  assert.equal(asked, false, "without a head there is no window and no chain time");
  assert.deepEqual(summary.unresolvedPayments, [1]);
});

test("a held row with nothing to ask the chain WITH is left for a human", async () => {
  // A row held before the payer was ever recorded, or an envelope this code
  // cannot read. There is no question to put, so there is no answer to act on.
  const { db, q } = heldMint();
  db.exec("UPDATE mints SET payer = NULL WHERE tokenId = 1");
  let asked = false;
  const chain = chainWith({ logs: [] });
  chain.getLogs = async () => { asked = true; return []; };

  const summary = await run(q, chain);

  assert.equal(asked, false, "asking about a payer we do not have would answer about nobody");
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "payment-unresolved");
  assert.deepEqual(summary.unresolvedPayments, [1]);
});

// THE ROWS THIS REWRITE DELIBERATELY WILL NOT DECIDE. A row held before the
// recipient and the amount were stored can only be judged by the forgeable
// question, so it is handed to a person instead. Refusing to ask it is the
// whole point.
test("a row with no recipient or amount is refused rather than decided", async () => {
  const { db, q } = heldMint();
  db.exec("UPDATE mints SET payTo = NULL, payAmount = NULL WHERE tokenId = 1");

  const said = [];
  const summary = await run(q, chainWith({ logs: settlementLogs() }), said);

  assert.deepEqual(summary.resolvedPaid, [], "a spent nonce alone must never promote a row");
  assert.deepEqual(summary.unresolvedPayments, [1]);
  assert.match(said.join(" "), /forgeable/);
});

test("a row with no reservation block has no bounded window, so it waits for a human", async () => {
  const { db, q } = heldMint();
  db.exec("UPDATE mints SET reservedBlock = NULL WHERE tokenId = 1");

  const summary = await run(q, chainWith({ logs: settlementLogs() }));
  assert.deepEqual(summary.unresolvedPayments, [1]);
});

test("CONTROL: a run with no held rows asks nothing and fails nothing", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  let asked = false;

  const summary = await resolveUnresolvedPayments({
    q,
    publicClient: { getBlock: async () => (asked = true), getLogs: async () => (asked = true) },
    alert: () => {},
    log: () => {},
  });

  assert.equal(asked, false);
  assert.deepEqual(summary.unresolvedPayments, []);
  assert.equal(exitCodeFor({ unresolvedPayments: [] }), 0);
});

test("a held MARK order is resolved the same way, and its Mark stays taken until it is", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: KEY_ID, owner: TO, lastDay: 20_700, mintDay: 20_400 });
  q.reserveMarkPaid(1, 3, 0, NONCE, RESERVED_AT);
  q.setPaymentFacts({
    payNonce: NONCE, payer: PAYER, asset: USDC, payTo: TREASURY,
    amount: AMOUNT, validBefore: VALID_BEFORE, block: BLOCK,
  });
  assert.ok(q.holdUnresolvedPayment({ payNonce: NONCE, payer: PAYER, asset: USDC }));

  // While the answer is unknown the Mark is NOT back on sale: selling it twice
  // cannot be undone, and a refund can.
  assert.equal((q.reservedMask(1) >> 3) & 1, 1, "the pair side stays held while the money is in doubt");

  const summary = await run(q, chainWith({ logs: settlementLogs() }));

  assert.equal(
    db.prepare("SELECT status, paymentTx FROM mark_orders WHERE tokenId = 1").get().status,
    "queued",
    "a Mark that was paid for is applied on chain like any other"
  );
  assert.deepEqual(summary.unresolvedPayments, []);
});

/// One real Clock run against a chain that answers the resolver's questions.
function nightlyRun(q, chain, { alert = () => {} } = {}) {
  return runClock({
    q,
    writer: {
      formatGas: (w) => `${w} wei`,
      async gasOk() { return { ok: true, gasPrice: 1n, capWei: 2n }; },
      async startRun() { return 0; },
      async send() { return { ok: true, hash: "0x1" }; },
    },
    publicClient: {
      async getBlockNumber() { return DEPLOY_BLOCK[84532]; },
      async getBlock(...args) { return chain.getBlock(...args); },
      async getLogs(params) {
        // The reconcile pass asks for the token contract's events, not the
        // asset's; only the resolver's questions carry an `event`.
        return params?.event ? chain.getLogs(params) : [];
      },
    },
    contract: "0x" + "22".repeat(20),
    chainId: 84532,
    today: 20_701,
    log: () => {},
    alert,
  });
}

// THE CALL SITE. The resolver above is useless unless the nightly run actually
// calls it -- and a call site nothing tests is the one that ships broken (see
// the a-test-that-cannot-see-the-failure memory). This drives the REAL runClock.
test("the nightly run resolves held payments", async () => {
  const { db, q } = heldMint();
  db.exec("UPDATE mints SET solveState = 'pending' WHERE tokenId = 1");

  const summary = await nightlyRun(q, chainWith({ logs: settlementLogs() }));

  assert.deepEqual(summary.resolvedPaid, [1], "the run must ask the chain about a held payment");
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "queued");
  assert.deepEqual(summary.unresolvedPayments, []);
});

// ---------------------------------------------------------------------------
// THE PATH THAT REACHED NOBODY: A HOLD THAT COULD NOT BE WRITTEN.
//
// The gateway holds a doubtful row by calling `onUnresolved`, and that call can
// throw -- a locked database, a crash between the settle and the hold. The row
// then keeps its 'awaiting-payment' status, which the resolver does not read.
// Only the expiry sweep moves such a row, and the sweep ran on the two paid
// tools alone: a piece nobody mints from again never sweeps, so the one
// reservation whose money is in doubt sat untouched forever.
//
// The Clock sweeps first and resolves second, so both happen in one run.
// ---------------------------------------------------------------------------

/// A reservation that is still 'awaiting-payment': the shape left behind when a
/// hold could not be written, or when the process died before the settlement
/// answer arrived.
function awaitingMint({ reservedAt = RESERVED_AT, validBefore = VALID_BEFORE } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.transact(() => {
    q.insertToken({ tokenId: 1, keyId: KEY_ID, owner: TO, lastDay: 20_700, mintDay: 20_700 });
    q.insertMint({ tokenId: 1, toAddress: TO, keyId: KEY_ID, payNonce: NONCE, now: reservedAt });
    q.setPaymentFacts({
      payNonce: NONCE,
      payer: PAYER,
      asset: USDC,
      payTo: TREASURY,
      amount: AMOUNT,
      validBefore,
      block: BLOCK,
    });
  });
  db.exec("UPDATE mints SET solveState = 'pending' WHERE tokenId = 1");
  assert.equal(
    db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status,
    "awaiting-payment",
    "the row must start in the state a failed hold leaves behind"
  );
  return { db, q };
}

test("the nightly run sweeps an expired reservation and resolves it in the same run", async () => {
  const { db, q } = awaitingMint();

  const summary = await nightlyRun(q, chainWith({ logs: settlementLogs() }));

  assert.deepEqual(
    summary.resolvedPaid,
    [1],
    "the sweep must run BEFORE the resolver, or the row is invisible for another day"
  );
  assert.equal(
    db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status,
    "queued",
    "the money moved, so the agent gets what it paid for"
  );
  assert.deepEqual(summary.unresolvedPayments, []);
});

// THE CONTROL, and it is not decoration: a sweep that took every reservation
// would break the live one. A payment being made right now is 'awaiting-payment'
// for the seconds its settlement takes, and moving it would hand the Clock a row
// whose answer is still on its way.
test("a reservation younger than its window is untouched by the nightly run", async () => {
  const now = Date.now();
  const { db, q } = awaitingMint({
    reservedAt: now,
    validBefore: Math.floor(now / 1000) + 300,
  });

  const summary = await nightlyRun(q, chainWith({ logs: settlementLogs() }));

  assert.equal(
    db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status,
    "awaiting-payment",
    "a settlement still in flight must be left alone"
  );
  assert.deepEqual(summary.resolvedPaid, []);
  assert.deepEqual(summary.resolvedUnpaid, []);
  assert.deepEqual(summary.deferredPayments, []);
  assert.deepEqual(summary.unresolvedPayments, []);
});

// A HOUSEKEEPING STEP MUST NOT COST THE NIGHT'S WRITES. The sweep writes to the
// database the Warden is writing to as well, so it can throw -- SQLITE_BUSY is
// the ordinary way. Unguarded, that throw rejected runClock before the gas
// guard: no mints, no check-ins, no Marks and no reconcile, so one locked
// moment during a step that resolves nothing by itself cost a whole night of
// the artwork. The queued rows survive to the next run; the night does not.
test("a sweep that throws is reported and the night's writes still go out", async () => {
  const { db, q } = awaitingMint();
  q.insertCredit(1, 20_700, "sig-yesterday");
  const said = [];
  const brokenSweep = {
    ...q,
    sweepExpiredReservations() {
      throw new Error("SQLITE_BUSY: database is locked");
    },
  };

  const summary = await nightlyRun(brokenSweep, chainWith({ logs: settlementLogs() }), {
    alert: (m) => said.push(m),
  });

  assert.deepEqual(
    summary.credited.map((e) => e.day),
    [20_700],
    "the night's check-in goes out even though the sweep failed"
  );
  assert.equal(
    db.prepare("SELECT status FROM credits WHERE day = 20700").get().status,
    "written",
    "and the mirror records it, so the day is not offered again"
  );
  assert.ok(summary.reconciled, "and the mirror still learns what the chain did");
  assert.match(said.join(" "), /sweep/i, "the operator is told which step failed");
  assert.match(said.join(" "), /SQLITE_BUSY/, "and what it failed with");
  assert.equal(exitCodeFor(summary), 1, "and systemd is told the night was not clean");
});
