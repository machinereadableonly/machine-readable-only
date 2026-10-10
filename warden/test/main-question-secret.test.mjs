// The Warden refuses to start without its own question secret, or with one
// equal to the door's, before it reads anything else.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const MAIN = fileURLToPath(new URL("../src/main.mjs", import.meta.url));

function boot(extra) {
  const env = { PATH: process.env.PATH, MRO_DOMAIN: "example.com", CHALLENGE_SECRET: "door-secret", ...extra };
  return spawnSync(process.execPath, [MAIN], { env, encoding: "utf8", timeout: 20_000 });
}

test("a Warden with no QUESTION_SECRET refuses to start, naming it", () => {
  const r = boot({});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /QUESTION_SECRET/);
});

test("a QUESTION_SECRET equal to CHALLENGE_SECRET is refused", () => {
  const r = boot({ QUESTION_SECRET: "door-secret" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /QUESTION_SECRET must differ from CHALLENGE_SECRET/);
});

test("a distinct QUESTION_SECRET gets past both checks to the next setting", () => {
  const r = boot({ QUESTION_SECRET: "question-secret" });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /QUESTION_SECRET/);
  assert.match(r.stderr, /BASE_RPC_URL/);
});
