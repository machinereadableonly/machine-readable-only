// Every tool answers with `ok`. No exceptions, because a convention with an
// exception is a table a client has to learn.
//
// Found on 2026-09-03 by the first end-to-end run: `checkin` answered with
// `accepted` alone and carried no `ok` at all, so a client branching on `ok`
// -- the only contract llms.txt states -- read every successful daily check-in
// as a failure. That is the one call every participant makes for 365 days.
//
// `upgrade` returned BOTH, which is what hid it when reading the source.
import test from "node:test";
import assert from "node:assert/strict";

import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { openChain } from "./chain-stub.mjs";

import { makeChallengeTool } from "../src/mcp/tools/challenge.mjs";
import { makeStatusTool } from "../src/mcp/tools/status.mjs";
import { makeLadderTool } from "../src/mcp/tools/ladder.mjs";
import { makeCheckinTool } from "../src/mcp/tools/checkin.mjs";
import { makeRebindTool } from "../src/mcp/tools/rebind.mjs";
import { makeRestTool } from "../src/mcp/tools/rest.mjs";

const CONTRACT = "0x" + "a".repeat(40);
const ctx = { keyId: "k1", sigHash: "sig" };

/// The tools that need no payment and no chain write to answer. The paid ones
/// (mint, upgrade, seed) already return `ok` on every path; these are the ones
/// a client meets first and the ones the convention was broken in.
function freeTools(q) {
  return [
    ["challenge", makeChallengeTool({ challengeSecret: "s".repeat(32), domain: "example.com" }), {}],
    ["status", makeStatusTool({ q }), {}],
    ["ladder", makeLadderTool({ q, chain: openChain() }), { tokenId: 1 }],
    ["checkin", makeCheckinTool({ q, chain: openChain(), today: () => 100 }), { tokenId: 1 }],
    ["rebind", makeRebindTool({ q, contract: CONTRACT }), { tokenId: 1 }],
    ["rest", makeRestTool({ q, contract: CONTRACT }), { tokenId: 1 }],
  ];
}

test("every free tool answers with `ok`, on an empty mirror", async () => {
  const q = queries(openDb(":memory:"));
  for (const [name, tool, args] of freeTools(q)) {
    const r = await tool.handler(args, ctx);
    assert.equal(typeof r.ok, "boolean", `${name} must answer with a boolean ok, got ${JSON.stringify(r)}`);
  }
});

test("a check-in answers with `ok` on the refusal AND on the success", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0x" + "1".repeat(40), lastDay: 99, mintDay: 99 });
  const tool = makeCheckinTool({ q, chain: openChain(), today: () => 100 });

  const good = await tool.handler({ tokenId: 1 }, ctx);
  assert.equal(good.ok, true, "a credited day is ok:true, not merely accepted:true");
  assert.equal(good.accepted, true, "accepted stays, so anything reading it still works");

  // The same day again: refused, and the refusal says so in both words.
  const again = await tool.handler({ tokenId: 1 }, ctx);
  assert.equal(again.ok, false);
  assert.equal(again.accepted, false);
  assert.equal(again.reason, "already-credited-today");
});
