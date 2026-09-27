// What the chain should hold after a list of credited days, and which Mark a
// finishing place earns. Both are mirrors of MachineReadableOnly.sol, so both
// are checked against the contract's own rules rather than against intent.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FINISH_LEVEL, expected, places, finisherMark } from "../tools/year/tally.mjs";
import { FINISHER_IDS, FINISH_LEVEL as WARDEN_FINISH_LEVEL } from "../src/mcp/ladder.mjs";
import { AGENTS, todayFor } from "../tools/year/scenario.mjs";

// The contract's own bookkeeping, written out day by day: _credit advances the
// level, continues the streak only on the next day, raises bestRun on the way
// up and never lowers it, and _effectiveRun reports max(streak, bestRun).
function asTheContractWould(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (sorted.length === 0) return { level: 0, effectiveRun: 0, lastDay: null };
  let level = 1, streak = 1, bestRun = 1, lastDay = sorted[0];
  for (const day of sorted.slice(1)) {
    if (level >= FINISH_LEVEL) break;
    level += 1;
    streak = day === lastDay + 1 ? streak + 1 : 1;
    if (streak > bestRun) bestRun = streak;
    lastDay = day;
  }
  return { level, effectiveRun: Math.max(streak, bestRun), lastDay };
}

// The literal stays a literal: a checker that imported its yardstick from the
// service could not catch the service moving it. This is what keeps the two
// copies honest instead.
test("the year ends at 365, and the checker's copy is the Warden's number", () => {
  assert.equal(FINISH_LEVEL, 365);
  assert.equal(FINISH_LEVEL, WARDEN_FINISH_LEVEL);
});

test("a gapped history: level counts days, streak is live, bestRun is the longest", () => {
  assert.deepEqual(expected([5, 6, 7, 9, 10]), { level: 5, streak: 2, bestRun: 3, lastDay: 10 });
});

test("the order the days arrive in does not matter, and a repeat is one day", () => {
  assert.deepEqual(expected([10, 6, 9, 5, 7]), { level: 5, streak: 2, bestRun: 3, lastDay: 10 });
  assert.deepEqual(expected([5, 5, 6, 6, 7]), { level: 3, streak: 3, bestRun: 3, lastDay: 7 });
});

test("no days at all is level zero with no last day", () => {
  assert.deepEqual(expected([]), { level: 0, streak: 0, bestRun: 0, lastDay: null });
});

test("one day is a run of one", () => {
  assert.deepEqual(expected([42]), { level: 1, streak: 1, bestRun: 1, lastDay: 42 });
});

test("the level caps at 365 and days after the 365th are ignored", () => {
  const unbroken = Array.from({ length: 400 }, (_, i) => i + 1);
  assert.deepEqual(expected(unbroken), { level: 365, streak: 365, bestRun: 365, lastDay: 365 });
  // A day long after the year is whole cannot move the last day either.
  assert.deepEqual(expected([...unbroken.slice(0, 365), 900]),
    { level: 365, streak: 365, bestRun: 365, lastDay: 365 });
});

test("a broken run is kept as bestRun while the live streak restarts", () => {
  const days = [...Array.from({ length: 40 }, (_, i) => i + 1), 100, 101];
  assert.deepEqual(expected(days), { level: 42, streak: 2, bestRun: 40, lastDay: 101 });
});

// THE CONTRACT IS THE AUTHORITY on the run a Mark gate reads. expected() works
// from a list of days and the contract works one credit at a time, so the two
// are run against each other over the histories this year actually produces.
test("bestRun is the contract's _effectiveRun, over every agent's real history", () => {
  const histories = [
    [5, 6, 7, 9, 10],
    [1],
    [1, 3, 5, 7],
    [1, 2, 3, 10, 11, 12, 13],
  ];
  for (const a of AGENTS) {
    // The days the scenario itself credits, asked of todayFor rather than rebuilt
    // here: a hand-built list started at mintDay + 2, which loses day one and caps
    // bestRun at 364 -- the exact off-by-one that made Break unreachable.
    const days = [a.mintDay];
    for (let day = a.mintDay + 1; days.length < FINISH_LEVEL + 5 && day < 600; day++) {
      if (todayFor(a, day).checkin) days.push(day);
    }
    histories.push(days);
  }
  for (const days of histories) {
    const mine = expected(days);
    const theirs = asTheContractWould(days);
    assert.equal(mine.level, theirs.level, `level for ${days.length} days`);
    assert.equal(mine.bestRun, theirs.effectiveRun, `bestRun for ${days.length} days`);
    assert.equal(mine.lastDay, theirs.lastDay, `lastDay for ${days.length} days`);
  }
});

test("finisherMark bands are the contract's: 1, 2-4, 5-14, 15-64, 65 on", () => {
  assert.equal(finisherMark(1), 15);
  assert.equal(finisherMark(2), 14);
  assert.equal(finisherMark(4), 14);
  assert.equal(finisherMark(5), 13);
  assert.equal(finisherMark(14), 13);
  assert.equal(finisherMark(15), 12);
  assert.equal(finisherMark(64), 12);
  assert.equal(finisherMark(65), 11);
  assert.equal(finisherMark(10_000), 11);
});

test("the bands issue exactly the five finisher ids the ladder knows", () => {
  const issued = new Set();
  for (let place = 1; place <= 200; place++) issued.add(finisherMark(place));
  assert.deepEqual([...issued].sort((a, b) => a - b), [...FINISHER_IDS].sort((a, b) => a - b));
});

test("places orders by day, then by lowest token id within a day", () => {
  const order = places([{ tokenId: 3, day: 9 }, { tokenId: 1, day: 9 }, { tokenId: 2, day: 8 }]);
  assert.deepEqual(order.get(2), { place: 1, markId: 15 });
  assert.deepEqual(order.get(1), { place: 2, markId: 14 });
  assert.deepEqual(order.get(3), { place: 3, markId: 14 });
});

test("places does not reorder the list it was handed", () => {
  const finishes = [{ tokenId: 3, day: 9 }, { tokenId: 2, day: 8 }];
  places(finishes);
  assert.deepEqual(finishes.map((f) => f.tokenId), [3, 2]);
});

test("places over an empty list is an empty map", () => {
  assert.equal(places([]).size, 0);
});
