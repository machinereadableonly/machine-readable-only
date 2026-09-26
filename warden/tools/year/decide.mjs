// The runner's decisions, with no chain and no network in them, so the year's
// judgement can be tested without a year.

/**
 * The refusals a retry cannot change.
 *
 * These are the check-in tool's own reasons (warden/src/mcp/tools/checkin.mjs
 * and the gates it calls): a token that does not exist, one bound to another
 * key, one already credited today, one sealed by its owner, a finished year,
 * and a contract paused or sunset. Asking again inside the same run day gets
 * the same answer, so the runner records it and moves on.
 *
 * `chain-unavailable` and `not-yet-mirrored` are deliberately NOT here: the
 * first is an RPC that may answer next time, the second a mirror that catches
 * up on its own. Anything unrecognised is retried too, because an unknown
 * failure is likelier transport than judgement.
 */
export const FINAL_REASONS = new Set([
  "already-credited-today", "resting", "sunset", "paused",
  "not-bound-to-caller", "year-complete", "unknown-token",
]);

export const MAX_ATTEMPTS = 3;

/**
 * The Marks this agent should ask for now.
 *
 * `view` is the token as the Warden reports it; `requested` holds the ids
 * already asked for this run, so nothing is ordered twice. `held` is the marks
 * word from the chain, and an `after` entry waits for that Mark's bit in it --
 * pair five is bought on both sides and the second side needs the first.
 *
 * A Mark the chain ALREADY carries is not due either, whatever `requested`
 * says: a run resumed after a restart begins with an empty `requested` set, and
 * ordering a Mark the token holds is a payment the contract then refuses.
 *
 * A run gate reads `view.bestRun`, never the live streak, because that is what
 * the contract's `_effectiveRun` admits a Mark on.
 */
export function dueMarks(agent, view, requested, held) {
  return agent.marks.filter((m) => {
    if (requested.has(m.id)) return false;
    if (held & (1n << BigInt(m.id))) return false;
    if (m.after !== undefined && !(held & (1n << BigInt(m.after)))) return false;
    if (m.when?.level !== undefined && view.level < m.when.level) return false;
    if (m.when?.run !== undefined && view.bestRun < m.when.run) return false;
    return true;
  });
}

/// reserve: USDC still needed for mints not yet paid, so a Mark never starves a mint.
export function buyOrDemand({ price, balance, reserve }) {
  return balance - reserve >= price ? "buy" : "demand-only";
}

/// Whether to ask again after this answer, given the attempt just made.
export function shouldRetry(result, attempt) {
  if (result?.ok === true || attempt >= MAX_ATTEMPTS) return false;
  return !FINAL_REASONS.has(result?.reason);
}
