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
import { echoRingBars, ringBudget } from "./render-token.mjs";

const runs = d => d.split("M").length - 1;

const show = (label, o, len) => {
  const d = echoRingBars(o, len);
  console.log(`${label}: o=${o} len=${len} -> ${runs(d)} runs, ${d.length} bytes`);
  console.log(`  ${keccak256(toBytes(d))}`);
};

// A newborn child: its echo ring is the outermost thing on a 53-cell canvas.
show("newborn child   ", 0, 53);
// A FINISHED child: one ring of its own, so the echo ring sits at depth 2. That
// is the deepest the echo ring can now sit -- Spec 10f ended the year at 365,
// so a child has one own ring at most, where it used to have nine and the echo
// sat at depth 18. This is the byte worst case for the ring.
// The ring is a DASH since 2026-09-07 -- two cells on, two off, consecutive ink
// emitted as ONE run -- so the run count is 54 where the dotted rule gave 104.
const { own } = ringBudget(1, 365);
show("finished child  ", 2 * own, 53);

// The short ring, printed in full because it is the readable pin.
console.log("\nthe short ring, in full:");
console.log(echoRingBars(0, 9));
