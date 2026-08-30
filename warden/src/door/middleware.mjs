// Sorting a request into one of four cases.
import { createHash } from "node:crypto";
import { issueChallenge, checkChallenge, CHALLENGE_MS } from "./challenge.mjs";
import { verifyRequest, headerOf } from "./verify.mjs";

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
  const { secret, lookupKey, seen, domain, now = Date.now() } = deps;

  const fail = (reason) => {
    const { challenge, expires } = issueChallenge(secret, now);
    return { ok: false, status: 401, body: challengeBody(challenge, expires, domain, reason) };
  };

  const like = toRequestLike(req, domain);
  const signature = headerOf(like, "signature");
  if (!signature) return fail(undefined);

  const verified = await verifyRequest(like, lookupKey);
  if (!verified.ok) return fail(verified.reason);

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
  return { ok: true, keyId: verified.keyId, sigHash: sigHashOf(signature) };
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
