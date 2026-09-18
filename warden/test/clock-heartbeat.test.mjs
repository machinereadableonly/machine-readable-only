// The Clock's liveness stamp: when it is sent, and when it must NOT be.
//
// The contract function is proven by contracts/test/Heartbeat.t.sol. What is
// proven here is the decision to send one, which is the half that decides
// whether the function is ever called at all -- a heartbeat nothing invokes is
// decoration, and the hazard it exists for would still be live.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heartbeatDue, HEARTBEAT_AFTER_DAYS } from "../src/clock/heartbeat.mjs";

test("a quiet stretch past the threshold is due", () => {
  const d = heartbeatDue({ today: 1000, lastWardenDay: 1000 - HEARTBEAT_AFTER_DAYS, wroteThisRun: false });
  assert.equal(d.due, true);
  assert.equal(d.why, "quiet");
  assert.equal(d.gap, HEARTBEAT_AFTER_DAYS);
});

test("a run that wrote anything is already stamped, and pays for no second transaction", () => {
  const d = heartbeatDue({ today: 1000, lastWardenDay: 500, wroteThisRun: true });
  assert.equal(d.due, false);
  assert.equal(d.why, "already-stamped");
});

test("a recent stamp is left alone", () => {
  const d = heartbeatDue({ today: 1000, lastWardenDay: 999, wroteThisRun: false });
  assert.equal(d.due, false);
  assert.equal(d.why, "recent-enough");
});

test("a closed piece is never heartbeaten", () => {
  // Otherwise the log would read as though the piece were alive, and the gas
  // would buy a no-op: isSunset is one-way.
  const d = heartbeatDue({ today: 2000, lastWardenDay: 500, wroteThisRun: false, sunset: true });
  assert.equal(d.due, false);
  assert.equal(d.why, "sunset");
});

test("a lagging RPC that reports a stamp in the future does not trigger a write", () => {
  // A public RPC is not read-after-write consistent -- measured on this project
  // before -- so a read can be served by a node behind the one that wrote.
  const d = heartbeatDue({ today: 1000, lastWardenDay: 1005, wroteThisRun: false });
  assert.equal(d.due, false);
  assert.equal(d.why, "recent-enough");
  assert.equal(d.gap, -5);
});

test("the threshold leaves the Clock months of room to be broken in", () => {
  // The point of the margin: the contract closes at 365 days of silence, so a
  // threshold anywhere near it would make one bad month terminal.
  assert.ok(HEARTBEAT_AFTER_DAYS <= 60, "a wide margin is the whole safety property");
  assert.ok(HEARTBEAT_AFTER_DAYS >= 7, "and it must not write every idle day");
});

test("the day before the threshold is not due, the day of it is", () => {
  // The boundary, provoked from both sides: a test that only ever checks the
  // middle of a range cannot see an off-by-one.
  const base = { today: 1000, wroteThisRun: false };
  assert.equal(heartbeatDue({ ...base, lastWardenDay: 1000 - (HEARTBEAT_AFTER_DAYS - 1) }).due, false);
  assert.equal(heartbeatDue({ ...base, lastWardenDay: 1000 - HEARTBEAT_AFTER_DAYS }).due, true);
});
