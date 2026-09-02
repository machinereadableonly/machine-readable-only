// Isolated unit tests for the eye shape-drawing closures in render-token.mjs,
// called directly through eyeOverlay rather than through the full render
// pipeline. Mirrors contracts/test/EyeRenderer.t.sol so the two languages are
// checked the same way -- this file asserts JS behaviour in isolation;
// cross-language agreement is Renderer.t.sol's and RenderMatrix.t.sol's job.
//
// Added in Fix Round 1 of the Task 6 review: the shape-drawing closures
// (eyeTarget/eyeSquircle/eyeLeaf) had no direct JS-side test, only coverage
// through the full renderSvg/tokenUri pipeline.
import test from "node:test";
import assert from "node:assert/strict";
import { eyeOverlay, IRIS_SHAPE_NAMES } from "../render-token.mjs";
import { SIZE } from "../token-bitmap.mjs";

// Same offset EyeCost.t.sol and EyeRenderer.t.sol use.
const CODE_OFF = 6;

test("IRIS_SHAPE_NAMES matches the three built shapes in order", () => {
  assert.deepEqual(IRIS_SHAPE_NAMES, ["target", "squircle", "leaf"]);
});

test("the target shape draws nine circles and three erase rects", () => {
  const out = eyeOverlay(CODE_OFF, 0, "#c8102e", "#ffffff", SIZE);
  assert.equal((out.match(/<circle/g) || []).length, 9);
  assert.equal((out.match(/<rect/g) || []).length, 3);
  // 635 bytes in tools/eye-shape-sheet.mjs at this offset -- the same
  // plausibility band contracts/test/EyeRenderer.t.sol asserts in Solidity.
  assert.ok(out.length > 500 && out.length < 800, `implausible length ${out.length}`);
});

test("the squircle shape draws nine rounded rects and three erase rects", () => {
  const out = eyeOverlay(CODE_OFF, 1, "#c8102e", "#ffffff", SIZE);
  // Three erase rects plus nine drawn rects (three per eye): twelve total.
  assert.equal((out.match(/<rect/g) || []).length, 12);
});

test("the leaf shape draws nine paths and three erase rects, byte for byte", () => {
  const out = eyeOverlay(CODE_OFF, 2, "#c8102e", "#ffffff", SIZE);
  assert.equal((out.match(/<path/g) || []).length, 9);
  assert.equal((out.match(/<rect/g) || []).length, 3);
  // The exact outer-ring geometry at the top-left eye (x = y = CODE_OFF),
  // checked byte for byte against the measured reference: every decimal is a
  // literal suffix, never computed, so a float artifact would show up here
  // as a wrong digit rather than a wrong-looking picture.
  const x = CODE_OFF, y = CODE_OFF;
  const outerRing =
    `M${x + 2}.6 ${y}h4.4v4.4a2.6 2.6 0 0 1 -2.6 2.6h-4.4v-4.4a2.6 2.6 0 0 1 2.6 -2.6z`;
  assert.ok(out.includes(outerRing), "the outer leaf ring does not match the measured reference");
});

test("the erase takes the ground and never a constant", () => {
  const out = eyeOverlay(CODE_OFF, 0, "#c8102e", "#fdf3e3", SIZE);
  assert.equal(
    (out.match(/#fdf3e3/g) || []).length, 6,
    "erase and inner ring must both use the ground"
  );
  assert.equal(
    (out.match(/#ffffff/g) || []).length, 0,
    "a white constant leaked into a tinted token"
  );
});

test("all three shapes draw something", () => {
  for (let shape = 0; shape < 3; shape++) {
    const out = eyeOverlay(CODE_OFF, shape, "#c8102e", "#ffffff", SIZE);
    assert.ok(out.length > 400, `shape ${shape} drew implausibly little (${out.length} bytes)`);
  }
});
