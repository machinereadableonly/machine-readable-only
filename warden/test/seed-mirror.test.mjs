// The mirror half of lineage: a seed is a FREE reservation, and never a mint.
//
// The rule every test here defends is the one the feature can most easily get
// wrong: a key earns ONE seed per completed agent-year, so a row that spends
// that seed and never reaches the chain burns a year the agent cannot earn
// again. `seedsSpent` counts `tokens.parentId IS NOT NULL`, which means the
// tokens row IS the reservation -- and the only thing that can give the year
// back is deleting it.
//
// EVERY PARENT HERE IS A REAL ONE: a paid, settled mint with its `mints` row,
// which is the only shape a parent ever has in production. An earlier draft of
// this file hung children off a bare `tokens` row, and that state is
// unreachable -- it was also the only reason those tests passed, because
// `mints` carried a UNIQUE index over `keyId` alone until the partial index in
// migrate() narrowed it to paid rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, migrate } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

/// Every test gets its own in-memory database, so no test can see another's
/// rows. Same shape as mirror.test.mjs -- there is no shared helper module.
function fresh() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

/// A founding token exactly as a real one arrives: a tokens row plus a mint
/// that was reserved against a payment nonce and then settled, through the real
/// insertMint and the real settleByNonce.
function parentToken(q, { tokenId = 1, keyId = "k", owner = "0xA" } = {}) {
  q.insertToken({ tokenId, keyId, owner, lastDay: 10, mintDay: 10 });
  seedPaidMint(q, { tokenId, toAddress: owner, keyId });
  return tokenId;
}

const QR = "ab".repeat(172);

test("a reserved seed spends the budget immediately", () => {
  const { q } = fresh();
  parentToken(q);
  assert.equal(q.seedsSpent("k"), 0);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.seedsSpent("k"), 1, "the row IS the reservation");
});

test("a seed is reservable at all for a key that has already minted", () => {
  const { q } = fresh();
  parentToken(q);
  // THE WHOLE FEATURE RESTS ON THIS. A child is bound to its parent's key, so
  // its `mints` row carries a key that has demonstrably already minted. Under
  // the full UNIQUE index this threw `UNIQUE constraint failed: mints.keyId`
  // and no real agent could ever have seeded anything.
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.getToken(2).parentId, 1);
  assert.ok(q.getMint(2), "and the child has a mints row, which is what gets its bitmap solved");
  assert.equal(q.getMint(2).payNonce, null, "carrying no payment, because nothing was paid");
});

test("a key still cannot buy TWO mints", () => {
  const { q } = fresh();
  parentToken(q);
  // The narrowing must not cost the guard its actual job. Two settlements from
  // one key can both pass the pre-payment hasMinted check, and this index is
  // what makes the second lose.
  assert.throws(
    () => seedPaidMint(q, { tokenId: 9, toAddress: "0xA", keyId: "k" }),
    /UNIQUE constraint failed: mints\.keyId/
  );
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
  // The one row this method must never touch is the one nobody can recreate:
  // a founding token was PAID for and is on chain.
  q.dropSeed(1);
  assert.ok(q.getToken(1), "a token with no parent is not a seed and must survive");
  assert.ok(q.getMint(1), "and so must the mint row that proves it was paid for");
});

test("dropSeed can never delete a child that is ALREADY ON CHAIN", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, QR);
  q.markSeedWritten(2);
  q.dropSeed(2);
  // NOTHING HEALS THIS IF IT GOES WRONG. reconcile only LOGS a `Seeded` event,
  // so a child deleted after it landed would 404 on /t/<id> for the life of the
  // piece while the chain went on holding it. Returning the budget would be a
  // lie on top of that: the contract refuses the over-spend with
  // NoSeedAvailable, so the agent would be told it had a seed it cannot use.
  assert.ok(q.getToken(2), "a written child is on chain and the mirror must keep saying so");
  assert.ok(q.getMint(2));
  assert.equal(q.seedsSpent("k"), 1, "and the seed stays spent, because the chain spent it");
});

test("a seed never appears in the MINT queue", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, QR);
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

test("a founding mint never appears in the SEED queue", () => {
  const { q } = fresh();
  parentToken(q);
  // THE MIRROR IMAGE OF THE TEST ABOVE, and it needs a founding mint that is
  // paid, settled AND SOLVED -- the two other founding mints in this file have
  // no bitmap or a failed one, so pendingSeeds is empty for them whatever the
  // WHERE clause says, and they would pin nothing.
  q.completeSolve(1, QR);
  assert.deepEqual(q.pendingSeeds(), [], "seed() would revert: token 1 has no parent");
  assert.deepEqual(
    q.pendingMints().map((m) => m.tokenId),
    [1]
  );
});

