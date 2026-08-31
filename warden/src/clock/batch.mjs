// batchCheckIn, and the rule that one bad entry must not cost a whole day.
//
// THE PROBLEM. batchCheckIn reverts the WHOLE chunk on one bad entry, and a
// chunk is up to 1,500 tokens' days. Retrying it unchanged reverts again,
// forever, and every token in it loses that day permanently -- a token's record
// is the artwork, so a lost day is not a retryable inconvenience.
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
const ENTRY_ERRORS = {
  NoSuchToken: { by: "id" },
  Resting: { by: "id" },
  DayNotAdvanced: { by: "id" },
  FutureDay: { by: "day" },
};

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
    if (!Number.isInteger(id) || id < 0 || id > 0xffff_ffff) {
      throw new Error(`token id ${id} does not fit in the 4 bytes the contract reads`);
    }
  }
  return "0x" + ids.map((id) => id.toString(16).padStart(8, "0")).join("");
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
 * Returns `{ written, dropped, aborted, attempts }`:
 *   written  - entries the chain accepted, in a landed transaction
 *   dropped  - `{ entry, reason }` for each entry the chain condemned
 *   aborted  - a run-level reason, or null. When set, NOTHING was written and
 *              the caller must stop the whole run rather than continue.
 *
 * `maxAttempts` bounds the shrink loop. Without it a pathological chunk where
 * every entry is bad would make one call per entry; with it, the remainder is
 * reported as dropped for a named reason rather than hammering the node.
 */
export async function writeCheckInChunk(writer, entries, { maxAttempts = 12, log = () => {} } = {}) {
  let remaining = [...entries];
  const dropped = [];
  let attempts = 0;

  while (remaining.length > 0) {
    if (attempts >= maxAttempts) {
      for (const entry of remaining) dropped.push({ entry, reason: "attempts-exhausted" });
      return { written: [], dropped, aborted: null, attempts };
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
      return { written: [], dropped, aborted: "reverted-on-chain", attempts, hash: result.hash };
    }
    if (result.reason !== "reverted-on-simulate") {
      return { written: [], dropped, aborted: result.reason, attempts, detail: result.detail };
    }

    const { errorName, errorArgs } = result;
    if (RUN_ERRORS.has(errorName)) {
      return { written: [], dropped, aborted: errorName, attempts };
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
      return { written: [], dropped, aborted: null, attempts };
    }
    const half = Math.ceil(remaining.length / 2);
    log(`clock: ${errorName ?? "unknown revert"} named no entry, bisecting ${remaining.length} into ${half}`);
    const first = await writeCheckInChunk(writer, remaining.slice(0, half), { maxAttempts: maxAttempts - attempts, log });
    if (first.aborted) return { ...first, dropped: [...dropped, ...first.dropped], attempts: attempts + first.attempts };
    const second = await writeCheckInChunk(writer, remaining.slice(half), { maxAttempts: maxAttempts - attempts, log });
    return {
      written: [...first.written, ...second.written],
      dropped: [...dropped, ...first.dropped, ...second.dropped],
      aborted: second.aborted,
      attempts: attempts + first.attempts + second.attempts,
    };
  }

  return { written: [], dropped, aborted: null, attempts };
}
