// The decisions the year's runner makes without touching the chain: which
// Marks are due, whether there is money to buy one, and whether a refusal is
// worth asking again.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dueMarks, buyOrDemand, FINAL_REASONS, MAX_ATTEMPTS, shouldRetry } from "../tools/year/decide.mjs";
import { AGENTS, todayFor } from "../tools/year/scenario.mjs";
import { FINISH_LEVEL, expected } from "../tools/year/tally.mjs";

const byName = (name) => AGENTS.find((a) => a.name === name);
const view = (level, bestRun) => ({ level, bestRun });
const held = (...ids) => ids.reduce((mask, id) => mask | (1n << BigInt(id)), 0n);
const ids = (entries) => entries.map((m) => m.id).sort((a, b) => a - b);

test("an earned Mark is due once the run reaches its rung, and not before", () => {
  const a2 = byName("A2");
  assert.deepEqual(ids(dueMarks(a2, view(10, 6), new Set(), 0n)), []);
  assert.deepEqual(ids(dueMarks(a2, view(10, 7), new Set(), 0n)), [2]);
  assert.deepEqual(ids(dueMarks(a2, view(40, 30), new Set(), 0n)), [2, 4]);
  assert.deepEqual(ids(dueMarks(a2, view(365, 365), new Set(), 0n)), [2, 4, 6, 8]);
});

// The run gate reads bestRun, never the live streak: a token that completed a
// run keeps what the run earned even after the run breaks.
test("a run gate reads bestRun, so a broken streak does not withdraw a Mark", () => {
  const a2 = byName("A2");
  assert.deepEqual(ids(dueMarks(a2, { level: 50, bestRun: 30, streak: 1 }, new Set(), 0n)), [2, 4]);
});

test("a bought Mark is due on the level, not on the run", () => {
  const a5 = byName("A5");
  assert.deepEqual(ids(dueMarks(a5, view(1, 1), new Set(), 0n)), [1]);
  assert.deepEqual(ids(dueMarks(a5, view(29, 29), new Set(), 0n)), [1]);
  assert.deepEqual(ids(dueMarks(a5, view(30, 1), new Set(), 0n)), [1, 3]);
  // A run of 365 with a level of 100 still does not open a level-365 Mark.
  assert.deepEqual(ids(dueMarks(a5, view(100, 365), new Set(), 0n)), [1, 3, 5]);
});

test("an `after` entry waits for that Mark's bit to be set in held", () => {
  const a5 = byName("A5");
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set(), 0n)), [1, 3, 5]);
  // Once 5 is held, 9 opens -- and 5 itself drops out, being held.
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set(), held(5))), [1, 3, 9]);
  // A neighbouring bit is not the one it waits on.
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set(), held(4, 6))), [1, 3, 5]);
});

test("a requested id is never due again", () => {
  const a5 = byName("A5");
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set([1, 3]), 0n)), [5]);
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set([1, 3]), held(5))), [9]);
  assert.deepEqual(ids(dueMarks(a5, view(365, 365), new Set([1, 3, 5, 7, 9]), held(5))), []);
});

// RESTART SAFETY. A run resumed after a restart begins with an empty
// `requested` set, so the chain's own marks word is the only thing that can say
// a Mark has already been taken. Ordering one the token holds is a payment the
// contract refuses.
test("a Mark the chain already carries is not due, whatever requested says", () => {
  const a2 = byName("A2");
  assert.deepEqual(ids(dueMarks(a2, view(365, 365), new Set(), held(2, 4))), [6, 8]);
  assert.deepEqual(ids(dueMarks(a2, view(365, 365), new Set(), held(2, 4, 6, 8))), []);
  // A5's second side of pair five is due on the first held bit and gone on its own.
  const a5 = byName("A5");
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set(), held(5))), [1, 3, 9]);
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set(), held(5, 9))), [1, 3]);
});

// FAIL CLOSED. The chain's own view names its run field `runFloor`, so a view
// handed straight to dueMarks would carry `bestRun: undefined` and make every
// run Mark due at once -- a payment the contract then refuses.
test("a view missing level or bestRun is refused, not read as zero", () => {
  const a2 = byName("A2");
  assert.throws(() => dueMarks(a2, { level: 10 }, new Set(), 0n), /bestRun/);
  assert.throws(() => dueMarks(a2, { bestRun: 10 }, new Set(), 0n), /level/);
  assert.throws(() => dueMarks(a2, { level: 10, runFloor: 30 }, new Set(), 0n), /bestRun/);
  assert.throws(() => dueMarks(a2, { level: NaN, bestRun: 1 }, new Set(), 0n), /level/);
  assert.throws(() => dueMarks(a2, { level: "10", bestRun: 10 }, new Set(), 0n), /level/);
  // An agent with no Marks is refused too: a bad view is a bug wherever it lands.
  assert.throws(() => dueMarks(byName("A9"), {}, new Set(), 0n), /level/);
});

test("an agent with no Marks is never due one", () => {
  assert.deepEqual(dueMarks(byName("A9"), view(365, 365), new Set(), held(5)), []);
});

test("a due entry is the table's own record, variant and all", () => {
  const due = dueMarks(byName("A5"), view(100, 100), new Set([1, 3]), 0n);
  assert.deepEqual(due, [{ id: 5, when: { level: 100 }, variant: 2 }]);
});

