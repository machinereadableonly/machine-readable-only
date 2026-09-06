// The skill, checked against the things it claims.
//
// SKILL.md is the out-of-band channel: it is the only place an agent can learn
// the treasury from somewhere other than the server that quotes it. That makes
// it the one document in this repository whose drift is a money problem rather
// than a documentation problem, so it gets a test rather than a review habit.
//
// Two claims are checked here. That every refusal word the skill explains is a
// word the service can actually emit -- a prescription for a reason that no
// longer exists is worse than no prescription, because the agent trusts it.
// And that the protocol copy carried inside the skill is byte-identical to the
// one in docs/, because a copy nothing compares is a copy that has already
// drifted. See the stubs-hide-interface-drift note: regenerate and diff, never
// eyeball.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const skill = join(root, "skills/machine-readable-only");

/// Every .mjs file under a directory, so a new source file is covered without
/// anyone remembering to add it here.
function sources(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (entry.endsWith(".mjs")) found.push(readFileSync(path, "utf8"));
  }
  return found;
}

test("every refusal the skill explains is one the service can emit", () => {
  const doc = readFileSync(join(skill, "references/refusals.md"), "utf8");
  const service = sources(join(root, "warden/src")).join("\n");

  // The first cell of each table row, when it is a bare code span. That is the
  // reason column and nothing else in these tables has that shape.
  const reasons = [...doc.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
  assert.ok(reasons.length > 25, `expected the whole table, parsed ${reasons.length}`);

  const missing = reasons.filter((r) => !service.includes(`"${r}"`));
  assert.deepEqual(missing, [], "the skill promises a reason the service cannot send");
});

// 5.L2, THE OTHER DIRECTION, and it is the one that matters to an agent. The
// test above proves the skill promises nothing the service cannot send; it says
// nothing about a refusal the service DOES send and no page explains. Three
// were found that way (`wallet-cap-reached`, `internal`, `payment-unavailable`)
// and a fourth arrived later with the supply-cap gate -- so a check that only
// runs one way is a check that finds this class once.
//
// The CLOCK is excluded deliberately: its reasons (`send-failed`,
// `receipt-unknown`, `gas-estimate-too-large`, `unpackable-id` and the rest)
// are written to the mirror and read by the operator. No agent is ever handed
// one, and documenting them for agents would be documenting a surface they
// cannot reach.
test("every refusal an AGENT can be sent is one the skill explains", () => {
  const doc = readFileSync(join(skill, "references/refusals.md"), "utf8");
  const documented = new Set([...doc.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]));

  const agentFacing = [
    join(root, "warden/src/mcp"),
    join(root, "warden/src/door"),
    join(root, "warden/src/pay"),
  ].flatMap((dir) => sources(dir));
  agentFacing.push(readFileSync(join(root, "warden/src/server.mjs"), "utf8"));

  const emitted = new Set();
  for (const src of agentFacing) {
    for (const m of src.matchAll(/reason: "([a-z-]+)"/g)) emitted.add(m[1]);
  }
  assert.ok(emitted.size > 20, `expected the whole surface, parsed ${emitted.size}`);

  const undocumented = [...emitted].filter((r) => !documented.has(r)).sort();
  assert.deepEqual(undocumented, [], "the service sends a refusal no published page explains");
});

test("the protocol copy inside the skill is the protocol document", () => {
  const original = readFileSync(join(root, "docs/2026-09-01-mro-raw-protocol.md"), "utf8");
  const copy = readFileSync(join(skill, "references/raw-protocol.md"), "utf8");
  assert.equal(copy, original, "re-copy docs/2026-09-01-mro-raw-protocol.md into the skill");
});

test("the skill's frontmatter carries the four out-of-band values", () => {
  const body = readFileSync(join(skill, "SKILL.md"), "utf8");
  assert.ok(body.startsWith("---\n"), "frontmatter must open on the first line");

  const frontmatter = body.slice(4, body.indexOf("\n---", 4));
  for (const key of ["contract", "chain-id", "treasury", "package", "repository"]) {
    assert.match(frontmatter, new RegExp(`^  ${key}: `, "m"), `frontmatter is missing ${key}`);
  }
  // The description is the whole first impression: it is all an agent sees
  // until the skill is activated. 1,536 characters is the documented ceiling.
  const description = body.match(/^description: (.*)$/m)[1];
  assert.ok(description.length <= 1536, `description is ${description.length} characters`);
  assert.match(description, /machinereadableonly\.com/, "the description must name the site");
});

// The four values are placeholders on purpose: three of them do not exist yet
// (a mainnet contract, a real treasury, a published package). This test does
// not fail on them -- it fails if anyone SILENTLY removes the marker without
// putting a real value in its place, which is the way this file could ship
// pointing an agent's money somewhere unintended.
test("a pending value is either marked pending or a real value, never blank", () => {
  const body = readFileSync(join(skill, "SKILL.md"), "utf8");
  for (const [, value] of body.matchAll(/^  (?:contract|treasury|package|repository): "(.*)"$/gm)) {
    const real = /^0x[0-9a-fA-F]{40}$/.test(value) || /^[a-z0-9@./-]{3,}$/.test(value);
    assert.ok(
      value.startsWith("PENDING-BEFORE-MAINNET") || real,
      `frontmatter value ${JSON.stringify(value)} is neither pending nor plausible`
    );
  }
});
