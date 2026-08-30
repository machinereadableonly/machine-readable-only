import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeCheckinTool } from "../src/mcp/tools/checkin.mjs";

function withToken({ keyId = "k1", lastDay = 100 } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId, owner: "0xabc", lastDay, mintDay: 100 });
  // `db` comes back alongside `q` so a test can read the credits table
  // directly. queries.mjs deliberately has no "list the credits" statement --
  // nothing in the service needs one, and an unused prepared statement is a
  // second place for the truth to live.
  return { db, q };
}

/// Every credit row for one token, oldest day first, read straight from SQLite.
const creditsFor = (db, tokenId) =>
  db.prepare("SELECT * FROM credits WHERE tokenId = ? ORDER BY day ASC").all(tokenId);

/// The chain read must never be needed on the happy path. A stub that throws
/// proves the tool did not reach for it.
const noChainRead = { boundKeyOf: async () => { throw new Error("chain must not be read here"); } };

test("a bound caller checking in on a new day is credited", async () => {
  const { q } = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.accepted, true);
  assert.equal(r.creditedDay, 101);
});

test("a second check-in on the same day is refused, not credited twice", async () => {
  const { q } = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  const second = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "already-credited-today");
});

test("an unknown token is refused", async () => {
  const { q } = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.reason, "unknown-token");
});

// Two things hold this now and BOTH are load-bearing: the day guard refuses
// every call after the first, because the first advanced lastDay to today; and
// the unique (tokenId, day) index is still what decides a race this process
// cannot serialise -- a second Warden, or a write interleaved across an await.
// mirror.test.mjs drives that index directly.
test("100 simultaneous check-ins produce exactly one credit", async () => {
  const { q } = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const results = await Promise.all(
    Array.from({ length: 100 }, () => tool.handler({ tokenId: 1 }, { keyId: "k1" }))
  );
  assert.equal(results.filter((r) => r.accepted === true).length, 1);
  assert.equal(results.filter((r) => r.reason === "already-credited-today").length, 99);
});

// THE MIRROR IS THE SOURCE OF TRUTH FOR THE TOOLS, so a credited day has to
// advance the token row and not only insert a credit. Before this, `credits`
// filled up while tokens.level sat at 1 forever: /t/<id> and `status` reported
// a token that never grew, and `upgrade`'s minLevel / needsWhole / minStreak
// gates and `seed`'s parent-whole gate all judged a value nothing advanced.

test("a credited day advances the token row, not just the credits table", async () => {
  const { db, q } = withToken({ lastDay: 100 });
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });

  const token = q.getToken(1);
  assert.equal(token.level, 2);
  assert.equal(token.streak, 2);
  assert.equal(token.lastDay, 101);
  // What the tool answered and what the mirror holds are the same fact.
  assert.equal(r.level, token.level);
  assert.equal(r.streak, token.streak);
  assert.equal(r.creditedDay, token.lastDay);
});

test("consecutive days continue the streak; a gap resets it to 1", async () => {
  const { db, q } = withToken({ lastDay: 100 });
  const day = { n: 101 };
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => day.n });

  await tool.handler({ tokenId: 1 }, { keyId: "k1" });          // 101, consecutive
  day.n = 102;
  await tool.handler({ tokenId: 1 }, { keyId: "k1" });          // 102, consecutive
  assert.deepEqual(
    { level: q.getToken(1).level, streak: q.getToken(1).streak },
    { level: 3, streak: 3 }
  );

  day.n = 110;                                                   // seven days missed
  const lapsed = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(lapsed.streak, 1, "a gap starts the streak again");
  assert.equal(lapsed.level, 4, "level counts distinct credited days and never falls");
  const token = q.getToken(1);
  assert.equal(token.streak, 1);
  assert.equal(token.level, 4);
  assert.equal(token.lastDay, 110);
});

test("a refused second check-in leaves the token row exactly as it was", async () => {
  const { db, q } = withToken({ lastDay: 100 });
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  const after = q.getToken(1);

  const second = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(second.accepted, false);
  assert.deepEqual(q.getToken(1), after, "a duplicate day must not advance anything");
});

