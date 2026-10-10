// The contract's gates, mirrored. Every one of these was MISSING until
// 2026-08-31, and every one of them reverts a transaction this service would
// otherwise queue -- two of them after the agent has already paid.
//
// The refusal direction is the point of most of this file. An RPC that cannot
// be reached must refuse the write, never admit it: refusing costs an agent a
// retry, admitting costs it a payment for a transaction that was always going
// to revert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chainBlock, tokenBlock, walletCapBlock, supplyBlock, receiverBlock, yearCompleteBlock, paidWriteBlock, requireChain } from "../src/mcp/gates.mjs";
import { makeChainReader, SUNSET_CACHE_MS } from "../src/chain/read.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { makeCheckinTool } from "../src/mcp/tools/checkin.mjs";
import { makeSeedTool } from "../src/mcp/tools/seed.mjs";
import {
  openChain, sunsetChain, pausedChain, unreadableChain,
  restingChain, unknownTokenChain, walletFullChain, supplyFullChain, nonReceiverChain,
  finishedChain,
} from "./chain-stub.mjs";

const TO = "0x" + "11".repeat(20);
const BANK = JSON.parse(readFileSync(new URL("./fixtures/question-bank.json", import.meta.url), "utf8"));

/// A mirror with nothing in it, for the gates that now subtract what this
/// service has promised and the chain has not been told.
const emptyMirror = () => queries(openDb(":memory:"));
import { settleNow, settleNowFor } from "./paid-stub.mjs";

// --- the gate functions ----------------------------------------------------

test("chainBlock names the contract-wide gate, and an unreadable chain is not an open one", async () => {
  assert.equal(await chainBlock(openChain()), null);
  assert.equal(await chainBlock(sunsetChain()), "sunset");
  assert.equal(await chainBlock(pausedChain()), "paused");
  assert.equal(await chainBlock(unreadableChain()), "chain-unavailable");
});

test("tokenBlock refuses a sealed or absent token, and records a sealed one", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });

  assert.equal(await tokenBlock(openChain(), 1, q), null);
  assert.equal(q.getToken(1).resting, 0);

  assert.equal(await tokenBlock(restingChain(), 1, q), "resting");
  // Written down, because rest() happens on chain and this service is never
  // told: without this, /t/<id> keeps calling a sealed token alive.
  assert.equal(q.getToken(1).resting, 1);

  assert.equal(await tokenBlock(unknownTokenChain(), 1), "unknown-token");
  assert.equal(await tokenBlock(unreadableChain(), 1), "chain-unavailable");
});

test("tokenBlock works without a mirror to write to", async () => {
  assert.equal(await tokenBlock(restingChain(), 1), "resting");
});

test("walletCapBlock refuses a full address and an unreadable chain", async () => {
  const empty = emptyMirror();
  assert.equal(await walletCapBlock(openChain(), empty, TO), null);
  assert.equal(await walletCapBlock(walletFullChain(), empty, TO), "wallet-cap-reached");
  assert.equal(await walletCapBlock(unreadableChain(), empty, TO), "chain-unavailable");
});

// THE WINDOW THE CHAIN CANNOT SEE. A mint reaches the chain only at the next
// 00:05 run, so between a payment and that run the contract's own count is
// behind by every reservation this mirror holds. The twenty-first mint to one
// address in a day was charged for and then reverted WalletCap, with no branch
// in the Clock to notice it.
test("walletCapBlock subtracts the mints this mirror has promised", async () => {
  const q = emptyMirror();
  const chain = openChain({ walletRoomFor: async () => 1 });
  assert.equal(await walletCapBlock(chain, q, TO), null, "the chain's last slot is free");

  q.transact(() => {
    q.insertMint({ tokenId: 1, toAddress: TO, keyId: "k1", payNonce: "0xone" });
    q.insertToken({ tokenId: 1, keyId: "k1", owner: TO, lastDay: 0, mintDay: 0 });
  });
  assert.equal(await walletCapBlock(chain, q, TO), "wallet-cap-reached", "and this mirror has taken it");

  // ANOTHER ADDRESS IS UNTOUCHED. The cap is per recipient on chain, so a
  // subtraction that counted every unwritten mint would refuse everybody.
  assert.equal(await walletCapBlock(chain, q, "0x" + "22".repeat(20)), null);
});

