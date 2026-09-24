// The `ladder` tool: what a purchase would forfeit, BEFORE it is paid for.
//
// `upgrade` already names an exclusion, but only in a refusal -- which arrives
// after the door has closed. A ladder whose exclusions are permanent is only
// fair if the consequence is legible in advance, so these tests are about
// legibility and not about arithmetic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { LADDER } from "../src/mcp/ladder.mjs";
import { makeLadderTool } from "../src/mcp/tools/ladder.mjs";
// C2.7 asserts that the forfeit `ladder` PROMISES and the one `upgrade` reports
// are the same string, so this suite drives both tools rather than one.
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { openChain } from "./chain-stub.mjs";
import { settleNow } from "./paid-stub.mjs";

// Token 1 wears Beat (id 4, the earned side of pair 2) and has since lapsed:
// level 40 credited days, a live run of nothing. That state is what makes every
// assertion below reachable at once -- pair 2 is decided, pair 1's earned side
// is still waiting on a run, pair 3's on a level it has not reached, and pair 5
// on an Iris it does not hold.
function ladderFor({ marks = 0, level = 1, streak = 1 } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  db.exec(`UPDATE tokens SET marks = ${marks}, level = ${level}, streak = ${streak} WHERE tokenId = 1`);
  return makeLadderTool({ q, catalogue: LADDER });
}

const ladder = ladderFor({ marks: 1 << 4, level: 40, streak: 0 });

// The caller is a stranger to this token on purpose: the whole point is that a
// consequence is readable before it is bought, and an agent deciding whether to
// buy has not bought yet.
const ctx = { keyId: "somebody-else" };

// The brief called this "a token holding Beat is told Break is closed". It is
// not: Break is pair 4 and Beat is pair 2, and EVERY exclusion is pair-internal
// since the cross-pair rule was removed as a trap on 2026-09-02. Beat forfeits
// Static and nothing else, which is what the assertions here have always said.
test("a token holding Beat is told Static is closed and by what, and that Break is untouched", async () => {
  // The case that matters. Everything else this tool reports is a convenience;
  // this is the one that makes the ladder fair.
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  const pair4 = res.pairs.find(p => p.pair === 4);
  assert.equal(pair4.closed, undefined);
  const pair2 = res.pairs.find(p => p.pair === 2);
  assert.equal(pair2.held, "beat");
  assert.equal(pair2.closed, "static");
  assert.equal(pair2.closedBy, "beat");
});

test("every pair reports what is open, what it costs and what gate it waits on", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  assert.equal(res.pairs.length, 5);
  const pair1 = res.pairs.find(p => p.pair === 1);
  assert.equal(pair1.sides[0].price, "$1.00");
  assert.equal(pair1.sides[1].waitingOn, "a run of 7 days");
});

test("pair 5 says it is waiting on an Iris, not on a level", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  const pair5 = res.pairs.find(p => p.pair === 5);
  for (const side of pair5.sides) assert.equal(side.waitingOn, "an Iris, by either route");
});

test("it takes no payment and refuses an unknown token by name", async () => {
  const res = await ladder.handler({ tokenId: 999 }, ctx);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "unknown-token");
});

// --- the rest of the ladder, and the rules the four tests above do not reach --

// A tool that says "waiting on a run of 7 days" to a token that already has one
// is worse than saying nothing: it reads as a refusal the agent cannot act on.
test("a side whose gates are already met is waiting on nothing", async () => {
  const run = ladderFor({ level: 365, streak: 365 });
  const res = await run.handler({ tokenId: 1 }, ctx);
  for (const pair of res.pairs) {
    for (const side of pair.sides) {
      // Pair 5 still needs an Iris; days alone never buy one.
      if (side.id >= 9) continue;
      assert.equal(side.waitingOn, undefined, `${side.name} still claims a gate`);
    }
  }
});

