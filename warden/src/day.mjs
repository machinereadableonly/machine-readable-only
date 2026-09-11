// The length of a day, in ONE place.
//
// The contract's day is `block.timestamp / 1 days`, and every time the Warden
// tells an agent -- when the next window opens, when a run breaks, when a write
// is promised -- is derived from a day number. Until 2026-09-11 eight places
// multiplied by 86,400,000 by hand. They ask this module now, so the TEST-ONLY
// fast-days copy (docs/plans/2026-09-11-mro-fast-days.md) runs the same code
// with a five-minute day by setting MRO_DAY_SECONDS=300.
//
// THE DEFAULT IS A REAL DAY, and a wrong setting cannot pass quietly: main.mjs
// refuses to start when the contract's today() and this module's disagree by
// more than one, so a mismatch fails at boot instead of queueing days the
// chain refuses.

export const DEFAULT_DAY_SECONDS = 86_400;

/// When, after a day closes, the Clock is promised to have written it. The
/// real timer fires at 00:05 UTC; the fast copy's Clock runs 30 s after each
/// fast day and says so with MRO_CLOCK_OFFSET_SECONDS=30.
export const DEFAULT_CLOCK_OFFSET_SECONDS = 300;

/// A positive whole number of seconds from `env[name]`, or the default when it
/// is unset. Anything else throws: a day length that silently fell back would
/// be the one misconfiguration nobody noticed.
export function secondsFrom(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive whole number of seconds, got ${JSON.stringify(raw)}`);
  }
  return n;
}

export const DAY_MS = secondsFrom(process.env, "MRO_DAY_SECONDS", DEFAULT_DAY_SECONDS) * 1000;
export const CLOCK_OFFSET_MS =
  secondsFrom(process.env, "MRO_CLOCK_OFFSET_SECONDS", DEFAULT_CLOCK_OFFSET_SECONDS) * 1000;

/// Whole days since the epoch -- the contract's unit. Named for the real day it
/// is in production; on the fast copy it counts fast days.
export const utcDay = (now = Date.now()) => Math.floor(now / DAY_MS);

/// The instant a day begins, as an ISO string.
export const dayStartIso = (day) => new Date(day * DAY_MS).toISOString();

/// Does the chain's day agree with this box's? One day either side is allowed,
/// because a read can straddle a boundary; more than that means the day length
/// here is not the contract's.
export function dayMismatch(chainDay, boxDay = utcDay()) {
  const gap = Math.abs(Number(chainDay) - boxDay);
  return gap > 1 ? gap : 0;
}