test("supplyBlock subtracts them too, which is the sell-out day", async () => {
  const q = emptyMirror();
  const chain = openChain({ supplyRoom: async () => 1 });
  assert.equal(await supplyBlock(chain, q), null);

  // A SEED COUNTS, not only a paid mint: the contract takes both from the same
  // SupplyCap, and a seeded child's row lands in `mints` queued outright.
  q.insertToken({ tokenId: 1, keyId: "k1", owner: TO, lastDay: 0, mintDay: 0 });
  q.insertSeed({ childId: 2, parentId: 1, toAddress: TO, keyId: "k1", lastDay: 0, mintDay: 0 });
  assert.equal(await supplyBlock(chain, q), "supply-cap-reached");
});

// The one row that must NOT be subtracted: a token the chain already holds is
// in the chain's own count, so counting it twice would close the collection a
// token early, for ever.
test("a written row is not subtracted twice", async () => {
  const q = emptyMirror();
  const chain = openChain({ supplyRoom: async () => 1 });
  q.transact(() => {
    q.insertMint({ tokenId: 1, toAddress: TO, keyId: "k1", payNonce: "0xone" });
    q.insertToken({ tokenId: 1, keyId: "k1", owner: TO, lastDay: 0, mintDay: 0 });
  });
  q.markMintWritten(1);
  assert.equal(await supplyBlock(chain, q), null);
  assert.equal(await walletCapBlock(chain, q, TO), null);
});

test("paidWriteBlock checks only what it is given, in a stable order", async () => {
  // No tokenId and no `to`: only the contract-wide gate is asked.
  const asked = [];
  const chain = openChain({
    lifecycleOf: async () => { asked.push("lifecycle"); return { exists: true, resting: false, sunset: false, level: 1, lastDay: 0 }; },
    walletRoomFor: async () => { asked.push("wallet"); return 20; },
  });
  assert.equal(await paidWriteBlock(chain, { q: emptyMirror() }), null);
  assert.deepEqual(asked, []);

  // Contract state wins over a token reason, so the answer does not depend on
  // which concurrent read happens to resolve first.
  const closedAndResting = sunsetChain();
  closedAndResting.lifecycleOf = async () => ({ exists: true, resting: true, sunset: true, level: 1, lastDay: 0 });
  assert.equal(await paidWriteBlock(closedAndResting, { tokenId: 1, to: TO, q: emptyMirror() }), "sunset");
});

test("supplyBlock reads the collection's room from the chain, and refuses on an unreadable one", async () => {
  const q = emptyMirror();
  assert.equal(await supplyBlock(openChain(), q), null);
  assert.equal(await supplyBlock(supplyFullChain(), q), "supply-cap-reached");
  // One slot left is still a slot: the boundary is provoked from both sides,
  // because a gate that is merely PRESENT proves nothing about where it sits.
  assert.equal(await supplyBlock(openChain({ supplyRoom: async () => 1 }), q), null);
  assert.equal(await supplyBlock(unreadableChain(), q), "chain-unavailable");
});

// `upgrade` adds a Mark, not a token, and the contract has no SupplyCap on
// applyMark. A gate applied where the chain does not apply it would refuse
// paid work for no reason.
test("paidWriteBlock asks the supply cap only for a call that MINTS", async () => {
  let asked = 0;
  const counting = () => openChain({ supplyRoom: async () => { asked += 1; return 0; } });
  assert.equal(await paidWriteBlock(counting(), { tokenId: 1, q: emptyMirror() }), null);
  assert.equal(asked, 0, "upgrade must not pay for a read the contract never makes");
  assert.equal(await paidWriteBlock(counting(), { to: TO, q: emptyMirror(), mints: true }), "supply-cap-reached");
  assert.equal(asked, 1);
});

