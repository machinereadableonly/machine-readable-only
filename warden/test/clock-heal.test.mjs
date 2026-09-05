// A CHECK-IN THAT LANDED ON CHAIN AND WAS NEVER MARKED IN THE MIRROR.
//
// This state is ordinary: the transaction mines, and the process dies before
// `waitForTransactionReceipt` resolves -- a dropped TCP connection, an OOM
// kill, systemd's TimeoutStartSec, an operator's stop. Mints and Marks both
// recover from it, because `Minted` and `MarkApplied` name their token and
// `TokenExists` triggers a chain read. Check-ins could not: the contract's only
// check-in event is `BatchCheckedIn(fromDay, toDay, count)`, which carries no
// token ids at all, so reconcile has nothing to work with.
//
// What happened instead, every night, forever:
//
//   - the stale row is re-offered by pendingCredits
//   - the chain reverts DayNotAdvanced(id)
//   - the re-chunk rule drops EVERY entry for that id -- including the days
//     that are perfectly writable
//   - dropped rows are never marked, so tomorrow rebuilds the same chunk
//   - the run exits 0
//
// A token's record IS the artwork, so that is an artwork that stops growing and
// says nothing. These tests pin the recovery. Nothing here tested the
// "on chain, queued in the mirror" state before 2026-09-05.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeCheckInChunk } from "../src/clock/batch.mjs";

const entry = (tokenId, day) => ({ tokenId, day });

/**
 * A writer that behaves like the contract: it refuses any entry whose day is at
 * or below what the chain already has for that token, naming DayNotAdvanced
 * with the token id -- and, like the real `batchCheckIn`, it reverts on the
 * FIRST such entry in array order and says nothing about the rest.
 *
 * `onChain` is the chain's `lastDay` per token: the state a landed-but-unmarked
 * check-in leaves behind.
 */
function chainWriter({ onChain = new Map() } = {}) {
  const calls = [];
  return {
    calls,
    async send(functionName, args, opts) {
      const ids = [];
      for (let i = 2; i < args[0].length; i += 8) ids.push(parseInt(args[0].slice(i, i + 8), 16));
      const days = args[1];
      calls.push({ functionName, ids, days, label: opts?.label });
      for (let i = 0; i < ids.length; i += 1) {
        const last = onChain.get(ids[i]);
        if (last !== undefined && days[i] <= last) {
          return { ok: false, reason: "reverted-on-simulate", errorName: "DayNotAdvanced", errorArgs: [String(ids[i])] };
        }
      }
      // Everything accepted advances the chain, exactly as the contract does.
      for (let i = 0; i < ids.length; i += 1) onChain.set(ids[i], days[i]);
      return { ok: true, hash: "0xbeef", receipt: { blockNumber: 1n } };
    },
  };
}

/// What the Clock can ask the chain: one token's lastDay, or null when the read
/// failed. Null is "could not ask", never "not on chain".
const lastDayReader = (onChain) => async (tokenId) => onChain.get(tokenId) ?? 0;

// THE CASE FROM 4.H2, exactly. Token 42's day 100 is already on chain; day 101
// is not. Before this fix both were dropped, because the filter condemned every
// entry carrying id 42 -- so the day the agent had actually earned was thrown
// away along with the stale one, every night, forever.
test("a stale day does not take the token's good day with it", async () => {
  const onChain = new Map([[42, 100]]);
  const writer = chainWriter({ onChain });
  const r = await writeCheckInChunk(writer, [entry(42, 100), entry(42, 101)], {
    lastDayOf: lastDayReader(onChain),
  });

  assert.deepEqual(r.healed, [entry(42, 100)], "day 100 is on chain already: it is HEALED, not dropped");
  assert.deepEqual(r.written, [entry(42, 101)], "day 101 was writable all along and must land");
  assert.deepEqual(r.dropped, [], "nothing here is condemned");
});

// The healed row must be marked WRITTEN, not merely forgotten. A row that is
// dropped stays queued and comes back tomorrow; that is the wedge.
test("an entry the chain already holds is healed rather than re-offered forever", async () => {
  const onChain = new Map([[7, 500]]);
  const writer = chainWriter({ onChain });
  const r = await writeCheckInChunk(writer, [entry(7, 500)], { lastDayOf: lastDayReader(onChain) });

  assert.deepEqual(r.healed, [entry(7, 500)]);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.aborted, null);
});