test("pendingSeeds carries everything seed(childId, parentId, to, qr) needs", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, QR);
  const [row] = q.pendingSeeds();
  assert.equal(row.tokenId, 2);
  assert.equal(row.parentId, 1);
  assert.equal(row.toAddress, "0xB");
  assert.equal(row.agentKeyId, "k", "the key comes from tokens, which a rebind keeps current");
  assert.equal(row.qr, QR);
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

test("a child's bitmap is queued for solving with no change to the solve queue", () => {
  const { q } = fresh();
  parentToken(q);
  q.completeSolve(1, QR);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  // nextPendingMint filters on solveState alone, so the child is picked up by
  // the existing solver without a line of new code. Pinned because it is load
  // bearing and invisible: a seed that never solved could never be written.
  assert.equal(q.nextPendingMint().tokenId, 2);
});

test("a written seed leaves the queue, and both its rows say so", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  q.completeSolve(2, QR);
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
  // The SAME key throughout, which is the real shape: every token in a line is
  // bound to the one key that has been coming back.
  q.insertSeed({ childId: 3, parentId: 2, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.getToken(3).generation, 2);
  assert.equal(q.seedsSpent("k"), 2, "two children, two seeds");
});

test("a child of a parent that does not exist is refused outright", () => {
  const { q } = fresh();
  parentToken(q);
  // generation is NOT NULL, and the subselect returns NULL for a missing
  // parent. A child with no parent is a row nothing downstream could read.
  assert.throws(
    () => q.insertSeed({ childId: 2, parentId: 99, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 }),
    /NOT NULL constraint failed: tokens\.generation/
  );
  assert.equal(q.seedsSpent("k"), 0, "and a reservation that was refused spends no seed");
  assert.equal(q.getMint(2), undefined, "and leaves no orphan behind");
});

// THIS TEST COULD NOT FAIL UNTIL 2026-09-07, and it guarded the only property
// nothing else in the repository guards. `dropExpiredReservations` selects
// `status = 'awaiting-payment' AND payNonce IS NOT NULL`, and the fixture had
// nothing in that state at all -- so the sweep was a no-op and the assertion
// was true by construction. PROVEN BY MUTATION: deleting `AND payNonce IS NOT
// NULL`, the exact guard this test's comment names, left all 23 tests in this
// file green, plus settlement-commit.test.mjs and binding.test.mjs.
//
// THE POSITIVE CONTROL IS THE FIX. A genuinely reserved, genuinely stale mint
// sits beside the child, and the SAME call must delete that one and keep this
// one. A sweep that deletes nothing now fails on the first assertion; a sweep
// that deletes everything fails on the second. Neither was reachable before.
test("a stale reservation is swept and a free seed beside it is not", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });

  // The control: a paid-mint reservation that was never settled. It carries a
  // payNonce and a reservedAt, which is what puts it inside the sweep.
  q.insertToken({ tokenId: 3, keyId: "unpaid", owner: "0xC", lastDay: 10, mintDay: 10 });
  q.insertMint({ tokenId: 3, toAddress: "0xC", keyId: "unpaid", payNonce: "0xnever" });
  assert.equal(q.getMint(3).status, "awaiting-payment", "the control has to actually be reservable");

  const swept = q.dropExpiredReservations(Date.now() + 86_400_000);

  assert.equal(swept.mints, 1, "the unpaid reservation is exactly what this sweep is for");
  assert.equal(q.getMint(3), undefined, "and it is gone");
  assert.equal(q.getToken(3), undefined, "with its token row, which holds a supply slot");

  // The child, which nobody paid for and which spends a once-a-year budget.
  assert.ok(q.getToken(2), "a free row has no payNonce and must not be swept");
  assert.ok(q.getMint(2), "and neither half of the pair may go");
  assert.equal(q.seedsSpent("k"), 1, "and the seed it spent is still spent");
});

