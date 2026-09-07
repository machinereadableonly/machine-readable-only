import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeSeedTool } from "../src/mcp/tools/seed.mjs";
import { onChainBy } from "../src/mcp/nextSteps.mjs";
import { openChain, restingChain, supplyFullChain, takenIdsChain, noSeedChain } from "./chain-stub.mjs";

/// Every test gets its own in-memory database, so no test can see another's rows.
function fresh() {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
}

/// insertToken has no level/status columns in its argument list -- both are
/// set directly on the row, the same way a reconcile from the Clock would
/// leave a token in an arbitrary state.
/// A solved bitmap, in the shape completeSolve stores: 172 bytes as hex. Only
/// its length matters here -- a child with no solved artwork is never offered
/// to the Clock, so it could never reach `written`.
const QR = "ab".repeat(172);

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

// The CHAIN names the other key too, which is what makes this a real refusal.
// It used to pass with the default stub (`boundTo: "k1"`, the caller) because
// seed refused on the stale mirror alone and never asked. Now that it asks, a
// chain saying "this IS your token" would admit the caller -- correctly -- and
// this test would be asserting the opposite of what it claims. 5.M2.
test("seeding from a parent bound to a different key is refused", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "other-key", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const tool = makeSeedTool({ q, chain: openChain({ boundTo: "other-key" }), today: () => 1000, supplyCap: 10_000 });
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

// THE CHAIN SAYS SO, not this database. The budget used to be computed here
// from `firstMintDay` and `seedsSpent`, both of which read `tokens.keyId` -- the
// column reconcile.mjs REWRITES on every `Rebound` -- while the contract keeps
// tenure in per-key mappings `rebind` never touches. The three ways those two
// diverged are each pinned below.
test("seeding with no unspent seed for this agent-year is refused", async () => {
  const { db, q } = fresh();
  // The mirror would say this key has a seed: it minted on day 0, today is
  // 1000, so `floor(1000/365)` is two years of budget and nothing spent. The
  // CHAIN says zero, and the chain is what reverts.
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  assert.ok(Math.floor((1000 - q.firstMintDay("k1")) / 365) > q.seedsSpent("k1"),
    "the mirror alone would have admitted this call");
  const tool = makeSeedTool({ q, chain: noSeedChain(), today: () => 1000, supplyCap: 10_000 });
  const r = await tool.handler({ parentId: 1, to: "0x1111111111111111111111111111111111111111" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-seed-available");
  assert.equal(q.tokenCount(), 1, "and nothing was reserved");
});

// DIVERGENCE 1. A child rebound AWAY from this key stops being counted by
// `seedsSpent`, because reconcile rewrites `tokens.keyId` and the count is
// `keyId = ? AND parentId IS NOT NULL`. The contract's `_seedsSpent` never
// decrements, so the mirror handed out a SECOND seed for the year: the chain
// then reverts NoSeedAvailable, the Clock drops the row a day later, and the
// agent has spent an id and a bitmap solve on a success message that told it
// the seed was used.
test("a child rebound away does not hand its key a second seed", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  // The seed was spent and the child written; then its owner rebound it to
  // another key and the Clock reconciled that, exactly as reconcile.mjs does.
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k1", lastDay: 365, mintDay: 365 });
  q.completeSolve(2, QR);
  q.markSeedWritten(2);
  db.exec("UPDATE tokens SET keyId = 'k2' WHERE tokenId = 2");
  assert.equal(q.seedsSpent("k1"), 0, "the mirror has forgotten the spend -- this is the defect");

  const tool = makeSeedTool({ q, chain: noSeedChain(), today: () => 400 });
  const r = await tool.handler({ parentId: 1, to: "0x2222222222222222222222222222222222222222" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-seed-available", "the chain still counts the spend, and it is the authority");
  assert.equal(q.tokenCount(), 2, "the parent and the rebound child; no third row");
});

// DIVERGENCE 2. A child rebound IN charges a key that never seeded anything.
// The mirror counts the inherited row against the new key and refuses a seed
// the chain WOULD grant -- and a seed is earned once a year, so there is no
// recovery path at all.
test("a child rebound in does not charge a key that never seeded", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  // A child of somebody else's line, written on chain and then rebound to k1.
  q.insertToken({ tokenId: 9, keyId: "other", owner: "0xC", lastDay: 0, mintDay: 0 });
  q.insertSeed({ childId: 10, parentId: 9, toAddress: "0xC", keyId: "other", lastDay: 0, mintDay: 0 });
  q.completeSolve(10, QR);
  q.markSeedWritten(10);
  db.exec("UPDATE tokens SET keyId = 'k1' WHERE tokenId = 10");
  assert.equal(q.seedsSpent("k1"), 1, "the mirror charges k1 for a seed it never spent -- this is the defect");

  const tool = makeSeedTool({ q, chain: openChain(), today: () => 400 });
  const r = await tool.handler({ parentId: 1, to: "0x2222222222222222222222222222222222222222" }, { keyId: "k1" });
  assert.equal(r.ok, true, r.reason);
  assert.equal(q.getToken(r.tokenId).parentId, 1);
});

// DIVERGENCE 3. `firstMintDay` answers 0 for a key with no rows at all, so the
// old arithmetic read `floor(today / 365)` -- about 56 years of budget by the
// time `today` is a real day number -- where the contract grants none, because
// `seedsAvailable` returns 0 outright for a key that has never minted.
test("a key with no rows in this mirror is granted nothing", async () => {
  const { db, q } = fresh();
  // The parent is bound to k1 ON CHAIN and this mirror has never seen k1 --
  // a fresh database beside a contract that already holds tokens, which is
  // exactly the state `freeIdFrom` exists for.
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  db.exec("UPDATE tokens SET keyId = 'stale' WHERE tokenId = 1");
  assert.equal(q.firstMintDay("k1"), 0, "no rows, so the old arithmetic saw day zero -- this is the defect");

  const tool = makeSeedTool({ q, chain: noSeedChain(), today: () => 20_000 });
  const r = await tool.handler({ parentId: 1, to: "0x2222222222222222222222222222222222222222" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-seed-available");
});

// THE NULL RULE, ON THIS GATE. A chain that cannot answer must refuse: the seed
// is the one budget an agent earns once a year, so admitting on an outage would
// spend it on a call the contract was never asked about.
test("a chain that cannot say how many seeds are left refuses rather than admits", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const tool = makeSeedTool({
    q, chain: openChain({ seedsAvailable: async () => null }), today: () => 400,
  });
  const r = await tool.handler({ parentId: 1, to: "0x2222222222222222222222222222222222222222" }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "chain-unavailable");
  assert.equal(q.tokenCount(), 1, "and a refusal on an outage burns no agent-year");
});

// THE MIRROR'S ONE REMAINING TERM. The chain cannot see a seed reserved here
// and not yet written, so it goes on answering "one left" for the whole day a
// reservation waits for the Clock. Subtracting the reservation is what stops
// two seeds leaving in that window.
test("a reservation the chain cannot see yet is still subtracted", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x2222222222222222222222222222222222222222";
  // The chain says one seed is left, on EVERY call: it has not been told about
  // the first child, and will not be until 00:05 UTC.
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 400 });

  const first = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(first.ok, true, first.reason);
  const second = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "no-seed-available");
  assert.equal(q.unwrittenSeeds("k1"), 1, "one reservation, and it is what refused the second call");
  assert.equal(q.tokenCount(), 2, "the parent and ONE child");
});

