// The re-chunk rule. One bad entry must not cost a whole day.
//
// The writer is a stub whose refusals are shaped exactly like the ones measured
// against the deployed contract on 2026-08-31 -- `{ errorName, errorArgs }`
// with the offending value decoded. No network here; the live decoding is
// checked by tools/clock-live-check.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { packIds, chunk, writeCheckInChunk } from "../src/clock/batch.mjs";

const entry = (tokenId, day) => ({ tokenId, day });

/**
 * A writer that refuses any chunk containing a poisoned id, naming it the way
 * the chain does, and accepts anything else.
 */
function stubWriter({ poison = new Map(), failWholeRun = null, onChainRevert = false } = {}) {
  const calls = [];
  return {
    calls,
    async send(functionName, args, opts) {
      calls.push({ functionName, ids: args[0], days: args[1], label: opts?.label });
      if (failWholeRun) {
        return { ok: false, reason: "reverted-on-simulate", errorName: failWholeRun, errorArgs: [] };
      }
      if (onChainRevert) {
        return { ok: false, reason: "reverted-on-chain", hash: "0xdead" };
      }
      const ids = [];
      for (let i = 2; i < args[0].length; i += 8) ids.push(parseInt(args[0].slice(i, i + 8), 16));
      for (const [badId, errorName] of poison) {
        if (ids.includes(badId)) {
          return { ok: false, reason: "reverted-on-simulate", errorName, errorArgs: [String(badId)] };
        }
      }
      return { ok: true, hash: "0xbeef" };
    },
  };
}

test("ids pack as 4-byte big-endian values, the way the contract slices them", () => {
  assert.equal(packIds([1, 2, 70_000]), "0x000000010000000200011170");
  assert.equal(packIds([]), "0x");
  assert.equal(packIds([0xffffffff]), "0xffffffff");
});

test("an id too large for four bytes is refused rather than silently truncated", () => {
  assert.throws(() => packIds([0x1_0000_0000]), /does not fit/);
  assert.throws(() => packIds([-1]), /does not fit/);
  assert.throws(() => packIds([1.5]), /does not fit/);
});

test("chunk splits evenly and refuses a nonsense size", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 10), []);
  assert.throws(() => chunk([1], 0), /positive integer/);
});

test("a clean chunk is written in one call", async () => {
  const writer = stubWriter();
  const entries = [entry(1, 100), entry(2, 100)];
  const r = await writeCheckInChunk(writer, entries);
  assert.equal(r.written.length, 2);
  assert.deepEqual(r.dropped, []);
  assert.equal(r.attempts, 1);
});

// THE RULE. The offending id is dropped and the REST still lands -- the whole
// chunk is never retried unchanged, and the other 1,499 tokens keep their day.
test("one refused id is dropped and every other entry still lands", async () => {
  const writer = stubWriter({ poison: new Map([[4242, "NoSuchToken"]]) });
  const entries = [entry(1, 100), entry(4242, 100), entry(3, 100)];
  const r = await writeCheckInChunk(writer, entries);

  assert.deepEqual(r.written.map((e) => e.tokenId), [1, 3]);
  assert.deepEqual(r.dropped, [{ entry: entry(4242, 100), reason: "NoSuchToken" }]);
  assert.equal(r.attempts, 2, "one refusal, then one successful retry");
  // The retry must be a SMALLER chunk, never the same one again.
  assert.equal(writer.calls[0].ids.length > writer.calls[1].ids.length, true);
});

test("several bad ids are dropped one refusal at a time", async () => {
  const writer = stubWriter({
    poison: new Map([[10, "NoSuchToken"], [20, "Resting"], [30, "DayNotAdvanced"]]),
  });
  const entries = [entry(1, 100), entry(10, 100), entry(20, 100), entry(30, 100), entry(2, 100)];
  const r = await writeCheckInChunk(writer, entries);

  assert.deepEqual(r.written.map((e) => e.tokenId), [1, 2]);
  assert.deepEqual(r.dropped.map((d) => [d.entry.tokenId, d.reason]).sort(),
    [[10, "NoSuchToken"], [20, "Resting"], [30, "DayNotAdvanced"]].sort());
  assert.equal(r.aborted, null);
});