test("holding an Iris opens pair 5, and a bought side still names its own level", async () => {
  const withIris = ladderFor({ marks: 1 << 6, level: 100, streak: 100 });
  const res = await withIris.handler({ tokenId: 1 }, ctx);
  const pair3 = res.pairs.find(p => p.pair === 3);
  assert.equal(pair3.held, "iris");
  assert.equal(pair3.closed, "iris");   // the same name by the other route
  assert.equal(pair3.closedBy, "iris");
  for (const side of res.pairs.find(p => p.pair === 5).sides) {
    assert.equal(side.waitingOn, undefined);
    assert.equal(side.state, "open");
  }
  // Vessel wants a whole heart and Break a full year's run; 100 days is neither.
  const pair4 = res.pairs.find(p => p.pair === 4);
  assert.equal(pair4.sides[0].waitingOn, "a whole heart, 365 days");
  assert.equal(pair4.sides[1].waitingOn, "a run of 365 days");
});

// The level gate and the run gate are different numbers on the two sides of a
// pair, and reporting one for the other would send an agent after the wrong
// thing for 70 days.
test("a bought side waits on a level and an earned side on a run", async () => {
  const res = await ladderFor({ level: 40, streak: 0 }).handler({ tokenId: 1 }, ctx);
  const pair3 = res.pairs.find(p => p.pair === 3);
  assert.equal(pair3.sides[0].waitingOn, "a level of 100 days");
  assert.equal(pair3.sides[1].waitingOn, "a run of 100 days");
  // Static's level gate is 30 and this token has 40, so only the run is left.
  const pair2 = res.pairs.find(p => p.pair === 2);
  assert.equal(pair2.sides[0].waitingOn, undefined);
  assert.equal(pair2.sides[1].waitingOn, "a run of 30 days");
});

test("a closed side is closed, not open, and is not waiting on anything", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  const [staticSide, beat] = res.pairs.find(p => p.pair === 2).sides;
  assert.equal(staticSide.state, "closed");
  // Static's level gate is 30 and this token has 40, so the gate is MET and only
  // the exclusion stands. A tool reporting the gate here would say nothing was
  // in the way of a Mark that can never be taken.
  assert.equal(staticSide.waitingOn, undefined);
  assert.equal(beat.state, "held");
});

// The two Marks with a choice cost $25.00 and $250.00, and the shape or the ink
// IS what is bought. An agent choosing has to be able to see the options.
test("the Marks with a choice name their variants", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  const iris = res.pairs.find(p => p.pair === 3).sides[0];
  assert.deepEqual(iris.variants, ["target", "squircle", "leaf"]);
  const tint = res.pairs.find(p => p.pair === 5).sides.find(s => s.id === 9);
  assert.deepEqual(tint.variants, ["violet", "gold"]);
  // Every other Mark has exactly one look, and says so by saying nothing.
  assert.equal(res.pairs.find(p => p.pair === 1).sides[0].variants, undefined);
});

// A read that could charge, write, or demand ownership would defeat the purpose:
// the answer has to be free to ask before the decision is made.
test("the tool is declared read-only and needs no payment or chain reader", () => {
  const tool = makeLadderTool({ q: {}, catalogue: LADDER });
  assert.equal(tool.name, "ladder");
  assert.equal(tool.config.annotations.readOnlyHint, true);
  assert.equal(tool.config.annotations.openWorldHint, false);
});

// REVERSED BY C2.7, deliberately. This asserted that an earned side carries NO
// price key, which is what the catalogue's `price: undefined` produced and what
// JSON then dropped. That is indistinguishable, to a client tabulating sides,
// from a price the server declined to quote -- so the four Marks that cost
// nothing were the four with an empty cell. They now say "free". The half that
// still matters is unchanged and is the reason this test survives rather than
// being deleted: a BOUGHT side must never lose its money string.
test("an earned side is priced `free` and a bought side always carries money", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  for (const pair of res.pairs) {
    for (const side of pair.sides) {
      if (side.route === "earned") assert.equal(side.price, "free", `${side.name} is earned and does not say so`);
      else assert.match(side.price, /^\$\d/, `${side.name} is bought and unpriced`);
    }
  }
});

// --- what the tool has to see that the mirror's mask does not ----------------