// AND IT STOPS BEING SUBTRACTED once the chain knows. A written child is
// already inside `seedsAvailable`, so counting it here too would refuse the
// NEXT year's seed for a full year.
test("a written child is counted by the chain alone, never twice", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  q.insertSeed({ childId: 2, parentId: 1, toAddress: "0xB", keyId: "k1", lastDay: 365, mintDay: 365 });
  q.completeSolve(2, QR);
  q.markSeedWritten(2);
  assert.equal(q.seedsSpent("k1"), 1, "the row is still there");
  assert.equal(q.unwrittenSeeds("k1"), 0, "but the chain has been told, so it is not subtracted again");

  // A second year of tenure: the chain grants one, and nothing here takes it
  // away.
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 730 });
  const r = await tool.handler({ parentId: 1, to: "0x3333333333333333333333333333333333333333" }, { keyId: "k1" });
  assert.equal(r.ok, true, r.reason);
});

test("a whole parent with an unspent seed gets a child", async () => {
  // This test asserted a refusal until 2026-09-07, and before that it asserted
  // a LIE: the tool inserted a `tokens` row and no `mints` row, answered
  // `txStatus: "queued"`, and nothing in this repository ever sent `seed` to
  // the chain. Both halves exist now -- `insertSeed` writes the pair in one
  // transaction and the Clock's fourth pass sends it -- so the promise is real.
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xparent-owner", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x2222222222222222222222222222222222222222";
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 365 });
  const r = await tool.handler({ parentId: 1, to }, { keyId: "k1" });

  assert.equal(r.ok, true);
  assert.equal(r.tokenId, 2);
  assert.equal(r.parentId, 1);
  assert.equal(r.txStatus, "queued");
  assert.equal(r.to, to);
  assert.equal(r.agentKeyId, "k1");
  assert.equal(r.level, 1, "a child starts at one day, like every founding token");
  // The same promise `mint` makes, from the same formula, about the same run.
  assert.equal(r.onChainBy, onChainBy(365));

  // THE ROW IS THE RESERVATION. Both halves have to be there: a tokens row
  // with no mints row is a child no bitmap is ever solved for, which is the
  // exact orphan this tool used to create.
  const child = q.getToken(2);
  assert.equal(child.parentId, 1);
  assert.equal(child.generation, q.getToken(1).generation + 1);
  assert.equal(child.lastDay, 365);
  assert.equal(child.mintDay, 365);
  assert.equal(q.getMint(2).status, "queued", "free, so it is queued outright and never awaits a payment");
  assert.equal(q.getMint(2).solveState, "pending", "and it joins the solve queue, because a bitmap encodes its own url");
  assert.equal(q.seedsSpent("k1"), 1, "the row IS the spend; there is no second counter");
});

