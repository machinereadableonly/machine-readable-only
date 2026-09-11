// The Clock's failure modes, from the 2026-09-04 security review's Medium and
// Low tiers.
//
// These share one shape: each turns a bad NIGHT into a permanent condition.
// The Clock runs once a day, so a defect that costs one run costs one day of
// every token's record, and a defect that repeats costs all of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { writeCheckInChunk, packableId, packIds } from "../src/clock/batch.mjs";
import { CONFIRMATIONS } from "../src/clock/run.mjs";

// -- 15.4: two processes write one file -------------------------------------

// The Warden writes on every check-in and the Clock writes at 00:05, to the
// same SQLite file. node:sqlite's default busy timeout is 0, so the second
// writer does not wait -- it throws `database is locked` immediately.
test("the mirror is opened with a busy timeout, because two processes write it", () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-lock-"));
  try {
    const path = join(dir, "state.db");
    const a = openDb(path);
    const b = openDb(path);

    // Hold a write transaction open on A, then write through B. With a zero
    // timeout this throws at once; with the timeout it waits and succeeds.
    a.exec("BEGIN IMMEDIATE");
    a.exec("INSERT INTO keys (keyId, jwk, directory, registeredAt) VALUES ('k1', '{}', NULL, 1)");

    // SLOW ON PURPOSE, about five seconds: what is being measured is that the
    // second writer WAITS. With the default timeout of 0 this returns in about
    // a millisecond, which is the defect. A is never committed here, so B is
    // expected to give up in the end -- the assertion is on how long it was
    // willing to wait, not on whether it won.
    const started = Date.now();
    try {
      b.exec("INSERT INTO keys (keyId, jwk, directory, registeredAt) VALUES ('k2', '{}', NULL, 1)");
    } catch { /* expected: A never commits */ }
    const waited = Date.now() - started;
    a.exec("COMMIT");

    assert.ok(waited > 4000,
      `a second writer waited only ${waited}ms; with no busy timeout it gives up in about 1ms`);
    a.close();
    b.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// -- 15.6: reconcile does not read to the bare head -------------------------

test("reconcile trails the chain head, because what it applies cannot be undone", () => {
  // setResting has no clearing statement and markMintWritten removes the row
  // from pendingMints permanently, so a log read out of a block that is later
  // reorged away is not recoverable. The RPC is documented in this codebase's
  // own comments as load-balanced and NOT read-after-write consistent, so the
  // head moving backwards is ordinary rather than exotic.
  assert.ok(Number.isInteger(CONFIRMATIONS), "there must be a depth at all");
  assert.ok(CONFIRMATIONS > 0, "reading to the bare head is what this fixes");
  // Base blocks are two seconds; this is a bound on the latency it costs a
  // nightly job, not a magic number.
  assert.ok(CONFIRMATIONS * 2 < 120, `${CONFIRMATIONS} blocks is more than two minutes of lag`);
});

// -- 15.7: a chunk too big to estimate is halved ----------------------------

/// A writer that refuses to estimate anything larger than `limit` entries, and
/// succeeds otherwise. This is the shape the real gas guard has.
function tooBigOver(limit) {
  const calls = [];
  return {
    calls,
    async send(_fn, args) {
      const n = args[1].length;
      calls.push(n);
      if (n > limit) return { ok: false, reason: "gas-estimate-too-large", gas: 99n };
      return { ok: true, hash: "0xabc", receipt: { blockNumber: 5n } };
    },
  };
}

const entriesFor = (n) => Array.from({ length: n }, (_, i) => ({ tokenId: i + 1, day: 100 }));

test("a chunk too big to estimate is halved, and BOTH halves are written", async () => {
  const writer = tooBigOver(4);
  const entries = entriesFor(16);
  const result = await writeCheckInChunk(writer, entries);

  assert.equal(result.aborted, null, "this used to abort the WHOLE run");
  // UNTIL 2026-09-11 THIS ASSERTED 4 OF 16, and so pinned the defect as the
  // behaviour. The halving kept the first half and DISCARDED the rest: neither
  // written nor dropped, so nothing reported them. Mostly they came back the
  // next night, a day late -- but a second halving could credit a token's
  // newer day in a later chunk first, after which the chain refuses the older
  // one forever and the heal path records it as already on chain. Found by
  // warden/tools/chunk-rehearsal.sh against a real node: 800 of 1,600.
  assert.deepEqual(
    result.written.map((e) => e.tokenId),
    entries.map((e) => e.tokenId),
    "every entry is written, in the order it was queued"
  );
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(writer.calls, [16, 8, 4, 4, 8, 4, 4], "halving, not one-at-a-time");
});

test("the halving accounts for every entry it was given", async () => {
  // The invariant the defect broke, stated once for any size: whatever the
  // writer does, each entry comes back written, healed or dropped. An entry in
  // none of the three is a check-in nobody will ever be told about.
  for (const [n, limit] of [[5, 2], [7, 3], [1600, 800], [9, 1]]) {
    const result = await writeCheckInChunk(tooBigOver(limit), entriesFor(n));
    const seen = result.written.length + result.healed.length + result.dropped.length;
    assert.equal(seen, n, `${n} entries at a limit of ${limit}: ${seen} accounted for`);
  }
});

test("a single entry that cannot be estimated is condemned by name, not silently", async () => {
  const writer = tooBigOver(0);
  const result = await writeCheckInChunk(writer, entriesFor(1));

  assert.equal(result.aborted, null);
  assert.deepEqual(result.dropped, [{ entry: { tokenId: 1, day: 100 }, reason: "gas-estimate-too-large" }]);
});

// -- 15.8: one malformed row is one row's problem ---------------------------

test("an id the contract cannot decode is answerable without throwing", () => {
  assert.equal(packableId(1), true);
  assert.equal(packableId(0xffff_ffff), true);
  assert.equal(packableId(0x1_0000_0000), false);
  assert.equal(packableId(-1), false);
  assert.equal(packableId(1.5), false);
  assert.equal(packableId(undefined), false);

  // packIds still throws, which is right: by the time a caller reaches it the
  // ids have been checked, and a throw there is a bug rather than bad data.
  assert.throws(() => packIds([0x1_0000_0000]), /does not fit in the 4 bytes/);
});

test("packIds is only ever handed ids it can pack, so the run cannot die on one row", () => {
  const good = entriesFor(3);
  assert.equal(packIds(good.map((e) => e.tokenId)).length, 2 + 3 * 8);
});
