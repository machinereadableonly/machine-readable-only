// Where public keys come from, and the guard around fetching one.
//
// Two paths, one rule. An agent that has a domain hosts its own JWKS and sends
// Signature-Agent pointing at it. An agent that does not registers here and
// sends Signature-Agent pointing at us. Either way the key id is the RFC 7638
// thumbprint and the entry rule is identical.
import { lookup as dnsLookup } from "node:dns/promises";
import { jwkToKeyID } from "web-bot-auth";

/// A directory response larger than this is refused unread. A JWKS is a few
/// hundred bytes; anything near this cap is not one.
const MAX_BODY = 64 * 1024;
const FETCH_TIMEOUT_MS = 3000;

/// The address ranges a directory fetch must never reach. Without this, an
/// agent could name a URL that makes THIS machine fetch its own private
/// network, including a cloud metadata service.
export function isBlockedAddress(addr) {
  if (addr === "::1" || addr === "0.0.0.0" || addr.startsWith("fe80:") || addr.startsWith("fc") || addr.startsWith("fd")) {
    return true;
  }
  const p = addr.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p;
  if (a === 0 || a === 127) return true;                 // this host, loopback
  if (a === 10) return true;                             // private
  if (a === 172 && b >= 16 && b <= 31) return true;      // private
  if (a === 192 && b === 168) return true;               // private
  if (a === 169 && b === 254) return true;               // link-local and metadata
  if (a === 100 && b >= 64 && b <= 127) return true;     // carrier-grade NAT
  return false;
}

/**
 * Fetch somebody else's key directory, safely.
 *
 * `deps` exists so the guard is testable without a network: it takes `resolve`
 * and `fetch`, defaulting to the real ones.
 */
export async function guardedFetchDirectory(url, deps = {}) {
  const resolve = deps.resolve ?? (async (host) => (await dnsLookup(host, { all: true })).map((r) => r.address));
  const doFetch = deps.fetch ?? fetch;

  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("directory must be https");
  if (parsed.port && parsed.port !== "443") throw new Error("directory must be on port 443");

  for (const addr of await resolve(parsed.hostname)) {
    if (isBlockedAddress(addr)) throw new Error(`directory resolves to a blocked address: ${addr}`);
  }

  const res = await doFetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { accept: "application/http-message-signatures-directory+json, application/json" },
  });
  if (!res.ok) throw new Error(`directory returned ${res.status}`);

  const body = await res.text();
  if (body.length > MAX_BODY) throw new Error("directory body too large");
  return JSON.parse(body);
}

/**
 * Register a key on the easy path.
 *
 * Proof of possession is checked by the CALLER before this runs: the route
 * verifies a signature over a server nonce. This function stores what has
 * already been proved.
 */
export async function registerKey(q, jwk, now = Date.now(), directory = null) {
  let keyId;
  try {
    keyId = await jwkToKeyID(jwk, async (b) => crypto.subtle.digest("SHA-256", b), (u) => Buffer.from(u).toString("base64url"));
  } catch {
    return { ok: false, reason: "invalid-jwk" };
  }
  q.insertKey({ keyId, jwk, directory, registeredAt: now });
  return { ok: true, keyId };
}

/// The JWKS this site serves at /.well-known/http-message-signatures-directory.
/// Regenerated on each registration and written to disk for nginx to serve.
export function renderDirectory(q) {
  const rows = q.allKeys();
  return JSON.stringify({ keys: rows.map((r) => JSON.parse(r.jwk)) }, null, 2);
}

/**
 * Build the key lookup the verifier calls.
 *
 * If Signature-Agent names our own domain the key is ours to know, so it comes
 * from the mirror. Otherwise the agent's own directory is fetched and cached
 * for an hour.
 */
export function makeLookup(q, fetchDirectory, ourDomain, cache = new Map()) {
  return async function lookupKey(keyId, signatureAgent) {
    const agent = typeof signatureAgent === "string" ? signatureAgent.replace(/^"|"$/g, "") : null;
    const isOurs = !agent || agent.includes(ourDomain);

    if (isOurs) {
      const row = q.getKey(keyId);
      return row ? JSON.parse(row.jwk) : null;
    }

    const url = new URL("/.well-known/http-message-signatures-directory", agent).toString();
    const hit = cache.get(url);
    const now = Date.now();
    let jwks;
    if (hit && now - hit.at < 3_600_000) {
      jwks = hit.jwks;
    } else {
      try {
        jwks = await fetchDirectory(url);
      } catch {
        return null;
      }
      cache.set(url, { jwks, at: now });
    }

    for (const jwk of jwks?.keys ?? []) {
      const id = await jwkToKeyID(jwk, async (b) => crypto.subtle.digest("SHA-256", b), (u) => Buffer.from(u).toString("base64url"));
      if (id === keyId) return jwk;
    }
    return null;
  };
}

/**
 * The easy path in: POST /keys.
 *
 * The proof is a signature over a nonce THIS server issued, made with the key
 * being registered. Without it, registration would accept a public key from
 * anyone, including one lifted from somebody else's published directory.
 *
 * `allow` is the rate-limiting decision, passed in so the policy lives with the
 * route and the check stays testable without a clock.
 */
export async function registerRoute(q, { jwk, nonce, proof }, allow) {
  if (!allow()) return { ok: false, reason: "rate-limited" };
  if (!jwk || typeof nonce !== "string" || typeof proof !== "string" || proof === "") {
    return { ok: false, reason: "proof" };
  }

  let verified = false;
  try {
    const key = await crypto.subtle.importKey("jwk", jwk, "Ed25519", false, ["verify"]);
    verified = await crypto.subtle.verify(
      "Ed25519",
      key,
      Buffer.from(proof, "base64url"),
      new TextEncoder().encode(nonce)
    );
  } catch {
    return { ok: false, reason: "proof" };
  }
  // Nothing is stored unless the proof actually verified. Storing first and
  // checking after would leave unowned keys in the directory.
  if (!verified) return { ok: false, reason: "proof" };

  return registerKey(q, jwk, Date.now());
}