// The reservation-counting property, at the TOOL boundary rather than the query
// one. A guard that reads only committed state cannot see what is promised --
// the same defect class as the reservedMask Critical -- and here the window
// between a reservation and the Clock writing it is up to a day wide. A key
// earns one seed per completed agent-year and can never earn that year again,
// so a second seed inside it is not a small over-issue: it is permanent.
test("the second seed in one agent-year is refused", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xparent-owner", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x2222222222222222222222222222222222222222";
  const tool = makeSeedTool({ q, chain: openChain(), today: () => 365 });

  const first = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(first.ok, true);

  // NOTHING HAS BEEN WRITTEN TO THE CHAIN between these two calls. The row is
  // still 'queued' and the Clock has not run, so this refusal can only come
  // from counting the reservation.
  const second = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "no-seed-available");
  assert.equal(q.tokenCount(), 2, "the parent and ONE child");
  assert.equal(q.seedsSpent("k1"), 1);
});

// The id is assigned HERE and sent to the contract, which reverts TokenExists
// on a collision. The mirror's own max id is not a fact about the chain: the
// same reasoning `mint` records at the line it was measured on, 2026-09-03.
test("the child's id is the one the CHAIN says is free, not the mirror's next", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xparent-owner", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  // The chain already holds 2 and 3 -- tokens this mirror has not reconciled.
  const tool = makeSeedTool({ q, chain: takenIdsChain([2, 3]), today: () => 365 });
  const r = await tool.handler({ parentId: 1, to: "0x6666666666666666666666666666666666666666" }, { keyId: "k1" });

  assert.equal(r.ok, true);
  assert.equal(r.tokenId, 4, "2 and 3 are taken on chain, so the child is 4");
  assert.equal(q.getToken(4).parentId, 1);
  assert.equal(q.getToken(2), undefined, "and nothing was written at the id the mirror proposed");
});

