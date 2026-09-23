// contracts/script/set-record-block.sh rewrites the deploy block and date on
// CLAUDE.md's live-deployment line.
//
// It exists because adopt-deployment.sh rewrote the addresses in CLAUDE.md but
// not the block and date beside them, so the 2026-09-22 redeploy left the old
// pair's block next to the new address. Each case runs the helper against a
// scratch copy of the line's real shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER = fileURLToPath(new URL("../../contracts/script/set-record-block.sh", import.meta.url));
const LINE = "      block 46,686,660, 2026-09-11, both Basescan-verified";

/// A scratch file shaped like CLAUDE.md around the one line that matters.
function scratch(body = LINE) {
  const dir = mkdtempSync(join(tmpdir(), "record-block-"));
  const file = join(dir, "CLAUDE.md");
  writeFileSync(file, `- **The live deployment:**\n\n      Renderer  0xabc\n${body}\n\nMore prose.\n`);
  return file;
}

const run = (...args) => execFileSync("bash", [HELPER, ...args], { encoding: "utf8", stdio: "pipe" });
const blockLine = (file) => readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("      block "));

/// A refusal must be the helper's OWN refusal, not bash failing to open it.
function refuses(...args) {
  let stderr = "";
  assert.throws(() => {
    try { run(...args); } catch (err) { stderr = String(err.stderr ?? ""); throw err; }
  });
  assert.match(stderr, /FAIL:/, `expected the helper's own FAIL message, got: ${stderr.slice(0, 200)}`);
}

test("rewrites the block and date, grouped with commas, and keeps the rest of the line", () => {
  const file = scratch();
  run("47161021", "2026-09-22", file);
  assert.equal(blockLine(file), "      block 47,161,021, 2026-09-22, both Basescan-verified");
});

test("groups short and exact-multiple numbers correctly", () => {
  const file = scratch();
  run("999", "2026-01-01", file);
  assert.equal(blockLine(file), "      block 999, 2026-01-01, both Basescan-verified");
  run("100000000", "2026-01-02", file);
  assert.equal(blockLine(file), "      block 100,000,000, 2026-01-02, both Basescan-verified");
});

test("running it twice with the same value changes nothing", () => {
  const file = scratch();
  run("47161021", "2026-09-22", file);
  const once = readFileSync(file, "utf8");
  run("47161021", "2026-09-22", file);
  assert.equal(readFileSync(file, "utf8"), once);
});

test("refuses a block or date that is not the plain shape, and leaves the file alone", () => {
  const file = scratch();
  const before = readFileSync(file, "utf8");
  refuses("47,161,021", "2026-09-22", file);
  refuses("", "2026-09-22", file);
  refuses("47161021", "22/09/2026", file);
  refuses("47161021", "", file);
  assert.equal(readFileSync(file, "utf8"), before);
});

// A second line of this shape is a dated historical record; rewriting it would
// say an old deploy happened at the new block.
test("refuses a file with two deploy-block lines, and one with none", () => {
  refuses("47161021", "2026-09-22", scratch(`${LINE}\n${LINE}`));
  refuses("47161021", "2026-09-22", scratch("no block line here"));
});

// The cases above prove the helper; this proves it is still CALLED. Without it,
// deleting the call from adopt-deployment.sh leaves every test here green and
// the record rotting again, which is the original bug.
test("adopt-deployment.sh calls the helper on CLAUDE.md", () => {
  const adopt = fileURLToPath(new URL("../../contracts/script/adopt-deployment.sh", import.meta.url));
  assert.match(readFileSync(adopt, "utf8"), /^\s*bash contracts\/script\/set-record-block\.sh .* CLAUDE\.md$/m);
});

test("the real CLAUDE.md has exactly one line of the shape the helper edits", () => {
  const real = fileURLToPath(new URL("../../CLAUDE.md", import.meta.url));
  const lines = readFileSync(real, "utf8").split("\n").filter((l) => /^ {6}block [0-9,]+, \d{4}-\d{2}-\d{2}, /.test(l));
  assert.equal(lines.length, 1);
});