// --- the receiver gate (F5) ------------------------------------------------
//
// `mint` makes no callback, so the chain would deliver to any address, and a
// token delivered to a contract that does not answer `onERC721Received` is
// stuck there for good. The gate refuses that address before the money moves.
test("receiverBlock passes an ordinary wallet and refuses one that cannot receive", async () => {
  assert.equal(await receiverBlock(openChain(), TO), null);
  assert.equal(await receiverBlock(nonReceiverChain(), TO), "recipient-cannot-receive");
});

// The contract reverts AlreadyFinished(id) inside `_credit`, which both
// check-in paths share, so a token at FINISH_LEVEL refuses every further
// credit. 365 is the boundary and it is INCLUSIVE: `s.level >= FINISH_LEVEL`.
test("yearCompleteBlock refuses a finished token, admits the day that finishes it", async () => {
  const atLevel = (level) =>
    openChain({ lifecycleOf: async () => ({ exists: true, resting: false, sunset: false, level, lastDay: 0 }) });
  assert.equal(await yearCompleteBlock(atLevel(364), 1), null, "day 365 is still to come");
  assert.equal(await yearCompleteBlock(atLevel(365), 1), "year-complete");
  assert.equal(await yearCompleteBlock(finishedChain(), 1), "year-complete");
  // A token the chain does not hold has level 0 and is not finished; it is
  // tokenBlock's business, not this gate's.
  assert.equal(await yearCompleteBlock(unknownTokenChain(), 1), null);
});

test("yearCompleteBlock refuses an unreadable chain rather than assuming room is left", async () => {
  assert.equal(await yearCompleteBlock(unreadableChain(), 1), "chain-unavailable");
});

test("receiverBlock refuses an unreadable chain rather than assuming it can receive", async () => {
  // THE NULL RULE, the same one every gate in this file follows. Admitting on
  // "could not ask" is what costs an agent a payment for a write that was
  // always going to revert.
  assert.equal(await receiverBlock(unreadableChain(), TO), "chain-unavailable");
});

test("paidWriteBlock asks the receiver gate only when there is a recipient", async () => {
  // `upgrade` buys a Mark and mints nothing, so it has no recipient and must
  // not pay for the read. Same shape as the supply-cap test above.
  let asked = 0;
  const counting = () =>
    openChain({ canReceiveERC721: async () => { asked += 1; return false; } });
  assert.equal(await paidWriteBlock(counting(), { q: emptyMirror() }), null);
  assert.equal(asked, 0, "upgrade must not pay for a read its write never makes");
  assert.equal(await paidWriteBlock(counting(), { to: TO, q: emptyMirror() }), "recipient-cannot-receive");
  assert.equal(asked, 1);
});

// THROUGH THE REAL TOOL, because the gate functions above can be right while
// the handler that calls them passes no mirror. This is the repro the review
// ran: with room for one on chain, the last slot was sold twice and the second
// mint paid its dollar and then reverted at the Clock, retrying every night.
test("the last slot cannot be sold twice through mint", async () => {
  const q = queries(openDb(":memory:"));
  const chain = openChain({ walletRoomFor: async () => 1, supplyRoom: async () => 100 });
  const tool = makeMintTool({ q, chain, paid: settleNowFor(q), today: () => 100, alert: () => {} });

  const first = await tool.handler({ to: TO }, { keyId: "k1" });
  assert.equal(first.ok, true);

  const second = await tool.handler({ to: TO }, { keyId: "k2" });
  assert.equal(second.ok, false, "a second mint to a full address is refused BEFORE it is charged");
  assert.equal(second.reason, "wallet-cap-reached");
  assert.equal(q.tokenCount(), 1);
});

test("and neither can the collection's", async () => {
  const q = queries(openDb(":memory:"));
  const chain = openChain({ walletRoomFor: async () => 100, supplyRoom: async () => 1 });
  const tool = makeMintTool({ q, chain, paid: settleNowFor(q), today: () => 100, alert: () => {} });

  assert.equal((await tool.handler({ to: TO }, { keyId: "k1" })).ok, true);
  const second = await tool.handler({ to: "0x" + "22".repeat(20) }, { keyId: "k2" });
  assert.equal(second.reason, "supply-cap-reached");
});

