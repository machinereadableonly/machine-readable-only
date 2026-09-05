// Stand-ins for the `paid` gateway, in one place.
//
// NOT a *.test.mjs file, so `node --test "test/**/*.test.mjs"` does not try to
// run it as a suite.
//
// WHY THIS IS SHARED RATHER THAN COPIED. Three suites had grown their own
// `const settleNow = (fn) => fn`, which was correct until the gateway started
// handing every paid handler the nonce that will settle it. A copied stub does
// not get updated with the thing it stands in for: two of the three would still
// be driving a handler shape production does not have, and a test that passes
// against an impossible shape proves nothing. The same class of mistake has
// cost this project a paid mint once already.
//
// What the real gateway does, and what these must therefore do: call the
// handler as `handler(args, { payNonce })`, with a nonce unique to the call.

let n = 0;

/// A fresh payment nonce. Unique per call, because that is what lets two
/// concurrent calls be told apart -- which is the whole point of
/// settleAfterBothGated below.
export const nextNonce = () => `0xstub${(n += 1)}`;

/// The success path: run the handler straight through, with no gap between its
/// pre-check and its write. Right for a single call, useless for a race.
export const settleNow = (fn) => (args, ctx) => fn(args, { payNonce: nextNonce(), ctx });

/**
 * The success path with a real yield in the middle.
 *
 * node:sqlite is synchronous, so two `Promise.all`-launched handlers would
 * otherwise run their whole pre-check-then-write sequence back to back and
 * never interleave. Deferring past the point where BOTH have cleared their
 * pre-payment gate is what actually exercises the post-settlement re-check.
 */
export const settleAfterBothGated = (fn) => async (args, ctx) => {
  await Promise.resolve();
  await Promise.resolve();
  return fn(args, { payNonce: nextNonce(), ctx });
};

/**
 * The success path INCLUDING the settlement, which is what the real gateway
 * does when its onSettled callback is wired to the mirror.
 *
 * `settleNow` above stops one step short on purpose: it reserves and leaves the
 * row 'awaiting-payment', which is the right stand-in for a test asking what
 * the tool wrote. A test asking what the CLOCK will write needs the money to
 * have moved as well, because only a settled row is ever 'queued'. Handing a
 * test the wrong one of these is not a subtle difference -- it is the whole
 * distinction this design turns on.
 */
export const settleNowFor = (q) => (fn) => async (args, ctx) => {
  const payNonce = nextNonce();
  const result = await fn(args, { payNonce, ctx });
  if (result?.ok) q.settleByNonce(payNonce, `0xtx${payNonce}`);
  return result;
};

/// A `_meta` carrying a payment the gateway can read a nonce out of -- the real
/// EIP-3009 envelope shape, as @x402/mcp's own extractor parses it. For tests
/// that drive makePaymentGateway directly rather than through a tool.
export const metaWithPayment = (nonce = nextNonce()) => ({
  "x402/payment": {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:84532",
    payload: { authorization: { nonce }, signature: "0x00" },
  },
});
