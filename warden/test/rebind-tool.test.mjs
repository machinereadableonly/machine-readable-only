import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeRebindTool } from "../src/mcp/tools/rebind.mjs";
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";

test("rebinding an unknown token is refused", async () => {
  const q = queries(openDb(":memory:"));
  const tool = makeRebindTool({ q, contract: "0xcontract" });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-token");
});

test("CONTROL: rebind returns the unsigned call, with args[1] the SAME encoding keyIdToBytes32 produces", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 0, mintDay: 0 });

  // No chain reader is supplied at all: this tool must never need one to do
  // its job, because it submits nothing -- it only describes a call for the
  // token owner's own wallet to sign.
  const tool = makeRebindTool({ q, contract: "0xcontract" });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "new-key" });

  assert.equal(r.ok, true);
  assert.equal(r.contract, "0xcontract");
  assert.equal(r.function, "rebind");
  assert.equal(r.args[0], 1);
  // Assert against the converter itself, not a hardcoded hash, so this test
  // stays correct if the hashing scheme ever changes.
  assert.equal(r.args[1], keyIdToBytes32("new-key"));
});
