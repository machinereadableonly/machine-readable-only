// The five-second entry challenge.
//
// This is an ACCESS CONDITION for an art piece: answering it is how a caller
// shows a program composed the request, because the answer must be computed
// between the 401 and the retry. It is deterministic, so no model is in the
// loop, and it is stateless, so nothing is keyed by IP and agents sharing one
// cloud NAT never collide.
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/// How long a challenge is good for. Short enough that it must be answered by
/// code, long enough to survive an ordinary round trip.
export const CHALLENGE_MS = 5000;

/// Compare two hex digests without leaking their difference through timing.
function sameDigest(a, b) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  if (x.length !== y.length || x.length === 0) return false;
  return timingSafeEqual(x, y);
}

const mac = (secret, nonce, ts) =>
  createHmac("sha256", secret).update(`${nonce}.${ts}`).digest("hex");

/**
 * Mint a challenge: `nonce.unix-ms.hmac`.
 *
 * The HMAC is what makes this stateless. The server keeps no record of what it
 * issued; it can recompute the HMAC later and see whether it minted the thing
 * in front of it.
 */
export function issueChallenge(secret, now = Date.now()) {
  const nonce = randomBytes(32).toString("base64url");
  const challenge = `${nonce}.${now}.${mac(secret, nonce, now)}`;
  return { challenge, expires: new Date(now + CHALLENGE_MS).toISOString() };
}

/**
 * Check a challenge and the caller's answer.
 *
 * `seen` gives burn-after-use. It only ever holds challenges from the last five
 * seconds, so it stays small; the caller sweeps it.
 */
export function checkChallenge(secret, challenge, answer, keyId, now = Date.now(), seen) {
  if (typeof challenge !== "string" || typeof answer !== "string") {
    return { ok: false, reason: "challenge" };
  }

  const parts = challenge.split(".");
  if (parts.length !== 3) return { ok: false, reason: "challenge" };
  const [nonce, ts, sig] = parts;

  if (!sameDigest(sig, mac(secret, nonce, ts))) return { ok: false, reason: "challenge" };

  // Expiry is checked AFTER the HMAC, so an unforgeable timestamp is the one
  // being judged. Checking it first would let anyone hand us any timestamp.
  const issuedAt = Number(ts);
  if (!Number.isFinite(issuedAt) || now - issuedAt > CHALLENGE_MS || now < issuedAt) {
    return { ok: false, reason: "expired" };
  }

  if (seen.has(challenge)) return { ok: false, reason: "challenge" };

  const expected = createHash("sha256").update(challenge + keyId).digest("hex");
  if (!sameDigest(answer, expected)) return { ok: false, reason: "challenge" };

  seen.add(challenge);
  return { ok: true };
}
