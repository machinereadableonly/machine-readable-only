import test from "node:test";
import assert from "node:assert/strict";
import { Resvg } from "@resvg/resvg-js";
import jsQR from "jsqr";
import { solve, bestOfAllMasks, packModules, unpackModules, payloadFor, freeByteBudget } from "../qart.mjs";
import { heartTarget } from "../heart-target.mjs";

const PAYLOAD = payloadFor("example.com", 1);

function decode(modules, size, px = 700) {
  const q = 4, dim = size + 2 * q;
  let d = "";
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++)
    if (modules[j * size + i]) d += `M${q + i} ${q + j}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="#fff"/><path fill="#111" d="${d}"/></svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: px } }).render();
  const got = jsQR(new Uint8ClampedArray(img.pixels), img.width, img.height);
  return got ? got.data : null;
}

test("the reshuffled code still decodes to its own payload", () => {
  const r = solve(PAYLOAD, 0);
  assert.equal(decode(r.modules, r.size), PAYLOAD);
});

test("a useful share of modules land on the heart", () => {
  const r = solve(PAYLOAD, 0);
  assert.ok(r.match > 0.65, `match too low: ${(r.match * 100).toFixed(1)}%`);
  assert.equal(r.size, 37);
});

test("every free bit becomes a usable pivot", () => {
  const r = solve(PAYLOAD, 0);
  assert.equal(r.controlled, freeByteBudget(PAYLOAD.length) * 8);
});

test("searching all eight masks never does worse than a fixed one", () => {
  const fixed = solve(PAYLOAD, 0);
  const best = bestOfAllMasks(PAYLOAD);
  assert.ok(best.match >= fixed.match, `best ${best.match} < fixed ${fixed.match}`);
  assert.equal(decode(best.modules, best.size), PAYLOAD);
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
