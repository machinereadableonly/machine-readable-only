import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeCheckinTool } from "../src/mcp/tools/checkin.mjs";
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";

// THE SECURITY CONTROL. A rebind may have been mined since the mirror was last
// reconciled, so a caller the mirror does not recognise gets ONE live chain
// read before being refused. Serving that answer from the mirror would lock a
// legitimately rebound agent out of its own token until the next Clock run.
test("a caller the mirror does not know is checked against the chain before refusal", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 100, mintDay: 100 });

  let chainWasRead = false;
  const chain = {
    boundKeyOf: async (tokenId) => {
      chainWasRead = true;
      assert.equal(tokenId, 1);
      // The chain speaks bytes32, never the raw thumbprint -- the SAME
      // encoding checkin.mjs compares against via keyIdToBytes32. A real
      // chain read can never return the un-hashed key id, since the hash
      // is one-way.
      return keyIdToBytes32("new-key");   // the rebind is on chain but not yet mirrored
    },
  };

  const tool = makeCheckinTool({ q, chain, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "new-key" });

  assert.equal(chainWasRead, true, "the chain must be read before refusing");
  assert.equal(r.accepted, true, "a rebound caller must be admitted");
});

test("a caller neither the mirror nor the chain knows is refused", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "old-key", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const chain = { boundKeyOf: async () => keyIdToBytes32("old-key") };
  const tool = makeCheckinTool({ q, chain, today: () => 101 });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "stranger" });
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "not-bound-to-caller");
});
