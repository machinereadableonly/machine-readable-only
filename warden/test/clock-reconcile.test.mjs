// Reconcile, and the 10,000-block wall it has to page around.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvents, applyEvents, MAX_LOG_SPAN, DEPLOY_BLOCK } from "../src/clock/reconcile.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";

/// A node that records the windows it was asked for and returns nothing.
function recordingRpc(logsByRange = () => []) {
  const windows = [];
  return {
    windows,
    async getLogs({ fromBlock, toBlock }) {
      windows.push([fromBlock, toBlock]);
      return logsByRange(fromBlock, toBlock);
    },
  };
}

test("a span wider than the RPC allows is refused rather than attempted", async () => {
  const pub = recordingRpc();
  await assert.rejects(
    () => readEvents(pub, { contract: "0xabc", fromBlock: 0n, toBlock: 100n, span: MAX_LOG_SPAN + 1n }),
    /exceeds the 10000-block limit/
  );
  assert.equal(pub.windows.length, 0, "nothing was asked of the node");
});

// A day of Base is about 43,200 blocks. The whole point of this module.
test("a full day pages into windows the RPC will accept, with no gap and no overlap", async () => {
  const pub = recordingRpc();
  const from = 1_000_000n;
  const to = from + 43_200n;
  const { pages } = await readEvents(pub, { contract: "0xabc", fromBlock: from, toBlock: to });

  assert.equal(pages, 5, "43,200 blocks needs five 10,000-block pages");
  for (const [a, b] of pub.windows) {
    assert.ok(b - a < MAX_LOG_SPAN, `window ${a}..${b} is ${b - a + 1n} blocks, over the limit`);
  }
  // Contiguous: each window starts exactly where the last ended, plus one.
  for (let i = 1; i < pub.windows.length; i += 1) {
    assert.equal(pub.windows[i][0], pub.windows[i - 1][1] + 1n, "a block fell between two pages");
  }
  assert.equal(pub.windows[0][0], from, "the first block was not read");
  assert.equal(pub.windows.at(-1)[1], to, "the last block was not read");
});

test("a range smaller than one page is a single call, and still inclusive", async () => {
  const pub = recordingRpc();
  const { pages } = await readEvents(pub, { contract: "0xabc", fromBlock: 500n, toBlock: 700n });
  assert.equal(pages, 1);
  assert.deepEqual(pub.windows, [[500n, 700n]]);
});

test("a one-block range is still read", async () => {
  const pub = recordingRpc();
  const { pages } = await readEvents(pub, { contract: "0xabc", fromBlock: 42n, toBlock: 42n });
  assert.equal(pages, 1);
  assert.deepEqual(pub.windows, [[42n, 42n]]);
});

test("the Base Sepolia deploy block is recorded, so reconcile floors instead of using a rolling window", () => {
  assert.equal(DEPLOY_BLOCK[84532], 46_163_891n);
});

// --- applying what the chain said ------------------------------------------

function mirrorWithToken(tokenId = 1) {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId, keyId: "k1", owner: "0xowner", lastDay: 100, mintDay: 100 });
  seedPaidMint(q, { tokenId, toAddress: "0xowner", keyId: "k1" });
  return { db, q };
}

const ev = (eventName, args) => ({ eventName, args });

// rest() is called by the OWNER straight on chain. This event is the only way
// the mirror can ever learn it, and /t/<id> reports resting to scanners.
test("Rested seals the token in the mirror", () => {
  const { q } = mirrorWithToken();
  const applied = applyEvents(q, [ev("Rested", { id: 1n, day: 101, level: 2, streak: 2 })]);
  assert.equal(applied.Rested, 1);
  assert.equal(q.getToken(1).resting, 1);
});

test("Transfer moves ownership, and the mint's own Transfer from the zero address is ignored", () => {
  const { q } = mirrorWithToken();
  const applied = applyEvents(q, [
    ev("Transfer", { from: ZERO, to: "0xNEWOWNER", tokenId: 1n }),
    ev("Transfer", { from: "0xowner", to: "0xAABBCC", tokenId: 1n }),
  ]);
  assert.equal(applied.Transfer, 1, "only the real transfer counts");
  assert.equal(q.getToken(1).owner, "0xaabbcc", "stored lower-cased, the way the door compares");
});

