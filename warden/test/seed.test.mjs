import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeSeedTool } from "../src/mcp/tools/seed.mjs";
import { openChain, restingChain, supplyFullChain } from "./chain-stub.mjs";

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
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  // The parent has to be WHOLE to reach the chain reads at all: since
  // 2026-09-06 every local refusal is decided first, so that a doomed call on a
  // free tool costs no RPC. A level-1 parent is refused `parent-not-whole`
  // before the chain is ever asked, which is the point of that order.
  setLevelAndStatus(db, 1, 365, "queued");
  const tool = makeSeedTool({ q, chain: restingChain(), today: () => 1000 });
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

test("CONTROL: every gate passes, and the answer is an honest refusal that writes nothing", async () => {
  // This test used to assert a successful seed. It was asserting a LIE: the
  // tool inserted a child token plus lineage, answered `txStatus: "queued"`,
  // and no code path in this repository has ever sent `seed` to the chain. The
  // child was served by /t/<id> forever while the chain had never heard of it,
  // and the key's one seed for that agent-year was spent on the orphan.
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xparent-owner", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x2222222222222222222222222222222222222222";
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 365, supplyCap: 10_000 });
  const r = await tool.handler({ parentId: 1, to }, { keyId: "k1" });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "seed-not-available");
  // No token id is promised, because none is reserved.
  assert.equal("tokenId" in r, false);
  assert.equal("txStatus" in r, false);

  // And nothing was written: the parent alone, no child, no spent seed.
  assert.equal(q.tokenCount(), 1);
  assert.equal(q.getToken(2), undefined);
  assert.equal(q.seedsSpent("k1"), 0, "a refusal must not burn the agent-year's seed");
});

test("the per-year boundary is still enforced, and still answers precisely", async () => {
  // The year arithmetic can no longer be observed through a successful seed,
  // so it is observed through WHICH refusal comes back. Below the boundary the
  // seed gate fires; at it, the request gets past that gate and lands on the
  // not-built refusal instead. The gates still answer "why can I not seed"
  // exactly, which is the half of this tool that was always honest.
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x3333333333333333333333333333333333333333";

  // One day short of a completed agent-year: no seed has been granted yet.
  const before = makeSeedTool({ q, chain: openChain(), today: () => 364, supplyCap: 10_000 });
  const early = await before.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(early.reason, "no-seed-available");

  // Exactly one completed agent-year: past that gate.
  const at = makeSeedTool({ q, chain: openChain(), today: () => 365, supplyCap: 10_000 });
  const due = await at.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(due.reason, "seed-not-available");
});

// A seeded child is a token in the SAME collection, so it counts against the
// same cap `mint` checks. This tool inserted tokens without ever reading it.
test("seeding is refused once the supply cap is reached", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  // THE CHAIN says the collection is full, so there is no room for a child --
  // even though every OTHER gate this tool has would pass. The cap used to be
  // answered from the mirror (a constant against this database's row count),
  // and both halves could disagree with the contract.
  const tool = makeSeedTool({ q, chain: supplyFullChain(), today: () => 365 });
  const r = await tool.handler({ parentId: 1, to: "0x4444444444444444444444444444444444444444" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "supply-cap-reached");
  assert.equal(q.tokenCount(), 1, "nothing may be inserted once the cap is reached");
});

// 4.H1: the tool must not write ANYTHING until the Clock can send `seed`.
// A mirror row with no chain behind it is worse than a refusal -- it is served
// as real, it spends a seed that cannot be returned, and it appears in neither
// `stuckMints` nor `dropped`, because both read `mints`.
test("no mirror row is written on any path, gated or not", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");

  // A double whose write methods are traps. If the tool touches either, the
  // test fails by name rather than by a count that could be read as noise.
  const trapped = {
    ...q,
    insertToken: () => { throw new Error("seed must not insert a token"); },
    setLineage: () => { throw new Error("seed must not write lineage"); },
  };
  const tool = makeSeedTool({ q: trapped, chain: openChain(), today: () => 365, supplyCap: 10_000 });

  const r = await tool.handler({ parentId: 1, to: "0x5555555555555555555555555555555555555555" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "seed-not-available");
  assert.equal(q.tokenCount(), 1);
});
