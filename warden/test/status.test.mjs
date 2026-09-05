import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeStatusTool } from "../src/mcp/tools/status.mjs";
import { openChain } from "./chain-stub.mjs";

test("status with a tokenId returns that token's view", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 5, mintDay: 0 });
  const tool = makeStatusTool({ q, chain: openChain() });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.tokenId, 1);
  assert.equal(r.lastDay, 5);
  assert.equal(r.owner, "0xabc");
});

test("status with an id the CHAIN does not have either is unknown-token", async () => {
  const q = queries(openDb(":memory:"));
  const chain = openChain({ lifecycleOf: async () => ({ exists: false, resting: false, sunset: false, level: 0, lastDay: 0 }) });
  const tool = makeStatusTool({ q, chain });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-token");
});

// C3.7. A mirror miss is not an absence. This service can be behind the chain
// -- a token minted straight on chain, or one whose reconcile has not run --
// and telling the holder of a real token that it does not exist is the shape
// of bug that makes an agent report the piece as broken and stop.
test("status distinguishes a token the chain HAS from one that does not exist", async () => {
  const q = queries(openDb(":memory:"));
  const tool = makeStatusTool({ q, chain: openChain() });   // stub: the chain has it
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-yet-mirrored");
});

test("status refuses rather than guesses when the chain cannot be read", async () => {
  const q = queries(openDb(":memory:"));
  const chain = openChain({ lifecycleOf: async () => null });
  const tool = makeStatusTool({ q, chain });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.reason, "chain-unavailable");
});

test("CONTROL: status with no tokenId returns only tokens bound to the caller's key", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  q.insertToken({ tokenId: 2, keyId: "k2", owner: "0xdef", lastDay: 0, mintDay: 0 });
  const tool = makeStatusTool({ q, chain: openChain() });
  const r = await tool.handler({}, { keyId: "k1" });

  assert.equal(r.ok, true);
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].tokenId, 1);
  // The other agent's token must never appear here, whatever its shape --
  // this is the assertion that would catch a status tool leaking another
  // agent's holdings.
  assert.ok(!r.tokens.some((t) => t.tokenId === 2));
});