// The credit row and the level it implies are written in one transaction, so
// nothing can ever observe one without the other.
test("the credit row and the token row can never disagree", async () => {
  const { db, q } = withToken({ lastDay: 100 });
  const day = { n: 101 };
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => day.n });
  for (const n of [101, 102, 103, 200]) {
    day.n = n;
    await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  }
  const token = q.getToken(1);
  const credits = creditsFor(db, 1);
  // The token started at level 1 with no credit behind it (that is what a mint
  // leaves), so every credit after that is exactly one level.
  assert.equal(token.level, credits.length + 1);
  assert.equal(token.lastDay, Math.max(...credits.map((c) => c.day)));
});

test("a failed level write rolls the credit back with it", async () => {
  const { db, q } = withToken({ lastDay: 100 });
  const broken = { ...q, creditDay: () => { throw new Error("level write failed"); } };
  const tool = makeCheckinTool({ q: broken, chain: noChainRead, today: () => 101 });

  await assert.rejects(tool.handler({ tokenId: 1 }, { keyId: "k1" }), /level write failed/);
  assert.equal(creditsFor(db, 1).length, 0, "the credit must not survive a failed level write");
  assert.equal(q.getToken(1).level, 1);
});

// credits.sigHash is the record of WHICH signed request bought a day. Nothing
// ever set it, so every row stored "". The door now hashes the Signature
// header and threads it through authInfo; this is the tool's half of that.
test("the check-in stores the sigHash it was given", async () => {
  const { db, q } = withToken({ lastDay: 100 });
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  await tool.handler({ tokenId: 1 }, { keyId: "k1", sigHash: "a".repeat(64) });
  assert.equal(creditsFor(db, 1)[0].sigHash, "a".repeat(64));
});

// THE MIRROR MUST NOT RUN AHEAD OF THE CHAIN.
//
// MachineReadableOnly.sol:249 mints with `Token(1, 1, d, d, ...)` -- lastDay
// IS the mint day -- and :314 reverts DayNotAdvanced(id) on `day <= s.lastDay`.
// So a check-in on the day of minting is refused ON CHAIN. The unique
// (tokenId, day) index cannot catch it, because on mint day that index is
// empty; before this guard the mirror credited the day, wrote level 2, and
// every later day inherited the offset. `seed` mints its child the same way
// (MachineReadableOnly.sol:545), so a seeded child is covered by the same rule.
test("a check-in on the mint day is refused, and nothing about the token moves", async () => {
  // lastDay === mintDay === today is exactly what mint and seed leave behind.
  const { db, q } = withToken({ lastDay: 100 });
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 100 });
  const before = q.getToken(1);

  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1", sigHash: "b".repeat(64) });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "already-credited-today");
  // It reopens the day after lastDay, which is the first day the chain accepts.
  assert.equal(r.nextWindowOpensAt, new Date(101 * 86_400_000).toISOString());

  assert.deepEqual(q.getToken(1), before, "level, streak and lastDay must all be untouched");
  assert.equal(q.getToken(1).level, 1);
  assert.equal(q.getToken(1).streak, 1);
  assert.equal(creditsFor(db, 1).length, 0, "a refused day must leave no credit row");
});

test("a day BEFORE lastDay is refused too, not credited as a backfill", async () => {
  // A clock that has gone backwards, or a reconcile that moved lastDay
  // forward. The chain reverts on `day <= lastDay`, both halves of it.
  const { db, q } = withToken({ lastDay: 100 });
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 99 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "already-credited-today");
  assert.equal(creditsFor(db, 1).length, 0);
});

test("CONTROL: the very next day IS credited, so the guard refuses only what the chain refuses", async () => {
  const { db, q } = withToken({ lastDay: 100 });
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.accepted, true);
  assert.equal(r.level, 2);
  assert.equal(r.streak, 2);
  assert.equal(creditsFor(db, 1).length, 1);
});
