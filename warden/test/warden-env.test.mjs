// D1: the Warden's own settings file carries only what the Warden's code reads.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { wardenSettings, buildWardenEnv, WARDEN_PATHS } from "../deploy/warden-env.mjs";

const { names, required } = wardenSettings();
const full = [
  "MRO_DOMAIN=example.com", "CHALLENGE_SECRET=c", "QUESTION_SECRET=q", "BASE_RPC_URL=https://rpc.example",
  "MRO_CONTRACT_ADDRESS=0x" + "11".repeat(20), "TREASURY_ADDRESS=0x" + "22".repeat(20), "MRO_CHAIN_ID=84532",
  "X402_FACILITATOR_URL=https://x402.org/facilitator", "STATE_DB_PATH=/srv/elsewhere/state.db",
  "CLOCK_CHECK_RPC_URL=https://other.example", "GH_TOKEN=not-the-wardens", "MRO_QUESTION_BANK=/tmp/bank.json",
].join("\n");

test("the names are read from the code: every requireEnv in main.mjs, nothing of the Clock's", () => {
  const main = readFileSync(new URL("../src/main.mjs", import.meta.url), "utf8");
  for (const m of main.matchAll(/requireEnv\("([A-Z_]+)"\)/g)) assert.ok(required.includes(m[1]), m[1]);
  assert.ok(names.includes("CDP_API_KEY_SECRET") && names.includes("MRO_OWNER_SAFE"));
  assert.ok(!names.includes("CLOCK_PRIVATE_KEY") && !names.includes("CLOCK_CHECK_RPC_URL"));
});

test("only the Warden's settings are copied, and the two paths are fixed", () => {
  const { text } = buildWardenEnv({ wardenEnvText: full, names, required });
  assert.match(text, /^QUESTION_SECRET=q$/m);
  assert.doesNotMatch(text, /GH_TOKEN|CLOCK_CHECK_RPC_URL/);
  assert.match(text, new RegExp(`^STATE_DB_PATH=${WARDEN_PATHS.stateDb}$`, "m"));
  assert.match(text, new RegExp(`^MRO_QUESTION_BANK=${WARDEN_PATHS.bank}$`, "m"));
  assert.doesNotMatch(text, /\/home\/someone|\/tmp\/bank/);
});

test("a missing required setting, a Clock key, or a doubled line is refused", () => {
  assert.throws(() => buildWardenEnv({ wardenEnvText: full.replace("QUESTION_SECRET=q", ""), names, required }), /QUESTION_SECRET is missing/);
  assert.throws(() => buildWardenEnv({ wardenEnvText: full + "\nCLOCK_PRIVATE_KEY=0xabc", names, required }), /belongs to the Clock/);
  assert.throws(() => buildWardenEnv({ wardenEnvText: full + "\nMRO_DOMAIN=two.example", names, required }), /more than once/);
});

test("the report names keys, never values", () => {
  const { report } = buildWardenEnv({ wardenEnvText: full, names, required });
  const said = report.join("\n");
  assert.ok(said.includes("GH_TOKEN"), "a dropped key is named");
  assert.ok(!said.includes("not-the-wardens") && !said.includes("https://rpc.example"));
});
