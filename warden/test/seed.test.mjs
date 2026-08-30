import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeSeedTool } from "../src/mcp/tools/seed.mjs";

/// Every test gets its own in-memory database, so no test can see another's rows.
function fresh() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

/// insertToken has no level/status columns in its argument list -- both are
/// set directly on the row, the same way a reconcile from the Clock would
/// leave a token in an arbitrary state.
function setLevelAndStatus(db, tokenId, level, status) {
  db.exec(`UPDATE tokens SET level = ${level}, status = '${status}' WHERE tokenId = ${tokenId}`);
}

test("seeding from an unknown parent is refused", async () => {
  const { q } = fresh();
  const tool = makeSeedTool({ q, today: () => 1000 });
  const r = await tool.handler({ parentId: 99, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-token");
});

test("seeding from a parent bound to a different key is refused", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "other-key", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const tool = makeSeedTool({ q, today: () => 1000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-bound-to-caller");
});

test("seeding from a resting parent is refused", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "resting");
  const tool = makeSeedTool({ q, today: () => 1000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "resting");
});

test("seeding from a parent below level 365 is refused", async () => {
  const { db, q } = fresh();
  // level defaults to 1 -- well below 365 -- and status defaults to "queued",
  // so no override is needed to isolate this one reason.
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  const tool = makeSeedTool({ q, today: () => 1000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "parent-not-whole");
});

test("seeding with no unspent seed for this agent-year is refused", async () => {
  const { db, q } = fresh();
  // mintDay equals today: zero elapsed time, so zero completed agent-years
  // and zero seeds granted, even though the parent itself is whole.
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 1000 });
  setLevelAndStatus(db, 1, 365, "queued");
  const tool = makeSeedTool({ q, today: () => 1000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-seed-available");
});

test("CONTROL: a whole, non-resting parent with a seed available succeeds and binds the child to the caller", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xparent-owner", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x2222222222222222222222222222222222222222";
  const tool = makeSeedTool({ q, today: () => 365 });
  const r = await tool.handler({ parentId: 1, to }, { keyId: "k1" });

  assert.equal(r.ok, true);
  assert.equal(r.tokenId, 2);
  assert.equal(r.parentId, 1);
  assert.equal(r.generation, 1);
  assert.equal(r.to, to);

  const child = q.getToken(r.tokenId);
  // The child is bound to the CALLER's key id, never the parent's owner
  // address -- the two are different kinds of value, and confusing them
  // would bind a seeded child to nobody's key.
  assert.equal(child.keyId, "k1");
  assert.notEqual(child.keyId, "0xparent-owner");
  assert.equal(child.generation, 1);
  assert.equal(child.parentId, 1);
});

test("the per-year boundary: exactly one elapsed year grants exactly one seed", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x3333333333333333333333333333333333333333";
  // today() is fixed at exactly 365 days after mintDay -- one completed
  // agent-year, no more.
  const tool = makeSeedTool({ q, today: () => 365 });

  const first = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(first.ok, true);

  const second = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "no-seed-available");
});