// Null from freeIdFrom means "could not establish one", never "use it anyway".
// Reserving on a guess would spend the agent-year on a child the contract
// refuses, and a seed is the one budget nobody can hand back cheaply.
test("a chain that cannot name a free id refuses rather than guesses", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xparent-owner", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const tool = makeSeedTool({ q, chain: openChain({ freeIdFrom: async () => null }), today: () => 365 });
  const r = await tool.handler({ parentId: 1, to: "0x7777777777777777777777777777777777777777" }, { keyId: "k1" });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "chain-unavailable");
  assert.equal(q.tokenCount(), 1);
  assert.equal(q.seedsSpent("k1"), 0, "a refusal must not burn the agent-year's seed");
});

// THE PER-YEAR ARITHMETIC IS THE CONTRACT'S, NOT THIS SERVICE'S, since
// 2026-09-07. `seedsAvailable` does the division and the subtraction on chain,
// and Lifecycle.t.sol:test_theBudgetIsOnePerYearOfKeyTenure provokes both sides
// of that boundary where it is actually enforced. What is left to pin HERE is
// that the tool takes that answer in both directions: a zero refuses and does
// not write, a one admits. Both sides, because a gate tested on one side only
// is a gate that can be inverted and still pass.
test("the tool takes the chain's budget answer in both directions", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  setLevelAndStatus(db, 1, 365, "queued");
  const to = "0x3333333333333333333333333333333333333333";

  // The key's tenure is one day short of a year: the contract grants nothing.
  const before = makeSeedTool({ q, chain: noSeedChain(), today: () => 364 });
  const early = await before.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(early.reason, "no-seed-available");
  assert.equal(q.tokenCount(), 1, "and the refused call wrote nothing");

  // A completed agent-year: the seed is due.
  const at = makeSeedTool({ q, chain: openChain(), today: () => 365 });
  const due = await at.handler({ parentId: 1, to }, { keyId: "k1" });
  assert.equal(due.ok, true);
  assert.equal(due.tokenId, 2);
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

// 4.H1, INVERTED. This used to assert the tool wrote nothing on ANY path,
// because the write path did not exist. It does now, so the property that
// still matters is the narrower and more valuable one: a REFUSED seed must
// write nothing. A reserved child the chain refuses is worse than a refusal --
// it is served by /t/<id> as real, it spends a seed the agent cannot earn
// again, and a free row has no reservedAt, so it appears in neither the expiry
// sweep nor `staleRows`.
//
// Every gate gets its own trapped run rather than one, because the write sits
// after all of them and a single sample cannot tell "no gate writes" from
// "this gate does not".
test("a refused seed writes no mirror row, whichever gate refused it", async () => {
  // A double whose only write method is a trap. If the tool reaches it, the
  // throw is CAUGHT by seed's own try/catch around `insertSeed` and turned into
  // `{ ok: false, reason: "internal" }`, so the failure surfaces on the reason
  // assertion below rather than on the trap's own message. That is still a
  // clean signal -- no gate in this table can legitimately answer `internal` --
  // but do not read the message here expecting to see it in the output.
  const trap = (q) => ({
    ...q,
    insertSeed: () => { throw new Error("a refused seed must not reserve a child"); },
  });
  const to = "0x5555555555555555555555555555555555555555";

  const cases = [
    ["parent-not-whole", { level: 1, today: 365, chain: openChain() }],
    ["no-seed-available", { level: 365, today: 365, chain: noSeedChain() }],
    ["resting", { level: 365, today: 365, chain: restingChain() }],
    ["supply-cap-reached", { level: 365, today: 365, chain: supplyFullChain() }],
    ["chain-unavailable", { level: 365, today: 365, chain: openChain({ freeIdFrom: async () => null }) }],
  ];

  for (const [reason, { level, today, chain }] of cases) {
    const { db, q } = fresh();
    q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
    setLevelAndStatus(db, 1, level, "queued");
    const tool = makeSeedTool({ q: trap(q), chain, today: () => today });

    const r = await tool.handler({ parentId: 1, to }, { keyId: "k1" });
    assert.equal(r.ok, false, `${reason}: expected a refusal`);
    assert.equal(r.reason, reason);
    assert.equal(q.tokenCount(), 1, `${reason}: the parent alone`);
    assert.equal(q.seedsSpent("k1"), 0, `${reason}: a refusal must not burn the agent-year's seed`);
  }
});
