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
