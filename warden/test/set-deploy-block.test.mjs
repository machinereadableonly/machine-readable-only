// contracts/script/set-deploy-block.sh records the Clock's DEPLOY_BLOCK for ONE
// chain and keeps every other chain's entry.
//
// It exists because adopt-deployment.sh could only ever write `{ 84532: ... }`
// (found 2026-09-15 by the mainnet rehearsal plan): a mainnet adoption would
// have failed at exactly the step that stops the Clock mis-running. The helper
// is run here against a scratch copy of the line's real shape, and the result
// is IMPORTED, so "the file still parses as JavaScript" is asserted rather than
// assumed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HELPER = fileURLToPath(new URL("../../contracts/script/set-deploy-block.sh", import.meta.url));

/// A scratch module shaped like reconcile.mjs around the one line that matters.
function scratch(mapLine) {
  const dir = mkdtempSync(join(tmpdir(), "deploy-block-"));
  const file = join(dir, "reconcile.mjs");
  writeFileSync(file, `/// comment above\n${mapLine}\n\nexport const OTHER = 1;\n`);
  return file;
}

const run = (...args) => execFileSync("bash", [HELPER, ...args], { encoding: "utf8", stdio: "pipe" });

/// A refusal must be the helper's OWN refusal. A bare `assert.throws` also
/// passed when the helper did not exist at all -- bash failing to open it looks
/// exactly like a correct refusal -- so the message is asserted too.
function refuses(...args) {
  let stderr = "";
  assert.throws(() => {
    try { run(...args); } catch (err) { stderr = String(err.stderr ?? ""); throw err; }
  });
  assert.match(stderr, /FAIL:/, `expected the helper's own FAIL message, got: ${stderr.slice(0, 200)}`);
}
const mapLine = (file) => readFileSync(file, "utf8").split("\n").find((l) => l.startsWith("export const DEPLOY_BLOCK"));
// A fresh URL per import, so node's module cache never serves an earlier state.
const load = async (file) => (await import(`${pathToFileURL(file).href}?v=${Math.random()}`)).DEPLOY_BLOCK;

test("updates the Sepolia entry in place, grouped the way the file writes it", async () => {
  const file = scratch("export const DEPLOY_BLOCK = { 84532: 46_686_660n };");
  run("84532", "46700001", file);
  assert.equal(mapLine(file), "export const DEPLOY_BLOCK = { 84532: 46_700_001n };");
  assert.deepEqual(await load(file), { 84532: 46_700_001n });
});

test("adds a mainnet entry and KEEPS the Sepolia one", async () => {
  const file = scratch("export const DEPLOY_BLOCK = { 84532: 46_686_660n };");
  run("8453", "51340945", file);
  assert.equal(mapLine(file), "export const DEPLOY_BLOCK = { 84532: 46_686_660n, 8453: 51_340_945n };");
  assert.deepEqual(await load(file), { 84532: 46_686_660n, 8453: 51_340_945n });
});

// THE PREFIX TRAP. "84532" begins with "8453", so a pattern that is not anchored
// on the colon would rewrite the Sepolia entry when asked for mainnet, or the
// other way round.
test("8453 and 84532 are never confused, in either direction", async () => {
  const file = scratch("export const DEPLOY_BLOCK = { 84532: 46_686_660n, 8453: 51_340_945n };");
  run("8453", "51400000", file);
  assert.deepEqual(await load(file), { 84532: 46_686_660n, 8453: 51_400_000n });
  run("84532", "46800000", file);
  assert.deepEqual(await load(file), { 84532: 46_800_000n, 8453: 51_400_000n });
});

test("running it twice with the same value changes nothing", () => {
  const file = scratch("export const DEPLOY_BLOCK = { 84532: 46_686_660n };");
  run("8453", "51340945", file);
  const once = readFileSync(file, "utf8");
  run("8453", "51340945", file);
  assert.equal(readFileSync(file, "utf8"), once);
});

test("refuses a block or chain that is not a plain number, and leaves the file alone", () => {
  const file = scratch("export const DEPLOY_BLOCK = { 84532: 46_686_660n };");
  const before = readFileSync(file, "utf8");
  refuses("8453", "51_340_945", file);
  refuses("base", "51340945", file);
  refuses("8453", "", file);
  assert.equal(readFileSync(file, "utf8"), before);
});

// `sed -i` succeeds when its pattern matches nothing. A reformatted line must
// therefore fail loudly, not report success over an unchanged file.
test("refuses a file with no one-line DEPLOY_BLOCK map", () => {
  const file = scratch("export const DEPLOY_BLOCK = {\n  84532: 46_686_660n,\n};");
  refuses("8453", "51340945", file);
});

test("the real reconcile.mjs has exactly the shape the helper edits", () => {
  const real = fileURLToPath(new URL("../src/clock/reconcile.mjs", import.meta.url));
  const lines = readFileSync(real, "utf8").split("\n").filter((l) => l.startsWith("export const DEPLOY_BLOCK"));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^export const DEPLOY_BLOCK = \{ [0-9]+: [0-9_]+n(, [0-9]+: [0-9_]+n)* \};$/);
});
