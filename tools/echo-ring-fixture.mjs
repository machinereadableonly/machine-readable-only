// Prints the two pins that hold the echo ring identical in both languages:
// the short ring in full, and the keccak256 of the two real ones.
//
// The render matrix carries no echo-bearing case, so RenderFixture.sol -- the
// usual cross-language differential -- cannot see echoRingBars at all. These
// pins are what replaces it. They are asserted in BOTH
// contracts/test/EchoRing.t.sol and tools/test/echo-ring.test.mjs, so a change
// on one side alone turns one suite red.
//
// Values are printed rather than written to a file, for the same reason
// tools/frame-path-fixture.mjs prints: tools/out is gitignored, and a test that
// read from there would fail on a clean clone.
//
//   node tools/echo-ring-fixture.mjs
import { keccak256, toBytes } from "viem";
import { echoRingBars, ringBudget, MAX_RINGS } from "./render-token.mjs";

const dots = d => d.split("M").length - 1;

const show = (label, o, len) => {
  const d = echoRingBars(o, len);
  console.log(`${label}: o=${o} len=${len} -> ${dots(d)} dots, ${d.length} bytes`);
  console.log(`  ${keccak256(toBytes(d))}`);
};

// A newborn child: its echo ring is the outermost thing on a 53-cell canvas.
show("newborn child   ", 0, 53);
// A child at the cap: nine of its own rings, so the echo ring sits at depth 18
// and every coordinate is two digits. This is the byte worst case for the ring.
const { own } = ringBudget(MAX_RINGS, 365);
show("child at the cap", 2 * own, 53);

// The short ring, printed in full because it is the readable pin.
console.log("\nthe short ring, in full:");
console.log(echoRingBars(0, 9));
