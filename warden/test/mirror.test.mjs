import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
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
