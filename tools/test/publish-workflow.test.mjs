// The workflow that stages mro-agent holds the one credential that can put
// code in front of every agent. These pin how narrowly it is granted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const text = readFileSync(new URL("../../.github/workflows/publish-client.yml", import.meta.url), "utf8");
const jobsAt = text.indexOf("\njobs:");
const stageAt = text.indexOf("\n  stage:");

test("only the stage job can mint the publish credential", () => {
  const grant = /^\s*id-token:\s*write\s*$/gm;
  assert.equal((text.match(grant) ?? []).length, 1);
  const at = text.search(/^\s*id-token:\s*write\s*$/m);
  assert.ok(stageAt > jobsAt && at > stageAt, "id-token is granted inside the stage job, not workflow-wide");
});

test("every action is pinned to a commit, and npm to a version", () => {
  const uses = [...text.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(uses.length > 0);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} is not pinned to a commit`);
  assert.doesNotMatch(text, /npm@latest/);
  assert.match(text, /npm install -g npm@\d+\.\d+\.\d+\b/);
});

test("no dependency's install script runs", () => {
  const installs = [...text.matchAll(/npm ci[^\n]*/g)].map((m) => m[0]);
  assert.ok(installs.length > 0);
  for (const line of installs) assert.match(line, /--ignore-scripts/, line);
});
