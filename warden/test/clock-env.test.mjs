import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildClockEnv, CLOCK_PATHS, REFUSED } from "../deploy/clock-env.mjs";

// Values no report or error may ever contain.
const KEY = "0x" + "ab".repeat(32);
const RPC = "https://rpc.example/v2/sentinel-api-key";

const wardenEnv = [
  "# the Warden's own file",
  "MRO_DOMAIN=machinereadableonly.com",
  `BASE_RPC_URL="${RPC}"`,
  "MRO_CONTRACT_ADDRESS=0x1111111111111111111111111111111111111111",
  "MRO_CHAIN_ID=84532",
  "TREASURY_ADDRESS=0x2222222222222222222222222222222222222222",
  "MRO_HOUSE_KEY_ID=house-key-thumbprint",
  "CLOCK_CHECK_RPC_URL=https://second.example",
  "MRO_OWNER_SAFE=0x3333333333333333333333333333333333333333",
  "CHALLENGE_SECRET=not-the-clocks-business",
  "",
].join("\n");
// The Clock's key lives in its own file and nowhere else.
const clockEnv = `CLOCK_PRIVATE_KEY=${KEY}\n`;
const build = (extra = "", opts = {}) =>
  buildClockEnv({ wardenEnvText: wardenEnv + extra, existingClockEnvText: clockEnv, ...opts });

const lines = (text) => text.split("\n").filter(Boolean);
const leaks = (s) => s.includes(KEY) || s.includes("sentinel-api-key");
const script = new URL("../deploy/clock-env.mjs", import.meta.url).pathname;

test("copies only the Clock's keys, verbatim, and sets the fixed paths", () => {
  const { text } = build();
  const out = lines(text).filter((l) => !l.startsWith("#"));
  assert.ok(out.includes(`BASE_RPC_URL="${RPC}"`), "quoting survives");
  assert.ok(out.includes("MRO_CONTRACT_ADDRESS=0x1111111111111111111111111111111111111111"));
  assert.ok(out.includes("MRO_CHAIN_ID=84532"));
  assert.ok(out.includes(`CLOCK_PRIVATE_KEY=${KEY}`));
  assert.ok(out.includes(`STATE_DB_PATH=${CLOCK_PATHS.stateDb}`));
  assert.ok(out.includes(`MRO_SPLIT_SEED_FILE=${CLOCK_PATHS.splitSeed}`));
  assert.ok(out.includes(`MRO_QUESTION_BANK=${CLOCK_PATHS.bank}`));
  assert.ok(out.includes(`CLOCK_LEDGER_PATH=${CLOCK_PATHS.ledger}`));
  // What every row is proven against.
  assert.ok(out.includes("MRO_DOMAIN=machinereadableonly.com"));
  assert.ok(out.includes("TREASURY_ADDRESS=0x2222222222222222222222222222222222222222"));
  assert.ok(out.includes("MRO_HOUSE_KEY_ID=house-key-thumbprint"));
  assert.ok(!text.includes("CHALLENGE_SECRET"), "the Warden's secrets stay in the Warden's file");
});

test("MAX_GAS_GWEI is copied when set and left out when not", () => {
  assert.ok(!build().text.includes("MAX_GAS_GWEI"));
  assert.ok(lines(build("MAX_GAS_GWEI=0.1\n").text).includes("MAX_GAS_GWEI=0.1"));
});

test("the key is kept from the existing clock.env", () => {
  const { text, report } = build();
  assert.ok(lines(text).includes(`CLOCK_PRIVATE_KEY=${KEY}`));
  assert.match(report.join("\n"), /CLOCK_PRIVATE_KEY\s+set, kept from the existing clock\.env/);
});

