import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeRestTool } from "../src/mcp/tools/rest.mjs";

test("resting an unknown token is refused", async () => {
  const q = queries(openDb(":memory:"));
  const tool = makeRestTool({ q, contract: "0xcontract" });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-token");
});

test("CONTROL: rest returns the unsigned, irreversible call", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  const tool = makeRestTool({ q, contract: "0xcontract" });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });

  assert.equal(r.ok, true);
  assert.equal(r.contract, "0xcontract");
  assert.equal(r.function, "rest");
  assert.deepEqual(r.args, [1]);
  assert.equal(r.irreversible, true);
});
