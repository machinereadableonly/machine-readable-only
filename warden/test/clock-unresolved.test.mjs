// ASKING THE CHAIN WHETHER THE MONEY ACTUALLY MOVED.
//
// A settlement whose answer was lost leaves a row in 'payment-unresolved': the
// EIP-3009 transfer may be mined or may never have been submitted, and nothing
// in this service can tell which. The chain can. An EIP-3009 token records
// every authorisation it has spent, permanently, under
// `authorizationState(payer, nonce)` -- so the payer and the nonce the gateway
// stored are exactly enough to get a yes or a no.
//
// WHY THE CLOCK AND NOT THE MOMENT OF FAILURE. A public RPC is not
// read-after-write consistent (measured 2026-09-10, see the clock-live-lessons
// memory): a read issued straight after a transfer can land on a node that has
// not imported it and answer "never used" about money that has just moved.
// Releasing the row on that answer is the very loss this exists to prevent. By
// the next 00:05 run the question has one answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { resolveUnresolvedPayments } from "../src/clock/unresolved.mjs";
import { exitCodeFor } from "../src/clock/cursor.mjs";
import { runClock } from "../src/clock/run.mjs";
import { DEPLOY_BLOCK } from "../src/clock/reconcile.mjs";

const KEY_ID = "k-unresolved";
const TO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NONCE = "0x" + "11".repeat(32);

/// A mirror holding one mint whose settlement outcome was never learned.
function heldMint({ payNonce = NONCE, payer = PAYER, asset = USDC } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.transact(() => {
    q.insertToken({ tokenId: 1, keyId: KEY_ID, owner: TO, lastDay: 20_700, mintDay: 20_700 });
    q.insertMint({ tokenId: 1, toAddress: TO, keyId: KEY_ID, payNonce });
  });
  assert.ok(q.holdUnresolvedPayment({ payNonce, payer, asset }), "the row must start held");
  return { db, q };
}

/// A chain that answers one question: has this authorisation been spent?
function chainSaying(used, { onRead = () => {} } = {}) {
  return {
    readContract: async ({ address, functionName, args }) => {
      onRead({ address, functionName, args });
      assert.equal(functionName, "authorizationState", "the only question worth asking the token");
      if (used instanceof Error) throw used;
      return used;
    },
  };
}

test("an authorisation the chain says WAS spent promotes the held row", async () => {
  const { db, q } = heldMint();
  const seen = [];

  const summary = await resolveUnresolvedPayments({
    q,
    publicClient: chainSaying(true, { onRead: (call) => seen.push(call) }),
    alert: () => {},
    log: () => {},
  });

  const row = db.prepare("SELECT status, paymentTx FROM mints WHERE tokenId = 1").get();
  assert.equal(row.status, "queued", "the money moved, so the agent gets what it paid for");
  assert.deepEqual(summary.resolvedPaid, [1], "and the night reports it, because a human was told to expect it");
  assert.deepEqual(summary.unresolvedPayments, [], "nothing is left in doubt");

  // The question must be put to the TOKEN CONTRACT, about the PAYER. Asking the
  // recipient would answer about an authorisation nobody signed -- always
  // false, which reads as "never paid" and deletes the row.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].address, USDC);
  assert.deepEqual(seen[0].args, [PAYER, NONCE]);
});

test("an authorisation the chain has NEVER seen releases the held row", async () => {
  const { db, q } = heldMint();

  const summary = await resolveUnresolvedPayments({
    q,
    publicClient: chainSaying(false),
    alert: () => {},
    log: () => {},
  });

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0, "no money moved, so nothing is owed");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0, "and the token row goes with it");
  assert.equal(q.hasMinted(KEY_ID), false, "the key is free to mint again");
  assert.deepEqual(summary.resolvedUnpaid, [1]);
  assert.deepEqual(summary.unresolvedPayments, [], "answered is answered, either way");
});

test("a chain read that FAILS leaves the row exactly as it was, and fails the run", async () => {
  const { db, q } = heldMint();

  const summary = await resolveUnresolvedPayments({
    q,
    publicClient: chainSaying(new Error("rpc is down")),
    alert: () => {},
    log: () => {},
  });

  assert.equal(
    db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status,
    "payment-unresolved",
    "an unanswered question must never be answered by guessing"
  );
  assert.deepEqual(summary.unresolvedPayments, [1]);
  assert.equal(exitCodeFor({ unresolvedPayments: [1] }), 1, "and systemd must hear about it every night");
});

test("a held row with nothing to ask the chain WITH is left for a human", async () => {
  // A row held before the payer was ever recorded, or an envelope this code
  // cannot read. There is no question to put, so there is no answer to act on.
  const { db, q } = heldMint({ payer: null });
  let asked = false;

  const summary = await resolveUnresolvedPayments({
    q,
    publicClient: { readContract: async () => (asked = true) },
    alert: () => {},
    log: () => {},
  });

  assert.equal(asked, false, "asking about a payer we do not have would answer about nobody");
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "payment-unresolved");
  assert.deepEqual(summary.unresolvedPayments, [1]);
});

test("CONTROL: a run with no held rows asks nothing and fails nothing", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  let asked = false;

  const summary = await resolveUnresolvedPayments({
    q,
    publicClient: { readContract: async () => (asked = true) },
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
  q.reserveMarkPaid(1, 3, 0, NONCE);
  assert.ok(q.holdUnresolvedPayment({ payNonce: NONCE, payer: PAYER, asset: USDC }));

  // While the answer is unknown the Mark is NOT back on sale: selling it twice
  // cannot be undone, and a refund can.
  assert.equal((q.reservedMask(1) >> 3) & 1, 1, "the pair side stays held while the money is in doubt");

  const summary = await resolveUnresolvedPayments({ q, publicClient: chainSaying(true), alert: () => {}, log: () => {} });

  assert.equal(
    db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status,
    "queued",
    "a Mark that was paid for is applied on chain like any other"
  );
  assert.deepEqual(summary.unresolvedPayments, []);
});

// THE CALL SITE. The resolver above is useless unless the nightly run actually
// calls it -- and a call site nothing tests is the one that ships broken (see
// the a-test-that-cannot-see-the-failure memory). This drives the REAL runClock.
test("the nightly run resolves held payments", async () => {
  const { db, q } = heldMint();
  db.exec("UPDATE mints SET solveState = 'pending' WHERE tokenId = 1");

  const summary = await runClock({
    q,
    writer: {
      formatGas: (w) => `${w} wei`,
      async gasOk() { return { ok: true, gasPrice: 1n, capWei: 2n }; },
      async startRun() { return 0; },
      async send() { return { ok: true, hash: "0x1" }; },
    },
    publicClient: {
      async getBlockNumber() { return DEPLOY_BLOCK[84532]; },
      async getLogs() { return []; },
      async readContract({ functionName }) {
        if (functionName === "authorizationState") return true;
        throw new Error(`unexpected read: ${functionName}`);
      },
    },
    contract: "0x" + "22".repeat(20),
    chainId: 84532,
    today: 20_701,
    log: () => {},
    alert: () => {},
  });

  assert.deepEqual(summary.resolvedPaid, [1], "the run must ask the chain about a held payment");
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "queued");
  assert.deepEqual(summary.unresolvedPayments, []);
});
