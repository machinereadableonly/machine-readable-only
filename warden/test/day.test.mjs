// The length of a day, and the one place that owns it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  secondsFrom, DAY_MS, CLOCK_OFFSET_MS, DEFAULT_DAY_SECONDS, utcDay, dayStartIso, dayMismatch,
} from "../src/day.mjs";
import { utcDay as fromCheckin } from "../src/mcp/tools/checkin.mjs";
import { onChainBy } from "../src/mcp/nextSteps.mjs";

const DAY_MODULE = fileURLToPath(new URL("../src/day.mjs", import.meta.url));

test("the default day is exactly a real day, and the promise is 00:05", () => {
  // The suite runs with no MRO_DAY_SECONDS, so these are production's values.
  assert.equal(DEFAULT_DAY_SECONDS, 86_400);
  assert.equal(DAY_MS, 86_400_000);
  assert.equal(CLOCK_OFFSET_MS, 300_000);
});

test("day numbers and their instants are the contract's unit", () => {
  // 2026-09-11 was day 20707 on the Sepolia contract's own today().
  assert.equal(utcDay(Date.UTC(2026, 8, 11, 13, 0)), 20707);
  assert.equal(dayStartIso(20708), "2026-09-12T00:00:00.000Z");
  assert.equal(onChainBy(20707), "2026-09-12T00:05:00.000Z");
});

test("checkin's utcDay IS day.mjs's, not a second copy of the formula", () => {
  assert.equal(fromCheckin, utcDay);
});

test("a setting is a positive whole number of seconds, or it throws", () => {
  assert.equal(secondsFrom({}, "X", 86_400), 86_400);
  assert.equal(secondsFrom({ X: "" }, "X", 86_400), 86_400);
  assert.equal(secondsFrom({ X: "300" }, "X", 86_400), 300);
  for (const bad of ["0", "-5", "1.5", "five", "300s"]) {
    assert.throws(() => secondsFrom({ X: bad }, "X", 86_400), /positive whole number/, bad);
  }
});

test("a day length the chain does not share is caught; a boundary straddle is not", () => {
  assert.equal(dayMismatch(20707, 20707), 0);
  assert.equal(dayMismatch(20708, 20707), 0, "a read can straddle midnight");
  // A five-minute contract read by a real-day Warden: millions of days apart.
  assert.ok(dayMismatch(5_963_000, 20707) > 1);
});

test("MRO_DAY_SECONDS really does shorten the day, in a process of its own", () => {
  // Module state is read once at import, so the override is proven where it
  // is actually set: a fresh process with the variable in its environment.
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `import { DAY_MS, CLOCK_OFFSET_MS } from ${JSON.stringify(DAY_MODULE)}; console.log(DAY_MS, CLOCK_OFFSET_MS);`],
    { env: { ...process.env, MRO_DAY_SECONDS: "300", MRO_CLOCK_OFFSET_SECONDS: "30" }, encoding: "utf8" }
  ).trim();
  assert.equal(out, "300000 30000");
});
