// Token 1 is the house token: the contract gives it Aorta and no place, so only
// the operator's own agent may ever be minted as id 1.
import test from "node:test";
import assert from "node:assert/strict";

import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";
import { houseKeyIdFor } from "../src/mcp/houseToken.mjs";
import { openChain } from "./chain-stub.mjs";
import { settleNow } from "./paid-stub.mjs";

const TO = "0x" + "1".repeat(40);
const mintAs = async (keyId, houseKeyId) => {
  const db = openDb(":memory:");
  const q = queries(db);
  const tool = makeMintTool({ q, chain: openChain(), paid: settleNow, today: () => 100, alert: () => {}, houseKeyId });
  return tool.handler({ to: TO }, { keyId });
};

test("an agent's first mint is never id 1 once a house key is set", async () => {
  const r = await mintAs("agent", "house");
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.tokenId, 2);
});

test("the house key's mint takes id 1", async () => {
  const r = await mintAs("house", "house");
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.tokenId, 1);
});

test("with no house key set, ids start at 1 as before", async () => {
  const r = await mintAs("agent", null);
  assert.equal(r.tokenId, 1);
});

test("off Base Sepolia the Warden refuses to start without a house key", () => {
  assert.throws(() => houseKeyIdFor({}, 8453), /MRO_HOUSE_KEY_ID/);
  assert.equal(houseKeyIdFor({ MRO_HOUSE_KEY_ID: "abc" }, 8453), "abc");
  assert.equal(houseKeyIdFor({}, 84532), null);
});

// Agents may mint before the operator's own token does: the house mint must
// still be token 1, not the next id after theirs.
test("an agent already holds id 2; the house mint still takes id 1", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const tool = makeMintTool({ q, chain: openChain(), paid: settleNow, today: () => 100, alert: () => {}, houseKeyId: "house" });
  const agent = await tool.handler({ to: TO }, { keyId: "agent" });
  assert.equal(agent.tokenId, 2);
  const house = await tool.handler({ to: TO }, { keyId: "house" });
  assert.equal(house.ok, true, house.reason);
  assert.equal(house.tokenId, 1);
});