/// The same fixture, with Marks RESERVED rather than written. tokens.marks is
/// set by markOrderWritten, which only the Clock calls after a successful
/// on-chain applyMark, so this is the state a token is actually in for most of
/// the day after a purchase.
function ladderWithReservations({ reserved = [], marks = 0, level = 1, streak = 1, resting = 0 } = {}) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  db.exec(`UPDATE tokens SET marks = ${marks}, level = ${level}, streak = ${streak}, resting = ${resting} WHERE tokenId = 1`);
  for (const id of reserved) q.reserveMark(1, id, 0);
  return makeLadderTool({ q, catalogue: LADDER });
}

// A ladder that showed Aura open to a token that bought Tint an hour ago would
// invite the purchase `upgrade` now refuses -- and, before that refusal existed,
// it took $275.00 for a pair that can only ever wear one side.
test("a Mark bought but not yet written already closes its partner", async () => {
  const tool = ladderWithReservations({ marks: 1 << 6, reserved: [9], level: 200, streak: 200 });
  const res = await tool.handler({ tokenId: 1 }, ctx);
  const pair5 = res.pairs.find(p => p.pair === 5);
  assert.equal(pair5.held, "tint");
  assert.equal(pair5.closed, "aura");
  assert.equal(pair5.closedBy, "tint");
  assert.equal(pair5.sides.find(s => s.id === 10).state, "closed");
});

// rest() is irreversible and applyMark reverts Resting(id), so `upgrade`
// refuses all ten. Quoting $1,250.00 beside a side that cannot be bought at any
// price is the opposite of what this tool is for.
test("a sealed token is shown no open side at all, and told why", async () => {
  const tool = ladderWithReservations({ level: 365, streak: 365, resting: 1 });
  const res = await tool.handler({ tokenId: 1 }, ctx);
  assert.equal(res.resting, true);
  for (const pair of res.pairs) {
    for (const side of pair.sides) {
      assert.equal(side.state, "closed", `${side.name} is still offered to a sealed token`);
      assert.equal(side.waitingOn, undefined, `${side.name} quotes a gate it can never pass`);
    }
  }
});

// THE CONTROL. Without it the test above passes for a tool that closes
// everything for everybody.
test("an unsealed token says so and keeps its open sides", async () => {
  const res = await ladderWithReservations({ level: 365, streak: 365 }).handler({ tokenId: 1 }, ctx);
  assert.equal(res.resting, false);
  assert.equal(res.pairs.flatMap(p => p.sides).filter(s => s.state === "open").length, 10);
});

// Nothing in the shipped ladder produces a pair with one side, and
// assertLadderSane does not check that nothing ever will. A free, read-only tool
// answering a question about a stub catalogue should not be the thing that
// crashes.
test("a pair with only one side reports what is held and closes nothing", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  db.exec("UPDATE tokens SET marks = 2 WHERE tokenId = 1");            // holds mark 1
  const lone = { 1: { ...LADDER[1], excludes: 0 } };
  const res = await makeLadderTool({ q, catalogue: lone }).handler({ tokenId: 1 }, ctx);
  assert.equal(res.pairs.length, 1);
  assert.equal(res.pairs[0].held, "hush");
  assert.equal(res.pairs[0].closed, undefined);
});

// 5.M7. A Mark the chain refused OUTRIGHT still occupies its side of the pair,
// and that is deliberate -- releasing it would let a second sale race a human's
// correction. What was missing was any way to SEE it: `ladder` reported the
// refused Mark as `held` and its partner as `closed` forever, `upgrade` refused
// the partner `mark-excluded` (which the protocol document calls "the permanent
// one"), and the only record of the refusal was an operator alert no agent can
// read. The agent is told it owns something that does not exist on chain.
test("a Mark the chain refused reads as refused, not as held", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  db.exec("UPDATE tokens SET level = 40, streak = 40 WHERE tokenId = 1");
  q.reserveMark(1, 3, 0);            // Static, the bought side of pair 2
  q.failMarkOrder(1, 3);             // and the chain refused it

  const tool = makeLadderTool({ q, catalogue: LADDER });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  const pair = r.pairs.find((p) => p.sides.some((s) => s.id === 3));

  const side = pair.sides.find((s) => s.id === 3);
  assert.equal(side.state, "refused", "an agent must not be told it holds this");
  assert.equal(pair.refused, "static");
  assert.equal(pair.held, undefined, "and it is not ownership");
  // The partner is still blocked, because the row still holds the slot -- the
  // finding is about what the agent is TOLD, not about releasing the pair.
  assert.equal(pair.closed, "beat");
  assert.equal(pair.closedBy, "static");
});

