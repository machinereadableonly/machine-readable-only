// batchCheckIn, and the rule that one bad entry must not cost a whole day.
//
// THE PROBLEM. batchCheckIn reverts the WHOLE chunk on one bad entry, and a
// chunk is up to CHECKIN_CHUNK tokens' days (run.mjs). Retrying it unchanged
// reverts again, forever, and every token in it loses that day permanently --
// a token's record is the artwork, so a lost day is not a retryable
// inconvenience.
//
// THE RULE, inherited from Plan 1's fix wave:
//
//     Re-chunk with the offending ids removed. NEVER retry the whole chunk.
//
// What makes that precise rather than a bisect: the contract's custom errors
// carry the offending value, and viem decodes it. Measured against the deployed
// contract on 2026-08-31 with a deliberately mixed chunk -- one live token and
// one that does not exist -- the simulation returned
//     { errorName: "NoSuchToken", args: ["4242"] }
// naming the exact entry to drop. Bisecting is the fallback for errors that
// name nothing, not the strategy.

/// Errors that condemn ONE entry, and which of the error's arguments says so.
/// `by: "id"` means the argument is a token id; `by: "day"` means a day number,
/// which condemns every entry for that day rather than one token.
///
/// `DayNotAdvanced` IS NOT IN THIS TABLE, and that is the point of the whole
/// heal path below. It is the one entry error that does not mean "this can
/// never be written" -- it means "the chain already has this day", which is a
/// statement about the MIRROR being behind, not about the entry being bad.
/// Treating it as a condemnation is what wedged the queue: see healDayNotAdvanced.
const ENTRY_ERRORS = {
  NoSuchToken: { by: "id" },
  Resting: { by: "id" },
  FutureDay: { by: "day" },
};

/**
 * Resolve a `DayNotAdvanced(id)` refusal against what the chain actually holds.
 *
 * THE STATE THIS EXISTS FOR. A `batchCheckIn` can land on chain and never be
 * marked in the mirror -- the transaction mines and the process ceases to exist
 * before the receipt arrives. Mints and Marks both recover from that, because
 * `Minted` and `MarkApplied` name their token and `TokenExists` triggers a
 * chain read. Check-ins cannot: `BatchCheckedIn(fromDay, toDay, count)` carries
 * no ids, so no event will ever tell this service which tokens landed.
 *
 * So it asks the chain's STATE instead. `lastDayOf(tokenId)` is the token's
 * `lastDay` on chain; every queued entry at or below it is already written, and
 * every entry above it is still writable. That splits the token's entries
 * precisely rather than condemning all of them.
 *
 * A NULL READ IS "COULD NOT ASK", never "not on chain". Nothing is healed on a
 * failed read -- healing a row that did not land would lose that day forever,
 * because `batchCheckIn` refuses `day <= lastDay` and a missed day can never be
 * backfilled. The fallback condemns exactly ONE entry: the contract reverts on
 * the FIRST offending entry in array order, so that is the only one it named.
 *
 * Returns `{ healed, remaining, dropped }`.
 */
async function healDayNotAdvanced(entries, tokenId, lastDayOf) {
  const mine = entries.filter((e) => String(e.tokenId) === String(tokenId));
  const others = entries.filter((e) => String(e.tokenId) !== String(tokenId));

  const lastDay = lastDayOf ? await lastDayOf(Number(tokenId)) : null;
  if (lastDay === null || lastDay === undefined) {
    // Could not ask. Condemn the first entry for that id and keep the rest, so
    // one unreadable moment cannot cost the token its other days.
    const [first, ...rest] = mine;
    return {
      healed: [],
      dropped: first ? [{ entry: first, reason: "DayNotAdvanced" }] : [],
      remaining: [...others, ...rest],
    };
  }

  const healed = mine.filter((e) => e.day <= lastDay);
  const stillWritable = mine.filter((e) => e.day > lastDay);
  return { healed, dropped: [], remaining: [...others, ...stillWritable] };
}