// 16 Low. Two paid mints racing for the last slot both passed the post-payment
// gate, then awaited the id lookup, then both inserted. The mirror is now
// re-checked against the room the gate read, with no await before the insert.
test("two concurrent mints cannot both reserve the collection's last slot", async () => {
  const q = queries(openDb(":memory:"));
  const chain = openChain({
    walletRoomFor: async () => 100,
    supplyRoom: async () => 1,
    freeIdFrom: async (from) => { await new Promise((r) => setTimeout(r, 5)); return from; },
  });
  const tool = makeMintTool({ q, chain, paid: settleNowFor(q), today: () => 100, alert: () => {} });
  const results = await Promise.all([
    tool.handler({ to: TO }, { keyId: "k1" }),
    tool.handler({ to: "0x" + "22".repeat(20) }, { keyId: "k2" }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.equal(results.find((r) => !r.ok).detail, "supply-cap-reached");
  assert.equal(q.tokenCount(), 1);
});

// 16 Low. A key whose only row is a held payment was told "already-minted";
// the agent that most needs "do not pay again" got a different word.
test("a key whose mint payment is held is told so, not already-minted", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const tool = makeMintTool({ q, chain: openChain(), paid: settleNowFor(q), today: () => 100, alert: () => {} });
  assert.equal((await tool.handler({ to: TO }, { keyId: "k1" })).ok, true);
  db.exec("UPDATE mints SET status = 'payment-unresolved'");
  const again = await tool.handler({ to: TO }, { keyId: "k1" });
  assert.equal(again.reason, "payment-unresolved");
});

test("a tool factory refuses to build without a chain reader", () => {
  for (const make of [makeMintTool, makeUpgradeTool, makeCheckinTool, makeSeedTool]) {
    assert.throws(() => make({ q: {}, paid: settleNow, supplyCap: 10, today: () => 1, catalogue: {} }),
      /requires a chain reader/);
  }
  // A partial stub is not a chain reader either: this is the shape a test
  // written before the gates existed would have passed.
  assert.throws(() => makeMintTool({ q: {}, chain: { boundKeyOf: async () => null }, paid: settleNow, today: () => 1 }),
    /requires a chain reader/);
  // A reader that is complete EXCEPT for the newest method is the real drift:
  // this is exactly the shape that shipped `chain.freeIdFrom is not a function`
  // to production while every tool test passed.
  const { supplyRoom, ...missingSupply } = openChain();
  assert.throws(() => makeMintTool({ q: {}, chain: missingSupply, paid: settleNow, today: () => 1 }),
    /requires a chain reader with supplyRoom\(\)/);
  // And the same for the newest one again, `seedsAvailable`. `seed` reads its
  // agent-year budget from the chain since 2026-09-07, and a reader without it
  // would throw at the first seed rather than at build time -- on the one call
  // an agent gets once a year.
  const { seedsAvailable, ...missingSeeds } = openChain();
  assert.throws(() => makeSeedTool({ q: {}, chain: missingSeeds, today: () => 1 }),
    /requires a chain reader with seedsAvailable\(\)/);
  // And the newest again, `canReceiveERC721` (F5, 2026-09-16). A reader
  // without it would throw at the first mint rather than at build time -- on
  // the one call where an agent's money is already in flight.
  const { canReceiveERC721, ...missingReceiver } = openChain();
  assert.throws(() => makeMintTool({ q: {}, chain: missingReceiver, paid: settleNow, today: () => 1 }),
    /requires a chain reader with canReceiveERC721\(\)/);
});

// THE DOUBLE MUST CARRY THE REAL THING'S SURFACE. A stub that implements only
// the methods that existed when it was written agrees with every mistake made
// after that -- measured twice on this project, the second time costing a paid
// mint. Whenever a method is added to the reader, this test is what makes the
// stub follow it.
test("the test chain stub answers everything the real reader does", () => {
  const real = makeChainReader({ rpcUrl: "https://example.invalid", contract: "0x" + "11".repeat(20) });
  assert.deepEqual(Object.keys(openChain()).sort(), Object.keys(real).sort());
});

// --- mint: every refusal must come BEFORE the money ------------------------

for (const [label, chain, reason] of [
  ["a sunset piece", sunsetChain, "sunset"],
  ["a paused contract", pausedChain, "paused"],
  ["a full wallet", walletFullChain, "wallet-cap-reached"],
  // SupplyCap was the one contract gate still answered from the mirror: a
  // constant 10_000 against this database's row count. An owner who lowers the
  // cap to close the collection early left both halves stale, and the mint sold
  // anyway -- with no refusal, so nothing cancelled the settlement and the
  // money genuinely moved.
  ["a full collection", supplyFullChain, "supply-cap-reached"],
  ["an unreachable chain", unreadableChain, "chain-unavailable"],
  // F5. The refusal an agent would otherwise have PAID for and received
  // nothing from: the write reverts on simulate every night, forever.
  ["a recipient that cannot hold an ERC-721", nonReceiverChain, "recipient-cannot-receive"],
]) {
  test(`mint refuses ${label} without ever requesting payment`, async () => {
    const q = queries(openDb(":memory:"));
    const tool = makeMintTool({
      q,
      chain: chain(),
      paid: () => { throw new Error("payment must not be requested"); },
      supplyCap: 10,
      today: () => 100,
    });
    const r = await tool.handler({ to: TO }, { keyId: "k1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, reason);
    assert.equal(q.tokenCount(), 0);
  });
}

// The gates are re-read after settlement for the same reason the supply cap is:
// settling takes seconds, and the owner can pause the piece inside that window.
test("a mint whose chain gate closes DURING settlement is paid-but-unavailable", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const alerts = [];
  let calls = 0;
  const chain = openChain({
    // Open on the pre-payment read, paused on the post-settlement one.
    writesOpen: async () => (++calls === 1 ? null : "paused"),
  });

  const tool = makeMintTool({ q, chain, paid: settleNow, supplyCap: 10, today: () => 100, alert: (m) => alerts.push(m) });
  const r = await tool.handler({ to: TO }, { keyId: "k1" });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "paid-but-unavailable");
  assert.equal(r.detail, "paused");
  // Money changed hands and the agent got nothing: somebody has to see that.
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /the chain now refuses it: paused/);
  // And no token was written for a mint the chain would have reverted.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
});

test("CONTROL: an open chain still mints", async () => {
  const q = queries(openDb(":memory:"));
  const tool = makeMintTool({ q, chain: openChain(), paid: settleNow, supplyCap: 10, today: () => 100 });
  const r = await tool.handler({ to: TO }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.equal(q.tokenCount(), 1);
});

// --- upgrade ---------------------------------------------------------------

test("upgrade refuses a sealed token before payment, and records the seal", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const tool = makeUpgradeTool({
    q,
    chain: restingChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: () => { throw new Error("payment must not be requested"); },
  });
  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.reason, "resting");
  assert.equal(q.getToken(1).resting, 1);
});