// One stale token must not cost the OTHER tokens in the chunk their day. This
// is the same promise the re-chunk rule already makes for NoSuchToken.
test("a stale token does not cost the rest of the chunk its day", async () => {
  const onChain = new Map([[42, 100]]);
  const writer = chainWriter({ onChain });
  const r = await writeCheckInChunk(writer, [entry(1, 101), entry(42, 100), entry(3, 101)], {
    lastDayOf: lastDayReader(onChain),
  });

  assert.deepEqual(r.written.map((e) => e.tokenId).sort(), [1, 3]);
  assert.deepEqual(r.healed, [entry(42, 100)]);
});

// WHEN THE CHAIN CANNOT BE ASKED. A null lastDay is "could not ask", so the
// entry must NOT be healed on a guess -- but it must also not condemn the
// token's other days. batchCheckIn reverts on the FIRST bad entry in array
// order, so that one entry is the only one actually condemned.
test("an unreadable chain drops only the entry the revert named, not the token", async () => {
  const onChain = new Map([[42, 100]]);
  const writer = chainWriter({ onChain });
  const r = await writeCheckInChunk(writer, [entry(42, 100), entry(42, 101)], {
    lastDayOf: async () => null,
  });

  assert.deepEqual(r.dropped.map((d) => d.entry), [entry(42, 100)], "only the first entry for that id");
  assert.deepEqual(r.written, [entry(42, 101)], "the good day still lands");
  assert.deepEqual(r.healed, [], "nothing is healed on a failed read");
});

// THE WEDGE ITSELF. Thirteen stale entries is more than maxAttempts, which is
// what turned a recoverable state into a permanent one: the loop exhausted,
// returned `written: []`, and left every row queued -- so nothing was ever
// credited again, on any token, on any night.
test("more stale entries than maxAttempts no longer exhausts the loop", async () => {
  const onChain = new Map();
  for (let id = 1; id <= 13; id += 1) onChain.set(id, 100);
  const writer = chainWriter({ onChain });

  const entries = [];
  for (let id = 1; id <= 13; id += 1) entries.push(entry(id, 100));
  entries.push(entry(99, 101));

  const r = await writeCheckInChunk(writer, entries, { lastDayOf: lastDayReader(onChain) });

  assert.equal(r.healed.length, 13, "every stale row is resolved against the chain, not retried");
  assert.deepEqual(r.written, [entry(99, 101)], "and the fresh day still lands");
  assert.equal(r.dropped.length, 0);
});

// A GENUINE CONDEMNATION still condemns. Healing must not swallow the errors
// that really do mean "this entry can never be written".
test("NoSuchToken and Resting still condemn the whole token", async () => {
  const writer = {
    calls: [],
    async send(_fn, args) {
      const ids = [];
      for (let i = 2; i < args[0].length; i += 8) ids.push(parseInt(args[0].slice(i, i + 8), 16));
      if (ids.includes(4242)) {
        return { ok: false, reason: "reverted-on-simulate", errorName: "NoSuchToken", errorArgs: ["4242"] };
      }
      return { ok: true, hash: "0xbeef" };
    },
  };
  const r = await writeCheckInChunk(writer, [entry(4242, 100), entry(4242, 101), entry(5, 100)], {
    lastDayOf: async () => 999,
  });

  assert.equal(r.healed.length, 0, "a chain read must not rescue a token that does not exist");
  assert.deepEqual(r.dropped.map((d) => d.entry), [entry(4242, 100), entry(4242, 101)]);
  assert.deepEqual(r.written, [entry(5, 100)]);
});

// A LOST RECEIPT IS NOT A FAILED SEND. The transaction may still land, so the
// chunk must NOT be retried -- retrying would double-credit if it did land, and
// the shrink loop would condemn good entries if it did not.
test("a receipt that never arrives aborts without writing or dropping anything", async () => {
  const writer = {
    calls: [],
    async send() {
      return { ok: false, reason: "receipt-unknown", hash: "0xabc" };
    },
  };
  const r = await writeCheckInChunk(writer, [entry(1, 100), entry(2, 100)], { lastDayOf: async () => 0 });

  assert.equal(r.aborted, "receipt-unknown", "the run stops rather than guessing");
  assert.equal(r.hash, "0xabc", "and says which transaction it does not know the fate of");
  assert.deepEqual(r.written, []);
  assert.deepEqual(r.dropped, [], "nothing is condemned on an unknown outcome");
});

