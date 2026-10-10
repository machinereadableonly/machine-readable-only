// The operator's split-seed tool: it makes the secret and shows only the anchor.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chainKeys } from "../src/clock/split.mjs";

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL("../tools/split-seed.mjs", import.meta.url));

test("new writes a 0600 seed and prints only its anchor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-split-"));
  const path = join(dir, "seed");
  const { stdout } = await run("node", [TOOL, "new", path]);
  const seed = readFileSync(path, "utf8").trim();
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.match(stdout.trim(), /^anchor 0x[0-9a-f]{64}$/);
  assert.ok(!stdout.includes(seed.replace(/^0x/, "")), "the seed is never printed");
  assert.equal(stdout.trim().split(" ")[1], chainKeys(seed)[0]);
});

test("anchor prints the anchor of an existing seed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-split-"));
  const path = join(dir, "seed");
  const seed = "0x" + "5a".repeat(32);
  writeFileSync(path, seed + "\n", { mode: 0o600 });
  const { stdout } = await run("node", [TOOL, "anchor", path]);
  assert.equal(stdout.trim(), `anchor ${chainKeys(seed)[0]}`);
});

test("new refuses to overwrite a seed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-split-"));
  const path = join(dir, "seed");
  writeFileSync(path, "x", { mode: 0o600 });
  await assert.rejects(run("node", [TOOL, "new", path]), (err) => /never overwritten/.test(err.stderr));
  assert.equal(readFileSync(path, "utf8"), "x");
});

test("new refuses a path inside the repository", async () => {
  await assert.rejects(
    run("node", [TOOL, "new", fileURLToPath(new URL("../seed-should-not-exist", import.meta.url))]),
    (err) => /inside the repository/.test(err.stderr)
  );
});

function verify(path, typed) {
  return new Promise((resolve) => {
    const p = spawn("node", [TOOL, "verify", path]);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
    p.stdin.end(typed + "\n");
  });
}

test("verify says match for a typed copy of the seed, in any case or prefix, and never prints it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-split-"));
  const path = join(dir, "seed");
  const seed = "0x" + "5a".repeat(32);
  writeFileSync(path, seed + "\n", { mode: 0o600 });
  for (const typed of [seed, seed.slice(2).toUpperCase(), `  ${seed}  `]) {
    const r = await verify(path, typed);
    assert.equal(r.code, 0, typed);
    assert.match(r.out, /^match/);
    assert.ok(!(r.out + r.err).toLowerCase().includes("5a".repeat(32)));
  }
});

test("verify says DIFFERENT and exits 1 for a mistyped copy", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-split-"));
  const path = join(dir, "seed");
  writeFileSync(path, "0x" + "5a".repeat(32) + "\n", { mode: 0o600 });
  const r = await verify(path, "0x" + "5a".repeat(31) + "5b");
  assert.equal(r.code, 1);
  assert.match(r.out, /^DIFFERENT/);
});