// AND THE `payNonce IS NOT NULL` CLAUSE ON ITS OWN, which the test above
// cannot defend and nor could anything else in the repository. Measured
// 2026-09-07: a free seed's `mints` row is kept out of that sweep THREE times
// over -- its status is 'queued' and not 'awaiting-payment', its payNonce is
// NULL, and its reservedAt is NULL -- so removing any ONE of the three clauses
// leaves every suite green and the second removal ships unnoticed.
//
// The only state in which this clause is the deciding one is a row that awaits
// payment, carries a timestamp, and has no nonce. Nothing writes that today:
// `insertMint` demands a nonce and `insertSeedMint` sets none of the three. It
// is written here with SQL BECAUSE it is unreachable, which is the point rather
// than a shortcut -- the clause exists for rows this schema did not write, and
// the moment anything reserves without an EIP-3009 nonce it is the only thing
// deciding whether that row survives.
test("a row awaiting payment with no nonce, or no timestamp, is not swept", () => {
  const { db, q } = fresh();
  parentToken(q);
  q.insertToken({ tokenId: 3, keyId: "nonceless", owner: "0xC", lastDay: 10, mintDay: 10 });
  q.insertMint({ tokenId: 3, toAddress: "0xC", keyId: "nonceless", payNonce: "0xtemp" });
  db.exec("UPDATE mints SET payNonce = NULL, reservedAt = 1 WHERE tokenId = 3");
  const row = q.getMint(3);
  assert.equal(row.status, "awaiting-payment");
  assert.equal(row.payNonce, null, "the one shape in which this clause decides");

  // The mirror image, for the `reservedAt` half: a row that awaits payment and
  // carries a nonce but has NO timestamp. That is the legacy shape the query's
  // own comment names -- rows written before these columns existed -- and it is
  // the only state in which the age test is the deciding clause.
  q.insertToken({ tokenId: 4, keyId: "timeless", owner: "0xD", lastDay: 10, mintDay: 10 });
  q.insertMint({ tokenId: 4, toAddress: "0xD", keyId: "timeless", payNonce: "0xlegacy" });
  db.exec("UPDATE mints SET reservedAt = NULL WHERE tokenId = 4");
  assert.equal(q.getMint(4).reservedAt, null);

  q.dropExpiredReservations(Date.now());
  assert.ok(q.getMint(3), "no nonce means no payment was ever authorised, whatever the timestamp says");
  assert.ok(q.getToken(3), "and its token row holds a supply slot that must not vanish with it");
  assert.ok(q.getMint(4), "and a row with no reservedAt has no age to be older than");
  assert.ok(q.getToken(4));
});

test("a seed is invisible to the stale-row alert, which measures reservations", () => {
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  // staleRows filters on `reservedAt IS NOT NULL` for exactly this reason: the
  // four EARNED Marks are queued with no reservation either. A seed that is
  // stuck is therefore reported by stuckSeeds, never by this.
  //
  // The PAID parent is in that list and belongs there -- it was reserved, it is
  // still queued, and a month has passed. The point is that the free child is
  // not beside it.
  assert.deepEqual(
    q.staleRows(1000, Date.now() + 30 * 86_400_000).mints.map((r) => r.tokenId),
    [1]
  );
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
  q.setSolveState(1, "failed");
  assert.deepEqual(
    q.stuckMints().map((r) => r.tokenId),
    [1],
    "narrowing the mint queue must not lose the alert an agent's money depends on"
  );
  assert.deepEqual(q.stuckSeeds(), []);
});

// --- the index migration ------------------------------------------------------
//
// Every suite in this project opens `:memory:`, which is ALWAYS FRESH. The one
// ordering that matters -- schema.sql exec'd whole over an EXISTING database
// before migrate() runs -- is therefore structurally unreachable without
// building the old state by hand, which is how an index naming a migrated
// column reached production on 2026-09-05 and crash-looped it. This follows the
// fixture in binding.test.mjs.

