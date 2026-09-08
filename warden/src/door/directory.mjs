// SPDX-License-Identifier: MIT
// Where public keys come from, and the guard around fetching one.
//
// Two paths, one rule. An agent that has a domain hosts its own JWKS and sends
// Signature-Agent pointing at it. An agent that does not registers here and
// sends Signature-Agent pointing at us. Either way the key id is the RFC 7638
// thumbprint and the entry rule is identical.
import { createHash } from "node:crypto";
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
///
/// `c` is the third octet, needed by exactly one range: 192.88.99.0/24, the
/// 6to4 relay anycast prefix (RFC 7526). It is optional so the IPv6 unwrapping
/// below can call this with two octets where the third is not in hand -- those
/// paths pass all three.
function blockedV4(a, b, c) {
  if (a === 0 || a === 127) return true;                 // this host, loopback
  if (a === 10) return true;                             // private
  if (a === 172 && b >= 16 && b <= 31) return true;      // private
  if (a === 192 && b === 168) return true;               // private
  if (a === 169 && b === 254) return true;               // link-local, and the metadata address
  if (a === 100 && b >= 64 && b <= 127) return true;     // carrier-grade NAT
  if (a === 192 && b === 0) return true;                 // IETF protocol assignments, TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true;    // 6to4 relay anycast, RFC 7526
  if (a === 198 && (b === 18 || b === 19)) return true;  // benchmarking
  if (a === 198 && b === 51) return true;                // TEST-NET-2
  if (a === 203 && b === 0) return true;                 // TEST-NET-3
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
    const [a, b, c] = addr.split(".").map(Number);
    return blockedV4(a, b, c);
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
  // ALL OF ::/8 IS RESERVED SPACE, so it is decided in one place.
  //
  // ::/64 is the part that carries an embedded IPv4, and it is judged by that
  // address. Everything else under ::/8 -- NAT64 at 64:ff9b::, the reserved
  // ::ffff:0:0:a.b.c.d shape, and anything not yet invented -- is simply
  // refused. Enumerating embedding forms one branch at a time was wrong twice
  // on this project; refusing the whole reserved block means there is no next
  // form to miss.
  if (bytes[0] === 0x00) {
    if (!zeros(8)) return true;                                  // reserved, and not a global address
    if (zeros(16)) return true;                                  // ::
    if (zeros(15) && bytes[15] === 1) return true;               // ::1
    return blockedV4(bytes[12], bytes[13], bytes[14]);           // ::a.b.c.d, ::ffff:a.b.c.d
  }
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10, site-local
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return blockedV4(bytes[2], bytes[3], bytes[4]);              // 2002::/16, 6to4
  }
  // 2001::/32, Teredo. Like 6to4 and the relay anycast prefix above, this is an
  // ENCAPSULATION address: on a host with the tunnel configured it reaches a
  // relay rather than the public internet. No such tunnel exists on this box,
  // so this is hardening rather than a live path -- said plainly, because the
  // rest of this guard is load-bearing and this should not read as if it were
  // patching a hole. 2001:db8::/32 (documentation) is deliberately left alone:
  // it routes nowhere and blocking it buys nothing.
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true;
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
 * The RFC 7638 thumbprint of a JWK, or null if it is not a usable JWK.
 *
 * One converter, because this value is BOTH the primary key of the mirror's
 * `keys` table and the identity the registration budget is keyed on. Deriving
 * it twice from two call sites is how those two could come apart.
 */
export async function keyIdOf(jwk) {
  try {
    return await jwkToKeyID(jwk, async (b) => crypto.subtle.digest("SHA-256", b), (u) => Buffer.from(u).toString("base64url"));
  } catch {
    return null;
  }
}

/**
 * Register a key on the easy path.
 *
 * Proof of possession is checked by the CALLER before this runs: the route
 * verifies a signature over a server nonce. This function stores what has
 * already been proved.
 */
