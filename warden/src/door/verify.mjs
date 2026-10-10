// SPDX-License-Identifier: MIT
// RFC 9421 verification: the piece's entry rule.
//
// web-bot-auth 0.2.0's verify() checks the profile: the tag, keyid, alg,
// created/expires, a bare @authority, and that a Signature-Agent dictionary is
// covered as exactly one keyed member (`"signature-agent";key="sig1"`). It
// does not check which OTHER components were covered, nor bound the window,
// nor leave `expires` without the skew allowance. Those are enforced here.
import { verify as webBotVerify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { parseDictionary, parseList } from "structured-headers";
import { createHash } from "node:crypto";

/**
 * The RFC 9530 `Content-Digest` header value for a body: `sha-256=:<base64>:`.
 * The door and the reference client must produce byte-identical values.
 */
export function contentDigest(body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
  return `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:`;
}

/// The standard sets no maximum window, so a signature could otherwise be
/// minted valid for a year and replayed for a year.
export const MAX_WINDOW_MS = 5 * 60 * 1000;

/**
 * How far into our future a signature's `created` may sit. RFC 9421 section 1.4
 * makes this ours to state. The cost: a signature created this far ahead is
 * live for its window plus this much against our clock. `expires` gets no
 * allowance.
 */
export const MAX_SKEW_MS = 60 * 1000;

/// The components a signature must cover. `content-digest` binds it to the
/// BODY: every call is POST /mcp, so method and path separate no tool.
/// `signature-agent` is covered as the keyed member when the header is a
/// dictionary, which web-bot-auth enforces.
export const REQUIRED = ["@authority", "@method", "@path", "signature-agent", "content-digest"];

/**
 * Why a refused signature was refused, when the reason is its TIMESTAMPS.
 * For diagnosis only, after a refusal: it parses attacker-shaped text and
 * decides nothing. Null when the timestamps are fine or unreadable.
 */
export function timeReason(request, now = Date.now()) {
  const input = headerOf(request, "signature-input");
  if (typeof input !== "string") return null;
  let created = null;
  let expires = null;
  let read = false;
  try {
    for (const [, value] of parseDictionary(input)) {
      const params = Array.isArray(value) ? value[1] : null;
      if (!params || typeof params.get !== "function") continue;
      const c = params.get("created");
      const e = params.get("expires");
      // Structured-field integers, in SECONDS since the epoch (RFC 9421).
      if (typeof c === "number") created = c * 1000;
      if (typeof e === "number") expires = e * 1000;
      read = true;
      break;
    }
  } catch {
    return null;
  }
  if (!read) return null;
  // A clock ahead first: it is the one a client can fix.
  if (created !== null && created > now + MAX_SKEW_MS) return "clock-skew";
  if (expires !== null && expires < now) return "expired";
  if (expires === null) return "window";
  return null;
}

/**
 * The component names a signature base covered, PARSED from its own
 * `@signature-params` line (lastIndexOf, so text forged earlier cannot win).
 * Null on anything unparseable. Used by the Clock on stored evidence.
 */
export function coveredComponents(base) {
  const marker = '"@signature-params": ';
  const at = base.lastIndexOf(marker);
  if (at === -1) return null;
  try {
    const parsed = parseList(base.slice(at + marker.length));
    if (parsed.length !== 1) return null;
    const [members] = parsed[0];
    if (!Array.isArray(members)) return null;
    // Only genuine strings: a Token or DisplayString stringifies to plain text.
    const names = members.map(([name]) => name);
    if (names.some((name) => typeof name !== "string")) return null;
    return names;
  } catch {
    return null;
  }
}

/**
 * `components` when the request's own Signature-Input already shows a refusal:
 * a required component missing, `signature-agent` covered more than once, a
 * `key=` naming a member the header does not have, or a dictionary covered
 * whole rather than by member. Null otherwise. For the
 * reason only; the decision is taken again on the verified components.
 */
function componentsProblem(request) {
  let members;
  try {
    const dict = parseDictionary(headerOf(request, "signature-input") ?? "");
    if (dict.size !== 1) return null;
    const [[list]] = dict.values();
    if (!Array.isArray(list)) return null;
    members = list;
  } catch {
    return null;
  }
  const names = members.map(([name]) => name);
  if (!REQUIRED.every((c) => names.includes(c))) return "components";
  const agents = members.filter(([name]) => name === "signature-agent");
  if (agents.length !== 1) return "components";
  const key = agents[0][1]?.get?.("key");
  let dict = null;
  try {
    dict = parseDictionary(headerOf(request, "signature-agent") ?? "");
  } catch {
    // The legacy bare string, covered whole.
  }
  if (key !== undefined && (typeof key !== "string" || !dict?.has(key))) return "components";
  // A dictionary must be covered as its member, never whole.
  if (key === undefined && dict && dict.size > 0) return "components";
  return null;
}

/// The request as http-message-sig 0.3.0 takes it: every header occurrence,
/// with the URL the middleware pinned to our domain.
function toDescriptor(request) {
  const fields = [];
  const add = (name, value) => {
    for (const v of Array.isArray(value) ? value : [value]) fields.push({ name: name.toLowerCase(), value: String(v) });
  };
  const h = request.headers ?? {};
  if (typeof h.forEach === "function") h.forEach((v, k) => add(k, v));
  else for (const [k, v] of Object.entries(h)) if (v !== undefined) add(k, v);
  return { kind: "request", method: request.method, targetUri: request.url, fields };
}

/**
 * Verify one request.
 *
 * `lookupKey(keyId, signatureAgentUrl)` returns the public JWK or null. The URL
 * is the member the signature COVERED (or the legacy bare string), as
 * web-bot-auth resolved it.
 */
export async function verifyRequest(request, lookupKey, { now = Date.now() } = {}) {
  const problem = componentsProblem(request);
  if (problem) return { ok: false, reason: problem };

  let reason = "signature";
  let jwk = null;
  let base = null;
  let verified;
  try {
    verified = await webBotVerify(toDescriptor(request), {
      clockSkew: MAX_SKEW_MS / 1000,
      now: new Date(now),
      async resolver(candidate) {
        try {
          jwk = await lookupKey(candidate.keyid, candidate.signatureAgent?.uri ?? null);
        } catch {
          // Fail closed, but say so: an outage is not bad crypto.
          reason = "directory";
          throw new Error("key lookup failed");
        }
        if (!jwk) {
          reason = "unknown-key";
          throw new Error("no key for that key id");
        }
        const inner = await verifierFromJWK(jwk);
        // The exact bytes checked are the replay identity and the Clock's evidence.
        return Object.freeze({
          algorithm: inner.algorithm,
          keyid: inner.keyid,
          async verify(data, signature) {
            base = data;
            return inner.verify(data, signature);
          },
        });
      },
      validate(sig) {
        const names = sig.components.map((c) => c.name);
        if (!REQUIRED.every((c) => names.includes(c)) || names.filter((n) => n === "signature-agent").length !== 1) {
          reason = "components";
          return false;
        }
        if (sig.expires.getTime() - sig.created.getTime() > MAX_WINDOW_MS) {
          // `window`, not `expired`: the remedy is to ask for less.
          reason = "window";
          return false;
        }
        // The skew allowance applies to `created` only.
        if (sig.expires.getTime() < now) {
          reason = "expired";
          return false;
        }
        return true;
      },
    });
  } catch {
    if (reason === "signature") reason = timeReason(request, now) ?? "signature";
    if (reason === "clock-skew" || reason === "expired") {
      return { ok: false, reason, serverTime: new Date(now).toISOString() };
    }
    return { ok: false, reason };
  }

  if (!verified?.keyid || !base) return { ok: false, reason: "signature" };
  const baseText = Buffer.from(base).toString("utf8");
  return {
    ok: true,
    keyId: verified.keyid,
    expiresAt: verified.expires.getTime(),
    // The signature BASE, not the Signature header: a relabelled header verifies
    // identically, so only what was signed identifies a signature.
    sigHash: createHash("sha256").update(base).digest("hex"),
    covered: verified.components.map((c) => c.name),
    evidence: { base: baseText, signature: Buffer.from(verified.signature).toString("base64"), jwk },
  };
}

/// One header, whatever case it was written in.
export function headerOf(request, name) {
  const h = request.headers;
  if (!h) return null;
  if (typeof h.get === "function") return h.get(name);
  const want = name.toLowerCase();
  for (const key of Object.keys(h)) {
    if (key.toLowerCase() === want) return h[key];
  }
  return null;
}
