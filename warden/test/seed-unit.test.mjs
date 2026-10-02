// The seed unit's guard is configuration, so nothing else would notice it
// being dropped from the command line.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const unit = read("../deploy/mro-seed.service");
const env = read("../deploy/mro-seed.env.example");
const installer = read("../deploy/install-seed-agent.sh");

test("every seed ExecStart ends with the not-before guard", () => {
  const lines = unit.split("\n").filter((l) => /^#?\s*ExecStart=/.test(l));
  assert.equal(lines.length, 2, "the live line and the commented npx line");
  for (const l of lines) assert.match(l.trimEnd(), / --not-before \$\{MRO_SEED_NOT_BEFORE\}$/);
});

test("the schema ships the guard empty, so an unset day fails the unit", () => {
  assert.match(env, /^MRO_SEED_NOT_BEFORE=$/m);
});

test("the installer writes a rehearsal day and refuses it for a real token", () => {
  assert.match(installer, /^REHEARSAL_NOT_BEFORE=2000-01-01$/m);
  assert.match(installer, /opening day \+ 2/);
});
