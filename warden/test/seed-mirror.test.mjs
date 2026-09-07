// The mirror half of lineage: a seed is a FREE reservation, and never a mint.
//
// The rule every test here defends is the one the feature can most easily get
// wrong: a key earns ONE seed per completed agent-year, so a row that spends
// that seed and never reaches the chain burns a year the agent cannot earn
// again. `seedsSpent` counts `tokens.parentId IS NOT NULL`, which means the
// tokens row IS the reservation -- and the only thing that can give the year
// back is deleting it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

/// Every test gets its own in-memory database, so no test can see another's
/// rows. Same shape as mirror.test.mjs -- there is no shared helper module.
function fresh() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

/// A founding token, the way a real one arrives: a paid-and-settled mint plus
/// its tokens row. Used where the mints row matters; tests that only need a
/// parent to hang a child off insert the tokens row alone.
function parentToken(q, { tokenId = 1, keyId = "k", owner = "0xA" } = {}) {
  q.insertToken({ tokenId, keyId, owner, lastDay: 10, mintDay: 10 });
  return tokenId;
}

test("a reserved seed spends the budget immediately", () => {
  const { q } = fresh();
  parentToken(q);
  assert.equal(q.seedsSpent("k"), 0);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.seedsSpent("k"), 1, "the row IS the reservation");
});

test("a dropped seed returns the budget", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.dropSeed(2);
  assert.equal(q.seedsSpent("k"), 0, "a seed that cannot land is not spent");
  assert.equal(q.getToken(2), undefined, "and the child is gone from the mirror");
  assert.equal(q.getMint(2), undefined, "including its solve row, which nothing would ever read again");
});

test("dropSeed can never delete a FOUNDING token", () => {
  const { q } = fresh();
  parentToken(q);
  seedPaidMint(q, { tokenId: 1, toAddress: "0xA", keyId: "k" });
  // The one row this method must never touch is the one nobody can recreate:
  // a founding token was PAID for and is on chain.
  q.dropSeed(1);
  assert.ok(q.getToken(1), "a token with no parent is not a seed and must survive");
  assert.ok(q.getMint(1), "and so must the mint row that proves it was paid for");
});

test("a seed never appears in the MINT queue", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, "ab".repeat(172));
  assert.deepEqual(
    q.pendingMints().map((m) => m.tokenId),
    [],
    "a child sent through mint() would revert, and the agent would never know why"
  );
  assert.deepEqual(
    q.pendingSeeds().map((s) => s.tokenId),
    [2]
  );
});

test("pendingSeeds carries everything seed(childId, parentId, to, qr) needs", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, "ab".repeat(172));
  const [row] = q.pendingSeeds();
  assert.equal(row.tokenId, 2);
  assert.equal(row.parentId, 1);
  assert.equal(row.toAddress, "0xB");
  assert.equal(row.agentKeyId, "k", "the key comes from tokens, which a rebind keeps current");
  assert.equal(row.qr, "ab".repeat(172));
});

test("an unsolved seed is NOT offered to the Clock", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  // Same rule as a mint: the contract takes `code` once and keeps it forever,
  // so a token written without its bitmap is broken permanently rather than
  // merely late.
  assert.deepEqual(q.pendingSeeds(), []);
});

test("a written seed leaves the queue, and both its rows say so", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, "ab".repeat(172));
  q.markSeedWritten(2);
  assert.deepEqual(q.pendingSeeds(), [], "so a landed seed is never sent twice");
  assert.equal(q.getMint(2).status, "written");
  assert.equal(q.getToken(2).status, "written", "the tokens half moves too, exactly as markMintWritten does");
  assert.equal(q.seedsSpent("k"), 1, "and the seed stays spent, because the chain now holds the child");
});

test("the child's generation is the parent's plus one", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.getToken(1).generation, 0);
  assert.equal(q.getToken(2).generation, 1);
  assert.equal(q.getToken(2).parentId, 1);
});

