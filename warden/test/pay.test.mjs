import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptContext } from "../src/pay/x402.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";

// THE BUG THIS PREVENTS. @x402/mcp 2.24.0 declares @modelcontextprotocol/sdk
// ^1.12.1, and its wrapper reads the payment as `extra?._meta` -- the v1 shape.
// Under the v2 server, _meta lives at ctx.mcpReq._meta. Without this adapter the
// wrapper finds nothing, decides no payment was made, and answers "payment
// required" forever, INCLUDING to an agent that has just paid.
test("the v2 context is adapted to the shape the payment wrapper reads", () => {
  const v2 = { mcpReq: { id: 1, method: "tools/call", _meta: { "x402/payment": { scheme: "exact" } } } };
  assert.deepEqual(adaptContext(v2)._meta, { "x402/payment": { scheme: "exact" } });
});

test("a context with no _meta adapts to undefined rather than throwing", () => {
  assert.equal(adaptContext({ mcpReq: { id: 1, method: "tools/call" } })._meta, undefined);
  assert.equal(adaptContext(undefined)._meta, undefined);
});

test("an upgrade gate is checked BEFORE payment is requested", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });

  let paymentWasRequested = false;
  const tool = makeUpgradeTool({
    q,
    catalogue: { 5: { name: "Halo", minLevel: 100, supply: 1000, sold: 0 } },
    paid: () => { paymentWasRequested = true; throw new Error("payment must not be requested"); },
  });

  // The token is at level 1; Halo needs 100. An agent must never be charged for
  // an upgrade it cannot have.
  const r = await tool.handler({ tokenId: 1, upgradeId: 5 }, { keyId: "k1" });
  assert.equal(paymentWasRequested, false);
  assert.equal(r.reason, "mark-level-too-low");
});

test("a sold-out mark is refused before payment", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const tool = makeUpgradeTool({
    q,
    catalogue: { 1: { name: "Vein", minLevel: 1, supply: 10, sold: 10 } },
    paid: () => { throw new Error("payment must not be requested"); },
  });
  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.reason, "mark-sold-out");
});