test("an upgrade whose token is sealed DURING settlement is paid-but-unavailable", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const alerts = [];
  let calls = 0;
  const chain = openChain({
    lifecycleOf: async () => ({
      // 200 rather than 400: a level past 365 is one the chain cannot hold.
      exists: true, resting: ++calls > 1, sunset: false, level: 200, lastDay: 0,
    }),
  });
  const tool = makeUpgradeTool({
    q,
    chain,
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: settleNow,
    alert: (m) => alerts.push(m),
  });
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.reason, "paid-but-unavailable");
  assert.equal(r.detail, "resting");
  assert.equal(alerts.length, 1);
  // No reservation was made for a Mark the chain would have refused.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mark_orders").get().n, 0);
});

test("upgrade refuses an unreachable chain rather than charging for a guess", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const tool = makeUpgradeTool({
    q,
    chain: unreadableChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: () => { throw new Error("payment must not be requested"); },
  });
  assert.equal((await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" })).reason, "chain-unavailable");
});

// --- checkin (free, so no settlement window) -------------------------------

for (const [label, chain, reason] of [
  ["a sunset piece", sunsetChain, "sunset"],
  ["a paused contract", pausedChain, "paused"],
  ["a sealed token", restingChain, "resting"],
  ["an unreachable chain", unreadableChain, "chain-unavailable"],
  // The mirror in these tests is at level 1, so the door's own level guard
  // cannot fire: this is the CHAIN gate, and the case it exists for is a
  // mirror that is behind -- a reconcile that has not run over a token whose
  // year finished. Without it the credit is queued and batchCheckIn reverts.
  ["a finished token", finishedChain, "year-complete"],
]) {
  test(`checkin refuses ${label} and credits nothing`, async () => {
    const db = openDb(":memory:");
    const q = queries(db);
    q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
    const tool = makeCheckinTool({ bank: BANK, q, chain: chain(), today: () => 101 });
    const r = await tool.handler({ tokenId: 1 }, { keyId: "k1", sigHash: "h" });
    assert.equal(r.accepted, false);
    assert.equal(r.reason, reason);
    // A credit the Clock cannot land leaves the mirror permanently ahead of
    // the chain -- the same failure as the mint-day credit.
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM credits").get().n, 0);
    assert.equal(q.getToken(1).level, 1);
  });
}

/// A mirror holding one ordinary token, bound to k1, that checked in on day 100.
function checkinMirror(level = 1) {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  if (level > 1) q.creditDay(1, 100, level, 1);
  return q;
}

// ONE REASON, ONE SHAPE. `year-complete` is decided in two places -- the
// mirror's own level, and this chain gate for a mirror running behind -- and
// the two answers used to differ in their fields. A client cannot branch on a
// field that is there only sometimes, and an agent reading `heart` to learn the
// year is whole would see it from one path and not the other.
test("the year-complete refusal is the SAME value whether the mirror or the chain decided it", async () => {
  const fromChain = await makeCheckinTool({ bank: BANK, q: checkinMirror(), chain: finishedChain(), today: () => 101 })
    .handler({ tokenId: 1 }, { keyId: "k1", sigHash: "h" });
  const fromMirror = await makeCheckinTool({ bank: BANK, q: checkinMirror(365), chain: openChain(), today: () => 101 })
    .handler({ tokenId: 1 }, { keyId: "k1", sigHash: "h" });

  assert.deepEqual(fromChain, fromMirror);
  assert.deepEqual(fromChain, { ok: false, accepted: false, reason: "year-complete", heart: "365/365" });
});

// `resting` and `level` come out of ONE `viewOf`, and read.mjs caches nothing,
// so a gate fetching its own record buys a second eth_call for a fact the
// caller already holds -- on the free tool, every day, for every token.
test("checkin reads the token's lifecycle once, however many gates ask about it", async () => {
  let reads = 0;
  const counting = openChain({
    lifecycleOf: async () => {
      reads += 1;
      return { exists: true, resting: false, sunset: false, level: 1, lastDay: 0 };
    },
  });
  const r = await makeCheckinTool({ bank: BANK, q: checkinMirror(), chain: counting, today: () => 101 })
    .handler({ tokenId: 1 }, { keyId: "k1", sigHash: "h" });
  assert.equal(r.ok, true, "the credit must actually be taken, or the gates were never reached");
  assert.equal(reads, 1, "two gates, one read");
});

// --- seed ------------------------------------------------------------------

test("seed refuses a full recipient wallet, which the contract checks against the CHILD", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  db.exec("UPDATE tokens SET level = 365 WHERE tokenId = 1");
  const tool = makeSeedTool({ q, chain: walletFullChain(), today: () => 1000, supplyCap: 10_000 });
  const r = await tool.handler({ parentId: 1, to: TO }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "wallet-cap-reached");
  assert.equal(q.tokenCount(), 1);
});

