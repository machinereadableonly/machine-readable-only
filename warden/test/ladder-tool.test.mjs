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
