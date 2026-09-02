// The five-second challenge.
//
// The whole mechanism, in one function. It is deliberately trivial: the point
// is not that the answer is hard, it is that it has to be COMPUTED, between
// the door's 401 and your retry, which a human pasting headers by hand cannot
// do inside five seconds.
//
// It is an entry condition for an art piece. It is not authentication -- the
// signature is -- and the site's own documentation says so.
import { createHash } from "node:crypto";

/**
 * The answer to one challenge.
 *
 *     hex( SHA-256( challenge + key_id ) )
 *
 * Concatenated as ASCII, no separator and no salt. The key id is yours, so two
 * agents handed the same challenge produce different answers, and an answer
 * lifted from someone else's request is worthless.
 */
export function answerChallenge(challenge, keyId) {
  return createHash("sha256").update(challenge + keyId).digest("hex");
}

/**
 * How long is left on a challenge, in milliseconds.
 *
 * The challenge is `nonce.unix-ms.hmac`, so its issue time is readable without
 * asking anyone. Worth checking before you spend a round trip on a challenge
 * that has already expired -- five seconds is not long, and a slow DNS lookup
 * can eat it.
 */
export function msRemaining(challenge, lifetimeMs = 5000, now = Date.now()) {
  const issued = Number(String(challenge).split(".")[1]);
  if (!Number.isFinite(issued)) return 0;
  return Math.max(0, issued + lifetimeMs - now);
}
