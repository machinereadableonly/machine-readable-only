// The words the piece says when it says no, and on the day after mint.
//
// C3.7, C3.8, C3.10. Three findings with one root: every surface an agent
// meets was a correct diagnosis with no prescription. These tests pin the
// prescriptions, and one of them pins COMPLETENESS -- a refusal added later
// without a next step fails the suite rather than shipping a dead end, which
// is the only version of this that survives the next person to add a tool.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { NEXT, NO_NEXT, withNext, onChainBy } from "../src/mcp/nextSteps.mjs";
import { makeCheckinTool, utcDay } from "../src/mcp/tools/checkin.mjs";
import { tokenView } from "../src/mcp/tokenView.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { openChain } from "./chain-stub.mjs";

const src = fileURLToPath(new URL("../src/", import.meta.url));

function sources(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (entry.endsWith(".mjs")) found.push(readFileSync(path, "utf8"));
  }
  return found;
}

// -- C3.7 -------------------------------------------------------------------

test("every reason the service can emit is answered or deliberately silent", () => {
  const text = sources(src).join("\n");
  const emitted = new Set([...text.matchAll(/reason: *"([a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(emitted.size > 20, `expected the real set, found ${emitted.size}`);

  const orphans = [...emitted].filter((r) => !NEXT[r] && !NO_NEXT.has(r));
  assert.deepEqual(orphans, [], "a refusal with no next step and no decision to omit one");
});

test("nothing is listed in both tables, which would hide a decision", () => {
  const both = Object.keys(NEXT).filter((r) => NO_NEXT.has(r));
  assert.deepEqual(both, []);
});

test("a next step is added to a refusal, and never to an answer", () => {
  const refused = withNext({ ok: false, reason: "resting" });
  assert.match(refused.next, /sealed by its owner/);

  // An answer is untouched, whatever it happens to contain.
  const fine = { ok: true, reason: "resting" };
  assert.equal(withNext(fine).next, undefined);
  // A tool that says something more specific keeps it.
  assert.equal(withNext({ ok: false, reason: "resting", next: "mine" }).next, "mine");
  // An unknown reason is passed through rather than given an empty string.
  assert.equal(withNext({ ok: false, reason: "signature" }).next, undefined);
});

// -- C3.8 -------------------------------------------------------------------

/// A token that checked in yesterday, so today's call credits and continues.
function withToken({ level, streak, lastDay }) {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay, mintDay: 0 });
  q.creditDay(1, lastDay, level, streak);
  return q;
}

test("the daily reply says when the day lands, what the deadline is, and what is next", async () => {
  const day = 500;
  const q = withToken({ level: 6, streak: 6, lastDay: day - 1 });
  const tool = makeCheckinTool({ q, chain: openChain(), today: () => day });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1", sigHash: "s" });

  assert.equal(r.ok, true);
  assert.equal(r.streak, 7);
  assert.equal(r.heart, "7/365");
  assert.equal(r.onChainBy, onChainBy(day));
  // The end of TOMORROW: a run survives a check-in any time before then.
  assert.equal(r.streakDeadline, new Date((day + 2) * 86_400_000).toISOString());
  // 7 is a rung, so the next one is 30.
  assert.deepEqual(r.nextRung, { at: 30, daysAway: 23 });
  assert.equal(r.runBroke, undefined);
  assert.match(r.note, /Day 7 credited/);
  assert.match(r.note, /Your run is 7/);
});

// The one thing the copy makes matter -- "Miss a day and the run restarts at
// one" -- was never announced by the only tool that knew it had happened.
test("a broken run is named, with what it was, rather than silently reported as 1", async () => {
  const day = 500;
  const q = withToken({ level: 98, streak: 99, lastDay: day - 5 });
  const tool = makeCheckinTool({ q, chain: openChain(), today: () => day });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1", sigHash: "s" });

  assert.equal(r.streak, 1);
  assert.deepEqual(r.runBroke, { was: 99, lastCreditedDay: day - 5 });
  assert.match(r.note, /Your run of 99 ended/);
  assert.match(r.note, /the 99 days are kept, the colour restarts/);
  assert.deepEqual(r.nextRung, { at: 3, daysAway: 2 });
});

test("a run past the last rung is told there is nothing further to reach", async () => {
  const day = 500;
  const q = withToken({ level: 200, streak: 200, lastDay: day - 1 });
  const tool = makeCheckinTool({ q, chain: openChain(), today: () => day });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1", sigHash: "s" });
  assert.equal(r.nextRung, null);
});

test("a second call the same day learns when the first one lands", async () => {
  const day = 500;
  const q = withToken({ level: 6, streak: 6, lastDay: day });
  const tool = makeCheckinTool({ q, chain: openChain(), today: () => day });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1", sigHash: "s" });

  assert.equal(r.reason, "already-credited-today");
  assert.equal(r.onChainBy, onChainBy(day));
});

// -- C3.10 ------------------------------------------------------------------

test("a pending token says by when, and whether that time has passed", () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const due = Date.parse(onChainBy(100));
  const early = tokenView(q, 1, null, due - 1000);
  assert.equal(early.pendingOnChain, true);
  assert.equal(early.onChainBy, onChainBy(100));
  assert.equal(early.late, false, "before 00:05 the promise is simply outstanding");

  // The Clock can skip a night on purpose, so `late` is a real state and not a
  // fault -- but an agent reading `pendingOnChain` on day three could not tell
  // "runs tonight" from "has not run for three nights" without it.
  const overdue = tokenView(q, 1, null, due + 1000);
  assert.equal(overdue.late, true);
});

test("a written token carries no promise at all, rather than a stale one", () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  q.markMintWritten(1);   // the Clock's own setter: marks the mint AND the token

  const view = tokenView(q, 1);
  // Not vacuous: the row really did reach 'written', so the absence below is
  // the branch under test and not an empty object.
  assert.equal(view.pendingOnChain, false, "the row must actually be written");
  assert.equal("onChainBy" in view, false);
  assert.equal("late" in view, false);
});

test("mint, checkin and the token view all promise the SAME moment", async () => {
  const day = utcDay();
  // Three copies of one formula is how they come to disagree; there is one.
  assert.equal(onChainBy(day), new Date((day + 1) * 86_400_000 + 300_000).toISOString());
});