// --- the same recovery, driven through the whole run ------------------------
//
// The tests above prove the batching logic. This one proves the ROW is marked
// written in the mirror, which is what actually stops the wedge: a row that is
// merely resolved in memory comes back tomorrow.

import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { runClock } from "../src/clock/run.mjs";
import { seedPaidMint } from "./mirror-seed.mjs";

const TODAY = 20_700;

/// A chain that holds `lastDay` for each token, and refuses any check-in at or
/// below it -- which is what a landed-but-unmarked batch leaves behind.
function chainAt(lastDays) {
  return {
    async getBlockNumber() { return 1n; },
    async getLogs() { return []; },
    async readContract({ functionName, args }) {
      if (functionName !== "viewOf") throw new Error(`unexpected read ${functionName}`);
      return { lastDay: lastDays.get(Number(args[0])) ?? 0 };
    },
  };
}

function writerRefusingStale(lastDays) {
  const sent = [];
  return {
    sent,
    address: "0xwarden",
    formatGas: (w) => `${w} wei`,
    async startRun() { return 0; },
    async gasOk() { return { ok: true, gasPrice: 6_000_000n, capWei: 50_000_000n }; },
    async send(functionName, args, opts) {
      sent.push({ functionName, args, label: opts?.label });
      if (functionName !== "batchCheckIn") return { ok: true, hash: "0x1" };
      const ids = [];
      for (let i = 2; i < args[0].length; i += 8) ids.push(parseInt(args[0].slice(i, i + 8), 16));
      for (let i = 0; i < ids.length; i += 1) {
        const last = lastDays.get(ids[i]);
        if (last !== undefined && args[1][i] <= last) {
          return { ok: false, reason: "reverted-on-simulate", errorName: "DayNotAdvanced", errorArgs: [String(ids[i])] };
        }
      }
      return { ok: true, hash: "0x1", receipt: { blockNumber: 5n } };
    },
  };
}

// THE FAILURE SCENARIO FROM 15.2 AND 16.1, end to end. Token 1's day was
// written on chain last night and never marked, because the receipt never
// arrived. Today the mirror offers it again along with the day the agent has
// just earned.
test("a run heals the landed day in the MIRROR and still credits the new one", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  seedPaidMint(q, { tokenId: 1, toAddress: "0x" + "11".repeat(20), keyId: "k1" });
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0x" + "11".repeat(20), lastDay: TODAY - 2, mintDay: TODAY - 9 });
  db.exec("UPDATE mints SET status = 'written' WHERE tokenId = 1");
  db.exec("UPDATE tokens SET status = 'written' WHERE tokenId = 1");

  // Yesterday's credit landed on chain; the day before is genuinely new.
  q.insertCredit(1, TODAY - 2, "sig-old");
  q.insertCredit(1, TODAY - 1, "sig-new");

  const lastDays = new Map([[1, TODAY - 2]]);
  const summary = await runClock({
    q,
    publicClient: chainAt(lastDays),
    writer: writerRefusingStale(lastDays),
    contract: "0xcontract",
    chainId: 84532,
    today: TODAY,
    log: () => {},
    alert: () => {},
  });

  assert.deepEqual(summary.healed.map((e) => e.day), [TODAY - 2], "the landed day is healed");
  assert.deepEqual(summary.credited.map((e) => e.day), [TODAY - 1], "and the new day still lands");
  assert.deepEqual(summary.stuckCredits, [], "neither is condemned");

  // THE POINT: both rows are written in the MIRROR, so tomorrow offers neither.
  // Spread each row: node:sqlite returns null-prototype objects, which
  // deepEqual will not match against a plain literal however identical the
  // contents. The other suites use the same idiom.
  const rows = db.prepare("SELECT day, status FROM credits ORDER BY day").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { day: TODAY - 2, status: "written" },
    { day: TODAY - 1, status: "written" },
  ]);
  assert.deepEqual(q.pendingCredits(TODAY).map((r) => ({ ...r })), [], "nothing comes back tomorrow");
});
