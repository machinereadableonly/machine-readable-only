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

test("the echo ring is 104 dots", () => {
  const d = echoRingBars(0, 53);
  assert.equal(d.split("M").length - 1, 104, "27 + 27 + 25 + 25");
});

test("the echo ring matches the Solidity byte for byte", () => {
  // The short ring in full, so the pattern is readable. The same literal is in
  // contracts/test/EchoRing.t.sol.
  assert.equal(
    echoRingBars(0, 9),
    "M0 0h1v1h-1zM0 8h1v1h-1zM2 0h1v1h-1zM2 8h1v1h-1zM4 0h1v1h-1zM4 8h1v1h-1z"
    + "M6 0h1v1h-1zM6 8h1v1h-1zM8 0h1v1h-1zM8 8h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1z"
    + "M0 4h1v1h-1zM8 4h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1z",
  );

  // The real one, held by hash because 1,386 bytes is not readable. The same
  // hash is asserted in EchoRing.t.sol.
  const d = echoRingBars(0, 53);
  assert.equal(d.length, 1386, "a newborn child's echo ring");
  assert.equal(
    keccak256(toBytes(d)),
    "0x1e94a853465cdc221019c2f535613bb2b5382b538e57ed7f758bab68f76961aa",
  );

  // And at the other extreme: a child at the cap draws the same 104 dots one
  // slot deeper, where every coordinate is two digits.
  const deep = echoRingBars(2 * 9, 53);
  assert.equal(deep.split("M").length - 1, 104);
  assert.equal(deep.length, 1456, "the deepest echo ring, all two-digit");
  assert.equal(
    keccak256(toBytes(deep)),
    "0x42c520135d88294bc8feb6c15db972f1d48e84efdd3fd7df11f1d720ac64a046",
  );
});

test("a ring too small to have edges draws nothing", () => {
  // Parity with the Solidity guard, where a zero length would underflow.
  assert.equal(echoRingBars(0, 0), "");
  assert.equal(echoRingBars(7, 1), "");
  assert.equal(echoRingBars(0, 2), "M0 0h1v1h-1zM0 1h1v1h-1z", "two cells is two dots");
});
