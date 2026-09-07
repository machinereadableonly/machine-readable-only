// The token id a paid mint is promised must be one THE CHAIN will accept.
//
// Found on 2026-09-03 by the first paid mint this service ever took. The id
// came from `q.nextTokenId()`, which is the mirror's own max plus one. The
// mirror was empty and the contract already held token 1 from another route,
// so the mint was queued as id 1, the contract reverts TokenExists on it, and
// the money had already moved.
import test from "node:test";
import assert from "node:assert/strict";

import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";
import { makeSeedTool } from "../src/mcp/tools/seed.mjs";
import { openChain, takenIdsChain, unreadableChain } from "./chain-stub.mjs";
import { makeChainReader } from "../src/chain/read.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

/// Settlement that always succeeds, so these tests are about the id and
/// nothing else.
import { settleNow } from "./paid-stub.mjs";

const fresh = () => {
  const db = openDb(":memory:");
  return { db, q: queries(db) };
};

const mintTool = (q, chain, alert = () => {}) =>
  makeMintTool({ q, chain, paid: settleNow, supplyCap: 10, today: () => 100, alert });

test("a mint skips an id the chain already holds", async () => {
  const { db, q } = fresh();
  // The mirror is empty, so it proposes 1. The chain holds 1 and 2.
  assert.equal(q.nextTokenId(), 1);
  const tool = mintTool(q, takenIdsChain([1, 2]));

  const r = await tool.handler({ to: "0x" + "1".repeat(40) }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.equal(r.tokenId, 3, "the first id the chain does not hold");
  assert.equal(
    db.prepare("SELECT tokenId FROM mints").get().tokenId, 3,
    "the queued row carries the id that will actually land"
  );
});

test("a mint whose free id cannot be established refuses AFTER paying, and writes nothing", async () => {
  const { db, q } = fresh();
  const alerts = [];
  const tool = mintTool(q, unreadableChain(), (m) => alerts.push(m));

  const r = await tool.handler({ to: "0x" + "1".repeat(40) }, { keyId: "k1" });
  assert.equal(r.ok, false);
  // An unreadable chain is refused by the earlier gates too; what matters is
  // that no row is left behind claiming an id nobody checked.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0);
});

test("a seed skips a taken id the same way a mint does", async () => {
  const { db, q } = fresh();
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0x" + "1".repeat(40), lastDay: 100, mintDay: 100 - 365 });
  seedPaidMint(q, { tokenId: 1, toAddress: "0x" + "1".repeat(40), keyId: "k1" });
  db.exec("UPDATE tokens SET level = 365 WHERE tokenId = 1");

  const tool = makeSeedTool({ q, chain: takenIdsChain([2, 3]), today: () => 100, supplyCap: 10 });
  const r = await tool.handler({ parentId: 1, to: "0x" + "2".repeat(40) }, { keyId: "k1" });

  // UNCONDITIONAL, and that is the point. This assertion sat behind `if (r.ok)`
  // while `seed` refused every call, so it asserted NOTHING for as long as the
  // tool was unbuilt and said nothing when the tool came back. A guard that
  // goes quiet exactly when its subject stops working is not a guard.
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.tokenId, 4, "1 is the parent, 2 and 3 are taken on chain");
});

// The stub is only useful while it has the same shape as the thing it stands
// in for. This is the guard the previous drift did not have: adding a method
// to the real reader and forgetting the double made every tool test pass while
// production threw "chain.freeIdFrom is not a function".
test("the test double exposes exactly the real chain reader's surface", () => {
  const real = makeChainReader({ rpcUrl: "http://127.0.0.1:1", contract: "0x" + "0".repeat(40) });
  assert.deepEqual(
    Object.keys(openChain()).sort(),
    Object.keys(real).sort(),
    "openChain() and makeChainReader() must offer the same methods"
  );
});
