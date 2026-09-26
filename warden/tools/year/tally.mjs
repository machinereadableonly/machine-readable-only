// What the chain should hold, computed from the days a token was credited.
// This is the checker's side of the run: it never reads the mirror, so a bug
// shared by the Warden and its database cannot hide inside agreement.

// The year's end, the contract's own FINISH_LEVEL. Written out rather than
// imported so this module stays free of the service it is checking.
export const FINISH_LEVEL = 365;

/// Which Mark a finishing place earns. Mirrors MachineReadableOnly's
/// `finisherMark`, whose bands are constants in the contract and not dials.
export function finisherMark(place) {
  if (place <= 1) return 15;
  if (place <= 4) return 14;
  if (place <= 14) return 13;
  if (place <= 64) return 12;
  return 11;
}

/**
 * The state a token should be in after being credited these days.
 *
 * `days` are chain days, the mint day included and in any order; repeats count
 * once, because the chain credits a day once.
 *
 * `bestRun` is the longest consecutive run in the list, which is what the
 * contract's `_effectiveRun` reports: `_credit` raises `bestRun` on the way up
 * and never lowers it, so max(streak, bestRun) is the longest run ever held.
 * The contract is the authority; if a live comparison ever disagrees, this is
 * what gets corrected.
 */
export function expected(days) {
  const sorted = [...new Set(days)].sort((a, b) => a - b).slice(0, FINISH_LEVEL);
  let streak = 0, bestRun = 0, prev = null;
  for (const d of sorted) {
    streak = prev !== null && d === prev + 1 ? streak + 1 : 1;
    bestRun = Math.max(bestRun, streak);
    prev = d;
  }
  return { level: sorted.length, streak, bestRun, lastDay: prev };
}

/**
 * The place each token finished in, and the Mark that place earns.
 *
 * Ties within a day break by lowest token id, which is the order the Clock
 * lists a batch in and therefore the order the contract assigns ordinals.
 */
export function places(finishes) {
  const order = [...finishes].sort((a, b) => a.day - b.day || a.tokenId - b.tokenId);
  return new Map(order.map((f, i) => [f.tokenId, { place: i + 1, markId: finisherMark(i + 1) }]));
}