test("seed refuses a sunset piece", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  db.exec("UPDATE tokens SET level = 365 WHERE tokenId = 1");
  const tool = makeSeedTool({ q, chain: sunsetChain(), today: () => 1000, supplyCap: 10_000 });
  assert.equal((await tool.handler({ parentId: 1, to: TO }, { keyId: "k1" })).reason, "sunset");
});

// --- the reader's own caching rule -----------------------------------------

/// A fetch that answers eth_call with a fixed word per selector, and counts.
function stubRpc(values, counts = {}) {
  return async (_url, init) => {
    const data = JSON.parse(init.body).params[0].data;
    counts[data] = (counts[data] ?? 0) + 1;
    const word = values[data] ?? "0".repeat(64);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0x" + word }) };
  };
}
const TRUE_WORD = "0".repeat(63) + "1";
const IS_SUNSET = "0x90b8b0c8";
const IS_PAUSED = "0x5c975abb";

test("a TRUE sunset is cached, because sunset is one-way on chain", async () => {
  const counts = {};
  const clock = { t: 0 };
  const chain = makeChainReader({
    rpcUrl: "https://rpc.example/",
    contract: "0xabc",
    fetchImpl: stubRpc({ [IS_SUNSET]: TRUE_WORD }, counts),
    now: () => clock.t,
  });
  assert.equal(await chain.writesOpen(), "sunset");
  assert.equal(await chain.writesOpen(), "sunset");
  assert.equal(counts[IS_SUNSET], 1, "the second answer came from the cache");

  clock.t = SUNSET_CACHE_MS + 1;
  assert.equal(await chain.writesOpen(), "sunset");
  assert.equal(counts[IS_SUNSET], 2, "and it is re-asked once the window passes");
});