/// Errors that condemn the WHOLE RUN, not an entry. Bisecting on these would
/// split down to single entries, fail on every one, and turn one refusal into
/// 2n pointless calls against the node.
const RUN_ERRORS = new Set([
  "NotWarden", // the warden was rotated out from under this process
  "Sunset", // the piece is closed
  "EnforcedPause", // OpenZeppelin Pausable
  "LengthMismatch", // this Clock built the calldata wrong
  "EmptyBatch",
]);

/// Ids packed as 4-byte big-endian values, which is how the contract slices
/// them (`packedIds[i*4 : i*4+4]`). Byte-identical to viem's
/// encodePacked(["uint32",...]) -- checked, not assumed.
export function packIds(ids) {
  for (const id of ids) {
    if (!packableId(id)) {
      throw new Error(`token id ${id} does not fit in the 4 bytes the contract reads`);
    }
  }
  return "0x" + ids.map((id) => id.toString(16).padStart(8, "0")).join("");
}

/**
 * Can this id travel as the 4 bytes the contract decodes?
 *
 * 15.8. Exported so a caller can ASK rather than find out by catching. packIds
 * throws, is called with no `try`, and propagates all the way out of the run --
 * so one malformed row in the mirror stopped that night's check-ins, its Marks
 * and its reconcile, for every token. A row that cannot be sent is one row's
 * problem; it should be dropped by name and the night should continue.
 */
export function packableId(id) {
  return Number.isInteger(id) && id >= 0 && id <= 0xffff_ffff;
}