// The control: an ordinary written Mark still reads as held, or the state above
// says nothing.
test("CONTROL: a Mark that landed still reads as held", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  db.exec("UPDATE tokens SET level = 40, streak = 40 WHERE tokenId = 1");
  q.reserveMark(1, 3, 0);
  q.markOrderWritten(1, 3);

  const tool = makeLadderTool({ q, catalogue: LADDER });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  const pair = r.pairs.find((p) => p.sides.some((s) => s.id === 3));
  assert.equal(pair.sides.find((s) => s.id === 3).state, "held");
  assert.equal(pair.held, "static");
  assert.equal(pair.refused, undefined);
});

// ---------------------------------------------------------------------------
// C2.7. THE FORFEIT, BEFORE IT IS TAKEN.
//
// Everything above tests a pair that is already DECIDED: `closed` and
// `closedBy` are written only once a side is held or refused. That is the
// forfeit read backwards. An agent choosing between two open sides -- the only
// moment the choice still exists -- was told what each side costs and what it
// waits on, and never what taking it would destroy. The pairing was implied by
// the array grouping and the reader's memory of llms.txt.
// ---------------------------------------------------------------------------

test("an OPEN side names what taking it would close, on both sides of an undecided pair", async () => {
  const tool = ladderFor({ level: 40, streak: 40 });
  const r = await tool.handler({ tokenId: 1 }, ctx);
  const pair1 = r.pairs.find((p) => p.pair === 1);

  // Nothing is held, so the pair is genuinely open on both sides: this is the
  // state in which the forfeit is still avoidable and therefore worth stating.
  assert.equal(pair1.held, undefined);
  assert.equal(pair1.closed, undefined);

  const hush = pair1.sides.find((s) => s.id === 1);
  const ache = pair1.sides.find((s) => s.id === 2);
  assert.equal(hush.state, "open");
  assert.equal(ache.state, "open");
  assert.equal(hush.closes, "ache", "buying Hush forecloses Ache");
  assert.equal(ache.closes, "hush", "earning Ache forecloses Hush");
});

test("a side that is not open carries no `closes`, because the pair is already decided", async () => {
  // Token 1 wears Beat, so pair 2 is settled: Static reads `closed` and Beat
  // reads `held`. Quoting a forfeit on either would describe a choice that no
  // longer exists.
  const r = await ladder.handler({ tokenId: 1 }, ctx);
  const pair2 = r.pairs.find((p) => p.pair === 2);
  for (const side of pair2.sides) {
    assert.notEqual(side.state, "open");
    assert.equal(side.closes, undefined);
  }
});

test("an earned side prices itself `free` rather than dropping the key", async () => {
  // The catalogue carries `price: undefined` for the four earned Marks, which
  // JSON drops entirely -- so a client tabulating sides printed an empty cell
  // against the free ones and could not tell "costs nothing" from "we did not
  // say". Route already carries the fact; the price column has to agree.
  const tool = ladderFor({ level: 40, streak: 40 });
  const r = await tool.handler({ tokenId: 1 }, ctx);
  const sides = r.pairs.flatMap((p) => p.sides);

  for (const side of sides.filter((s) => s.route === "earned")) {
    assert.equal(side.price, "free", `${side.name} is earned and must say so in the price`);
  }
  // CONTROL: the bought sides still quote money, so the change did not flatten
  // the one field the ladder is read for.
  assert.equal(sides.find((s) => s.id === 7).price, "$1250.00");
});

