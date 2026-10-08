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
    // THREE SHAPES, not one. `reason: "x"` in an object literal is the common
    // one, and the only one this saw until 2026-09-19 -- so it was blind to
    // `reason = "x"` (how the door assigns its own) and to `fail("x")`. It
    // read 28 of the 32 literals in the tree and reported a clean sweep, which
    // is exactly what a guard that cannot see the failure looks like.
    for (const m of src.matchAll(/reason["']?\s*[:=,]\s*["']([a-z][a-z-]*)["']/g)) emitted.add(m[1]);
    for (const m of src.matchAll(/fail\(["']([a-z][a-z-]*)["']/g)) emitted.add(m[1]);
  }

  // AND THE ONES NO SCAN CAN SEE, because they are computed rather than
  // written: `reason = timeReason(request) ?? "signature"` yields these three
  // and a regex will never find them. Listed by hand BECAUSE they are
  // invisible -- the list is short, it is commented at the site that produces
  // them, and leaving them out would mean the door's commonest refusals were
  // the ones this never checked.
  for (const computed of ["signature", "clock-skew", "expired"]) emitted.add(computed);

  // A FLOOR THAT RATCHETS. The old `> 20` passed comfortably while four
  // reasons were invisible; this is set just under what the broadened scan
  // actually finds, so losing sight of the surface fails here rather than
  // quietly reducing what is checked.
  assert.ok(emitted.size >= 32, `expected the whole surface, parsed ${emitted.size}`);

  const undocumented = [...emitted].filter((r) => !documented.has(r)).sort();
  assert.deepEqual(undocumented, [], "the service sends a refusal no published page explains");
});

test("the protocol copy inside the skill is the protocol document", () => {
  const original = readFileSync(join(root, "docs/2026-09-01-mro-raw-protocol.md"), "utf8");
  const copy = readFileSync(join(skill, "references/raw-protocol.md"), "utf8");
  assert.equal(copy, original, "re-copy docs/2026-09-01-mro-raw-protocol.md into the skill");
});

// A remedy that names the WRONG components is worse than none: the agent does
// exactly what it is told and is refused again, with no way to tell that the
// instruction was the problem. The lists live in one place each in the door, so
// the row is pinned to them rather than to a number somebody has to remember.
//
// TWO lists, because the door enforces two: RFC 9421's set in verify.mjs, and
// the challenge pair in middleware.mjs, which is the door's own mechanism
// rather than the standard's. A test reading only the first passed while the
// remedy omitted the pair.
function doorComponents() {
  const named = (file, decl) => {
    const src = readFileSync(join(root, file), "utf8");
    const declared = src.match(new RegExp(`^(?:export )?const ${decl} = \\[(.*)\\];$`, "m"));
    assert.ok(declared, `${file} no longer declares ${decl} where this test reads it`);
    return [...declared[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };
  return [
    ...named("warden/src/door/verify.mjs", "REQUIRED"),
    ...named("warden/src/door/middleware.mjs", "BOUND_COMPONENTS"),
  ];
}

test("the `components` remedy names exactly the components the door requires", () => {
  const required = doorComponents();
  assert.ok(required.length >= 7, `parsed only ${required.length} required components`);

  const doc = readFileSync(join(skill, "references/refusals.md"), "utf8");
  const row = doc.split("\n").find((line) => line.startsWith("| `components` |"));
  assert.ok(row, "refusals.md no longer has a `components` row");

  const named = [...row.split("|")[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  assert.deepEqual(named.sort(), [...required].sort(), "the remedy and the door disagree");
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

// THE ANSWERS BECOME THE BORDER. Every surface an agent reads says so, says the
// rule is published the next night, that silence and the mint day are coin
// flips, and how to check it -- and none of them states the rule itself.
test("every agent-facing surface says the answers become the border, and how to check it", () => {
  const surfaces = {
    "llms.txt": readFileSync(join(root, "warden/public/llms.txt"), "utf8"),
    "SKILL.md": readFileSync(join(skill, "SKILL.md"), "utf8"),
    "raw protocol": readFileSync(join(root, "docs/2026-09-01-mro-raw-protocol.md"), "utf8"),
  };
  for (const [name, text] of Object.entries(surfaces)) {
    const flat = text.replace(/\s+/g, " ");
    assert.match(flat, /Your answers become the border\./, `${name}: the heading sentence`);
    assert.match(flat, /From your 122nd credited day a band appears round the code/, `${name}: when the band appears`);
    assert.match(flat, /secret on the day, the same for every token, and different every day/, `${name}: the rule's three properties`);
    assert.match(flat, /The next night the rule for that day is published on chain/, `${name}: when it is published`);
    assert.match(flat, /verify-border <tokenId> --contract <address>/, `${name}: the verifier`);
    assert.match(flat, /The whole year's rules were fixed before the door opened/, `${name}: the commitment`);
    assert.match(flat, /when token 1 finishes it is given Aorta, the Mark every finisher after the 64th receives, and takes no place/, `${name}: token 1`);
    assert.match(flat, /placed lowest token id first|placed by lowest token id/, `${name}: the same-day order`);
    assert.doesNotMatch(flat, /beat --not-before/, `${name}: the old client-side promise is gone`);
    assert.match(flat, /A day with no answer is a coin flip, and so is your mint day, which has no question\./, `${name}: the coin flips`);
    assert.doesNotMatch(flat, /keccak|floor\(n \/ 2\)/i, `${name}: the rule itself is never stated`);
  }
});
