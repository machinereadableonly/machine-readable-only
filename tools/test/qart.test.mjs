import test from "node:test";
import assert from "node:assert/strict";
import { solve, bestOfAllMasks, packModules, unpackModules, payloadFor,
         freeByteBudget, FREE_BITS } from "../qart.mjs";
import { heartTarget } from "../heart-target.mjs";
import { renderModules, scanResult } from "./helpers/decode.mjs";

const PAYLOAD = payloadFor("example.com", 1);
const DESTINATION = PAYLOAD.slice(0, -1);   // everything before the "#"

const scan = (modules, size, px = 700) => scanResult(renderModules(modules, size, px), px);

test("the reshuffled code still sends a scanner to its own destination", () => {
  const r = solve(PAYLOAD, 0);
  const got = scan(r.modules, r.size);
  assert.ok(got.ok, `${got.why}: ${JSON.stringify(got.text)}`);
  assert.equal(got.destination, DESTINATION);
});

test("a useful share of modules land on the heart", () => {
  // 60% is the floor, not the target. The URL-safe alphabet gives 5 free bits
  // per byte instead of 8, so the solver controls 400 of 1369 modules and the
  // rest fall as chance leaves them -- about 50% right by luck. Measured 64.9%
  // with the interior-first order; anything under 60% means something regressed.
  const r = solve(PAYLOAD, 0);
  assert.ok(r.match > 0.60, `match too low: ${(r.match * 100).toFixed(1)}%`);
  assert.equal(r.size, 37);
});

test("every free bit becomes a usable pivot", () => {
  const r = solve(PAYLOAD, 0);
  assert.equal(r.controlled, freeByteBudget(PAYLOAD.length) * FREE_BITS.length);
});

test("searching all eight masks never does worse than a fixed one", () => {
  const fixed = solve(PAYLOAD, 0);
  const best = bestOfAllMasks(PAYLOAD);
  assert.ok(best.match >= fixed.match, `best ${best.match} < fixed ${fixed.match}`);
  const got = scan(best.modules, best.size);
  assert.ok(got.ok, `${got.why}: ${JSON.stringify(got.text)}`);
  assert.equal(got.destination, DESTINATION);
});

test("different tokens produce different codes but comparable quality", () => {
  const a = solve(payloadFor("example.com", 1), 0);
  const b = solve(payloadFor("example.com", 2), 0);
  assert.notDeepEqual(Array.from(a.modules), Array.from(b.modules), "two tokens share a code");
  assert.ok(Math.abs(a.match - b.match) < 0.05, "quality varies too much between tokens");
});

test("packing modules to bytes round-trips", () => {
  const r = solve(PAYLOAD, 0);
  const packed = packModules(r.modules, r.size);
  assert.equal(packed.length, Math.ceil(37 * 37 / 8));
  assert.deepEqual(Array.from(unpackModules(packed, r.size)), Array.from(r.modules));
});

test("a payload too long for the version is rejected, not silently truncated", () => {
  assert.throws(() => solve("https://example.com/" + "x".repeat(120) + "#", 0), /too long/);
});