// FutureDay names a DAY, not a token, so it condemns every entry for that day.
test("FutureDay drops every entry for that day, not one token", async () => {
  const writer = {
    calls: [],
    async send(fn, args) {
      const days = args[1];
      this.calls.push(days);
      if (days.includes(999)) return { ok: false, reason: "reverted-on-simulate", errorName: "FutureDay", errorArgs: ["999"] };
      return { ok: true, hash: "0x1" };
    },
  };
  const entries = [entry(1, 100), entry(2, 999), entry(3, 999), entry(4, 100)];
  const r = await writeCheckInChunk(writer, entries);
  assert.deepEqual(r.written.map((e) => e.tokenId), [1, 4]);
  assert.equal(r.dropped.length, 2);
  for (const d of r.dropped) assert.equal(d.reason, "FutureDay");
});

// A run-level refusal must stop the run. Bisecting on NotWarden would split
// down to single entries and fail on every one -- 2n calls to learn nothing.
for (const errorName of ["NotWarden", "Sunset", "EnforcedPause", "LengthMismatch", "EmptyBatch"]) {
  test(`${errorName} aborts the run instead of bisecting`, async () => {
    const writer = stubWriter({ failWholeRun: errorName });
    const r = await writeCheckInChunk(writer, [entry(1, 100), entry(2, 100), entry(3, 100)]);
    assert.equal(r.aborted, errorName);
    assert.deepEqual(r.written, []);
    assert.equal(writer.calls.length, 1, "exactly one call, then stop");
  });
}

// A transaction that reverted ON CHAIN has already burned gas and a nonce.
// Something changed between the simulation and the block, so the honest move is
// to stop rather than shrink and guess.
test("a revert on chain aborts rather than shrinking and retrying", async () => {
  const writer = stubWriter({ onChainRevert: true });
  const r = await writeCheckInChunk(writer, [entry(1, 100), entry(2, 100)]);
  assert.equal(r.aborted, "reverted-on-chain");
  assert.equal(r.hash, "0xdead");
  assert.deepEqual(r.written, []);
  assert.equal(writer.calls.length, 1);
});

