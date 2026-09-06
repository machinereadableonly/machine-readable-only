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
    ["status", makeStatusTool({ q, chain: openChain() }), {}],
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

// 5.L4. The spec requires a prompt-injection warning on "any field that echoes
// agent-supplied text". It sat on `rebind`, whose echoes are a positive integer
// and a hex string derived from a VERIFIED key id -- the one tool that could not
// carry prose -- and an annotation pointing at the safest surface reads as if it
// were the risky one. The requirement is met by the SCHEMAS: no tool accepts
// free-form text. This is what keeps that true.
test("no tool accepts free-form text, which is what makes the warning unnecessary", async () => {
  const { makeMcpHandler } = await import("../src/mcp/server.mjs");
  const { openDb } = await import("../src/mirror/db.mjs");
  const { queries } = await import("../src/mirror/queries.mjs");
  const { openChain } = await import("./chain-stub.mjs");
  const { envelope } = await import("./mcp-envelope.mjs");

  const { handler } = makeMcpHandler({
    q: queries(openDb(":memory:")), chain: openChain(), contract: "0xc", chainId: 84532,
  });
  const built = envelope({ method: "tools/list", params: {} });
  const req = new Request("https://example.com/mcp", { method: "POST", headers: built.headers, body: built.raw });
  const res = await handler.fetch(req, { authInfo: { token: "n/a", clientId: "k1", scopes: [], extra: { keyId: "k1" } } });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  const tools = JSON.parse(line ? line.slice("data: ".length) : text).result.tools;

  assert.ok(tools.length >= 9, `expected the whole surface, saw ${tools.length}`);
  for (const tool of tools) {
    for (const [field, schema] of Object.entries(tool.inputSchema?.properties ?? {})) {
      if (schema.type !== "string") continue;
      // A string field is allowed ONLY if it is pattern-bounded -- the `to`
      // address is the one that exists. An unbounded string is where prose gets
      // in, and it is the day the warning has to be written.
      assert.ok(
        typeof schema.pattern === "string" && schema.pattern.length > 0,
        `${tool.name}.${field} is an unbounded string: it can carry prose, so it needs the injection warning`
      );
    }
  }
});
