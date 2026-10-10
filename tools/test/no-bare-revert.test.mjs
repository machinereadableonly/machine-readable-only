// A bare vm.expectRevert() passes on ANY revert, so a test meant to prove an
// owner or pause gate also passes when the gate is gone and something else
// reverts. Every expected revert names its error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

test("no contract test expects a revert without naming it", () => {
  const dir = new URL("../../contracts/test/", import.meta.url);
  const bare = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sol"))) {
    readFileSync(new URL(file, dir), "utf8").split("\n").forEach((line, i) => {
      if (/vm\.expectRevert\(\s*\)/.test(line) && !line.trim().startsWith("//")) bare.push(`${file}:${i + 1}`);
    });
  }
  assert.deepEqual(bare, []);
});
