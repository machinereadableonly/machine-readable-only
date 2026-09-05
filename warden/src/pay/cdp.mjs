// Authentication for Coinbase's CDP facilitator, which is the only one that
// settles on Base MAINNET.
//
// WHY THIS FILE EXISTS AT ALL. `HTTPFacilitatorClient` is constructed with a
// url and nothing else, and the testnet host (https://x402.org/facilitator)
// needs no key -- so every measurement this project has ever taken exercised
// the unauthenticated path. The mainnet host answers 401 without a Bearer
// token. Left as it was, the cutover would have produced a piece that boots,
// looks healthy, and refuses every mint and every upgrade with
// `payment-unavailable` forever.
//
// WHY IT IS HAND-WRITTEN rather than taken from @coinbase/x402. That package is
// official and would work, but it pulls in @coinbase/cdp-sdk -- seven megabytes
// bringing axios, the Solana kit, jose and a second major of zod -- into a
// service that holds this repository's only private key, to do what is written
// below in about forty lines of node:crypto. The token format is fully
// specified by CDP's own authentication reference, and every part of it is
// checked offline in test/cdp.test.mjs against a key whose public half we hold.
//
// THE PART THAT IS EASY TO GET WRONG: the `uri` claim names the exact request
// being made, so ONE token cannot authenticate every call. That is precisely
// why @x402/core's `createAuthHeaders` returns headers keyed by path rather
// than a flat object -- and it throws on a flat one, deliberately, because the
// alternative is silently unauthenticated requests.
import { createPrivateKey, randomBytes, sign as signOneShot } from "node:crypto";

/// How long a token is good for. CDP's own limit is two minutes; a token is
/// minted per request, so there is no reason to go near it.
const TOKEN_TTL_SECONDS = 120;

/// base64url without padding, which is what JWT uses everywhere.
const b64url = (buf) => Buffer.from(buf).toString("base64url");

/**
 * Rebuild a PKCS#8 Ed25519 private key from CDP's 64-byte base64 secret.
 *
 * CDP hands out the raw Ed25519 key pair: 32 bytes of seed followed by the 32
 * byte public half. node:crypto cannot import that directly -- it wants DER --
 * so the seed is wrapped in the fixed PKCS#8 prefix for Ed25519. The prefix is
 * constant because every field in it is fixed for this algorithm: version 0,
 * the curve OID 1.3.101.112, and a 32-byte octet string.
 *
 * The public half is deliberately ignored rather than trusted: it is derivable
 * from the seed, and a secret whose two halves disagree is a corrupt secret,
 * not a usable one.
 */
function privateKeyFromCdpSecret(secret) {
  const raw = Buffer.from(secret, "base64");
  if (raw.length !== 64 && raw.length !== 32) {
    throw new Error(
      `CDP_API_KEY_SECRET decodes to ${raw.length} bytes; expected 64 (seed plus public half) or 32 (seed)`
    );
  }
  const seed = raw.subarray(0, 32);
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    seed,
  ]);
  return createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

/**
 * One CDP Bearer token, for one request.
 *
 * `uri` is CDP's own `${method} ${host}${path}` -- a space after the method and
 * NONE between host and path, so
 * "GET api.cdp.coinbase.com/platform/v2/x402/supported". It names the exact
 * call this token authorises and nothing else.
 *
 * THE CLAIM SET IS COPIED FROM COINBASE'S OWN GENERATOR, not from their prose
 * documentation, because the two disagree. `@coinbase/cdp-sdk`'s `generateJwt`
 * emits `uris` -- PLURAL, an array -- plus `iat`, and NO `aud` at all, while
 * the authentication reference describes a singular `uri` and an
 * `aud: ["cdp_service"]`. This was built from the prose first, and the result
 * signed cleanly, verified against its own key, passed every offline test and
 * was refused 401 by the live host.
 *
 * The comparison that settled it ran both generators against the same key and
 * printed both tokens (2026-09-05). Do not "simplify" `uris` back to `uri`, and
 * do not restore `aud`: the reference implementation is the specification here.
 */
export function cdpJwt({ keyId, secret, method, host, path, now = Date.now() }) {
  const key = privateKeyFromCdpSecret(secret);
  const issuedAt = Math.floor(now / 1000);
  const header = {
    alg: "EdDSA",
    kid: keyId,
    typ: "JWT",
    // Unique per token. It is what stops a captured token being replayed
    // within its two-minute life.
    nonce: randomBytes(16).toString("hex"),
  };
  const claims = {
    sub: keyId,
    iss: "cdp",
    // PLURAL, and an array. One token could authorise several calls; this one
    // authorises exactly the request it was minted for.
    uris: [`${method} ${host}${path}`],
    iat: issuedAt,
    nbf: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  // Ed25519 signs the message itself -- no separate digest, which is why this
  // is the one-shot sign() and not a createSign() stream.
  const signature = signOneShot(null, Buffer.from(signingInput), key);
  return `${signingInput}.${b64url(signature)}`;
}

/**
 * The `createAuthHeaders` @x402/core asks for, for a CDP facilitator.
 *
 * Returns a fresh token per path on every call, because each names its own
 * `uri` and each expires in two minutes. Minting four short-lived tokens per
 * facilitator round trip is cheaper than any cache that has to reason about
 * expiry, and it cannot serve a stale one.
 *
 * The four paths are the ones @x402/core actually requests. `bazaar` is
 * included because the discovery extension uses it; omitting a path means that
 * request goes out unauthenticated, which against CDP is a 401 rather than
 * anything dangerous -- but a 401 on settle is a payment that verified and then
 * failed to move, so nothing is left to chance here.
 */
export function makeCdpAuthHeaders({ keyId, secret, facilitatorUrl }) {
  const { host, pathname } = new URL(facilitatorUrl);
  // The base path is whatever the operator configured, so /platform/v2/x402
  // becomes /platform/v2/x402/settle. Trailing slashes are trimmed: a doubled
  // slash changes the uri claim and CDP compares it against the real request.
  const base = pathname.replace(/\/+$/, "");
  const bearer = (method, suffix) => ({
    Authorization: `Bearer ${cdpJwt({ keyId, secret, method, host, path: `${base}/${suffix}` })}`,
  });
  return async () => ({
    verify: bearer("POST", "verify"),
    settle: bearer("POST", "settle"),
    supported: bearer("GET", "supported"),
    bazaar: bearer("GET", "discovery/resources"),
  });
}

/// Whether a facilitator url is Coinbase's, and therefore needs a key. Matched
/// on the HOST rather than the whole url so a path change or a query string
/// cannot quietly turn the check off.
export function isCdpFacilitator(facilitatorUrl) {
  try {
    return new URL(facilitatorUrl).host.endsWith("cdp.coinbase.com");
  } catch {
    return false;
  }
}
