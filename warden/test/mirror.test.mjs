import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { openDb, migrate } from "../src/mirror/db.mjs";
import { queries, PaymentNonceReusedError } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

/// Every test gets its own in-memory database, so no test can see another's rows.
function fresh() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

test("a credit for a new day is accepted", () => {
  const { q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  assert.equal(q.insertCredit(1, 101, "sig1"), true);
});

test("the same token and day twice is reported, not thrown", () => {
  const { q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  q.insertCredit(1, 101, "sig1");
  assert.equal(q.insertCredit(1, 101, "sig2"), false);
});

test("a genuine database error is NOT swallowed as a duplicate", () => {
  const { db, q } = fresh();
  db.exec("DROP TABLE credits");
  assert.throws(() => q.insertCredit(1, 101, "sig1"), /no such table/);
});

test("nextTokenId starts at 1 and follows the highest row", () => {
  const { q } = fresh();
  assert.equal(q.nextTokenId(), 1);
  q.insertToken({ tokenId: 7, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  assert.equal(q.nextTokenId(), 8);
});

// --- the variant, carried from the reservation to the Clock ------------------

test("a reservation carries its variant all the way to the Clock's queue", () => {
  const { q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  assert.equal(q.reserveMark(1, 5, 2), true);
  // node:sqlite hands back null-prototype rows, which assert/strict will not
  // match against an object literal. Copy the shape, not the prototype.
  assert.deepEqual(q.pendingMarkOrders().map((o) => ({ ...o })),
    [{ tokenId: 1, upgradeId: 5, variant: 2 }]);
});

// The column has to be SELECTed, not merely stored. It was not, and the Clock
// would have encoded `undefined` as a uint8 -- a throw, not a default.
test("a variant of zero is a number, never undefined", () => {
  const { q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  q.reserveMark(1, 1);
  const [order] = q.pendingMarkOrders();
  assert.equal(order.variant, 0);
  assert.equal(typeof order.variant, "number");
});

// The unique index is on (tokenId, upgradeId) and deliberately NOT on the
// variant: a token holds one reservation per Mark whatever shape it picked, and
// that is what stops two settlements racing to apply the same Mark twice.
test("a second reservation of the same Mark is refused even with a different variant", () => {
  const { q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  assert.equal(q.reserveMark(1, 5, 0), true);
  assert.equal(q.reserveMark(1, 5, 1), false);
  assert.equal(q.markSold(5), 1);
});

// migrate() has to add the column to a database created before it existed.
// CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
// without this an upgraded Warden reads `undefined` off every queued order.
test("an older mirror without the column is migrated rather than left broken", () => {
  const db = openDb(":memory:");
  db.exec("DROP TABLE mark_orders");
  db.exec("CREATE TABLE mark_orders (tokenId INTEGER NOT NULL, upgradeId INTEGER NOT NULL, paymentTx TEXT, status TEXT NOT NULL DEFAULT 'queued')");
  db.exec("INSERT INTO mark_orders (tokenId, upgradeId) VALUES (7, 3)");

  // Re-running the migration is what a restart does.
  const cols = new Set(db.prepare("PRAGMA table_info(mark_orders)").all().map((c) => c.name));
  assert.equal(cols.has("variant"), false, "the fixture must start without the column");

  migrate(db);
  const q = queries(db);
  assert.deepEqual(q.pendingMarkOrders().map((o) => ({ ...o })),
    [{ tokenId: 7, upgradeId: 3, variant: 0 }]);
});

// -- forgetting keys that were never used -----------------------------------
//
// Registration is free and unauthenticated, so the per-thumbprint limit never
// binds an attacker using a fresh keypair each time. The only aggregate limit
// is the 10,000-key ceiling, and reaching it used to close POST /keys forever
// -- which shuts out precisely the agents that have no domain of their own.

const DAY = 24 * 60 * 60 * 1000;
const keyRow = (id, registeredAt) => ({ keyId: id, jwk: { kty: "OKP", x: id }, directory: null, registeredAt });

test("a key that registered and never came through the door is forgotten", () => {
  const { q } = fresh();
  const now = Date.now();
  q.insertKey(keyRow("never-used", now - 31 * DAY));

  assert.equal(q.pruneUnusedKeys(now - 30 * DAY), 1);
  assert.equal(q.getKey("never-used"), undefined);
  assert.equal(q.keyCount(), 0);
});

test("a key that HAS been through the door is never forgotten, however old", () => {
  const { q } = fresh();
  const now = Date.now();
  q.insertKey(keyRow("used-once", now - 400 * DAY));
  q.markKeyUsed("used-once", now - 399 * DAY);

  // Well past any window. A used key may be bound to a token on chain, and
  // that binding is permanent.
  assert.equal(q.pruneUnusedKeys(now), 0);
  assert.equal(q.getKey("used-once").keyId, "used-once");
});

test("an unused key inside the window is left alone", () => {
  const { q } = fresh();
  const now = Date.now();
  q.insertKey(keyRow("recent", now - 2 * DAY));

  assert.equal(q.pruneUnusedKeys(now - 30 * DAY), 0);
  assert.equal(q.getKey("recent").keyId, "recent");
});

test("the prune clears a flood without touching the agents already in", () => {
  const { q } = fresh();
  const now = Date.now();
  q.insertKey(keyRow("honest", now - 90 * DAY));
  q.markKeyUsed("honest", now - 89 * DAY);
  for (let i = 0; i < 500; i++) q.insertKey(keyRow(`flood-${i}`, now - 31 * DAY));
  assert.equal(q.keyCount(), 501);

  assert.equal(q.pruneUnusedKeys(now - 30 * DAY), 500);
  assert.equal(q.keyCount(), 1);
  assert.equal(q.getKey("honest").keyId, "honest");
});

test("marking a key used is throttled to one write a day", () => {
  const { q } = fresh();
  const now = Date.now();
  q.insertKey(keyRow("busy", now));

  assert.equal(q.markKeyUsed("busy", now), 1, "the first use is recorded");
  assert.equal(q.markKeyUsed("busy", now + 1000), 0, "a second use the same day writes nothing");
  const stamp = q.getKey("busy").lastUsedAt;

  assert.equal(q.markKeyUsed("busy", now + 2 * DAY), 1, "a later day is recorded");
  assert.notEqual(q.getKey("busy").lastUsedAt, stamp);
});

test("a key used at any point survives, even if its last use is ancient", () => {
  // The rule is "never used", not "used recently". A token bound to this key
  // on chain outlives any idleness.
  const { q } = fresh();
  const now = Date.now();
  q.insertKey(keyRow("dormant", now - 900 * DAY));
  q.markKeyUsed("dormant", now - 899 * DAY);
  assert.equal(q.pruneUnusedKeys(now - 30 * DAY), 0);
});

// -- one authorisation, one effect ------------------------------------------
//
// An x402 authorisation is bound to an AMOUNT and to nothing else: not a tool,
// a token, a Mark or a variant. mint and Hush both cost $1.00, so their demands
// are byte-identical and a payload obtained for one is accepted for the other.
// The only single-use enforcement the scheme has is the chain's
// authorizationState, which nothing consults until settlement -- and settlement
// happens after both handlers have already run.

test("the same payment authorisation cannot reserve two mints", () => {
  const { q } = fresh();
  q.transact(() => q.insertMint({ tokenId: 1, toAddress: "0xa", keyId: "k1", payNonce: "0xsame" }));

  assert.throws(
    () => q.transact(() => q.insertMint({ tokenId: 2, toAddress: "0xb", keyId: "k2", payNonce: "0xsame" })),
    (err) => err instanceof PaymentNonceReusedError && err.payNonce === "0xsame"
  );
  // And the loser left NOTHING behind -- the throw unwound its whole
  // transaction, not just the claim.
  assert.equal(q.getMint(2), undefined);
});

test("a payload that reserved a mint cannot then reserve a Mark", () => {
  // The cross-tool case, which is the one the byte-identical $1.00 demands
  // actually enable.
  const { q } = fresh();
  q.transact(() => q.insertMint({ tokenId: 1, toAddress: "0xa", keyId: "k1", payNonce: "0xcross" }));

  assert.throws(
    () => q.reserveMarkPaid(1, 1, 0, "0xcross"),
    (err) => err instanceof PaymentNonceReusedError
  );
  assert.equal(q.payNonceClaim("0xcross").tool, "mint");
});

test("two Marks cannot share one authorisation", () => {
  const { q } = fresh();
  assert.equal(q.reserveMarkPaid(1, 1, 0, "0xmark"), true);
  assert.throws(
    () => q.reserveMarkPaid(2, 1, 0, "0xmark"),
    (err) => err instanceof PaymentNonceReusedError
  );
});

test("distinct authorisations are unaffected", () => {
  // The control: a guard that refused everything would pass the three above.
  const { q } = fresh();
  q.transact(() => q.insertMint({ tokenId: 1, toAddress: "0xa", keyId: "k1", payNonce: "0xone" }));
  q.transact(() => q.insertMint({ tokenId: 2, toAddress: "0xb", keyId: "k2", payNonce: "0xtwo" }));
  assert.equal(q.reserveMarkPaid(1, 1, 0, "0xthree"), true);
  assert.equal(q.getMint(1).payNonce, "0xone");
  assert.equal(q.getMint(2).payNonce, "0xtwo");
});

test("a Mark refused as already applied does NOT burn the authorisation", () => {
  // The reservation is attempted BEFORE the claim precisely so that an agent
  // refused for a reason of its own keeps a payload it can present again.
  const { q } = fresh();
  assert.equal(q.reserveMarkPaid(5, 1, 0, "0xfirst"), true);

  // Same token, same Mark, a DIFFERENT payload: refused by the unique index.
  assert.equal(q.reserveMarkPaid(5, 1, 0, "0xsecond"), false);
  assert.equal(q.payNonceClaim("0xsecond"), undefined, "a refused reservation must not claim the nonce");

  // So that payload is still good for something else.
  assert.equal(q.reserveMarkPaid(6, 1, 0, "0xsecond"), true);
});

test("a released reservation does not free its authorisation for reuse", () => {
  // An authorisation whose settlement failed cannot be settled later anyway,
  // and re-signing costs the agent nothing -- no gas, no chain write.
  const { q } = fresh();
  q.transact(() => q.insertMint({ tokenId: 1, toAddress: "0xa", keyId: "k1", payNonce: "0xdead" }));
  assert.equal(q.releaseReservation("0xdead").kind, "mint");

  assert.throws(
    () => q.transact(() => q.insertMint({ tokenId: 2, toAddress: "0xb", keyId: "k1", payNonce: "0xdead" })),
    (err) => err instanceof PaymentNonceReusedError
  );
});

// ---------------------------------------------------------------------------
// markMintWritten is ATOMIC -- test gap 33 / finding 4.L1
// ---------------------------------------------------------------------------

// The two statements move a token from "the Clock owes this agent a token" to
// "the artwork exists", and a mint row written while its token row is not (or
// the reverse) is a state nothing else in this service knows how to read.
//
// "Together" was a COMMENT and not a fact until 4.L1: the two ran outside any
// transaction, so a crash between them left exactly the half-applied state the
// comment promised was impossible -- and the Clock's unit could deliver a
// SIGKILL until 16.7 closed that.
//
// The code was fixed; nothing tested it. This drops the `tokens` table so the
// SECOND statement throws, and asserts the FIRST was rolled back. Without the
// transaction the mint row would be left at 'written' with no artwork behind
// it: the agent has paid, the mirror says it is done, and no queue will ever
// pick it up again.
test("markMintWritten rolls back the mint row when the token row cannot be written", () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  seedPaidMint(q, { tokenId: 1, toAddress: "0xabc", keyId: "k1" });

  const before = db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status;
  assert.equal(before, "queued", "the row must start where the Clock would find it");

  // Make the second statement fail, the way a crash between the two would.
  db.exec("DROP TABLE tokens");

  assert.throws(() => q.markMintWritten(1));

  const after = db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status;
  assert.equal(
    after,
    "queued",
    "the mint row must NOT be left written with no token row: that is a paid agent with no artwork",
  );
});

test("CONTROL: when both statements succeed, both rows move", () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  seedPaidMint(q, { tokenId: 1, toAddress: "0xabc", keyId: "k1" });

  q.markMintWritten(1);

  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "written");
  assert.equal(db.prepare("SELECT status FROM tokens WHERE tokenId = 1").get().status, "written");
});

// ---------------------------------------------------------------------------
// Two writers on one file -- test gap 32 / finding 4.M4
// ---------------------------------------------------------------------------

// TWO PROCESSES WRITE THIS FILE: the Warden on every check-in, and the Clock at
// 00:05. node:sqlite's default busy timeout is 0 -- measured on the installed
// Node, a second writer threw `database is locked` after 1 ms -- so before
// 4.M4 an agent checking in at the moment the Clock ran was simply refused,
// and the refusal looked like a bug in the tool rather than contention.
//
// WAL lets READERS through during a write; it does nothing for two WRITERS.
// Only the timeout does, and every other test here uses `:memory:`, where
// contention cannot happen at all. So the one setting that makes concurrent
// writing work was unreachable from the suite.
test("a contended write WAITS for the other writer rather than failing", async () => {
  // A SECOND PROCESS, not a timer. node:sqlite is synchronous: a blocking
  // retry loop in this thread cannot be interrupted by anything in this
  // thread, so a setTimeout that releases the lock never runs and the write
  // always exhausts the full timeout. The first draft of this test did that
  // and "proved" the timeout does not work.
  //
  // Two processes is also the actual scenario: the Warden writes on every
  // check-in and the Clock writes at 00:05, and they are different processes.
  const dir = mkdtempSync(join(tmpdir(), "mro-mirror-"));
  const path = join(dir, "state.db");
  try {
    const setup = openDb(path);
    migrate(setup);
    queries(setup).insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
    setup.close();

    // The holder takes the write lock, says so, and releases it 400ms later.
    const holder = spawn(process.execPath, ["-e", `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(path)}, { timeout: 5000 });
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("BEGIN IMMEDIATE");
      db.prepare("UPDATE tokens SET owner = ? WHERE tokenId = ?").run("0xdef", 1);
      process.stdout.write("locked\\n");
      setTimeout(() => { db.exec("COMMIT"); db.close(); }, 400);
    `]);

    try {
      await new Promise((resolve, reject) => {
        holder.stdout.on("data", (d) => { if (String(d).includes("locked")) resolve(); });
        holder.on("error", reject);
        holder.on("exit", () => reject(new Error("the lock holder exited before taking the lock")));
      });

      const db = openDb(path);
      const q = queries(db);
      const started = Date.now();
      // Blocks until the holder commits, then lands. With node:sqlite's
      // DEFAULT timeout of 0 this throws `database is locked` after about 1ms.
      q.insertToken({ tokenId: 2, keyId: "k2", owner: "0xabc", lastDay: 100, mintDay: 100 });
      const waited = Date.now() - started;

      assert.ok(waited > 100, `the write should have waited for the lock, took ${waited}ms`);
      assert.equal(q.getToken(2)?.tokenId, 2, "and the waiting write must actually land");
      db.close();
    } finally {
      holder.kill();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