test("an EXISTING mirror gains the partial index and keeps its legacy rows", () => {
  const db = new DatabaseSync(":memory:");
  // A pre-2026-09-05 mirror: no payNonce, no reservedAt, and the FULL unique
  // index over keyId, which is what the live database actually carries.
  db.exec(`
    CREATE TABLE keys (keyId TEXT PRIMARY KEY, jwk TEXT NOT NULL, directory TEXT, registeredAt INTEGER NOT NULL);
    CREATE TABLE tokens (tokenId INTEGER PRIMARY KEY, keyId TEXT NOT NULL, owner TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1, streak INTEGER NOT NULL DEFAULT 1, lastDay INTEGER NOT NULL,
      mintDay INTEGER NOT NULL, marks INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0,
      parentId INTEGER, status TEXT NOT NULL DEFAULT 'queued');
    CREATE TABLE credits (tokenId INTEGER NOT NULL, day INTEGER NOT NULL, sigHash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued');
    CREATE TABLE mark_orders (tokenId INTEGER NOT NULL, upgradeId INTEGER NOT NULL, paymentTx TEXT,
      status TEXT NOT NULL DEFAULT 'queued');
    CREATE TABLE mints (tokenId INTEGER PRIMARY KEY, toAddress TEXT NOT NULL, keyId TEXT NOT NULL,
      paymentTx TEXT, qr TEXT, solveState TEXT NOT NULL DEFAULT 'pending',
      solveTries INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued');
    CREATE UNIQUE INDEX mints_key ON mints (keyId);
    INSERT INTO keys VALUES ('k', '{}', NULL, 1);
    INSERT INTO tokens (tokenId, keyId, owner, lastDay, mintDay) VALUES (1, 'k', '0xA', 10, 10);
    INSERT INTO mints (tokenId, toAddress, keyId, status, solveState) VALUES (1, '0xA', 'k', 'written', 'done');
  `);

  // THE ORDER THAT CRASHED PRODUCTION. Moving the partial index into schema.sql
  // makes this line throw "no such column: payNonce", because CREATE TABLE IF
  // NOT EXISTS is a no-op here and migrate() has not run yet.
  db.exec(readFileSync(new URL("../src/mirror/schema.sql", import.meta.url), "utf8"));
  migrate(db);

  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'mints'").all();
  const names = indexes.map((r) => r.name);
  assert.ok(names.includes("mints_paid_key"), "the partial index replaced the full one");
  assert.ok(!names.includes("mints_key"), "and the full one is gone, or seeds would still be refused");

  const q = queries(db);
  // The legacy row survives untouched. It has a NULL payNonce and therefore
  // falls OUT of the new index's coverage -- the deliberate narrowing.
  assert.equal(q.getMint(1).keyId, "k");
  // And the point of the whole migration: this key can now seed.
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.seedsSpent("k"), 1);
});

test("migrate is idempotent: a second run changes nothing", () => {
  const db = openDb(":memory:");
  migrate(db);
  migrate(db);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'mints'")
    .all()
    .map((r) => r.name);
  assert.ok(names.includes("mints_paid_key"));
  assert.ok(!names.includes("mints_key"));
});

test("a FRESH database ends up with the same index as a migrated one", () => {
  // schema.sql creates the full index and migrate() replaces it, so the two
  // paths must converge -- otherwise a fresh box and the live box enforce
  // different rules on the money path.
  const { q } = fresh();
  parentToken(q);
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
  assert.equal(q.seedsSpent("k"), 1, "a fresh database seeds");
  assert.throws(
    () => seedPaidMint(q, { tokenId: 9, toAddress: "0xA", keyId: "k" }),
    /UNIQUE constraint failed: mints\.keyId/,
    "and still refuses a second PAID mint"
  );
});

test("the service can RESTART with a seed reserved", () => {
  // THE CRASH LOOP THIS FEATURE NEARLY SHIPPED, and no :memory: test could see
  // it: reopening an in-memory database gives a new empty one, so "restart" is
  // only meaningful against a file.
  //
  // schema.sql is exec'd on EVERY open. While it still declared the full
  // `mints_key ON mints (keyId)`, that statement recreated the index migrate()
  // had dropped -- and once one seed existed, two mints rows shared a keyId, so
  // the next start died with `UNIQUE constraint failed: mints.keyId` before it
  // could serve anything. Measured 2026-09-07.
  const dir = mkdtempSync(join(tmpdir(), "mro-seed-restart-"));
  const path = join(dir, "state.db");
  try {
    const first = openDb(path);
    const q = queries(first);
    q.insertToken({ tokenId: 1, keyId: "k", owner: "0xA", lastDay: 10, mintDay: 10 });
    seedPaidMint(q, { tokenId: 1, toAddress: "0xA", keyId: "k" });
    q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k", lastDay: 10, mintDay: 10 });
    first.close();

    const second = openDb(path);
    const names = second
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'mints'")
      .all()
      .map((r) => r.name);
    assert.deepEqual(names, ["mints_paid_key"], "and no full index came back to kill the NEXT restart");
    assert.equal(queries(second).getToken(2).parentId, 1, "the reserved child survived the restart");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
