import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildClockEnv, CLOCK_PATHS } from "../deploy/clock-env.mjs";

// Values no report or error may ever contain.
const KEY = "0x" + "ab".repeat(32);
const RPC = "https://rpc.example/v2/sentinel-api-key";

const wardenEnv = [
  "# the Warden's own file",
  "MRO_DOMAIN=machinereadableonly.com",
  `BASE_RPC_URL="${RPC}"`,
  "MRO_CONTRACT_ADDRESS=0x1111111111111111111111111111111111111111",
  "MRO_CHAIN_ID=84532",
  "CHALLENGE_SECRET=not-the-clocks-business",
  `CLOCK_PRIVATE_KEY=${KEY}`,
  "",
].join("\n");

const lines = (text) => text.split("\n").filter(Boolean);
const leaks = (s) => s.includes(KEY) || s.includes("sentinel-api-key");

test("copies only the Clock's keys, verbatim, and sets the fixed paths", () => {
  const { text } = buildClockEnv({ wardenEnvText: wardenEnv });
  const out = lines(text).filter((l) => !l.startsWith("#"));
  assert.ok(out.includes(`BASE_RPC_URL="${RPC}"`), "quoting survives");
  assert.ok(out.includes("MRO_CONTRACT_ADDRESS=0x1111111111111111111111111111111111111111"));
  assert.ok(out.includes("MRO_CHAIN_ID=84532"));
  assert.ok(out.includes(`CLOCK_PRIVATE_KEY=${KEY}`));
  assert.ok(out.includes(`STATE_DB_PATH=${CLOCK_PATHS.stateDb}`));
  assert.ok(out.includes(`MRO_SPLIT_SEED_FILE=${CLOCK_PATHS.splitSeed}`));
  assert.ok(out.includes(`MRO_QUESTION_BANK=${CLOCK_PATHS.bank}`));
  assert.ok(!text.includes("CHALLENGE_SECRET"), "the Warden's secrets stay in the Warden's file");
  assert.ok(!text.includes("MRO_DOMAIN"));
});

test("MAX_GAS_GWEI is copied when set and left out when not", () => {
  assert.ok(!buildClockEnv({ wardenEnvText: wardenEnv }).text.includes("MAX_GAS_GWEI"));
  const { text } = buildClockEnv({ wardenEnvText: wardenEnv + "MAX_GAS_GWEI=0.1\n" });
  assert.ok(lines(text).includes("MAX_GAS_GWEI=0.1"));
});

// After the cutover the operator removes the key from the Warden's file, and
// the installer must still be re-runnable after every Clock code change.
test("the key falls back to the existing clock.env once the Warden's file drops it", () => {
  const without = wardenEnv.replace(/^CLOCK_PRIVATE_KEY=.*\n/m, "");
  const { text, report } = buildClockEnv({
    wardenEnvText: without,
    existingClockEnvText: `CLOCK_PRIVATE_KEY=${KEY}\n`,
  });
  assert.ok(lines(text).includes(`CLOCK_PRIVATE_KEY=${KEY}`));
  assert.match(report.join("\n"), /CLOCK_PRIVATE_KEY\s+set, kept from the existing clock\.env/);
});

test("the Warden's file wins over the existing clock.env, so a rotated key lands", () => {
  const { text } = buildClockEnv({
    wardenEnvText: wardenEnv,
    existingClockEnvText: "CLOCK_PRIVATE_KEY=0xold\n",
  });
  assert.ok(lines(text).includes(`CLOCK_PRIVATE_KEY=${KEY}`));
  assert.ok(!text.includes("0xold"));
});

test("no key anywhere is refused", () => {
  const without = wardenEnv.replace(/^CLOCK_PRIVATE_KEY=.*\n/m, "");
  assert.throws(() => buildClockEnv({ wardenEnvText: without }), /CLOCK_PRIVATE_KEY/);
});

test("an empty value counts as missing", () => {
  const empty = wardenEnv.replace(/^MRO_CHAIN_ID=.*$/m, "MRO_CHAIN_ID=");
  assert.throws(() => buildClockEnv({ wardenEnvText: empty }), /MRO_CHAIN_ID/);
});

test("a key written twice is refused rather than guessed at", () => {
  assert.throws(
    () => buildClockEnv({ wardenEnvText: wardenEnv + "MRO_CHAIN_ID=8453\n" }),
    /MRO_CHAIN_ID.*more than once/
  );
});

test("a key the Clock does not read may repeat", () => {
  const { text } = buildClockEnv({ wardenEnvText: wardenEnv + "CLOCK_ADDRESS=0x1\nCLOCK_ADDRESS=0x2\n" });
  assert.ok(!text.includes("CLOCK_ADDRESS"));
});

test("neither the report nor any refusal carries a value", () => {
  const { report } = buildClockEnv({ wardenEnvText: wardenEnv });
  assert.ok(!leaks(report.join("\n")));
  const twice = wardenEnv + `CLOCK_PRIVATE_KEY=${KEY}\n`;
  try {
    buildClockEnv({ wardenEnvText: twice });
    assert.fail("expected a refusal");
  } catch (err) {
    assert.ok(!leaks(err.message));
  }
});

// A variable the Clock starts requiring must reach its file, or the first sign
// is a failed night.
test("every variable the Clock requires is one the builder writes", () => {
  const main = readFileSync(new URL("../src/clock/main.mjs", import.meta.url), "utf8");
  const required = [...main.matchAll(/requireEnv\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]);
  assert.ok(required.length >= 5);
  const { text } = buildClockEnv({ wardenEnvText: wardenEnv });
  for (const name of required) assert.match(text, new RegExp(`^${name}=.`, "m"), name);
});

test("clock.env.example lists exactly the keys the builder writes", () => {
  const names = (text) =>
    new Set(lines(text).map((l) => /^#?([A-Z][A-Z0-9_]*)=/.exec(l)?.[1]).filter(Boolean));
  const example = readFileSync(new URL("../deploy/clock.env.example", import.meta.url), "utf8");
  const { text } = buildClockEnv({ wardenEnvText: wardenEnv + "MAX_GAS_GWEI=0.1\n" });
  assert.deepEqual([...names(example)].sort(), [...names(text)].sort());
  for (const [, path] of Object.entries(CLOCK_PATHS)) assert.ok(example.includes(path), path);
});

test("the command writes the file mode 600 and prints no value", () => {
  const dir = mkdtempSync(join(tmpdir(), "clock-env-"));
  const src = join(dir, "warden.env");
  const out = join(dir, "clock.env");
  writeFileSync(src, wardenEnv, { mode: 0o600 });
  const script = new URL("../deploy/clock-env.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, "--warden-env", src, "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.ok(readFileSync(out, "utf8").includes(`CLOCK_PRIVATE_KEY=${KEY}`));
  assert.ok(!leaks(r.stdout + r.stderr));
});

test("the command reads an existing clock.env at --out when it is there", () => {
  const dir = mkdtempSync(join(tmpdir(), "clock-env-"));
  const src = join(dir, "warden.env");
  const out = join(dir, "clock.env");
  writeFileSync(src, wardenEnv.replace(/^CLOCK_PRIVATE_KEY=.*\n/m, ""), { mode: 0o600 });
  writeFileSync(out, `CLOCK_PRIVATE_KEY=${KEY}\n`, { mode: 0o600 });
  const script = new URL("../deploy/clock-env.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, "--warden-env", src, "--out", out], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(readFileSync(out, "utf8").includes(`CLOCK_PRIVATE_KEY=${KEY}`));
});
