// Reconcile, and the 10,000-block wall it has to page around.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readEvents, applyEvents, MAX_LOG_SPAN, DEPLOY_BLOCK } from "../src/clock/reconcile.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";
import { MRO_ABI } from "../src/clock/abi.mjs";

const ZERO = "0x0000000000000000000000000000000000000000";

/// A stubbed log entry whose ARG NAMES are checked against the contract's own
/// ABI before the test can use it.
///
/// Hand-written event doubles are the drift that hid a real bug: this file's
/// `Seeded` stub said `tokenId` until 2026-09-07, a name the event does not
/// carry, and the reader read the same wrong name -- so the pair agreed with
/// each other and with nothing on chain. Fixing the literal fixes it once.
/// Deriving the check from `MRO_ABI` closes the class for every stub that goes
/// through this helper -- which is all of them in this file, and this file is
/// the only place that hand-writes one. Rename an input in the contract and the
/// stub fails here, by name, instead of passing against a decoder that is wrong
/// in the same direction. It cannot stop someone writing a raw
/// `{ eventName, args }` literal again; nothing short of a lint rule can.
/// Same idea as mint-id.test.mjs's "the test double exposes exactly the real
/// chain reader's surface".
/// `partial: true` is for a stub that deliberately carries only the arguments
/// one test cares about. It relaxes COMPLETENESS only -- every name given is
/// still checked against the ABI, which is the half that catches the drift.
function chainEvent(eventName, args, { partial = false } = {}) {
  const spec = MRO_ABI.find((e) => e.type === "event" && e.name === eventName);
  assert.ok(spec, `the ABI has no event named ${eventName}`);
  const real = spec.inputs.map((i) => i.name);

  const invented = Object.keys(args).filter((k) => !real.includes(k));
  assert.deepEqual(
    invented,
    [],
    `${eventName} stub uses ${invented.join(", ")}, which the event does not carry (it has ${real.join(", ")})`
  );
  if (!partial) {
    assert.deepEqual(
      Object.keys(args).sort(),
      [...real].sort(),
      `${eventName} stub does not carry the ABI's own argument names`
    );
  }
  return { eventName, args };
}

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
  // THIS ONE IS DELIBERATELY A LITERAL. Everywhere else the floor is derived,
  // but something has to fail when a redeploy happens and nobody updates it:
  // left at a previous contract's block, reconcile pages tens of thousands of
  // empty blocks and finds nothing, which reads as a quiet chain rather than as
  // a misconfiguration. Updated 2026-09-11 for the first-day pair (mint and
  // seed take the day the agent paid), taken from the broadcast receipt: all
  // twelve transactions of that deploy landed in block 46,686,660. Updated
  // again 2026-09-22 for the QR version 10 pair, whose twelve transactions all
  // landed in block 47,161,021.
  //
  // adopt-deployment.sh did NOT update this the first time and the suite went
  // red after an otherwise clean adoption. That is the pin doing its job, but
  // the script claims to change the address "everywhere at once", so it now
  // rewrites this line too.
  assert.equal(DEPLOY_BLOCK[84532], 47_161_021n);
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

// The finishing credit emits `Finished` and NOT `MarkApplied`: there is no
// order to mark written, nobody paid for it, and this is the only event that
// ever says which place a token took. Without this case a finished token looks
// exactly like any other whole one, and the `year-complete` refusal points the
// agent at a `status` that cannot answer.
test("Finished records the place AND sets the finisher Mark bit", () => {
  const { q } = mirrorWithToken();
  const applied = applyEvents(q, [chainEvent("Finished", { id: 1n, ordinal: 3, markId: 14 })]);
  assert.equal(applied.Finished, 1);
  assert.equal(q.getToken(1).finisher, 3, "the place the chain gave it");
  assert.equal(q.getToken(1).marks, 1 << 14, "Atrium, and nothing else");
});

// Reconcile re-reads a block range whenever a run is repeated or a cursor is
// rewound, so the same log arrives twice as a matter of course. Writing the
// place is not a counter and must not behave like one.
test("the same Finished applied twice changes nothing the second time", () => {
  const { q } = mirrorWithToken();
  const e = chainEvent("Finished", { id: 1n, ordinal: 3, markId: 14 });
  applyEvents(q, [e]);
  const first = { ...q.getToken(1) };
  applyEvents(q, [e]);
  assert.deepEqual({ ...q.getToken(1) }, first);
});