export async function registerKey(q, jwk, now = Date.now(), directory = null) {
  const keyId = await keyIdOf(jwk);
  if (keyId === null) return { ok: false, reason: "invalid-jwk" };
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
 * The rendered directory, remembered until the key table changes.
 *
 * WHY THIS IS NOT JUST A GET. The directory route is public, unsigned and
 * unmetered, and it used to call renderDirectory on EVERY request: read every
 * row, JSON.parse each stored JWK, re-serialise the lot with two-space
 * indentation. Measured at the 10,000-key ceiling that is 11.8 ms of
 * synchronous CPU and a 1,140,018-byte response per request -- roughly 85
 * requests a second to saturate one core of a single-process service with no
 * worker threads. Rendering once per CHANGE instead of once per READ turns the
 * hot path into a string copy.
 *
 * The ETag comes with it rather than as a second feature: a directory that
 * changes only on registration is exactly the thing a conditional GET is for,
 * and a 304 costs no body at all.
 *
 * `render` is injectable so a test can count how many times it actually runs;
 * nothing in the service passes it.
 */
export function makeDirectoryCache(q, render = renderDirectory) {
  let doc = null;
  return {
    current() {
      if (doc === null) {
        const body = render(q);
        doc = { body, etag: `"${createHash("sha256").update(body).digest("hex")}"` };
      }
      return doc;
    },
    /// Called after a successful registration. The next read re-renders.
    invalidate() {
      doc = null;
    },
  };
}

/**
 * Build the key lookup the verifier calls.
 *
 * If Signature-Agent names our own domain the key is ours to know, so it comes
 * from the mirror. Otherwise the agent's own directory is fetched and cached
 * for an hour.
 */
/// How many third-party directories are remembered at once. The key is a value
/// an unauthenticated caller chooses, so it cannot be allowed to grow forever.
const MAX_CACHED_DIRECTORIES = 256;

/// How long a fetched JWKS is trusted. This is the deliberate revocation
/// window: a key removed from an agent's own directory keeps verifying for up
/// to an hour, which is why identity changes are settled by the contract's
/// `rebind` rather than here.
const SUCCESS_TTL_MS = 3_600_000;

/// How long a FAILURE is remembered, and the ceiling on backing that off.
///
/// AN HOUR WAS THE WRONG NUMBER FOR THIS HALF, and it was a lockout anyone
/// could trigger. The cache key is derived from `Signature-Agent`, an
/// unverified header, and the lookup runs before any signature is checked -- so
/// one request naming a victim's directory during any transient of its host
/// wrote a failure that refused THAT AGENT's own requests for the next hour,
/// with no invalidation path and nothing it could do about it. Mid-mint, it
/// could not mint.
///
/// The short TTL keeps what the hour was actually for: without remembering
/// failures at all, every unauthenticated request naming an unreachable
/// directory becomes one outbound fetch, which is a prober pointed wherever the
/// caller likes. Repeated failures back off geometrically to the ceiling, so a
/// genuinely dead host is not re-probed on a 45-second loop for ever, while a
/// victim of a single transient is out for 45 seconds rather than an hour.
const FAILURE_TTL_MS = 45_000;
const FAILURE_TTL_CEILING_MS = 600_000;

/// How many outbound directory fetches may be in flight at once, process-wide.
///
/// The destination is already well constrained -- HTTPS only, port 443, no
/// credentials, no redirects, a fixed path, and every resolved address checked
/// inside the socket's own lookup. What was NOT bounded is the NUMBER: an
/// unauthenticated caller with a syntactically valid but worthless signature
/// could open one connection per request to any host it named, each held for up
/// to the timeout and each buffering up to MAX_BODY. That is a request
/// reflector aimed at a third party, and a memory cost here.
const MAX_INFLIGHT_FETCHES = 8;

/// Remember one directory result, evicting the oldest entry when full.
function rememberDirectory(cache, url, entry) {
  if (cache.size >= MAX_CACHED_DIRECTORIES && !cache.has(url)) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(url, entry);
}

/// Raised when the directory could not be FETCHED, as opposed to fetched and
/// found not to contain the key. verifyRequest turns a throw into
/// `reason: "directory"` and a null into `reason: "unknown-key"`, and those two
/// say opposite things to an honest client -- see makeLookup.
export class DirectoryUnavailableError extends Error {
  constructor(url, cause) {
    super(`directory could not be fetched: ${url}`);
    this.name = "DirectoryUnavailableError";
    this.cause = cause;
  }
}

export function makeLookup(q, fetchDirectory, ourDomain, cache = new Map(), inFlight = new Map(), clock = Date.now) {
  return async function lookupKey(keyId, signatureAgent) {
    const agent = typeof signatureAgent === "string" ? signatureAgent.replace(/^"|"$/g, "") : null;

    // WHOSE DIRECTORY IS THIS? Decided by exact hostname, never by substring.
    // `agent.includes(ourDomain)` treated https://attacker.net/?x=our.domain as
    // ours, and refused a legitimate third party whose own hostname happened to
    // contain our domain.
    let isOurs = !agent;
    if (agent) {
      try {
        isOurs = new URL(agent).hostname === ourDomain;
      } catch {
        return null;                                   // not a url: refuse, fail closed
      }
    }

    if (isOurs) {
      const row = q.getKey(keyId);
      return row ? JSON.parse(row.jwk) : null;
    }

    const url = new URL("/.well-known/http-message-signatures-directory", agent).toString();
    const hit = cache.get(url);
    const now = clock();

    // A cached SUCCESS is trusted for an hour -- the deliberate revocation
    // window, settled on chain by `rebind` rather than here. A cached FAILURE
    // is trusted for seconds, and backs off; see the two constants above for
    // why those are different numbers.
    let jwks;
    if (hit && now - hit.at < (hit.failed ? hit.ttl : SUCCESS_TTL_MS)) {
      // A REMEMBERED FAILURE IS "COULD NOT FETCH", NOT "NO SUCH KEY". Returning
      // null here told an honest agent its key id was wrong during an outage --
      // and the protocol document's own table sends it to re-derive its RFC
      // 7638 thumbprint, which that document already warns is the trap that
      // "produces a wrong key id silently". So it throws, and the door answers
      // `directory`: ours, not yours, try again.
      if (hit.failed) throw new DirectoryUnavailableError(url);
      jwks = hit.jwks;
    } else {
      // ONE FETCH PER URL, however many callers want it. The cache was written
      // only when a fetch SETTLED, so N concurrent requests naming one host all
      // missed and all went out. Sharing the promise means a burst costs one
      // outbound connection rather than N.
      let pending = inFlight.get(url);
      if (!pending) {
        // And a hard ceiling on how many DIFFERENT hosts can be in flight at
        // once, because sharing per URL does not bound a caller that names a
        // thousand different ones. Refusing is honest here: we could not fetch.
        if (inFlight.size >= MAX_INFLIGHT_FETCHES) {
          throw new DirectoryUnavailableError(url, new Error("too many directory fetches in flight"));
        }
        pending = fetchDirectory(url).finally(() => inFlight.delete(url));
        inFlight.set(url, pending);
      }
      try {
        jwks = await pending;
      } catch (err) {
        // Failures are remembered, briefly. Without that, every unauthenticated
        // request naming an unreachable directory becomes one outbound request,
        // which is a timing-observable prober pointed wherever the caller likes.
        // With an hour of it, one request was a lockout.
        const previous = hit?.failed ? hit.ttl : 0;
        const ttl = Math.min(previous ? previous * 2 : FAILURE_TTL_MS, FAILURE_TTL_CEILING_MS);
        rememberDirectory(cache, url, { failed: true, at: now, ttl });
        throw new DirectoryUnavailableError(url, err);
      }
      rememberDirectory(cache, url, { jwks, at: now });
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
 * `allow(keyId)` is the rate-limiting decision, passed in so the policy lives
 * with the route and the check stays testable without a clock.
 *
 * ORDER IS THE WHOLE POINT HERE, and it used to be wrong twice over.
 *
 * `allow()` ran FIRST, before a single field was validated, so 21 junk bodies
 * -- no jwk, no nonce, garbage proof -- spent the whole minute's budget and
 * every legitimate agent got a 429. POST /keys is the only way in for an agent
 * with no domain of its own, so that was the entrance closed by 21 requests
 * costing an attacker nothing. An invalid request must cost nothing NOW: the
 * budget is only reached once the JWK, the nonce and the proof have all
 * validated.
 *
 * And `allow` was called with no argument, so the budget it guarded could only
 * ever be global. It is now keyed on the RFC 7638 thumbprint of the key being
 * registered, which is the only identity this endpoint has that the caller
 * cannot choose freely -- it is derived from the key it has just PROVED
 * possession of. One key exhausting its own budget no longer touches anybody
 * else's.
 */
export async function registerRoute(q, { jwk, nonce, proof }, allow, checkNonce) {
  if (!jwk || typeof nonce !== "string" || typeof proof !== "string" || proof === "") {
    return { ok: false, reason: "proof" };
  }

  // THE NONCE MUST BE ONE THIS SERVER ISSUED, AND IT IS SPENT HERE.
  //
  // Without this the proof shows only that the caller holds the key, not that
  // the exchange is fresh: measured 2026-08-30, a nonce the caller invented was
  // accepted, and a captured {jwk, nonce, proof} triple replayed verbatim. With
  // INSERT OR REPLACE behind it, a replay also rewrites the stored directory
  // and registration time.
  if (!checkNonce(nonce)) return { ok: false, reason: "nonce" };

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

  // Everything about this request is now proved, so it may finally cost the
  // caller some of its own budget. The thumbprint has to be derived before the
  // budget check, because it IS the budget's key.
  const keyId = await keyIdOf(jwk);
  if (keyId === null) return { ok: false, reason: "invalid-jwk" };
  if (!allow(keyId)) return { ok: false, reason: "rate-limited" };

  // registerKey derives the thumbprint again rather than being handed this
  // one. That is one extra SHA-256 over a few hundred bytes, on a request that
  // has already verified an Ed25519 signature, and it buys a single storing
  // path instead of two -- both going through keyIdOf, so they cannot disagree
  // about what this key's id is.
  return registerKey(q, jwk, Date.now());
}
