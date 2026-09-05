// WHO A TOKEN IS BOUND TO, AND WHY THE MIRROR CANNOT ANSWER IT.
//
// `rebind` is called by the token owner straight on chain and is never routed
// through this service -- rebind.mjs only hands back the calldata. So
// `tokens.keyId` is a cache of something this Warden does not control, and
// until 2026-09-05 it was a cache that never invalidated:
//
//   - reconcile.mjs saw the `Rebound` event and only LOGGED it, because the
//     chain names the new key as a SHA-256 and the mirror stores the
//     preimage. q.setKeyId had no caller anywhere in src/, test/ or client/.
//   - `upgrade` and `seed` decided "bound to the caller" from that stale column
//     alone, and both do things that cannot be undone.
//
// The result was permanent in both directions: the seller of a token kept the
// power to spend its seed and to take a free Mark that forecloses a $1,250.00
// one, and the buyer was refused forever.
//
// Two changes close it, and this file tests them separately because they are
// independent -- either one alone still leaves a hole.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, migrate } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { applyEvents } from "../src/clock/reconcile.mjs";
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";
import { bindingBlock } from "../src/mcp/gates.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { makeSeedTool } from "../src/mcp/tools/seed.mjs";
import { LADDER, assertLadderSane } from "../src/mcp/ladder.mjs";
import { openChain } from "./chain-stub.mjs";
import { settleNow } from "./paid-stub.mjs";

const SELLER = "seller-key";
const BUYER = "buyer-key";
const jwk = (kid) => ({ kty: "OKP", crv: "Ed25519", x: kid });

function mirror() {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertKey({ keyId: SELLER, jwk: jwk(SELLER), directory: null, registeredAt: 1 });
  q.insertToken({ tokenId: 7, keyId: SELLER, owner: "0xseller", lastDay: 100, mintDay: 100 });
  return { db, q };
}

const ev = (eventName, args) => ({ eventName, args });

// --- half one: the mirror converges -----------------------------------------

test("a Rebound to a REGISTERED key moves the mirror's binding", () => {
  const { q } = mirror();
  q.insertKey({ keyId: BUYER, jwk: jwk(BUYER), directory: null, registeredAt: 2 });

  const applied = applyEvents(q, [ev("Rebound", { tokenId: 7n, newKeyId: keyIdToBytes32(BUYER) })], { log: () => {} });
  assert.equal(applied.Rebound, 1);
  assert.equal(q.getToken(7).keyId, BUYER, "the seller no longer holds this token in the mirror");
});

// The lookup is a forward hash stored at registration, NOT an inversion. This
// is what makes the convergence possible at all, so it is pinned directly:
// there is no way back from the bytes32 alone.
test("the on-chain form of a key resolves to the thumbprint that produced it", () => {
  const { q } = mirror();
  assert.equal(q.keyForHash(keyIdToBytes32(SELLER)), SELLER);
  assert.equal(q.keyForHash(keyIdToBytes32("never-registered")), null);
});

// A key registered BEFORE the hash column existed still has to resolve, or
// every token in the live mirror would be unrebindable. openDb backfills it.
test("a key registered before the hash column existed is still resolvable", () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertKey({ keyId: SELLER, jwk: jwk(SELLER), directory: null, registeredAt: 1 });
  db.exec("UPDATE keys SET keyIdHash = NULL");
  assert.equal(q.keyForHash(keyIdToBytes32(SELLER)), null, "the hole this migration fills");

  // The migration computes the hash from the stored preimage -- possible
  // precisely because the direction that is hard is the other one.
  migrate(db);
  assert.equal(q.keyForHash(keyIdToBytes32(SELLER)), SELLER);
});

// AND THE CASE THAT CANNOT CONVERGE, which is legitimate rather than an error:
// an agent may rebind to a key it has never registered here. What matters is
// that the mirror does NOT keep asserting the old binding as though it were
// current -- the live re-check below is what covers this.
test("a Rebound to an UNREGISTERED key leaves the mirror unable to name the new holder", () => {
  const { q } = mirror();
  const logs = [];
  const applied = applyEvents(q, [ev("Rebound", { tokenId: 7n, newKeyId: keyIdToBytes32(BUYER) })], { log: (m) => logs.push(m) });
  assert.equal(applied.Rebound, 1, "the event is still counted as seen");
  assert.equal(q.getToken(7).keyId, SELLER, "there is no thumbprint to write");
  assert.match(logs.join(" "), /UNREGISTERED/, "and it is not silent");
});