// Caching a false would hold the door open for a minute after the operator
// shut it, and every write admitted in that window is one the chain refuses.
test("an OPEN contract is never cached: every call asks again", async () => {
  const counts = {};
  const chain = makeChainReader({
    rpcUrl: "https://rpc.example/", contract: "0xabc", fetchImpl: stubRpc({}, counts), now: () => 0,
  });
  assert.equal(await chain.writesOpen(), null);
  assert.equal(await chain.writesOpen(), null);
  assert.equal(counts[IS_SUNSET], 2);
});

// Pause is _pause/_unpause -- reversible -- so a cached true would go on
// refusing writes after the owner reopened the piece.
test("a paused contract is never cached, because pause can be lifted", async () => {
  const counts = {};
  const chain = makeChainReader({
    rpcUrl: "https://rpc.example/",
    contract: "0xabc",
    fetchImpl: stubRpc({ [IS_PAUSED]: TRUE_WORD }, counts),
    now: () => 0,
  });
  assert.equal(await chain.writesOpen(), "paused");
  assert.equal(await chain.writesOpen(), "paused");
  assert.equal(counts[IS_PAUSED], 2, "pause must be re-read every time");
});

test("a JSON-RPC error object is unreadable, not open", async () => {
  const chain = makeChainReader({
    rpcUrl: "https://rpc.example/",
    contract: "0xabc",
    fetchImpl: async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "boom" } }) }),
  });
  assert.equal(await chain.writesOpen(), "unreadable");
  assert.equal(await chain.lifecycleOf(1), null);
  assert.equal(await chain.walletRoomFor(TO), null);
  assert.equal(await chain.boundKeyOf(1), null);
});

test("a short or truncated return is unreadable, not a zero value", async () => {
  const chain = makeChainReader({
    rpcUrl: "https://rpc.example/",
    contract: "0xabc",
    fetchImpl: async () => ({ ok: true, json: async () => ({ jsonrpc: "2.0", id: 1, result: "0xdeadbeef" }) }),
  });
  assert.equal(await chain.writesOpen(), "unreadable");
  assert.equal(await chain.lifecycleOf(1), null);
  assert.equal(await chain.walletRoomFor(TO), null);
});
