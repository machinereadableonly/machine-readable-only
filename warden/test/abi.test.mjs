// The Clock's ABI must match the contract it talks to.
//
// WHY THIS EXISTS. src/clock/abi.mjs is generated from the compiled artifact by
// tools/gen-abi.mjs, and on 2026-09-02 it was found STALE: the contract had
// gained a third argument on applyMark six commits earlier and nothing re-ran
// the generator. Every Clock test passed anyway, because they all drive a stub
// writer that records arguments instead of encoding them -- so the one thing
// that would have caught it was a real transaction, at 00:05 UTC, failing in a
// way that reads like a chain problem rather than a stale file.
//
// WHY IT SKIPS RATHER THAN FAILS without a build. contracts/out/ is gitignored,
// so on a fresh clone there is nothing to compare against. A guard that fails
// for the wrong reason gets deleted, and then it guards nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MRO_ABI } from "../src/clock/abi.mjs";

const ARTIFACT = fileURLToPath(
  new URL("../../contracts/out/MachineReadableOnly.sol/MachineReadableOnly.json", import.meta.url)
);

let artifactAbi = null;
try {
  artifactAbi = JSON.parse(readFileSync(ARTIFACT, "utf8")).abi;
} catch {
  artifactAbi = null;
}

const skip = artifactAbi ? false : "no contracts/out build to compare against; run forge build";

test("the committed ABI is what the generator would write today", { skip }, () => {
  assert.deepEqual(MRO_ABI, artifactAbi,
    "src/clock/abi.mjs has drifted from the contract -- run: cd warden && node tools/gen-abi.mjs");
});

// The specific drift that was missed, named so a regression is legible rather
// than a wall of JSON diff. These are the only two shapes the Clock encodes by
// hand, so they are the two worth calling out.
test("applyMark takes the variant, and MarkApplied reports it", { skip }, () => {
  const fn = MRO_ABI.find((e) => e.type === "function" && e.name === "applyMark");
  assert.deepEqual(fn.inputs.map((i) => i.type), ["uint256", "uint8", "uint8"]);

  const ev = MRO_ABI.find((e) => e.type === "event" && e.name === "MarkApplied");
  assert.deepEqual(ev.inputs.map((i) => i.name), ["id", "upgradeId", "variant"]);
});
