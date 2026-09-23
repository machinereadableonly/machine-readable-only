// The JavaScript half of the echo ring, and the differential that holds it to
// the Solidity half.
//
// contracts/test/EchoRing.t.sol asserts the SAME short-ring string and the
// SAME keccak256 against FrameRenderer.echoRingBars. The render matrix has no
// echo-bearing case in it, so RenderFixture.sol cannot see this path at all --
// these two pins are the only thing that proves the dashed ring is drawn the
// same way in both languages. Regenerate both with
// `node tools/echo-ring-fixture.mjs`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";

import { ringBudget, ringsFor, canvasFor, echoRingBars } from "../render-token.mjs";

test("a founding token draws its finished-year ring and nothing else", () => {
  assert.deepEqual(ringBudget(1, 0), { own: 1, echoRings: 0 });
  assert.equal(ringsFor(1, 0), 1);
  assert.equal(ringsFor(1), 1, "and the one-argument form still means founding");
});

test("a finished child draws two rings", () => {
  // Spec 10f: there is only ever one own ring, so the echo adds a ring rather
  // than taking a share of one.
  assert.deepEqual(ringBudget(1, 365), { own: 1, echoRings: 1 });
  assert.equal(ringsFor(1, 365), 2);
});

test("one echo day is enough to draw the ring", () => {
  assert.deepEqual(ringBudget(1, 1), { own: 1, echoRings: 1 });
});

test("a newborn child is one ring, not zero", () => {
  assert.deepEqual(ringBudget(0, 365), { own: 0, echoRings: 1 });
  assert.equal(canvasFor(0, 365), 53);
});

test("the echo ring is always 53 cells on a side", () => {
  // Both ring counts a child can have: the echo alone, and the echo inside its
  // own finished ring.
  for (const y of [0, 1]) {
    const total = ringsFor(y, 365);
    const size = canvasFor(y, 365);
    const o = 2 * (total - 1);
    assert.equal(size - 2 * o, 53, `at ${y} years`);
  }
});

test("the echo ring is 54 runs covering 104 cells", () => {
  const d = echoRingBars(0, 53);
  assert.equal(d.split("M").length - 1, 54, "14 + 14 + 13 + 13");
  // The ink is the same NUMBER of cells the dot rule drew, but NOT the same
  // cells: the two rules agree only on offsets divisible by 4, so 52 of the 104
  // are shared and the other half moved. Only the number of runs they are
  // written as halved.
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

  // And at the other extreme: a FINISHED child draws the same 54 runs one slot
  // deeper, inside its own ring. Spec 10f made that depth 2 rather than the 18
  // a nine-ring child used to reach.
  const deep = echoRingBars(2 * 1, 53);
  assert.equal(deep.split("M").length - 1, 54);
  assert.equal(deep.length, 721, "the deepest echo ring");
  assert.equal(
    keccak256(toBytes(deep)),
    "0x224bf74265fd2922b70cb1567538e4ef019b87b8260e5ba371fccbf01068b5c8",
  );
});

test("a ring too small to have edges draws nothing", () => {
  // Parity with the Solidity guard, where a zero length would underflow.
  assert.equal(echoRingBars(0, 0), "");
  assert.equal(echoRingBars(7, 1), "");
  assert.equal(echoRingBars(0, 2), "M0 0h2v1h-2zM0 1h2v1h-2z", "two cells is one run per edge");

  // len 6 IS THE ONLY SHORT RING THAT EXERCISES THE VERTICAL CLIP. That branch
  // -- `run = (len - 1) - i >= 2 ? 2 : 1` -- is DEAD at the shipped len of 53
  // and fires only when len is 2 mod 4. An untested branch in a function that
  // must stay byte-identical across two languages is exactly where a future
  // edit diverges with every suite green, so it is pinned here and in
  // contracts/test/EchoRing.t.sol with the same string. At len 6 the vertical
  // group starting at offset 4 has only offset 4 in range, since offset 5 is
  // the corner the horizontal edge already drew.
  assert.equal(
    echoRingBars(0, 6),
    "M0 0h2v1h-2zM0 5h2v1h-2zM4 0h2v1h-2zM4 5h2v1h-2z"
    + "M0 1h1v1h-1zM5 1h1v1h-1zM0 4h1v1h-1zM5 4h1v1h-1z",
    "the vertical clip, at the only length that reaches it",
  );
});
