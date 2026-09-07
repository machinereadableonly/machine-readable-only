// The JavaScript half of the echo ring, and the differential that holds it to
// the Solidity half.
//
// contracts/test/EchoRing.t.sol asserts the SAME short-ring string and the
// SAME keccak256 against FrameRenderer.echoRingBars. The render matrix has no
// echo-bearing case in it, so RenderFixture.sol cannot see this path at all --
// these two pins are the only thing that proves the dotted ring is drawn the
// same way in both languages. Regenerate both with
// `node tools/echo-ring-fixture.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";

import { ringBudget, ringsFor, canvasFor, echoRingBars, MAX_RINGS } from "../render-token.mjs";

test("a founding token keeps all ten of its own rings", () => {
  assert.deepEqual(ringBudget(10, 0), { own: 10, echoRings: 0 });
  assert.equal(ringsFor(10, 0), 10);
  assert.equal(ringsFor(10), 10, "and the one-argument form still means founding");
});

test("a child gives up one slot", () => {
  assert.deepEqual(ringBudget(10, 365), { own: 9, echoRings: 1 });
  assert.equal(ringsFor(10, 365), 10);
});

test("one echo day is enough to take the slot", () => {
  assert.deepEqual(ringBudget(10, 1), { own: 9, echoRings: 1 });
});

test("a newborn child is one ring, not zero", () => {
  assert.deepEqual(ringBudget(0, 365), { own: 0, echoRings: 1 });
  assert.equal(canvasFor(0, 365), 53);
});

test("the echo ring is always 53 cells on a side", () => {
  for (let y = 1; y <= MAX_RINGS; y++) {
    const total = ringsFor(y, 365);
    const size = canvasFor(y, 365);
    const o = 2 * (total - 1);
    assert.equal(size - 2 * o, 53, `at ${y} years`);
  }
});

test("the echo ring is 54 runs covering 104 cells", () => {
  const d = echoRingBars(0, 53);
  assert.equal(d.split("M").length - 1, 54, "14 + 14 + 13 + 13");
  // THE INK IS UNCHANGED BY THE REVISION: the dash covers exactly the cells the
  // dot rule covered, and only the number of runs they are written as halved.
  // A run is "M<x> <y>h<w>v<h>h-<w>z", so its area is w * h.
  const cells = [...d.matchAll(/M\d+ \d+h(\d+)v(\d+)h-\d+z/g)]
    .reduce((n, m) => n + Number(m[1]) * Number(m[2]), 0);
  assert.equal(cells, 104, "27 + 27 + 25 + 25 cells of ink");
});

test("the echo ring matches the Solidity byte for byte", () => {
  // The short ring in full, so the pattern is readable. The same literal is in
  // contracts/test/EchoRing.t.sol.
  assert.equal(
    echoRingBars(0, 9),
    "M0 0h2v1h-2zM0 8h2v1h-2zM4 0h2v1h-2zM4 8h2v1h-2zM8 0h1v1h-1zM8 8h1v1h-1z"
    + "M0 1h1v1h-1zM8 1h1v1h-1zM0 4h1v2h-1zM8 4h1v2h-1z",
  );

  // The real one, held by hash because 717 bytes is not readable. The same
  // hash is asserted in EchoRing.t.sol.
  const d = echoRingBars(0, 53);
  assert.equal(d.length, 717, "a newborn child's echo ring");
  assert.equal(
    keccak256(toBytes(d)),
    "0x72ad6bd54c11077cd08247296099dfa08ba0cd6c2ebc366e0895d97c6dcf1fe4",
  );

  // And at the other extreme: a child at the cap draws the same 54 runs one
  // slot deeper, where every coordinate is two digits.
  const deep = echoRingBars(2 * 9, 53);
  assert.equal(deep.split("M").length - 1, 54);
  assert.equal(deep.length, 756, "the deepest echo ring, all two-digit");
  assert.equal(
    keccak256(toBytes(deep)),
    "0xf9c9a5d28305a0e04d3c25f29d1d273e31c5cb27997535d8b0ef4d2e50f2c85b",
  );
});

test("a ring too small to have edges draws nothing", () => {
  // Parity with the Solidity guard, where a zero length would underflow.
  assert.equal(echoRingBars(0, 0), "");
  assert.equal(echoRingBars(7, 1), "");
  assert.equal(echoRingBars(0, 2), "M0 0h2v1h-2zM0 1h2v1h-2z", "two cells is one run per edge");
});
