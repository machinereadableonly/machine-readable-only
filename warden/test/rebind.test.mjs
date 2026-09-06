import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeCheckinTool } from "../src/mcp/tools/checkin.mjs";
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";
import { openChain } from "./chain-stub.mjs";

// THE SECURITY CONTROL. A rebind may have been mined since the mirror was last
// reconciled, so a caller the mirror does not recognise gets ONE live chain
// read before being refused. Serving that answer from the mirror would lock a
// legitimately rebound agent out of its own token until the next Clock run.
test("a caller the mirror does not know is checked against the chain before refusal", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 100, mintDay: 100 });

  let chainWasRead = false;
  const chain = openChain({
    boundKeyOf: async (tokenId) => {
      chainWasRead = true;
      assert.equal(tokenId, 1);
      // The chain speaks bytes32, never the raw thumbprint -- the SAME
      // encoding checkin.mjs compares against via keyIdToBytes32. A real
      // chain read can never return the un-hashed key id, since the hash
      // is one-way.
      return keyIdToBytes32("new-key");   // the rebind is on chain but not yet mirrored
    },
  });

  const tool = makeCheckinTool({ q, chain, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "new-key" });

  assert.equal(chainWasRead, true, "the chain must be read before refusing");
  assert.equal(r.accepted, true, "a rebound caller must be admitted");
});

test("a caller neither the mirror nor the chain knows is refused", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const chain = openChain({ boundKeyOf: async () => keyIdToBytes32("old-key") });
  const tool = makeCheckinTool({ q, chain, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "stranger" });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "not-bound-to-caller");
});

// ---------------------------------------------------------------------------
// The same rule on the PAID tools -- test gap 39 / finding 5.M2
// ---------------------------------------------------------------------------

// The two tests above pin the chain re-check for `checkin`, and nothing drove
// `upgrade` or `seed` with a caller whose binding exists only on chain -- which
// is the case 5.M2 is about. It matters more on these two than on checkin: a
// rebound agent refused a check-in loses a day, and a rebound agent refused an
// upgrade is refused something it is about to PAY for.
//
// A rebind is a token-owner call that the Warden never sees. It lands on chain
// and reaches the mirror only at the next Clock run, so between those two
// moments the mirror's `keyId` is stale by design.

test("upgrade admits a caller whose binding exists only on chain", async () => {
  const { makeUpgradeTool } = await import("../src/mcp/tools/upgrade.mjs");
  const { LADDER } = await import("../src/mcp/ladder.mjs");
  const { settleNow } = await import("./paid-stub.mjs");

  const q = queries(openDb(":memory:"));
  // Whole, on a long run, so every gate but the binding is satisfied.
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 100, mintDay: 100, level: 365, streak: 400 });

  let chainWasRead = false;
  const chain = openChain({
    boundKeyOf: async (tokenId) => {
      chainWasRead = true;
      assert.equal(tokenId, 1);
      return keyIdToBytes32("new-key");    // the rebind is on chain, not yet mirrored
    },
  });

  const tool = makeUpgradeTool({ q, chain, catalogue: LADDER, paid: settleNow });
  const r = await tool.handler({ tokenId: 1, upgradeId: 1, variant: 0 }, { keyId: "new-key" });

  assert.equal(chainWasRead, true, "the chain must be read before refusing a caller the mirror does not know");
  assert.notEqual(
    r.reason, "not-bound-to-caller",
    "a rebound agent must not be refused something it is about to pay for",
  );
});

test("seed admits a caller whose binding exists only on chain", async () => {
  const { makeSeedTool } = await import("../src/mcp/tools/seed.mjs");

  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 100, mintDay: 100, level: 365, streak: 400 });

  let chainWasRead = false;
  const chain = openChain({
    boundKeyOf: async () => { chainWasRead = true; return keyIdToBytes32("new-key"); },
  });

  const tool = makeSeedTool({ q, chain, today: () => 101 });
  const r = await tool.handler({ parentId: 1, to: "0x" + "a1".repeat(20) }, { keyId: "new-key" });

  assert.equal(chainWasRead, true, "the chain must be read before refusing");
  // seed refuses everything today (`seed-not-available`, the write path does
  // not exist), so the assertion is that it does NOT refuse for the wrong
  // reason -- getting past the binding is the thing being tested.
  assert.notEqual(r.reason, "not-bound-to-caller", "the binding must be judged by the chain, not the mirror");
});

// The other direction, which is the security half: a caller the MIRROR still
// trusts but the CHAIN has rebound away must be refused. A stale mirror must
// not keep letting the previous key spend the token's Marks.
test("upgrade refuses a caller the chain has rebound AWAY from, even while the mirror still trusts it", async () => {
  const { makeUpgradeTool } = await import("../src/mcp/tools/upgrade.mjs");
  const { LADDER } = await import("../src/mcp/ladder.mjs");
  const { settleNow } = await import("./paid-stub.mjs");

  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 100, mintDay: 100, level: 365, streak: 400 });

  const chain = openChain({ boundKeyOf: async () => keyIdToBytes32("somebody-else") });
  const tool = makeUpgradeTool({ q, chain, catalogue: LADDER, paid: settleNow });

  const r = await tool.handler({ tokenId: 1, upgradeId: 1, variant: 0 }, { keyId: "old-key" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-bound-to-caller", "the chain is the authority, in both directions");
});