test("a grandchild counts from ITS parent, not from the founder", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  // THE SECOND KEY IS A WORKAROUND, NOT THE DESIGN. A child is bound to its
  // parent's key, so both of these seeds carry "k" in real life -- and the
  // UNIQUE index on mints.keyId refuses the second one. See the pinned test at
  // the bottom of this file: that index is the open blocker on this feature,
  // and it cannot be changed from here without a migration.
  q.insertSeed({ childId: 3, parentId: 2, toAddress: "0xB", keyId: "k2", lastDay: 10, mintDay: 10 });
  assert.equal(q.getToken(3).generation, 2);
});

test("a child of a parent that does not exist is refused outright", () => {
  const { q } = fresh();
  // generation is NOT NULL, and the subselect returns NULL for a missing
  // parent. A child with no parent is a row nothing downstream could read.
  assert.throws(
    () => q.insertSeed({ childId: 2, parentId: 99, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 }),
    /NOT NULL constraint failed: tokens\.generation/
  );
  assert.equal(q.seedsSpent("k"), 0);
});

test("a seed is never swept as an expired reservation", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  // The REAL sweep, by its real name. A free row has no payNonce and no
  // reservedAt, which is what keeps it out of expiredMints.
  q.dropExpiredReservations(Date.now() + 86_400_000);
  assert.ok(q.getToken(2), "a free row has no payNonce and must not be swept");
  assert.equal(q.seedsSpent("k"), 1, "and the seed it spent is still spent");
});

test("a seed is invisible to the stale-row alert, which measures reservations", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  // staleRows filters on `reservedAt IS NOT NULL` for exactly this reason: the
  // four EARNED Marks are queued with no reservation either. A seed that is
  // stuck is therefore reported by stuckSeeds, never by this.
  assert.deepEqual(q.staleRows(1000, Date.now() + 30 * 86_400_000).mints, []);
});

test("a seed whose artwork failed is reported as a seed, not as a paid mint", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.setSolveState(2, "failed");
  assert.deepEqual(q.stuckMints(), [], "nobody paid for this, so the paid-mint alert must not claim they did");
  assert.deepEqual(
    q.stuckSeeds().map((r) => r.tokenId),
    [2]
  );
});

test("a paid mint whose artwork failed is still reported as a paid mint", () => {
  const { q } = fresh();
  parentToken(q);
  seedPaidMint(q, { tokenId: 1, toAddress: "0xA", keyId: "k" });
  q.setSolveState(1, "failed");
  assert.deepEqual(
    q.stuckMints().map((r) => r.tokenId),
    [1],
    "narrowing the mint queue must not lose the alert an agent's money depends on"
  );
  assert.deepEqual(q.stuckSeeds(), []);
});

// --- what the schema will not allow yet --------------------------------------

test("a key that already holds a mint row CANNOT reserve a seed, and loses nothing trying", () => {
  const { q } = fresh();
  parentToken(q);
  // A REAL parent always has one of these: it was minted and paid for. Every
  // other test in this file hangs its child off a tokens row with no mints row,
  // which is why they pass and this one does not.
  seedPaidMint(q, { tokenId: 1, toAddress: "0xA", keyId: "k" });
  // PINNED, NOT ENDORSED. `mints` carries a UNIQUE index on keyId -- the
  // control that stops one key minting twice -- and a seed's row carries the
  // same key, because the child is bound to the parent's key. So the moment a
  // real parent exists (which always has a mints row), insertSeed is refused.
  // Every earlier test here has a parent with no mints row, which is why they
  // pass. This is a schema question for the task that wires `seed` up, and it
  // is recorded here so it cannot be discovered on chain instead.
  assert.throws(
    () => q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 }),
    /UNIQUE constraint failed: mints\.keyId/
  );
  // The refusal costs the agent NOTHING, which is the property that matters:
  // both rows are written in one transaction, so the rollback takes the tokens
  // row with it and the agent-year's seed is still there to spend.
  assert.equal(q.seedsSpent("k"), 0, "a reservation that could not be written has spent no seed");
  assert.equal(q.getToken(2), undefined, "and left no orphan behind");
});
