// The bitmap solve queue.
//
// WHY THIS EXISTS AT ALL. One robust QArt solve measured 9,695 ms and 532 MB
// resident on 2026-08-30. Node runs one thread, so doing that inside a request
// would freeze every other agent for ten seconds, and 532 MB is a real number
// on a 7.8 GB box. So a mint returns immediately and the solve happens here.
//
// The Clock does not need the bitmap until 00:05 UTC, which is hours of slack.

/// Three attempts, then stop and tell somebody. Without a cap a permanently
/// failing solve is re-claimed forever and the agent who paid for it hears
/// nothing.
export const MAX_TRIES = 3;

export function claimNext(q) {
  const row = q.nextPendingMint();
  if (!row) return null;
  q.setSolveState(row.tokenId, "solving");
  return row;
}

export function completeSolve(q, tokenId, qrHex) {
  q.completeSolve(tokenId, qrHex);
}

export function failSolve(q, tokenId, alert = console.error) {
  const tries = q.bumpSolveTries(tokenId);
  if (tries >= MAX_TRIES) {
    q.setSolveState(tokenId, "failed");
    // An agent has paid and has no artwork. This is the one place in the
    // service where money and a fallible computation meet, so it is never
    // silent.
    alert(`solve failed ${tries} times for token ${tokenId}; it has been paid for and has no bitmap`);
  } else {
    q.setSolveState(tokenId, "pending");
  }
}

/**
 * Drain the queue one claimed row at a time, until nothing pending remains.
 *
 * `spawn(tokenId)` is the injected boundary to the real work (the child
 * process in worker.mjs): it must return a promise that resolves to
 * `{ hex, mask, match }` on a successful solve, or reject on failure. Passing
 * it in rather than importing child_process here is what keeps this function
 * unit-testable without ever spawning a process or touching resvg's native
 * buffers.
 *
 * A row that keeps failing is retried in place -- claimNext hands out the
 * lowest pending tokenId, and failSolve puts a row that has not yet hit
 * MAX_TRIES straight back to 'pending' -- so it is reclaimed immediately on
 * the next iteration rather than starving the rest of the queue behind it.
 * Once MAX_TRIES is reached the row moves to 'failed' and claimNext stops
 * returning it, so the loop always terminates: every row ends in 'done' or
 * 'failed', never stuck in 'pending' or 'solving' forever.
 */
export async function runSolver(q, spawn, alert = console.error) {
  let row;
  while ((row = claimNext(q))) {
    try {
      const result = await spawn(row.tokenId);
      completeSolve(q, row.tokenId, result.hex);
    } catch {
      failSolve(q, row.tokenId, alert);
    }
  }
}
