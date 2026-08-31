import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeSeedTool } from "../src/mcp/tools/seed.mjs";
import { openChain, restingChain } from "./chain-stub.mjs";

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
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 1000, supplyCap: 10_000 });
  const r = await tool.handler({ parentId: 99, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-token");
});

test("seeding from a parent bound to a different key is refused", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "other-key", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 1000, supplyCap: 10_000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-bound-to-caller");
});

// THIS TEST USED TO PROVE NOTHING. It set `status = 'resting'` and asserted the
// refusal -- but tokens.status only ever holds 'queued' | 'written', so the
// value was one the column never legitimately carries, and the check it was
// aimed at (`parent.status === "resting"`) could never fire in production. The
// test was written against the implementation and so encoded its bug as the
// specification. Resting is set by the OWNER on chain, so the chain is the only
// thing that can say so, and that is what is asserted now.
test("seeding from a resting parent is refused, on the chain's word", async () => {
  const { q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  const tool = makeSeedTool({ q, chain: restingChain(), today: () => 1000, supplyCap: 10_000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "resting");
  // And it was written down, so /t/<id> stops calling a sealed token alive.
  assert.equal(q.getToken(1).resting, 1);
});

test("seeding from a parent below level 365 is refused", async () => {
  const { db, q } = fresh();
  // level defaults to 1 -- well below 365 -- and status defaults to "queued",
  // so no override is needed to isolate this one reason.
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 1000, supplyCap: 10_000 });
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
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 1000, supplyCap: 10_000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-seed-available");
});

test("CONTROL: a whole, non-resting parent with a seed available succeeds and binds the child to the caller", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xparent-owner", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x2222222222222222222222222222222222222222";
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 365, supplyCap: 10_000 });
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
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 365, supplyCap: 10_000 });

  const first = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(first.ok, true);

  const second = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "no-seed-available");
});

// A seeded child is a token in the SAME collection, so it counts against the
// same cap `mint` checks. This tool inserted tokens without ever reading it.
test("seeding is refused once the supply cap is reached", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  // One token exists and the cap is one, so there is no room for a child --
  // even though every OTHER gate this tool has would pass.
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 365, supplyCap: 1 });
  const r = await tool.handler({ parentId: 1, to: "0x4444444444444444444444444444444444444444" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "supply-cap-reached");
  assert.equal(q.tokenCount(), 1, "nothing may be inserted once the cap is reached");
});

// The child row and its lineage are ONE FACT. A child whose lineage never
// landed has no parent and generation 0 -- indistinguishable from an ordinary
// mint -- and the key's seed for that year would still have been spent.
test("a failed lineage write leaves no half-created child behind", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");

  // Break setLineage only, leaving insertToken working: the exact shape of a
  // second write failing after the first has already succeeded.
  const broken = { ...q, setLineage: () => { throw new Error("lineage write failed"); } };
  const tool = makeSeedTool({ q: broken, chain: openChain(), today: () => 365, supplyCap: 10_000 });

  await assert.rejects(
    tool.handler({ parentId: 1, to: "0x5555555555555555555555555555555555555555" }, { keyId: "k1" }),
    /lineage write failed/
  );
  assert.equal(q.tokenCount(), 1, "the parent only: the child must have been rolled back");
  assert.equal(q.getToken(2), undefined);
});
