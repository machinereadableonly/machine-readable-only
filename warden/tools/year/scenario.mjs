// The twelve agents of the accelerated year, as data rather than as a script.
// One table, so the runner, the tally and the checker all read the same year.
//
// A day number here is a RUN day, counted from the start of the run, not the
// contract's own day. The runner maps one to the other.

const never = () => false;

// The four earned Marks, asked for at the run each one gates on. Shared by the
// agents whose script is simply "never miss, take everything a run earns".
const earnedLadder = [
  { id: 2, when: { run: 7 } }, { id: 4, when: { run: 30 } },
  { id: 6, when: { run: 100 } }, { id: 8, when: { run: 365 } },
];

export const AGENTS = [
  { name: "A1", mintDay: 0, misses: never, marks: earnedLadder, seeds: true },
  // A2 and A6 answer the daily question, so the band and verify-border are proven live.
  { name: "A2", mintDay: 0, misses: never, marks: earnedLadder, answers: true },
  { name: "A3", mintDay: 0, misses: never, marks: earnedLadder },
  { name: "A4", mintDay: 1, misses: never, marks: [] },
  { name: "A5", mintDay: 2, misses: never, marks: [
      { id: 1, when: { level: 1 } }, { id: 3, when: { level: 30 } },
      { id: 5, when: { level: 100 }, variant: 2 }, { id: 9, when: { level: 100 }, after: 5 },
      { id: 7, when: { level: 365 } } ] },
  { name: "A6", mintDay: 2, misses: never, marks: earnedLadder, answers: true },
  { name: "A7", mintDay: 2, misses: never, marks: [
      { id: 3, when: { level: 30 } }, { id: 6, when: { run: 100 } }, { id: 10, when: { run: 100 }, after: 6 } ] },
  { name: "A8", mintDay: 3, misses: (d) => (d - 3) % 10 === 0, marks: [] },
  { name: "A9", mintDay: 3, misses: (d) => d >= 54 && d < 114, marks: [] },
  { name: "A10", mintDay: 3, misses: never, marks: [], owner: [{ day: 120, kind: "rest" }] },
  { name: "A11", mintDay: 3, misses: never, marks: [],
    owner: [{ day: 50, kind: "transfer", to: "A12" }, { day: 51, kind: "rebind" }] },
  { name: "A12", mintDay: 20, misses: never, marks: [] },
];

/**
 * What one agent does on one run day: mint, check in, and any owner action.
 *
 * Check-ins start at mintDay + 1. The Clock mints with the day the agent PAID,
 * and the contract sets the new token's lastDay to that day, so the mint day is
 * the token's first credit and the very next day is already a day the chain
 * accepts. Both guards refuse only `day <= lastDay`.
 *
 * `rested` is handed in rather than read from the table: resting is a fact
 * about the token on chain, and only the runner knows whether the seal landed.
 */
export function todayFor(agent, day, { rested = false } = {}) {
  const owner = agent.owner?.find((o) => o.day === day)?.kind ?? null;
  return {
    mint: day === agent.mintDay,
    checkin: !rested && day >= agent.mintDay + 1 && !agent.misses(day),
    owner,
  };
}