test("Minted moves both the mint row and the token row to written", () => {
  const { db, q } = mirrorWithToken();
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "queued");
  applyEvents(q, [ev("Minted", { id: 1n, keyId: "0xkey" })]);
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 1").get().status, "written");
  assert.equal(q.getToken(1).status, "written");
});

test("MarkApplied marks the order written AND sets the bit the tools read", () => {
  const { db, q } = mirrorWithToken();
  q.reserveMark(1, 3);
  applyEvents(q, [ev("MarkApplied", { id: 1n, upgradeId: 3 })]);
  assert.equal(db.prepare("SELECT status FROM mark_orders WHERE tokenId = 1").get().status, "written");
  // Bit 3 set, and nothing else.
  assert.equal(q.getToken(1).marks, 1 << 3);
});

// A token minted by some other warden, or one this mirror was restored without,
// is not this service's to invent.
test("an event for a token the mirror never heard of is skipped, not inserted", () => {
  const { q } = mirrorWithToken();
  const applied = applyEvents(q, [
    ev("Rested", { id: 999n }),
    ev("Transfer", { from: "0xa", to: "0xb", tokenId: 999n }),
  ]);
  assert.equal(applied.skipped, 2);
  assert.equal(applied.Rested, 0);
  assert.equal(q.getToken(999), undefined);
});

// The chain stores a bytes32; the mirror stores the thumbprint the door speaks.
// The hash is one-way, so writing the event's value into the mirror's keyId
// column would lock the agent out of its own token.
test("Rebound is reported but never written into the mirror's key column", () => {
  const { q } = mirrorWithToken();
  const lines = [];
  const applied = applyEvents(q, [ev("Rebound", { id: 1n, newKeyId: "0xabc123" })], { log: (m) => lines.push(m) });
  assert.equal(applied.Rebound, 1);
  assert.equal(q.getToken(1).keyId, "k1", "the mirror's key id is untouched");
  assert.match(lines[0], /rebound on chain/);
});

test("events this reconcile does not handle are ignored without counting as skipped", () => {
  const { q } = mirrorWithToken();
  const applied = applyEvents(q, [
    ev("BatchCheckedIn", { fromDay: 1, toDay: 2, count: 3n }),
    ev("MetadataUpdate", { _tokenId: 1n }),
  ]);
  assert.equal(applied.skipped, 0);
  for (const k of ["Rested", "Transfer", "Rebound", "Minted", "MarkApplied"]) assert.equal(applied[k], 0);
});

// 15.11. `getLogs({ address })` is a NODE-SIDE filter, and viem's
// parseEventLogs does not re-apply it -- read at source in 2.56.0, it matches
// on topic0, event name and args only. So one RPC's filtering was the whole
// defence between a foreign Transfer and q.setOwner rewriting an owner, and
// every ERC-721 on the chain emits a topic-compatible Transfer.
test("a log from another contract is discarded even if the node returns it", async () => {
  const MINE = "0x00000000000000000000000000000000000C0DE0";
  const THEIRS = "0x000000000000000000000000000000000000BEEF";
  // Transfer(address,address,uint256): the topic every ERC-721 shares.
  const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const pad = (a) => `0x${a.slice(2).toLowerCase().padStart(64, "0")}`;

  // A node that ignores the address filter, which is exactly the case the
  // client-side check exists for.
  const foreign = (address) => ({
    async getLogs() {
      return [{
        address,
        topics: [TRANSFER, pad(ZERO), pad("0x00000000000000000000000000000000000000a1"), `0x${(1n).toString(16).padStart(64, "0")}`],
        data: "0x",
        blockNumber: 1n,
        logIndex: 0,
        transactionHash: `0x${"11".repeat(32)}`,
      }];
    },
  });

  const refused = await readEvents(foreign(THEIRS), { contract: MINE, fromBlock: 0n, toBlock: 10n });
  assert.deepEqual(refused.events, [], "a foreign contract's Transfer must never reach applyEvents");

  // NOT VACUOUS: the identical log from OUR contract does parse, so the empty
  // result above is the address check and not a malformed fixture.
  const accepted = await readEvents(foreign(MINE), { contract: MINE, fromBlock: 0n, toBlock: 10n });
  assert.equal(accepted.events.length, 1, "the same log from our own address must be read");
  assert.equal(accepted.events[0].eventName, "Transfer");
});
