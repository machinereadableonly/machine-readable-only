import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeStatusTool } from "../src/mcp/tools/status.mjs";

test("status with a tokenId returns that token's view", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 5, mintDay: 0 });
  const tool = makeStatusTool({ q });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.tokenId, 1);
  assert.equal(r.lastDay, 5);
  assert.equal(r.owner, "0xabc");
});

test("status with an unknown tokenId is refused", async () => {
  const q = queries(openDb(":memory:"));
  const tool = makeStatusTool({ q });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-token");
});

test("CONTROL: status with no tokenId returns only tokens bound to the caller's key", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  q.insertToken({ tokenId: 2, keyId: "k2", owner: "0xdef", lastDay: 0, mintDay: 0 });
  const tool = makeStatusTool({ q });
  const r = await tool.handler({}, { keyId: "k1" });

  assert.equal(r.ok, true);
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].tokenId, 1);
  // The other agent's token must never appear here, whatever its shape --
  // this is the assertion that would catch a status tool leaking another
  // agent's holdings.
  assert.ok(!r.tokens.some((t) => t.tokenId === 2));
});
