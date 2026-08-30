import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeCheckinTool } from "../src/mcp/tools/checkin.mjs";

function withToken({ keyId = "k1", lastDay = 100 } = {}) {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId, owner: "0xabc", lastDay, mintDay: 100 });
  return q;
}

/// The chain read must never be needed on the happy path. A stub that throws
/// proves the tool did not reach for it.
const noChainRead = { boundKeyOf: async () => { throw new Error("chain must not be read here"); } };

test("a bound caller checking in on a new day is credited", async () => {
  const q = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.accepted, true);
  assert.equal(r.creditedDay, 101);
});

test("a second check-in on the same day is refused, not credited twice", async () => {
  const q = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  const second = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(second.accepted, false);
  assert.equal(second.reason, "already-credited-today");
});

test("an unknown token is refused", async () => {
  const q = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.reason, "unknown-token");
});

test("100 simultaneous check-ins produce exactly one credit", async () => {
  const q = withToken();
  const tool = makeCheckinTool({ q, chain: noChainRead, today: () => 101 });
  const results = await Promise.all(
    Array.from({ length: 100 }, () => tool.handler({ tokenId: 1 }, { keyId: "k1" }))
  );
  assert.equal(results.filter((r) => r.accepted === true).length, 1);
  assert.equal(results.filter((r) => r.reason === "already-credited-today").length, 99);
});