test("`ladder`'s forfeit and `upgrade`'s refusal name the pair partner with the SAME string", async () => {
  // THE ANTI-DRIFT ASSERTION, and the reason both call sites resolve the name
  // through one helper. These two strings are the same fact told at two
  // moments: `closes` before the choice, `mark-excluded` after it. If they ever
  // disagree, the tool that promised the forfeit named something the refusal
  // does not, and the agent cannot match them up.
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  db.exec("UPDATE tokens SET level = 365, streak = 365, bestRun = 365 WHERE tokenId = 1");

  // What the ladder PROMISES taking Ache would close, while both sides are open.
  const before = await makeLadderTool({ q, catalogue: LADDER }).handler({ tokenId: 1 }, ctx);
  const promised = before.pairs.find((p) => p.pair === 1).sides.find((s) => s.id === 2).closes;
  assert.equal(promised, "hush");

  // Now take Ache, and ask upgrade for the side it just foreclosed.
  const upgrade = makeUpgradeTool({ q, chain: openChain(), catalogue: LADDER, paid: settleNow });
  const taken = await upgrade.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" });
  assert.equal(taken.accepted, true);

  const refused = await upgrade.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(refused.reason, "mark-excluded");
  // The promise and the refusal are the same word, derived from one place.
  assert.equal(refused.detail, "ache");
  assert.equal(before.pairs.find((p) => p.pair === 1).sides.find((s) => s.id === 1).closes, refused.detail);
});

test("an accepted upgrade says what it just closed, on the earned route and the bought one", async () => {
  // The moment the forfeit actually happens, and the response never mentioned
  // it. An agent that took a side learned what it had given up only by asking
  // `ladder` again afterwards.
  const earnedDb = openDb(":memory:");
  const earnedQ = queries(earnedDb);
  earnedQ.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  earnedDb.exec("UPDATE tokens SET level = 365, streak = 365, bestRun = 365 WHERE tokenId = 1");
  const earnedTool = makeUpgradeTool({ q: earnedQ, chain: openChain(), catalogue: LADDER, paid: settleNow });
  const earned = await earnedTool.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" });
  assert.equal(earned.accepted, true);
  assert.equal(earned.closed, "hush", "taking Ache closed Hush");

  const boughtDb = openDb(":memory:");
  const boughtQ = queries(boughtDb);
  boughtQ.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  boughtDb.exec("UPDATE tokens SET level = 365, streak = 365, bestRun = 365 WHERE tokenId = 1");
  const boughtTool = makeUpgradeTool({ q: boughtQ, chain: openChain(), catalogue: LADDER, paid: settleNow });
  const bought = await boughtTool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(bought.accepted, true);
  assert.equal(bought.closed, "ache", "buying Hush closed Ache");
});

test("the tool that takes earned Marks does not describe itself as a shop", async () => {
  // Four of the ten Marks are earned and take no payment wrapper at all, and
  // the tool an agent reads before calling was titled "Buy a Mark". An agent
  // looking for the free route had no reason to open this one.
  const tool = makeUpgradeTool({ q: queries(openDb(":memory:")), chain: openChain(), catalogue: LADDER, paid: settleNow });
  assert.equal(tool.config.title, "Take a Mark");
  assert.match(tool.config.description, /bought or earned/);
  assert.match(tool.config.description, /closes the other permanently/);
});

// ---------------------------------------------------------------------------
// THE FIVE THAT ARE NOT FOR SALE.
//
// Marks 11-15 are given by the token contract at 365, in the order tokens
// finish, and no amount of money reaches one. They are in no pair, so they have
// no side, no gate to walk towards and nothing they forfeit -- which is
// everything the `pairs` block above reports. Left out of this tool entirely
// they were invisible to the one surface an agent reads before deciding what a
// year is worth; listed as a sixth pair they would read as five Marks that
// close each other, which is a puzzle rather than an answer. So they are their
// own group, and the group carries no price and no call to action.
// ---------------------------------------------------------------------------