// 4.L8 again, on the other event that carries a Mark id. A decode that lost the
// argument would write a bit no finisher owns, and nothing ever clears a bit.
// Ids 11-15 are the whole finisher band (MachineReadableOnly.finisherMark).
test("a Finished carrying a Mark id outside the finisher band is skipped, not written", () => {
  const { q } = mirrorWithToken();
  const lines = [];
  const applied = applyEvents(
    q,
    [chainEvent("Finished", { id: 1n, ordinal: 1, markId: 8 })],
    { log: (m) => lines.push(m) }
  );
  assert.equal(applied.Finished, 0);
  assert.equal(applied.skipped, 1);
  assert.equal(q.getToken(1).finisher, 0, "nothing written");
  assert.equal(q.getToken(1).marks, 0);
  assert.match(lines[0], /Finished/);
});

// Places start at 1 -- the contract's `ordinal = ++finishers` can never hand
// out a 0 -- so a 0 here is a lost argument wearing the shape of a real one,
// and it would read back as "not finished".
test("a Finished with no usable ordinal is skipped, not written", () => {
  const { q } = mirrorWithToken();
  const lines = [];
  const applied = applyEvents(
    q,
    [chainEvent("Finished", { id: 1n, ordinal: 0, markId: 15 })],
    { log: (m) => lines.push(m) }
  );
  assert.equal(applied.Finished, 0);
  assert.equal(applied.skipped, 1);
  assert.equal(q.getToken(1).finisher, 0);
  assert.equal(q.getToken(1).marks, 0);
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
  for (const k of ["Rested", "Transfer", "Rebound", "Minted", "MarkApplied", "Finished"]) assert.equal(applied[k], 0);
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

// 4.M8. Three events the chain emits reached reconcile and were dropped by the
// `if (!(name in applied)) continue` guard, so "the mirror ignored it" and "the
// chain never said it" looked identical from the summary. None of the three can
// heal per-token state -- BatchCheckedIn names no tokens at all, Seeded is
// healed from the Clock's own receipt rather than from this log, and SunsetAt
// is already read live by every gated call -- but all three are worth SEEING.
test("the three events reconcile cannot apply are counted rather than dropped", () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 10, mintDay: 10 });

  const logs = [];
  const applied = applyEvents(q, [
    // `BatchCheckedIn(fromDay, toDay, count)`. This stub said `day, count`
    // until the ABI guard above was written, and it was caught on the guard's
    // FIRST run. Nothing in production reads these args -- reconcile only
    // counts this event, because it names no token ids and so can heal
    // nothing -- so this one was a lie with no consequence yet. The `Seeded`
    // one next to it was not.
    chainEvent("BatchCheckedIn", { fromDay: 20_700, toDay: 20_700, count: 3 }),
    chainEvent("SunsetAt", { day: 20_700 }),
    chainEvent("Seeded", { parentId: 1, childId: 9, generation: 1 }),
  ], { log: (m) => logs.push(m) });

  assert.equal(applied.BatchCheckedIn, 1);
  assert.equal(applied.SunsetAt, 1);
  assert.equal(applied.Seeded, 1);
  // And NOT counted as skipped: a skip means "an event about a token we do not
  // hold", which is a divergence alert. These are neither.
  assert.equal(applied.skipped, 0);
  assert.ok(logs.some((l) => /SUNSET/.test(l)), "closing the piece must be said out loud");
  // Named by BOTH ids, so an operator reading the night's log can tell which
  // child landed from which parent -- and so a "?" from a misread arg name
  // fails here instead of shipping.
  assert.ok(logs.some((l) => /child 9 was seeded from parent 1/.test(l)));
});

// The control that gives the count above its meaning: an event for a token this
// mirror does not hold is still a skip, and still a divergence.
test("an event for an unknown token is still counted as skipped", () => {
  const q = queries(openDb(":memory:"));
  // `Rested(id, day, level, streak)` -- the id argument is `id`, NOT `tokenId`,
  // which is what this stub said until the ABI guard was relaxed to admit it.
  // No production bug: reconcile reads `args.tokenId ?? args.id`, so both land.
  // Partial on purpose -- only the id decides a skip.
  const applied = applyEvents(q, [chainEvent("Rested", { id: 404 }, { partial: true })]);
  assert.equal(applied.skipped, 1);
  assert.equal(applied.Rested, 0);
});
