// Seeding the mirror with state that is meant to already be PAID FOR.
//
// NOT a *.test.mjs file, so `node --test "test/**/*.test.mjs"` does not try to
// run it as a suite.
//
// WHY THIS EXISTS. Since 2026-09-05 a mint is a two-step fact: the tool
// reserves it against a payment nonce, and the settlement hook promotes it when
// the money actually moves. Only the promoted row is one the Clock will write.
// A test that wants "a token somebody has paid for" therefore has to do both
// steps, and doing them by hand in each suite is how a fixture quietly ends up
// asserting against a state no real agent can produce.
//
// It deliberately goes through the REAL insertMint and the REAL settleByNonce
// rather than writing the finished row with SQL. A fixture that reaches past
// the code under test cannot notice when that code changes shape -- which is
// the whole reason the payment columns were unwritten and unnoticed for a week.
let nonce = 0;

/**
 * A mint that has been reserved AND settled: exactly what an agent who paid
 * leaves behind.
 *
 * The token row is the caller's job, as it always was -- some suites want a
 * token with a level, a streak or a lineage on it, and this should not have
 * opinions about that.
 */
export function seedPaidMint(q, { tokenId, toAddress, keyId }) {
  const payNonce = `0xtest${(nonce += 1)}`;
  q.insertMint({ tokenId, toAddress, keyId, payNonce });
  const settled = q.settleByNonce(payNonce, `0xtx${nonce}`);
  if (!settled) throw new Error(`seedPaidMint could not settle token ${tokenId}`);
  return payNonce;
}

/// A bought Mark that has been reserved AND settled. The earned Marks need
/// nothing like this: q.reserveMark queues them outright, because nothing
/// settles on that route.
export function seedPaidMark(q, tokenId, upgradeId, variant = 0) {
  const payNonce = `0xtestmark${(nonce += 1)}`;
  if (!q.reserveMarkPaid(tokenId, upgradeId, variant, payNonce)) {
    throw new Error(`seedPaidMark could not reserve mark ${upgradeId} on token ${tokenId}`);
  }
  const settled = q.settleByNonce(payNonce, `0xtx${nonce}`);
  if (!settled) throw new Error(`seedPaidMark could not settle mark ${upgradeId} on token ${tokenId}`);
  return payNonce;
}