test("the finisher Marks are shown as their own group, by place, with a cap and a count", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);

  // Best place first, which is the order a reader meets them in: 1st, then
  // 2nd-4th, and so on down to everyone else.
  assert.deepEqual(res.finishers.map((f) => f.name), ["apex", "atrium", "valve", "chamber", "aorta"]);
  assert.deepEqual(res.finishers.map((f) => f.id), [15, 14, 13, 12, 11]);
  assert.deepEqual(res.finishers.map((f) => f.places), ["1st", "2nd-4th", "5th-14th", "15th-64th", "65th on"]);
  // The size of the place band, and `null` for the band that has no end.
  // Infinity is not JSON, so saying null on purpose is the only way the
  // meaning is chosen rather than produced by a serialiser.
  assert.deepEqual(res.finishers.map((f) => f.cap), [1, 3, 10, 50, null]);
});

// A price, a `waitingOn` or a `closes` on one of these rows would describe a
// door that is not there -- the ONE thing this group must never do is read as
// something an agent could go and get.
test("a finisher row carries no price and nothing to act on", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  for (const row of res.finishers) {
    assert.deepEqual(
      Object.keys(row).sort(),
      ["cap", "id", "name", "places", "taken"],
      `${row.name} carries a field this group must not have`,
    );
  }
  // And the group is named for what it is, so a client can tell the two blocks
  // apart without matching on ids.
  assert.equal("pairs" in res && "finishers" in res, true);
});

// THE PAIRS ARE UNTOUCHED. The whole risk of adding a second block is that the
// first one quietly grows a sixth member.
test("the pairs block is still exactly the five pairs and the ten requestable Marks", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  assert.equal(res.pairs.length, 5);
  const ids = res.pairs.flatMap((p) => p.sides).map((s) => s.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

// `taken` is read from the mirror, never from the catalogue: a static count is
// never incremented by anything, and a Mark whose band is full must say so.
test("`taken` counts the tokens that actually wear each finisher Mark", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  for (const tokenId of [1, 2, 3]) {
    q.insertToken({ tokenId, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  }
  q.setFinished(1, 1, 15);      // first home wears Apex
  q.setFinished(2, 5, 13);      // fifth and sixth both wear Valve
  q.setFinished(3, 6, 13);

  const res = await makeLadderTool({ q, catalogue: LADDER }).handler({ tokenId: 1 }, ctx);
  const taken = Object.fromEntries(res.finishers.map((f) => [f.name, f.taken]));
  assert.deepEqual(taken, { apex: 1, atrium: 0, valve: 2, chamber: 0, aorta: 0 });
});

// THE CONTROL. Without it the test above passes for a tool that counts every
// token once, or that reports the same number for every row.
test("CONTROL: with nothing finished every count is zero", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  for (const row of res.finishers) assert.equal(row.taken, 0, `${row.name} counted a finish that has not happened`);
});

// The schema stops 11-15 (pay.test.mjs pins that), so this is the SECOND wall:
// a caller that reaches the handler some other way is refused by name rather
// than sent into a payment demand for a Mark nothing can sell.
test("`upgrade` refuses a finisher Mark by name, past the schema, without asking for payment", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  db.exec("UPDATE tokens SET level = 365, streak = 365, bestRun = 365 WHERE tokenId = 1");

  const tool = makeUpgradeTool({
    q, chain: openChain(), catalogue: LADDER,
    paid: () => { throw new Error("a Mark that is given must never reach the payment wrapper"); },
  });

  for (const upgradeId of [11, 12, 13, 14, 15]) {
    const r = await tool.handler({ tokenId: 1, upgradeId }, { keyId: "k1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "mark-not-requestable", `id ${upgradeId} was not refused as unrequestable`);
    assert.equal(r.upgradeId, upgradeId);
  }
  // CONTROL: the same tool still takes an ordinary earned Mark, so the refusal
  // above is about the route and not about a tool that refuses everything.
  const ok = await tool.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" });
  assert.equal(ok.accepted, true);
});