// An error naming nothing usable cannot be filtered, so it bisects. This is the
// fallback, not the strategy.
test("an unnamed revert bisects to find the bad entry", async () => {
  const calls = [];
  const writer = {
    calls,
    async send(fn, args) {
      const ids = [];
      for (let i = 2; i < args[0].length; i += 8) ids.push(parseInt(args[0].slice(i, i + 8), 16));
      calls.push(ids);
      // Naming no argument at all: the shape of a revert viem could not decode.
      if (ids.includes(7)) return { ok: false, reason: "reverted-on-simulate", errorName: null, errorArgs: [] };
      return { ok: true, hash: "0x1" };
    },
  };
  const entries = [1, 2, 3, 7, 4, 5].map((id) => entry(id, 100));
  const r = await writeCheckInChunk(writer, entries);

  assert.deepEqual(r.written.map((e) => e.tokenId).sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual(r.dropped.map((d) => d.entry.tokenId), [7]);
  // log2(6) is under 3, so bisecting must not take anything like six calls.
  assert.ok(calls.length <= 7, `bisect took ${calls.length} calls`);
});

test("an error naming a value that is not in the chunk falls through to bisect rather than looping", async () => {
  let calls = 0;
  const writer = {
    async send(fn, args) {
      calls += 1;
      const ids = [];
      for (let i = 2; i < args[0].length; i += 8) ids.push(parseInt(args[0].slice(i, i + 8), 16));
      // Names an id that was never in the batch: a filter on it removes
      // nothing, and without the fall-through this would retry forever.
      if (ids.length > 1) return { ok: false, reason: "reverted-on-simulate", errorName: "NoSuchToken", errorArgs: ["99999"] };
      return { ok: true, hash: "0x1" };
    },
  };
  const r = await writeCheckInChunk(writer, [entry(1, 100), entry(2, 100)], { maxAttempts: 8 });
  assert.equal(r.written.length, 2, "both entries still land, one at a time");
  assert.ok(calls < 8, "and it terminated rather than looping");
});

test("a pathological chunk gives up by its attempt bound instead of hammering the node", async () => {
  let calls = 0;
  const writer = {
    async send() {
      calls += 1;
      return { ok: false, reason: "reverted-on-simulate", errorName: "NoSuchToken", errorArgs: ["1"] };
    },
  };
  const r = await writeCheckInChunk(writer, [entry(1, 100)], { maxAttempts: 3 });
  assert.equal(r.written.length, 0);
  assert.equal(r.dropped.length, 1);
  assert.ok(calls <= 3, `made ${calls} calls against a bound of 3`);
});

// ---------------------------------------------------------------------------
// Two queued days for one token -- test gap 27 / finding 4.H2
// ---------------------------------------------------------------------------

// THE SCOPE OF `by: "id"` WAS PINNED NOWHERE. Every DayNotAdvanced test above
// gives a token exactly one queued day, so "drop the offending id" and "drop
// this one entry" are indistinguishable -- and they are very different rules
// the night a token has two days waiting, which is the ordinary shape after a
// night the Clock did not run.
//
// Getting it wrong loses a day permanently: batchCheckIn refuses `day <= lastDay`,
// so a day dropped here can never be backfilled. The heal path exists precisely
// to split a token's entries at what the chain already holds.
/// A writer that behaves like the CONTRACT does about days: it reverts
/// DayNotAdvanced, naming the first offending token, for any entry whose day is
/// at or below what the chain already holds -- and accepts everything else.
///
/// The `poison` stub above cannot express this case. It refuses every chunk
/// containing the id, so the entry the heal correctly rescues is refused again
/// on the retry and condemned on the second pass. That is the stub being wrong,
/// not the code: the whole point of healing is that day 99 IS writable once
/// day 98 is recognised as already landed.
function dayAwareWriter(chainLastDay = new Map()) {
  const calls = [];
  return {
    calls,
    async send(functionName, args, opts) {
      const ids = [];
      for (let i = 2; i < args[0].length; i += 8) ids.push(parseInt(args[0].slice(i, i + 8), 16));
      const days = args[1];
      calls.push({ ids, days, label: opts?.label });

      // The contract reverts on the FIRST offending entry in array order.
      for (let i = 0; i < ids.length; i++) {
        const last = chainLastDay.get(ids[i]) ?? 0;
        if (days[i] <= last) {
          return {
            ok: false,
            reason: "reverted-on-simulate",
            errorName: "DayNotAdvanced",
            errorArgs: [String(ids[i])],
          };
        }
      }
      return { ok: true, hash: "0xbeef" };
    },
  };
}

test("two queued days for one token: the written one heals, the writable one lands", async () => {
  // The chain already holds day 98 for token 1, and nothing for token 2.
  const writer = dayAwareWriter(new Map([[1, 98]]));
  const entries = [entry(1, 98), entry(1, 99), entry(2, 99)];

  const r = await writeCheckInChunk(writer, entries, { lastDayOf: async (id) => (id === 1 ? 98 : 0) });

  assert.deepEqual(
    r.healed.map((e) => [e.tokenId, e.day]),
    [[1, 98]],
    "the day already on chain is HEALED, not dropped -- it landed, the mirror was behind",
  );
  assert.deepEqual(r.dropped, [], "nothing is condemned: every entry was accounted for");
  assert.deepEqual(
    r.written.map((e) => [e.tokenId, e.day]).sort(),
    [[1, 99], [2, 99]],
    "the still-writable day for the SAME token must land, and so must the other token's",
  );
  assert.equal(r.aborted, null);
});

// The fallback half of the same rule. When the chain cannot be asked, the
// contract reverts on the FIRST offending entry in array order, so that is the
// only one it named and the only one condemned -- the token's other days stay.
test("when the chain cannot be asked, ONE entry is condemned and the rest survive", async () => {
  const writer = dayAwareWriter(new Map([[1, 98]]));
  const entries = [entry(1, 98), entry(1, 99), entry(2, 99)];

  // lastDayOf returns null: could not ask. NOT "not on chain".
  const r = await writeCheckInChunk(writer, entries, { lastDayOf: async () => null });

  assert.deepEqual(
    r.dropped.map((d) => [d.entry.tokenId, d.entry.day]),
    [[1, 98]],
    "exactly the first entry for that id, which is the one the contract named",
  );
  assert.deepEqual(
    r.written.map((e) => [e.tokenId, e.day]).sort(),
    [[1, 99], [2, 99]],
    "one unreadable moment must not cost the token its other days",
  );
  assert.deepEqual(r.healed, [], "nothing may be marked written on a read that failed");
});

// ---------------------------------------------------------------------------
// gas-estimate-too-large -- test gap 28 / finding 4.M5
// ---------------------------------------------------------------------------

/// A writer that cannot ESTIMATE a chunk above `limit` entries, and sends
/// anything at or below it. Nothing is broadcast on the refusal -- that is what
/// makes halving safe here where retrying would not be.
function gasStubWriter(limit) {
  const calls = [];
  return {
    calls,
    async send(functionName, args, opts) {
      const count = args[1].length;
      calls.push({ count, label: opts?.label });
      if (count > limit) return { ok: false, reason: "gas-estimate-too-large" };
      return { ok: true, hash: "0xbeef" };
    },
  };
}

// NOTHING PINNED THIS REASON AT ALL. clock-batch covered `reverted-on-chain`
// and `send-failed`, and the gas refusal -- the one the halve path exists for --
// was tested by nothing, which is why 4.M5's abort went unnoticed. The chunk
// size it guards is an explicitly UNVERIFIED number, so "too big to estimate"
// is an ordinary outcome, and aborting on it meant nobody was credited at all.
test("a chunk too big to estimate is HALVED, not abandoned", async () => {
  const writer = gasStubWriter(2);
  const entries = [entry(1, 100), entry(2, 100), entry(3, 100), entry(4, 100)];

  const r = await writeCheckInChunk(writer, entries);

  assert.equal(r.aborted, null, "the run must not abort on a chunk that merely will not estimate");
  assert.deepEqual(r.written.map((e) => e.tokenId), [1, 2], "the half that fits is written");
  assert.deepEqual(r.dropped, [], "nothing is condemned: the entries are fine, the chunk was big");
  assert.deepEqual(
    writer.calls.map((c) => c.count),
    [4, 2],
    "four refused, then two -- halved, never retried at the same size",
  );
});

test("halving repeats until the chunk fits", async () => {
  const writer = gasStubWriter(1);
  const entries = [entry(1, 100), entry(2, 100), entry(3, 100), entry(4, 100)];

  const r = await writeCheckInChunk(writer, entries);

  assert.equal(r.aborted, null);
  assert.deepEqual(r.written.map((e) => e.tokenId), [1]);
  assert.deepEqual(writer.calls.map((c) => c.count), [4, 2, 1]);
});

// The floor of the halve. A SINGLE entry that will not estimate is genuinely
// undeliverable -- there is nothing left to halve -- so it is condemned by name
// rather than halved forever or aborting the night.
test("a single entry that will not estimate is condemned by name", async () => {
  const writer = gasStubWriter(0);
  const r = await writeCheckInChunk(writer, [entry(1, 100)]);

  assert.equal(r.aborted, null);
  assert.deepEqual(r.written, []);
  assert.deepEqual(r.dropped, [{ entry: entry(1, 100), reason: "gas-estimate-too-large" }]);
});