/**
 * THE THREE MODULES AGAINST EACH OTHER, over the whole year.
 *
 * Each module is right on its own terms and the year can still be wrong: a
 * check-in rule off by one day costs the unbroken agents a day of run, and the
 * run-365 Mark they are scripted to buy then never comes due. Nothing in a unit
 * test of any one file can see that. This walks the real day list `todayFor`
 * produces, tallies it with `expected`, and asks `dueMarks` whether every Mark
 * the agent orders eventually opens.
 *
 * Verified to FAIL under the earlier `mintDay + 2` rule: A1, A2, A3 and A6 all
 * lost Mark 8 (run 365), because their day list was gapped at the mint day and
 * the best run reached only 364 by the time the level reached 365.
 */
test("every Mark an agent orders comes due somewhere in its real year", () => {
  for (const a of AGENTS) {
    if (a.marks.length === 0) continue;
    const days = [a.mintDay];
    const requested = new Set();
    let held = 0n;
    // An order sets that Mark's bit, which may open one that waits on it, so
    // each day is drained until nothing more is due.
    const drain = () => {
      for (let more = true; more; ) {
        more = false;
        for (const m of dueMarks(a, expected(days), requested, held)) {
          requested.add(m.id);
          held |= 1n << BigInt(m.id);
          more = true;
        }
      }
    };
    // The horizon covers the worst case in the table: A9 is away for 60 days.
    for (let day = a.mintDay + 1; day <= 800 && days.length < FINISH_LEVEL; day++) {
      if (todayFor(a, day).checkin) days.push(day);
      drain();
    }
    drain();
    assert.equal(days.length, FINISH_LEVEL, `${a.name} never finished its year`);
    assert.deepEqual(
      [...requested].sort((x, y) => x - y),
      a.marks.map((m) => m.id).sort((x, y) => x - y),
      `${a.name} never qualified for every Mark it orders`,
    );
  }
});

// The reserve is USDC still owed to mints that have not been paid for, so a
// Mark can never spend the money a mint needs.
test("buy only when the balance clears the price with the reserve untouched", () => {
  assert.equal(buyOrDemand({ price: 5_000000n, balance: 9_000000n, reserve: 1_000000n }), "buy");
  assert.equal(buyOrDemand({ price: 5_000000n, balance: 5_500000n, reserve: 1_000000n }), "demand-only");
  // Exactly enough is enough.
  assert.equal(buyOrDemand({ price: 5_000000n, balance: 6_000000n, reserve: 1_000000n }), "buy");
  assert.equal(buyOrDemand({ price: 5_000000n, balance: 5_999999n, reserve: 1_000000n }), "demand-only");
  assert.equal(buyOrDemand({ price: 1_250_000000n, balance: 20_000000n, reserve: 0n }), "demand-only");
});

test("a retryable refusal is asked again, up to three attempts", () => {
  assert.equal(shouldRetry({ reason: "chain-unavailable" }, 1), true);
  assert.equal(shouldRetry({ reason: "chain-unavailable" }, 2), true);
  assert.equal(shouldRetry({ reason: "chain-unavailable" }, 3), false);
  assert.equal(MAX_ATTEMPTS, 3);
  // A mirror running behind the chain catches up on its own.
  assert.equal(shouldRetry({ reason: "not-yet-mirrored" }, 1), true);
});

test("a refusal a retry cannot change is never asked again", () => {
  for (const reason of FINAL_REASONS) {
    assert.equal(shouldRetry({ reason }, 1), false, reason);
  }
  assert.equal(shouldRetry({ reason: "already-credited-today" }, 1), false);
});

test("not-bound-to-caller is retried on the day of a rebind, and only then", () => {
  // A public RPC can lag a rebind by seconds, so the new key is refused until
  // the chain read catches up. Found live: A11 lost a day to this.
  assert.equal(shouldRetry({ reason: "not-bound-to-caller" }, 1, { justRebound: true }), true);
  assert.equal(shouldRetry({ reason: "not-bound-to-caller" }, 2, { justRebound: true }), true);
  assert.equal(shouldRetry({ reason: "not-bound-to-caller" }, MAX_ATTEMPTS, { justRebound: true }), false);
  assert.equal(shouldRetry({ reason: "not-bound-to-caller" }, 1), false);
  // A rebind makes no other final refusal retryable.
  assert.equal(shouldRetry({ reason: "resting" }, 1, { justRebound: true }), false);
});

test("success is not retried, and neither is a missing result", () => {
  assert.equal(shouldRetry({ ok: true }, 1), false);
  assert.equal(shouldRetry({ ok: true, reason: "chain-unavailable" }, 1), false);
  // An unrecognised failure IS retried: the retryable set is the open one.
  assert.equal(shouldRetry({ ok: false, reason: "http-500" }, 1), true);
  assert.equal(shouldRetry(undefined, 1), true);
});

// FINAL_REASONS must hold the check-in tool's own refusals. A reason the tool
// returns but this set does not know would be retried every day for the rest
// of the year, against a token that can never accept the call.
test("every refusal the check-in tool can return is classified", () => {
  const fromCheckin = [
    "chain-unavailable", "not-yet-mirrored", "unknown-token", "not-bound-to-caller",
    "year-complete", "already-credited-today", "resting", "sunset", "paused",
  ];
  const retryable = new Set(["chain-unavailable", "not-yet-mirrored"]);
  for (const reason of fromCheckin) {
    assert.equal(FINAL_REASONS.has(reason), !retryable.has(reason), reason);
  }
});
