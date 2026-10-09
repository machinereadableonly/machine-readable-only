// A prover that accepts every row, for tests of the run's own logic that are
// not about proof. Proof itself is tested against the real prover in
// clock-prove.test.mjs. Never import this from src/.
export const trustingProver = () => ({
  written() {},
  mint: async () => ({ ok: true }),
  seed: async () => ({ ok: true }),
  credit: async (row) => ({ ok: true, answer: row.answer }),
  mark: async () => ({ ok: true }),
});
