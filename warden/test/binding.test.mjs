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
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
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

// OPENING A DATABASE THAT PREDATES THE COLUMN. This is the case every test in
// this project structurally could not reach, because they all open ":memory:"
// -- a fresh database, where CREATE TABLE has already made every column and no
// migration has anything to do.
//
// It took the live Warden down on 2026-09-05. schema.sql is exec'd WHOLE before
// migrate() runs, so an index there naming a migrated column threw "no such
// column: keyIdHash" against the production mirror and the process crash-looped.
//
// The database is built here the way a real old one is: the CURRENT schema with
// the new column and index stripped out, which is exactly what the file looked
// like before this change.
test("a mirror created before the new columns existed opens, migrates and works", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE keys (keyId TEXT PRIMARY KEY, jwk TEXT NOT NULL, directory TEXT, registeredAt INTEGER NOT NULL);
    CREATE TABLE tokens (tokenId INTEGER PRIMARY KEY, keyId TEXT NOT NULL, owner TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1, streak INTEGER NOT NULL DEFAULT 1, lastDay INTEGER NOT NULL,
      mintDay INTEGER NOT NULL, marks INTEGER NOT NULL DEFAULT 0, generation INTEGER NOT NULL DEFAULT 0,
      parentId INTEGER, status TEXT NOT NULL DEFAULT 'queued');
    CREATE TABLE credits (tokenId INTEGER NOT NULL, day INTEGER NOT NULL, sigHash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued');
    CREATE TABLE mark_orders (tokenId INTEGER NOT NULL, upgradeId INTEGER NOT NULL, paymentTx TEXT,
      status TEXT NOT NULL DEFAULT 'queued');
    CREATE TABLE mints (tokenId INTEGER PRIMARY KEY, toAddress TEXT NOT NULL, keyId TEXT NOT NULL,
      paymentTx TEXT, qr TEXT, solveState TEXT NOT NULL DEFAULT 'pending',
      solveTries INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued');
    INSERT INTO keys VALUES ('${SELLER}', '{}', NULL, 1);
    INSERT INTO tokens (tokenId, keyId, owner, lastDay, mintDay) VALUES (7, '${SELLER}', '0xseller', 100, 100);
  `);

  // THE LINE THAT CRASHED PRODUCTION. Reverting the schema/migrate split makes
  // this throw, exactly as the live Warden did.
  db.exec(readFileSync(new URL("../src/mirror/schema.sql", import.meta.url), "utf8"));
  migrate(db);

  const q = queries(db);
  assert.equal(q.keyForHash(keyIdToBytes32(SELLER)), SELLER, "the old key was backfilled");
  // And the rest of the new surface works on the upgraded database.
  q.insertMint({ tokenId: 8, toAddress: "0xa", keyId: SELLER, payNonce: "0xn" });
  assert.equal(q.settleByNonce("0xn", "0xtx").kind, "mint");
  // A row written BEFORE these columns existed has no payNonce, and must never
  // be swept as an expired reservation -- that would delete real history.
  assert.deepEqual(q.dropExpiredReservations(Date.now() + 1), { mints: 0, marks: 0 });

  // The USED key on an upgraded mirror must survive the prune. The old code
  // recorded no usage at all, so without the backfill every pre-existing key
  // reads as never-used and the first sweep deletes the lot -- including keys
  // bound to tokens on chain.
  assert.equal(q.pruneUnusedKeys(Date.now()), 0, "a key that owns a token must not be pruned");
  assert.equal(q.getKey(SELLER).keyId, SELLER);
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

  // THE OTHER HALF OF 14.3 IS NOW CLOSED (5.M2, 2026-09-06). This used to
  // record `ok: false` as "what the buyer actually gets today": the mirror's
  // own first check refused an unrecognised caller BEFORE any chain read, so
  // only the mirror converging let the buyer in, and until the next Clock run
  // it was refused something it was about to pay for. upgrade and seed now ask
  // the chain before refusing, exactly as checkin already did.
  assert.equal(r.ok, true, "the chain names this caller, so the stale mirror must not refuse it");

  // And it still works once the Clock has applied the Rebound and the mirror
  // agrees -- the two halves must not disagree with each other.
  q.insertKey({ keyId: BUYER, jwk: jwk(BUYER), directory: null, registeredAt: 2 });
  applyEvents(q, [ev("Rebound", { tokenId: 7n, newKeyId: keyIdToBytes32(BUYER) })], { log: () => {} });
  const after = await tool.handler({ tokenId: 7, upgradeId: 8 }, { keyId: BUYER });
  // Break is already reserved by the call above, so the second one is refused
  // for that reason and NOT for the binding -- which is the thing under test.
  assert.notEqual(after.reason, "not-bound-to-caller", "the buyer stays admitted once the mirror agrees");
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
