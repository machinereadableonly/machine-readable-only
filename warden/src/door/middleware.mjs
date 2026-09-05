// Sorting a request into one of four cases.
import { createHash } from "node:crypto";
import { issueChallenge, checkChallenge, CHALLENGE_MS } from "./challenge.mjs";
import { verifyRequest, headerOf, contentDigest, MAX_WINDOW_MS } from "./verify.mjs";

/**
 * Adapt a Node request to the shape the signature library takes.
 *
 * Two things here are load-bearing. Node's `req.url` is a path, and the
 * signature covers @authority and @path derived from a full URL, so it must be
 * made absolute. And the authority comes from OUR configured domain, never from
 * the Host header: behind a proxy that header is caller-controlled, and
 * trusting it would let a signature minted for another site verify here.
 */
export function toRequestLike(req, domain) {
  return { method: req.method, url: pinnedUrl(req.url, domain).toString(), headers: req.headers };
}

/**
 * Reduce a request target to a URL on OUR origin, whatever it claimed to be.
 *
 * THE TWO-STEP IS THE WHOLE POINT. Node passes the request target through
 * verbatim, and a target may carry its own authority: "//evil.example/mcp" is
 * protocol-relative and "http://evil.example/mcp" is absolute-form. Parsed
 * against a base, that authority WINS -- measured 2026-08-30, both produced
 * @authority = evil.example while pathname stayed /mcp. So the router still
 * dispatched to /mcp while the signature was verified against somebody else's
 * host, and a signature minted for any site at path /mcp was admitted here.
 *
 * Reducing to pathname + search first, then rebuilding on the configured
 * origin, leaves nothing for a target to override. Pinning at the CALL SITES
 * is what allowed this: it is done here, once, so no caller can forget.
 */
export function pinnedUrl(target, domain) {
  const origin = `https://${domain}`;
  const claimed = new URL(target, origin);
  return new URL(claimed.pathname + claimed.search, origin);
}

/// The body of a 401. It tells an agent everything it needs to come back.
export function challengeBody(challenge, expires, domain, reason) {
  const body = {
    challenge,
    expires,
    mcp: `https://${domain}/mcp`,
    docs: `https://${domain}/llms.txt`,
    client: `https://${domain}/client.mjs`,
  };
  if (reason) body.reason = reason;
  return body;
}

/**
 * Decide whether one request gets in.
 *
 * `deps` carries the secret, the key lookup, the spent-challenge set and the
 * per-day admitted set, so this function has no globals and tests can drive it.
 */
export async function admit(req, deps) {
  const { secret, lookupKey, seen, spent, domain, body = "", now = Date.now() } = deps;

  // A control a caller can lose by forgetting an argument is not a control.
  // There is no default here on purpose: an empty Map made per call would
  // remember nothing and every replay would be admitted, silently.
  if (!(spent instanceof Map)) {
    throw new Error("admit needs a `spent` Map to record signatures against");
  }

  const fail = (reason) => {
    const { challenge, expires } = issueChallenge(secret, now);
    return { ok: false, status: 401, body: challengeBody(challenge, expires, domain, reason) };
  };

  const like = toRequestLike(req, domain);
  const signature = headerOf(like, "signature");
  if (!signature) return fail(undefined);

  const verified = await verifyRequest(like, lookupKey);
  if (!verified.ok) return fail(verified.reason);

  // ONE SIGNATURE, ONE ADMISSION.
  //
  // The challenge is not a second factor and never was: key ids travel in
  // plaintext in Signature-Input, a fresh challenge is free and
  // unauthenticated, and the answer is a pure function of the two. So an
  // attacker holding one captured request could swap in its own challenge pair
  // and be admitted again, for as long as the signature lived -- up to five
  // minutes, unlimited times. The existing challenge-burn test missed it by
  // re-signing on each attempt, which is not what a replayer does.
  //
  // Recorded ONLY AFTER the cryptography has passed. Writing the set before the
  // proof would hand an attacker a way to pre-spend a signature it had seen but
  // could not use, locking out the agent that legitimately holds it.
  const sigHash = sigHashOf(signature);
  if (spent.has(sigHash)) return fail("replay");

  // THE BODY, CHECKED AFTER THE SIGNATURE AND NEVER BEFORE. Verification is
  // what proves the `content-digest` header is the one the caller signed;
  // comparing an unverified header to the body would only prove the attacker
  // can do arithmetic. `REQUIRED` guarantees the signature covered it, so by
  // this line the header is authentic and this compares it to what arrived.
  const offeredDigest = headerOf(like, "content-digest");
  if (offeredDigest !== contentDigest(body)) return fail("digest");

  const answer = headerOf(like, "challenge-response");
  const offered = headerOf(like, "challenge");
  const checked = checkChallenge(secret, offered, answer, verified.keyId, now, seen);
  if (!checked.ok) return fail(checked.reason);

  // THE EVIDENCE, CARRIED FORWARD. `credits.sigHash` is the record of which
  // signed request bought a day, and the door is the only place that ever
  // holds that signature. Hashing it here rather than storing the header
  // itself keeps a fixed-width value out of which nothing can be replayed,
  // while still being reproducible by anyone holding the original request.
  // Before this it was set by nobody and every credit row stored "".
  //
  // The signature is spent at the same moment it is honoured. It is remembered
  // until its own `expires`, which is the exact instant after which the library
  // would reject it anyway -- longer wastes memory, shorter reopens the window.
  spent.set(sigHash, verified.expiresAt ?? now + MAX_WINDOW_MS);
  return { ok: true, keyId: verified.keyId, sigHash };
}

/// SHA-256 of the Signature header value, in hex.
export function sigHashOf(signature) {
  return createHash("sha256").update(signature, "utf8").digest("hex");
}

// `headerOf` is imported from verify.mjs rather than written again here. It has
// to be case-blind (see its own comment), and two copies of that rule is two
// places for it to be got wrong.

/// Sweep spent challenges. They are only ever valid for five seconds, so
/// anything older than that window can go.
export function sweepSeen(seen, issuedAt = new Map(), now = Date.now()) {
  for (const challenge of seen) {
    const ts = Number(challenge.split(".")[1]);
    if (!Number.isFinite(ts) || now - ts > CHALLENGE_MS * 2) seen.delete(challenge);
  }
}

/**
 * Sweep spent signatures.
 *
 * Kept separate from `sweepSeen` because the two windows differ by two orders
 * of magnitude: a challenge lives five seconds, a signature up to five minutes.
 * Sweeping signatures on the challenge schedule would forget them while they
 * were still replayable, which is the whole failure this set exists to stop.
 *
 * Each entry carries its own expiry, so a signature minted with a short window
 * is forgotten sooner than one minted with the full five minutes.
 */
export function sweepSpent(spent, now = Date.now()) {
  for (const [sigHash, expiresAt] of spent) {
    if (!Number.isFinite(expiresAt) || expiresAt <= now) spent.delete(sigHash);
  }
}
