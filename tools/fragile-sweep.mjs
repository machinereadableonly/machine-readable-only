// Find a code the robustness gate REJECTS, and say exactly where it fails.
//
// WHY THIS EXISTS. robust-solve.mjs picks a token's bitmap by robustness first
// and heart match second, because a code chosen on match alone once shipped and
// failed to scan at a fifth of raster sizes. robust-solve.test.mjs pins that
// with KNOWN_FRAGILE: real (id, mask) pairs measured to fail.
//
// Those pins do not survive a QR version raise. A raise re-solves every code,
// so the version 5 examples (id 55 mask 4, id 12 mask 4) simply stopped
// existing at version 10 and the test would have passed for the wrong reason --
// a guard agreeing with itself. This tool is how the pins get re-measured
// instead of relaxed.
//
// IT IS ALSO THE OPEN HALF OF THAT TEST. The assertion with real teeth is
// `rejected > 0`: that the gate REJECTED a better-matching mask and changed
// what ships, rather than agreeing with the ranking it exists to override.
// Both version 10 pins ship with rejected = 0, so that assertion is currently
// a todo. Sweeping a wider id range is what closes it.
//
// HEAVY. Each candidate is a full QArt solve plus the gate's eighty renders and
// decodes. A three-id sweep took minutes and was the memory pressure that
// killed a session's background task on 2026-09-21. ALWAYS run it through the
// wrapper, and sweep in small batches:
//
//   ~/scripts/safe-build.sh node tools/fragile-sweep.mjs sweep 1,2,3
//   ~/scripts/safe-build.sh node tools/fragile-sweep.mjs detail 1:3 2:1
//
// `sweep` walks every mask of each id and names the ones the gate refuses.
// `detail` takes id:mask pairs and prints every state and size each fails at,
// which is what KNOWN_FRAGILE needs, plus what that token actually ships.
import { solve, payloadFor, MASKS, VERSION_SIZE } from "./qart.mjs";
import { heartTarget } from "./heart-target.mjs";
import { gateSolve } from "./robust-solve.mjs";
import { tokenBitmap } from "./token-bitmap.mjs";

// example.com, not the real domain: a bitmap encodes its own url, and every
// fixture in the repo is solved against the placeholder. A sweep against the
// real domain would be measuring different codes than the tests pin.
const DOMAIN = process.env.MRO_SWEEP_DOMAIN ?? "example.com";
const want = heartTarget(VERSION_SIZE).want;
const dest = id => `https://${DOMAIN}/t/${id}`;

function sweep(ids) {
  let checked = 0, rejected = 0;
  for (const id of ids) {
    for (const mask of MASKS) {
      const verdict = gateSolve(solve(payloadFor(DOMAIN, id), mask), dest(id), want);
      checked++;
      if (!verdict.ok) {
        rejected++;
        console.log(`FRAGILE id=${id} mask=${mask} failures=${verdict.failures.length}`);
      }
    }
    console.log(`  ...id ${id} done (${checked} checked, ${rejected} fragile so far)`);
  }
  console.log(`SWEEP DONE: ${checked} candidates, ${rejected} the gate refuses`);
}

function detail(pairs) {
  for (const pair of pairs) {
    const [id, mask] = pair.split(":").map(Number);
    const verdict = gateSolve(solve(payloadFor(DOMAIN, id), mask), dest(id), want);
    console.log(`id ${id} mask ${mask}: ok=${verdict.ok} failures=${verdict.failures.length}`);
    const byState = {};
    for (const f of verdict.failures) (byState[f.state] ??= []).push(f.px);
    for (const [state, sizes] of Object.entries(byState)) {
      console.log(`  state ${JSON.stringify(state)} sizes [${sizes.join(", ")}]`);
    }
    // `rejected` is the number the open todo needs: non-zero means the gate
    // overrode the match ranking for this token.
    const shipped = tokenBitmap(DOMAIN, id);
    console.log(`  ships mask ${shipped.mask}, rejected ${shipped.rejected}`);
  }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "sweep") sweep((rest[0] ?? "1,2,3").split(",").map(Number));
else if (mode === "detail") detail(rest);
else {
  console.error("usage: fragile-sweep.mjs sweep <id,id,...>");
  console.error("       fragile-sweep.mjs detail <id:mask> [id:mask ...]");
  process.exit(2);
}