// The main user can write the Warden's file, so a key there is a key planted.
test("a key in the Warden's file is refused, never copied", () => {
  assert.throws(() => build(`CLOCK_PRIVATE_KEY=0x${"cd".repeat(32)}\n`), /CLOCK_PRIVATE_KEY is in the Warden's/);
  assert.throws(() => build("CLOCK_PRIVATE_KEY=\n"), /CLOCK_PRIVATE_KEY is in the Warden's/, "even an empty line");
});

test("a first install generates the key; a later one never replaces it", () => {
  const fresh = `0x${"ef".repeat(32)}`;
  const { text, report } = buildClockEnv({ wardenEnvText: wardenEnv, newKey: fresh });
  assert.ok(lines(text).includes(`CLOCK_PRIVATE_KEY=${fresh}`));
  assert.match(report.join("\n"), /newly generated/);
  assert.throws(() => build("", { newKey: fresh }), /already holds/);
});

test("no key anywhere is refused", () => {
  assert.throws(() => buildClockEnv({ wardenEnvText: wardenEnv }), /--new-key/);
});

test("a dry run that cannot read clock.env does not fail on the key", () => {
  const { report } = buildClockEnv({ wardenEnvText: wardenEnv, existingUnreadable: true });
  assert.match(report.join("\n"), /not checked/);
});

test("an empty value counts as missing", () => {
  const empty = wardenEnv.replace(/^MRO_CHAIN_ID=.*$/m, "MRO_CHAIN_ID=");
  assert.throws(() => buildClockEnv({ wardenEnvText: empty, existingClockEnvText: clockEnv }), /MRO_CHAIN_ID/);
});

test("a key written twice is refused rather than guessed at", () => {
  assert.throws(() => build("MRO_CHAIN_ID=8453\n"), /MRO_CHAIN_ID.*more than once/);
});

test("a key the Clock does not read may repeat", () => {
  assert.ok(!build("CLOCK_ADDRESS=0x1\nCLOCK_ADDRESS=0x2\n").text.includes("CLOCK_ADDRESS"));
});

test("neither the report nor any refusal carries a value", () => {
  assert.ok(!leaks(build().report.join("\n")));
  for (const extra of [`CLOCK_PRIVATE_KEY=${KEY}\n`, "MRO_CHAIN_ID=8453\n"]) {
    try {
      build(extra);
      assert.fail("expected a refusal");
    } catch (err) {
      assert.ok(!leaks(err.message));
    }
  }
});

// A variable the Clock starts requiring must reach its file, or the first sign
// is a failed night.
test("every variable the Clock requires is one the builder writes", () => {
  const main = readFileSync(new URL("../src/clock/main.mjs", import.meta.url), "utf8");
  const required = [...main.matchAll(/requireEnv\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]);
  assert.ok(required.length >= 5);
  const { text } = build();
  for (const name of required) assert.match(text, new RegExp(`^${name}=.`, "m"), name);
});

// Optional reads too: one the builder silently drops runs on its default under
// mro-clock while the Warden runs on the value.
test("every variable the Clock's code reads is written or refused", () => {
  const dir = new URL("../src/clock/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs")).map((f) => new URL(f, dir));
  files.push(new URL("../src/day.mjs", import.meta.url), new URL("../src/mcp/question.mjs", import.meta.url));
  const read = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const re of [/requireEnv\("([A-Z0-9_]+)"\)/g, /\benv\.([A-Z][A-Z0-9_]+)/g, /\(process\.env, "([A-Z0-9_]+)"/g]) {
      for (const m of src.matchAll(re)) read.add(m[1]);
    }
  }
  assert.ok(read.has("MAX_GAS_GWEI") && read.has("MRO_DAY_SECONDS") && read.has("MRO_SPLIT_SEED_FILE"), "the scan sees the Clock");
  const { text } = build("MAX_GAS_GWEI=0.1\n");
  for (const name of read) {
    assert.ok(new RegExp(`^${name}=.`, "m").test(text) || REFUSED.includes(name), `${name} is read but neither written nor refused`);
  }
});

test("a variable the installed Clock never takes is refused, not dropped", () => {
  for (const name of REFUSED) assert.throws(() => build(`${name}=1\n`), new RegExp(name));
});

test("clock.env.example lists exactly the keys the builder writes", () => {
  const names = (text) =>
    new Set(lines(text).map((l) => /^#?([A-Z][A-Z0-9_]*)=/.exec(l)?.[1]).filter(Boolean));
  const example = readFileSync(new URL("../deploy/clock.env.example", import.meta.url), "utf8");
  const optional = ["MAX_GAS_GWEI=0.1", "CLOCK_MAX_MINTS=1", "CLOCK_MAX_SEEDS=1", "CLOCK_MAX_MARKS=1", "CLOCK_MAX_CREDITS=1"];
  const { text } = build(optional.join("\n") + "\n");
  assert.deepEqual([...names(example)].sort(), [...names(text)].sort());
  for (const [, path] of Object.entries(CLOCK_PATHS)) assert.ok(example.includes(path), path);
});

function files() {
  const dir = mkdtempSync(join(tmpdir(), "clock-env-"));
  const src = join(dir, "warden.env");
  writeFileSync(src, wardenEnv, { mode: 0o600 });
  return { dir, src, out: join(dir, "clock.env") };
}
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("the command keeps the existing key, writes mode 600, and prints no value", () => {
  const { src, out } = files();
  writeFileSync(out, clockEnv, { mode: 0o600 });
  const r = run("--warden-env", src, "--out", out);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(statSync(out).mode & 0o777, 0o600);
  assert.ok(readFileSync(out, "utf8").includes(`CLOCK_PRIVATE_KEY=${KEY}`));
  assert.ok(!leaks(r.stdout + r.stderr));
});

test("--new-key generates a key on a first install and prints only its address", () => {
  const { src, out } = files();
  const r = run("--warden-env", src, "--out", out, "--new-key");
  assert.equal(r.status, 0, r.stderr);
  const key = /^CLOCK_PRIVATE_KEY=(0x[0-9a-f]{64})$/m.exec(readFileSync(out, "utf8"))?.[1];
  assert.ok(key, "a key was written");
  assert.match(r.stdout, /address is 0x[0-9a-fA-F]{40}/);
  assert.ok(!r.stdout.includes(key.slice(2)), "the key itself is never printed");
  assert.equal(run("--warden-env", src, "--out", out, "--new-key").status, 1, "never replaces it");
});

test("--check reports the keys and writes nothing", () => {
  const { dir, src, out } = files();
  writeFileSync(out, clockEnv, { mode: 0o600 });
  const r = run("--warden-env", src, "--out", out, "--check");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /CLOCK_PRIVATE_KEY\s+set/);
  assert.deepEqual(readdirSync(dir).sort(), ["clock.env", "warden.env"]);
  assert.ok(!leaks(r.stdout + r.stderr));
  writeFileSync(src, wardenEnv + "MRO_DAY_SECONDS=60\n", { mode: 0o600 });
  const refused = run("--warden-env", src, "--out", out, "--check");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /MRO_DAY_SECONDS/);
});
