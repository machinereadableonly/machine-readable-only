// The decisions the year's runner makes without touching the chain: which
// Marks are due, whether there is money to buy one, and whether a refusal is
// worth asking again.
import { test } from "node:test";
import assert from "node:assert/strict";

import { dueMarks, buyOrDemand, FINAL_REASONS, MAX_ATTEMPTS, shouldRetry } from "../tools/year/decide.mjs";
import { AGENTS } from "../tools/year/scenario.mjs";

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
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set(), held(5))), [1, 3, 5, 9]);
  // A neighbouring bit is not the one it waits on.
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set(), held(4, 6))), [1, 3, 5]);
});

test("a requested id is never due again", () => {
  const a5 = byName("A5");
  assert.deepEqual(ids(dueMarks(a5, view(100, 100), new Set([1, 3]), held(5))), [5, 9]);
  assert.deepEqual(ids(dueMarks(a5, view(365, 365), new Set([1, 3, 5, 7, 9]), held(5))), []);
});

test("an agent with no Marks is never due one", () => {
  assert.deepEqual(dueMarks(byName("A9"), view(365, 365), new Set(), held(5)), []);
});

test("a due entry is the table's own record, variant and all", () => {
  const due = dueMarks(byName("A5"), view(100, 100), new Set([1, 3]), 0n);
  assert.deepEqual(due, [{ id: 5, when: { level: 100 }, variant: 2 }]);
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
