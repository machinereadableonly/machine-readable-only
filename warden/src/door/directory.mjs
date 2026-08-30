// Where public keys come from, and the guard around fetching one.
//
// Two paths, one rule. An agent that has a domain hosts its own JWKS and sends
// Signature-Agent pointing at it. An agent that does not registers here and
// sends Signature-Agent pointing at us. Either way the key id is the RFC 7638
// thumbprint and the entry rule is identical.
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { jwkToKeyID } from "web-bot-auth";

/// A directory response larger than this is refused unread. A JWKS is a few
/// hundred bytes; anything near this cap is not one.
const MAX_BODY = 64 * 1024;
const FETCH_TIMEOUT_MS = 3000;

/**
 * Expand an IPv6 literal to its 16 bytes, or null if it is not one.
 *
 * Written out because the decision below has to be made on the ADDRESS, not on
 * how it happens to be spelled. IPv6 has several ways to write the same
 * address, and a prefix test on the text misses most of them.
 */
function ipv6Bytes(addr) {
  const bare = addr.split("%")[0].toLowerCase();
  if (isIP(bare) !== 6) return null;
  let head = bare;
  let tail = "";
  if (bare.includes("::")) {
    const [h, t = ""] = bare.split("::");
    head = h;
    tail = t;
  }
  const expand = (part) => {
    if (!part) return [];
    const out = [];
    for (const piece of part.split(":")) {
      if (piece.includes(".")) {
        const quad = piece.split(".").map(Number);
        if (quad.length !== 4 || quad.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
        out.push((quad[0] << 8) | quad[1], (quad[2] << 8) | quad[3]);
      } else {
        out.push(parseInt(piece, 16));
      }
    }
    return out;
  };
  const h = expand(head);
  const t = expand(tail);
  if (h === null || t === null) return null;
  const groups = bare.includes("::")
    ? [...h, ...Array(8 - h.length - t.length).fill(0), ...t]
    : h;
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g))) return null;
  const bytes = [];
  for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  return bytes;
}

/// The IPv4 ranges a directory fetch must never reach.
function blockedV4(a, b) {
  if (a === 0 || a === 127) return true;                 // this host, loopback
  if (a === 10) return true;                             // private
  if (a === 172 && b >= 16 && b <= 31) return true;      // private
  if (a === 192 && b === 168) return true;               // private
  if (a === 169 && b === 254) return true;               // link-local, and the metadata address
  if (a === 100 && b >= 64 && b <= 127) return true;     // carrier-grade NAT
  if (a >= 224) return true;                             // multicast and reserved
  return false;
}

/**
 * Is this address one a directory fetch must never reach?
 *
 * Without this, an agent could name a URL that makes THIS machine fetch its own
 * private network, including the cloud metadata service.
 *
 * IT IS DECIDED ON BYTES, NEVER ON SPELLING. A text-prefix version of this
 * check shipped and was measured on 2026-08-30 to let EVERY blocked range
 * through in IPv4-mapped IPv6 form: `::ffff:169.254.169.254` was allowed and
 * the fetch really was made. That is not theoretical -- an agent registering
 * its own domain controls its own AAAA records, so it chooses what we resolve.
 * The mapped forms, the deprecated `::a.b.c.d` compatible form, NAT64 and 6to4
 * all carry an IPv4 address inside them, so each is unwrapped and judged by the
 * IPv4 rules.
 *
 * It also FAILS CLOSED on anything it cannot parse. The previous version
 * returned "not blocked" for any string that was not a dotted quad, which is
 * the wrong direction for a guard.
 */
export function isBlockedAddress(addr) {
  if (typeof addr !== "string" || addr === "") return true;
  const kind = isIP(addr.split("%")[0]);
  if (kind === 0) return true;                                   // not an IP at all
  if (kind === 4) {
    const [a, b] = addr.split(".").map(Number);
    return blockedV4(a, b);
  }

  const bytes = ipv6Bytes(addr);
  if (!bytes) return true;
  const zeros = (n) => bytes.slice(0, n).every((x) => x === 0);

  if (zeros(16)) return true;                                    // ::
  if (zeros(15) && bytes[15] === 1) return true;                 // ::1, loopback
  if (zeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return blockedV4(bytes[12], bytes[13]);                      // ::ffff:a.b.c.d
  }
  if (zeros(12)) return blockedV4(bytes[12], bytes[13]);         // ::a.b.c.d
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    return true;                                                 // 64:ff9b::/96, NAT64
  }
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return blockedV4(bytes[2], bytes[3]);                        // 2002::/16, 6to4
  }
  if ((bytes[0] & 0xfe) === 0xfc) return true;                   // fc00::/7, unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10, link-local
  if (bytes[0] === 0xff) return true;                            // multicast
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
