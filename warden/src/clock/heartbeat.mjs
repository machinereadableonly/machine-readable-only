// WHEN THE CLOCK MUST SAY, ON CHAIN, THAT THE OPERATOR IS STILL HERE.
//
// The contract's `sunsetByAbsence` measures silence from `lastWardenDay`, which
// only advances inside `onlyWarden` -- and every one of those functions needs
// real work to do. This Clock writes nothing on a day with no credits, no mints
// and no mark orders, so the stamp stops advancing when AGENTS go quiet, not
// only when the operator does. A year of that and any stranger may close the
// piece permanently, with the operator present and paying to host it.
//
// `heartbeat()` exists for exactly this and writes no token state. A make-work
// check-in would stamp the day just as cheaply and is refused on meaning: it
// would forge the return visit the artwork is a record of.

/// How much silence to allow before saying something. Not close to the
/// contract's 365: the margin is what survives the Clock itself being down.
/// At 30 an idle piece pays about twelve cheap transactions a year, and the
/// Clock would have to be broken for eleven months before the ending became
/// reachable -- long enough that the absence it measures would be real.
export const HEARTBEAT_AFTER_DAYS = 30;

/**
 * Should this run send a heartbeat?
 *
 * The field is `why`, not `reason`: `reason` is this service's AGENT-FACING
 * refusal vocabulary, and `next-steps.test.mjs` requires every one of those to
 * carry a prescription an agent can act on. This decision is internal and has
 * no agent on the other end of it; borrowing that word would either break that
 * guard or quietly weaken it.
 *
 * Pure so it can be tested without a chain: the wiring in `run.mjs` supplies
 * what it reads.
 *
 * @param {object} o
 * @param {number} o.today          the contract's day index
 * @param {number} o.lastWardenDay  the stamp as the CHAIN holds it
 * @param {boolean} o.wroteThisRun  did this run already write anything on chain
 * @param {boolean} [o.sunset]      the piece is already closed
 * @param {number} [o.afterDays]
 * @returns {{ due: boolean, why: string, gap: number }}
 */
export function heartbeatDue({
  today,
  lastWardenDay,
  wroteThisRun,
  sunset = false,
  afterDays = HEARTBEAT_AFTER_DAYS,
}) {
  const gap = today - lastWardenDay;

  // A closed piece cannot be held open and must not be pretended otherwise.
  // `isSunset` is one-way; a heartbeat here would be a no-op that costs gas and
  // reads, in a log, like the piece is still alive.
  if (sunset) return { due: false, why: "sunset", gap };

  // Any real write already stamped the day inside `onlyWarden`. Sending a
  // heartbeat too would pay for a second transaction to say what the first
  // already said.
  if (wroteThisRun) return { due: false, why: "already-stamped", gap };

  // A gap can read NEGATIVE against a lagging RPC (a read served by a node
  // behind the one that wrote). Treat it as fresh rather than as a reason to
  // write: a public RPC is not read-after-write consistent, which this project
  // has measured before.
  if (gap < afterDays) return { due: false, why: "recent-enough", gap };

  return { due: true, why: "quiet", gap };
}
