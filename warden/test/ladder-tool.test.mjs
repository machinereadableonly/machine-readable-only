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
  const run = ladderFor({ level: 400, streak: 400 });
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

test("an earned side never carries a price and a bought side always does", async () => {
  const res = await ladder.handler({ tokenId: 1 }, ctx);
  for (const pair of res.pairs) {
    for (const side of pair.sides) {
      if (side.route === "earned") assert.equal(side.price, undefined, `${side.name} is earned and priced`);
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
  const tool = ladderWithReservations({ level: 400, streak: 400, resting: 1 });
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
  const res = await ladderWithReservations({ level: 400, streak: 400 }).handler({ tokenId: 1 }, ctx);
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