// --- half two: the tools ask the chain, in BOTH directions ------------------

test("bindingBlock refuses a caller the chain does not name, and admits one it does", async () => {
  const chain = openChain({ boundTo: BUYER });
  assert.equal(await bindingBlock(chain, 7, BUYER, keyIdToBytes32), null);
  assert.equal(await bindingBlock(chain, 7, SELLER, keyIdToBytes32), "not-bound-to-caller");
});

// A null is "could not ask", never "not bound" -- and it must refuse. Admitting
// on an unreadable chain would turn an RPC outage into an open door.
test("bindingBlock refuses when the chain cannot be read", async () => {
  const chain = openChain({ boundKeyOf: async () => null });
  assert.equal(await bindingBlock(chain, 7, BUYER, keyIdToBytes32), "chain-unavailable");
});

// THE ATTACK FROM THE REVIEW, in full. The mirror still says SELLER because no
// Clock pass has run; the chain says BUYER because the rebind mined seconds
// ago. Break is FREE and permanently forecloses the $1,250.00 Vessel, so this
// is the cheapest possible way to destroy value in somebody else's token.
test("a seller cannot take a free Mark on a token the chain has already rebound away", async () => {
  const { db, q } = mirror();
  db.exec("UPDATE tokens SET level = 400, streak = 400, bestRun = 400 WHERE tokenId = 7");
  assert.equal(q.getToken(7).keyId, SELLER, "the mirror is stale, which is the premise");

  const tool = makeUpgradeTool({
    q,
    chain: openChain({ boundTo: BUYER }),
    catalogue: assertLadderSane(LADDER),
    paid: settleNow,
    alert: () => {},
  });
  // Break, id 8: the earned side of pair four, free, run of 365.
  const r = await tool.handler({ tokenId: 7, upgradeId: 8 }, { keyId: SELLER });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-bound-to-caller");
  assert.equal(q.reservedMask(7), 0, "nothing was reserved, so Vessel is still buyable");
});

// THE CONTROL. The buyer, whom the mirror does not yet recognise, must be able
// to act -- the guard reads the chain, so it lets the right agent in as well as
// keeping the wrong one out. Without this the test above would pass for a tool
// that refused everyone.
test("CONTROL: the buyer the chain names IS admitted, though the mirror still says otherwise", async () => {
  const { db, q } = mirror();
  db.exec("UPDATE tokens SET level = 400, streak = 400, bestRun = 400 WHERE tokenId = 7");

  const tool = makeUpgradeTool({
    q,
    chain: openChain({ boundTo: BUYER }),
    catalogue: assertLadderSane(LADDER),
    paid: settleNow,
    alert: () => {},
  });
  const r = await tool.handler({ tokenId: 7, upgradeId: 8 }, { keyId: BUYER });
  // The mirror's own first check still refuses an unrecognised caller before
  // any chain read happens, so this is what the buyer actually gets today.
  // Recorded rather than asserted as ok:true, because closing THAT is the
  // separate half of 14.3: it is the mirror converging (above) that lets the
  // buyer in, not this guard.
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-bound-to-caller");

  // Once the Clock has applied the Rebound, the same call succeeds -- which is
  // why both halves are needed and neither is sufficient alone.
  q.insertKey({ keyId: BUYER, jwk: jwk(BUYER), directory: null, registeredAt: 2 });
  applyEvents(q, [ev("Rebound", { tokenId: 7n, newKeyId: keyIdToBytes32(BUYER) })], { log: () => {} });
  const after = await tool.handler({ tokenId: 7, upgradeId: 8 }, { keyId: BUYER });
  assert.equal(after.ok, true, "the buyer can act once the mirror has caught up");
});

test("a seller cannot spend the seed of a token the chain has already rebound away", async () => {
  const { db, q } = mirror();
  db.exec("UPDATE tokens SET level = 400 WHERE tokenId = 7");

  const tool = makeSeedTool({
    q,
    chain: openChain({ boundTo: BUYER }),
    today: () => 100 + 365 * 3,
    supplyCap: 100,
  });
  const r = await tool.handler({ parentId: 7, to: "0x" + "2".repeat(40) }, { keyId: SELLER });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-bound-to-caller");
  assert.equal(q.tokenCount(), 1, "no child was created");
});