export function chunk(items, size) {
  if (!Number.isInteger(size) || size < 1) throw new Error(`chunk size must be a positive integer, got ${size}`);
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Write one chunk of `{ tokenId, day }` entries, shrinking it around whatever
 * the chain refuses.
 *
 * Returns `{ written, healed, dropped, aborted, attempts }`:
 *   written  - entries the chain accepted, in a landed transaction
 *   healed   - entries the chain ALREADY HELD. Not written by this run and not
 *              condemned either: the mirror was behind, and these rows must be
 *              marked written or they come back every night forever.
 *   dropped  - `{ entry, reason }` for each entry the chain condemned
 *   aborted  - a run-level reason, or null. When set, NOTHING was written and
 *              the caller must stop the whole run rather than continue.
 *
 * `lastDayOf(tokenId)` reads one token's `lastDay` from the chain, or null when
 * it cannot be read. It is what makes `DayNotAdvanced` recoverable; without it
 * the fallback is to condemn one entry per refusal, which is correct but slow.
 *
 * `maxAttempts` bounds the shrink loop. Without it a pathological chunk where
 * every entry is bad would make one call per entry; with it, the remainder is
 * reported as dropped for a named reason rather than hammering the node.
 */
export async function writeCheckInChunk(
  writer,
  entries,
  { maxAttempts = 12, log = () => {}, lastDayOf = null } = {}
) {
  let remaining = [...entries];
  const dropped = [];
  const healed = [];
  // `attempts` is every call made, for reporting. `shrinks` is the budget:
  // only calls that CONDEMNED something count against it.
  //
  // WHY HEALING IS NOT CHARGED TO IT. maxAttempts exists to stop a loop that is
  // not making progress from making one call per entry. A heal always makes
  // progress -- healDayNotAdvanced removes at least one entry from `remaining`
  // every time, or the caller falls through to the bisect -- so the loop is
  // already bounded by the chunk length. Charging heals to the same budget put
  // a hard ceiling of twelve on how many stale tokens could ever be recovered:
  // the thirteenth exhausted the loop, `written` came back empty, and NOTHING
  // was credited that night, on any token. That is the wedge, reintroduced by
  // its own fix.
  let attempts = 0;
  let shrinks = 0;

  while (remaining.length > 0) {
    if (shrinks >= maxAttempts) {
      for (const entry of remaining) dropped.push({ entry, reason: "attempts-exhausted" });
      return { written: [], healed, dropped, aborted: null, attempts };
    }
    attempts += 1;

    const result = await writer.send(
      "batchCheckIn",
      [packIds(remaining.map((e) => e.tokenId)), remaining.map((e) => e.day)],
      { label: `batchCheckIn x${remaining.length}` }
    );

    if (result.ok) {
      return {
        written: remaining,
        healed,
        dropped,
        aborted: null,
        attempts,
        hash: result.hash,
        // The block this landed in. A caller that VERIFIES the write has to
        // wait for a node that has imported it -- a public RPC is load
        // balanced, and a read straight after a receipt can hit a node that is
        // still behind. Measured on the live rehearsal, 2026-08-31.
        blockNumber: result.receipt?.blockNumber ?? null,
      };
    }

    // A transaction that reverted ON CHAIN has already cost gas and consumed a
    // nonce. It is not shrunk and retried here: something changed between the
    // simulation and the block, and the honest response is to stop and let the
    // next run re-read the world rather than guess at it.
    if (result.reason === "reverted-on-chain") {
      return { written: [], healed, dropped, aborted: "reverted-on-chain", attempts, hash: result.hash };
    }
    // A RECEIPT THAT NEVER ARRIVED IS NOT A FAILED SEND. The transaction is in
    // the mempool and may yet land, so this chunk must not be shrunk and it
    // must not be retried: retrying would double-send if it landed, and the
    // shrink loop would condemn perfectly good entries if it had not. The run
    // stops, naming the hash whose fate is unknown, and the next run resolves
    // it against the chain's own state through healDayNotAdvanced above.
    if (result.reason === "receipt-unknown") {
      return { written: [], healed, dropped, aborted: "receipt-unknown", attempts, hash: result.hash };
    }
    // 15.7. A CHUNK TOO BIG TO ESTIMATE IS HALVED, NOT ABANDONED.
    //
    // This branch used to abort the run for every reason that was not
    // `reverted-on-simulate`, and it sits BEFORE the bisect below -- so
    // `gas-estimate-too-large` could never reach the halve path that exists
    // precisely for it, and the consequence was that nobody was credited that
    // night at all. CHECKIN_CHUNK has been MEASURED since 2026-09-11 and leaves
    // 500,000 of margin, so this should not fire -- but a contract change that
    // makes a check-in dearer would reach it without any other warning.
    //
    // Halving is safe here in a way retrying is not: nothing was sent. The
    // estimate failed, so there is no transaction, no nonce and no gas spent.
    // A single entry that cannot be estimated is genuinely undeliverable and
    // is condemned by name.
    //
    // BOTH HALVES ARE WRITTEN. Until 2026-09-11 this kept the first half and
    // DISCARDED the second: those entries came back neither written nor
    // dropped, so the night reported success. writeInHalves is now the only
    // way either split happens.
    if (result.reason === "gas-estimate-too-large") {
      if (remaining.length === 1) {
        dropped.push({ entry: remaining[0], reason: "gas-estimate-too-large" });
        return { written: [], healed, dropped, aborted: null, attempts };
      }
      shrinks += 1;
      log(`batchCheckIn: ${remaining.length} entries will not estimate; writing them in two halves`);
      return writeInHalves(writer, remaining, { maxAttempts: maxAttempts - shrinks, log, lastDayOf }, { healed, dropped, attempts });
    }

    if (result.reason !== "reverted-on-simulate") {
      return { written: [], healed, dropped, aborted: result.reason, attempts, detail: result.detail };
    }

    const { errorName, errorArgs } = result;
    if (RUN_ERRORS.has(errorName)) {
      return { written: [], healed, dropped, aborted: errorName, attempts };
    }

    // DayNotAdvanced means the MIRROR is behind, not that the entry is bad, so
    // it is resolved against the chain rather than condemned. This is the whole
    // recovery path; see healDayNotAdvanced.
    if (errorName === "DayNotAdvanced" && errorArgs.length > 0) {
      const before = remaining.length;
      const outcome = await healDayNotAdvanced(remaining, errorArgs[0], lastDayOf);
      healed.push(...outcome.healed);
      dropped.push(...outcome.dropped);
      remaining = outcome.remaining;
      // Only the fallback path condemns, and only that is charged to the budget.
      if (outcome.dropped.length > 0) shrinks += 1;
      if (remaining.length < before) {
        if (outcome.healed.length > 0) {
          log(
            `clock: ${outcome.healed.length} check-in(s) for token ${errorArgs[0]} were already on chain; ` +
              "the mirror was behind and is now caught up"
          );
        }
        continue;
      }
      // The revert named a token with no entries here, which cannot happen from
      // a chunk this function built. Fall through to the bisect rather than
      // loop on a filter that removes nothing.
    }

    const rule = ENTRY_ERRORS[errorName];
    if (rule && errorArgs.length > 0) {
      const value = String(errorArgs[0]);
      const before = remaining.length;
      remaining = remaining.filter((e) => {
        const condemned = rule.by === "id" ? String(e.tokenId) === value : String(e.day) === value;
        if (condemned) dropped.push({ entry: e, reason: errorName });
        return !condemned;
      });
      if (remaining.length < before) {
        shrinks += 1;
        log(`clock: dropped ${before - remaining.length} entr${before - remaining.length === 1 ? "y" : "ies"} for ${errorName}(${value}), retrying ${remaining.length}`);
        continue;
      }
      // The error named a value that is not in this chunk. Falling through to
      // the bisect is right: continuing here would loop forever on a filter
      // that removes nothing.
    }

    // The error named nothing usable. Halve the chunk: the bad entry is in one
    // half, and this converges in log2(n) calls rather than n.
    if (remaining.length === 1) {
      dropped.push({ entry: remaining[0], reason: errorName ?? "unknown-revert" });
      return { written: [], healed, dropped, aborted: null, attempts };
    }
    log(`clock: ${errorName ?? "unknown revert"} named no entry, bisecting ${remaining.length} into ${Math.ceil(remaining.length / 2)}`);
    return writeInHalves(writer, remaining, { maxAttempts: maxAttempts - shrinks, log, lastDayOf }, { healed, dropped, attempts });
  }

  return { written: [], healed, dropped, aborted: null, attempts };
}

/**
 * Write `entries` as two halves, first then second, and merge what came back.
 *
 * BOTH SPLITS GO THROUGH HERE because the one that did not lost entries. The
 * gas-estimate halving kept the first half and discarded the rest, which came
 * back neither written nor dropped -- see clock-resilience.test.mjs. One helper
 * means the two can no longer disagree about what "halve" means.
 *
 * The first half goes first because entries arrive ordered by day: a token's
 * older day must land before its newer one, or the chain refuses the older one
 * for good (`day <= lastDay`).
 *
 * An abort in the first half stops here, and the second half is not sent. Its
 * entries stay queued and the run exits loudly, which is what an abort is for;
 * a discard, by contrast, reported success.
 */
async function writeInHalves(writer, entries, opts, sofar) {
  const half = Math.ceil(entries.length / 2);
  const first = await writeCheckInChunk(writer, entries.slice(0, half), opts);
  const halves = first.aborted
    ? [first]
    : [first, await writeCheckInChunk(writer, entries.slice(half), opts)];
  const last = halves.at(-1);
  return {
    written: halves.flatMap((h) => h.written),
    healed: [...sofar.healed, ...halves.flatMap((h) => h.healed)],
    dropped: [...sofar.dropped, ...halves.flatMap((h) => h.dropped)],
    aborted: last.aborted,
    attempts: sofar.attempts + halves.reduce((n, h) => n + h.attempts, 0),
    // Carried through rather than lost, as the bisect used to lose them: the
    // hash names a receipt-unknown transaction in the alert, and the block is
    // what a caller verifying the write must wait for.
    hash: last.hash,
    detail: last.detail,
    blockNumber: halves.map((h) => h.blockNumber).filter(Boolean).at(-1) ?? null,
  };
}
