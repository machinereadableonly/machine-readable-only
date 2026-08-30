// Where public keys come from, and the guard around fetching one.
//
// Two paths, one rule. An agent that has a domain hosts its own JWKS and sends
// Signature-Agent pointing at it. An agent that does not registers here and
// sends Signature-Agent pointing at us. Either way the key id is the RFC 7638
// thumbprint and the entry rule is identical.
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup } from "node:dns";
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

  // EVERYTHING IN ::/64 IS JUDGED BY ITS LAST FOUR BYTES.
  //
  // Naming embedding forms one branch at a time was wrong twice on this
  // project: ::ffff:a.b.c.d was missed first, then ::ffff:0:a.b.c.d, the
  // RFC 2765 translated form. Both live in ::/64, as do ::a.b.c.d, :: and ::1,
  // and nothing globally routable does. Deciding the whole range at once by
  // reading the trailing IPv4 means no form can be forgotten, because no form
  // has to be named.
  if (zeros(8)) {
    if (zeros(16)) return true;                                  // ::
    if (zeros(15) && bytes[15] === 1) return true;               // ::1
    return blockedV4(bytes[12], bytes[13]);
  }
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
 * WHY node:https AND NOT fetch. The address check has to happen on the
 * connection the request actually makes. Validating with a DNS lookup and then
 * handing the URL to fetch leaves fetch to resolve again on its own, and an
 * agent controls its own DNS records: it answers with a public address for our
 * check and a private one for the connection. That is DNS rebinding, and
 * against it a pre-flight check is decoration.
 *
 * node:https takes a `lookup`, so the validation happens INSIDE the resolution
 * the socket uses. There is no window between checking and connecting.
 *
 * `deps` takes `request` and `lookup` so every path here is testable with no
 * network at all.
 */
export function guardedFetchDirectory(url, deps = {}) {
  const doRequest = deps.request ?? httpsRequest;
  const resolver = deps.lookup ?? dnsLookup;

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error("directory url is not a url"));
    }
    if (parsed.protocol !== "https:") return reject(new Error("directory must be https"));
    if (parsed.port && parsed.port !== "443") return reject(new Error("directory must be on port 443"));
    // Credentials in a directory URL have no legitimate use here, and they are
    // a classic way to make a URL parser and an HTTP client disagree about
    // which host is being addressed.
    if (parsed.username || parsed.password) {
      return reject(new Error("directory url must carry no credentials"));
    }

    // A HOSTNAME THAT IS ALREADY AN IP NEVER REACHES THE LOOKUP.
    //
    // Node connects straight to a literal address, so the pinned lookup below
    // is never called and the whole guard is skipped. Measured 2026-08-30:
    // https://169.254.169.254/x and https://127.0.0.1/x both opened a real
    // connection with lookup untouched. That needs no DNS control at all, so it
    // is a simpler attack than rebinding, not a harder one.
    //
    // Brackets are stripped because URL keeps them for IPv6, and note it also
    // normalises the literal: [::ffff:169.254.169.254] arrives as
    // [::ffff:a9fe:a9fe], which is why this is decided by isBlockedAddress
    // rather than by comparing text.
    const literal = parsed.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) !== 0 && isBlockedAddress(literal)) {
      return reject(new Error(`directory resolves to a blocked address: ${literal}`));
    }

    const pinnedLookup = (hostname, options, cb) => {
      resolver(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return cb(err);
        const list = Array.isArray(addresses) ? addresses : [addresses];
        if (list.length === 0) return cb(new Error("directory host does not resolve"));
        // EVERY answer is checked, not only the one that would be used: a
        // resolver returning one good address and one bad one gets no
        // connection at all.
        for (const a of list) {
          if (isBlockedAddress(a.address)) {
            return cb(new Error(`directory resolves to a blocked address: ${a.address}`));
          }
        }
        // Node asks for `all` itself when happy-eyeballs is on and then expects
        // the ARRAY back; returning a single address there fails with
        // "Invalid IP address: undefined".
        if (options && options.all) return cb(null, list);
        cb(null, list[0].address, list[0].family);
      });
    };

    const req = doRequest(
      {
        protocol: "https:",
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method: "GET",
        lookup: pinnedLookup,
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          accept: "application/http-message-signatures-directory+json, application/json",
          host: parsed.host,
        },
      },
      (res) => {
        // A redirect is refused, never followed: following one would repeat the
        // whole address decision against a host we never checked.
        if (res.statusCode >= 300 && res.statusCode < 400) {
          res.destroy();
          return reject(new Error("directory redirected"));
        }
        if (res.statusCode !== 200) {
          res.destroy();
          return reject(new Error(`directory returned ${res.statusCode}`));
        }

        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          // Capped WHILE reading. Reading the whole body and measuring it
          // afterwards means an unbounded response is already in memory by the
          // time it is refused.
          if (size > MAX_BODY) {
            res.destroy();
            return reject(new Error("directory body too large"));
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("directory is not valid json"));
          }
        });
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("directory timed out")));
    req.on("error", reject);
    req.end();
  });
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
