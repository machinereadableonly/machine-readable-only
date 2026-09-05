import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, migrate } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";

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
