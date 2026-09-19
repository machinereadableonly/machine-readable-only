// SPDX-License-Identifier: MIT
// RFC 9421 verification: the piece's entry rule.
//
// WHAT THE LIBRARY DOES AND DOES NOT DO. Read from web-bot-auth 0.1.3's own
// source on 2026-08-30, because the difference is the whole reason this file
// exists. verify() checks: the tag is web-bot-auth, created is not in the
// future, expires is not past, and keyid is present. It does NOT check WHICH
// components the signature covered, and it does NOT bound how long the
// signature is valid for. Both of those are required by the spec, so both are
// enforced here.
// THE UNDERLYING VERIFIER, called directly.
//
// `web-bot-auth`'s own verify() wraps this with four checks and then hands
// control to the caller's verifier. Three of those four we want verbatim; the
// fourth refuses `created > Date.now()` with NO allowance whatsoever, and it
// is not configurable. A machine one second fast can therefore never be
// admitted by it -- and an unsynchronised clock is ordinary, not hostile.
//
// So the four checks live here now, in `verifyWebBotAuth` below, where the
// skew allowance can be stated and tested. This file already reimplemented
// the component check for the same reason (the library does not make one), so
// this is the existing division of labour, not a new one. http-message-sig is
// declared as a direct dependency because we call it directly; it is pinned to
// the exact version web-bot-auth itself resolves.
import { verify as httpsigVerify } from "http-message-sig";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { parseDictionary } from "structured-headers";
import { createHash } from "node:crypto";

/**
 * The RFC 9530 `Content-Digest` header value for a body.
 *
 * `sha-256=:<base64>:` -- a structured-field dictionary whose value is a byte
 * sequence, which is what the colons are. Exported because the door and the
 * reference client must produce byte-identical values, and because a test that
 * built its own would be testing its own arithmetic.
 */
export function contentDigest(body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
  return `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:`;
}

/// The spec's window bound. The standard sets no maximum, so a signature could
/// otherwise be minted valid for a year and replayed for a year.
export const MAX_WINDOW_MS = 5 * 60 * 1000;

/**
 * How far into our future a signature's `created` may sit.
 *
 * RFC 9421 says nothing about clock skew: section 1.4 makes it the
 * application's job to state how it determines validity, so this number is
 * ours to choose and to publish. Sixty seconds covers a box that has simply
 * not run ntp lately, which is the common case and is not an attack.
 *
 * THE COST, STATED. A signature created `MAX_SKEW_MS` ahead of us is live for
 * its own window plus that skew measured against OUR clock -- six minutes at
 * these numbers, not five. That is the whole price, it is bounded, and it buys
 * admission for every honest agent whose clock drifted.
 *
 * It does NOT extend a signature past its own `expires`, which is checked
 * against our clock with no allowance at all.
 */
export const MAX_SKEW_MS = 60 * 1000;

/**
 * web-bot-auth's four checks, with an allowance on one of them.
 *
 * Copied deliberately from web-bot-auth 0.1.3's verify() (read 2026-09-19) so
 * that `created` can carry a tolerance. Everything else is byte for byte what
 * the library does:
 *
 *   - the tag MUST be `web-bot-auth`;
 *   - `created` must not be in our future -- NOW: by more than MAX_SKEW_MS;
 *   - `expires` must not be in our past, with no allowance;
 *   - `keyid` MUST be present.
 *
 * `http-message-sig` checks `expires` itself as well, before this runs. The
 * duplicate is harmless and is kept so this function stands alone.
 */
async function verifyWebBotAuth(message, verifier, { now = Date.now(), skewMs = MAX_SKEW_MS } = {}) {
  return httpsigVerify(message, (data, signature, params) => {
    assertWebBotAuthParams(params, { now, skewMs });
    return verifier(data, signature, {
      keyid: params.keyid,
      created: params.created,
      expires: params.expires,
      tag: params.tag,
      nonce: params.nonce,
    });
  });
}

/**
 * The four checks themselves, exported so each can be driven on its own.
 *
 * They cannot be reached through `signatureHeaders`: it writes
 * `tag="web-bot-auth"` unconditionally and ignores any override (measured
 * 2026-09-19), so a wrong-tag or missing-keyid request cannot be produced by
 * signing one. Testing the predicate directly is the only way to show these
 * still refuse -- and showing that matters, because this file took them over
 * from the library in order to add the skew allowance.
 *
 * Throws on refusal, like the library's own, so the caller's catch is unchanged.
 */
export function assertWebBotAuthParams(params, { now = Date.now(), skewMs = MAX_SKEW_MS } = {}) {
  if (params.tag !== WEB_BOT_AUTH_TAG) throw new Error(`tag must be '${WEB_BOT_AUTH_TAG}'`);
  if (params.created.getTime() > now + skewMs) throw new Error("created in the future");
  if (params.expires.getTime() < now) throw new Error("signature has expired");
  if (params.keyid === undefined) throw new Error("keyid MUST be defined");
}

/// The tag web-bot-auth requires, and the one this door admits.
const WEB_BOT_AUTH_TAG = "web-bot-auth";

/// The components a signature must cover. The standard mandates only
/// @authority.
///
/// `content-digest` is what binds a signature to a BODY, and it is the whole
/// reason the other three are not enough here. Every MCP call is POST /mcp, so
/// @method and @path are identical across all nine tools and separate none of
/// them. Without the digest, a captured Signature pair authenticates ANY tool
/// call until it expires -- and the challenge is no second factor, because key
/// ids are public, challenges are free and unauthenticated, and the answer is a
/// pure function of the two. One key may mint once ever, so the worst case was
/// an attacker spending a victim's only mint. Found 2026-09-02 by a fresh
/// reader of the protocol doc; the comment here previously claimed method and
/// path prevented exactly this.
const REQUIRED = ["@authority", "@method", "@path", "signature-agent", "content-digest"];

/**
 * The component list a signature ACTUALLY covered.
 *
 * PARSED, never string-matched. Two bypasses were measured here on 2026-08-30
 * and both came from treating this structured field as text:
 *
 *  1. Searching the whole base for `"@path"` was satisfied by a COVERED header
 *     whose VALUE contained that text, leaving the real path unsigned. The same
 *     headers then replayed at DELETE /admin-evil.
 *  2. Splitting the parameters line on spaces was satisfied by a quoted
 *     component NAME containing a space -- `"a @method"` splits into `a` and
 *     `@method` -- with the same replay available. Component PARAMETERS
 *     carrying the text did it too.
 *
 * An RFC 8941 parser has none of those seams: `"a @method"` stays one member,
 * so it is simply not `@method`. Read from the base's own @signature-params
 * line (with lastIndexOf, so text forged earlier cannot win) because that line
 * belongs to the signature that was actually verified -- the Signature-Input
 * header may carry several.
 *
 * Returns null on anything unparseable, and the caller refuses on null.
 *
 * Exported so the non-string guard can be tested directly. Through a whole
 * request it is unreachable -- upstream rejects a non-string component before
 * this code runs -- and a test that could only reach it through upstream would
 * be proving upstream's check, not this one.
 */
/**
 * The URL a `Signature-Agent` header names, whichever encoding it uses.
 *
 * 3.M1. THIS ACCEPTED ONLY THE LEGACY FORM, and the legacy form is the one the
 * draft now tells signers not to send. web-bot-auth 0.1.3 treats the header as
 * opaque -- it only checks presence -- so the encoding decision is entirely
 * ours, and an agent following the current specification could not get in at
 * all. Worse, it was refused `unknown-key`, which points a correct implementer
 * at its thumbprint: the one thing that was not wrong.
 *
 * VERIFIED LIVE 2026-09-06, and the report this came from was one draft behind:
 * draft-meunier-web-bot-auth-architecture-05 is marked "Replaced by
 * draft-meunier-webbotauth-httpsig-protocol", whose -02 (August 2026) says
 *
 *   "`Signature-Agent` is a Dictionary Structured Header ... Its member values
 *    MUST be String Items that contain a [URI], whose scheme MUST be `https`."
 *
 * and, of the bare string,
 *
 *   "A verifier MAY accept that form ... Signers MUST send the dictionary
 *    form."
 *
 * So both are read, and neither is guessed at: the dictionary is parsed with
 * the same RFC 8941 parser the component list uses, because every bypass this
 * door has had came from treating a structured field as text.
 *
 * Returns the URL string, or null when the header is absent or unusable. The
 * caller refuses on null.
 */
/**
 * The label of the first signature in `Signature-Input` -- `sig1` in
 * `sig1=("@authority" ...)`.
 *
 * It is the key a dictionary `Signature-Agent` is expected to use, so it is
 * read from the request rather than assumed to be "sig1". Null when the header
 * is missing or will not parse, in which case a single-member dictionary is
 * still unambiguous and anything else is refused.
 */
/**
 * Why a refused signature was refused, when the reason is its TIMESTAMPS.
 *
 * WHY THIS IS NEEDED. web-bot-auth throws for created-in-the-future, for a
 * past `expires` and for a signature that simply does not verify, all the
 * same way and all before our verifier callback ever runs. So every one of
 * them arrived here as `signature`, whose published prescription is "check you
 * signed with the registered key and the right origin" -- advice a client with
 * a fast clock can follow forever without ever finding the problem. Clock skew
 * is ordinary; an unsynchronised box is one `ntp` away from being refused.
 *
 * FOR DIAGNOSIS ONLY, AND ONLY AFTER A REFUSAL. This parses attacker-shaped
 * text, so it decides nothing: the signature has already been refused by the
 * library when this is called, and the worst a liar can do is choose which
 * true-sounding word it is refused with. Admission is never reached from here.
 *
 * Returns null when the timestamps are fine or unreadable, in which case the
 * refusal keeps the word it already had.
 */
export function timeReason(request, now = Date.now()) {
  const input = headerOf(request, "signature-input");
  if (typeof input !== "string") return null;
  let created = null;
  let expires = null;
  try {
    for (const [, value] of parseDictionary(input)) {
      const params = Array.isArray(value) ? value[1] : null;
      if (!params || typeof params.get !== "function") continue;
      const c = params.get("created");
      const e = params.get("expires");
      // Structured-field integers, in SECONDS since the epoch (RFC 9421).
      if (typeof c === "number") created = c * 1000;
      if (typeof e === "number") expires = e * 1000;
      break;   // the first signature is the one this door reads
    }
  } catch {
    return null;
  }

  // A CLOCK AHEAD IS CHECKED FIRST, because it is the one a client can fix.
  // web-bot-auth refuses `created > now` with no tolerance at all, so this is
  // reached by an ordinary machine a minute out of step, not by an attacker.
  if (created !== null && created > now) return "clock-skew";
  if (expires !== null && expires < now) return "expired";
  return null;
}

export function signatureLabel(request) {
  const input = headerOf(request, "signature-input");
  if (typeof input !== "string") return null;
  try {
    const [first] = parseDictionary(input).keys();
    return first ?? null;
  } catch {
    return null;
  }
}

export function signatureAgentUrl(value, label = null) {
  if (typeof value !== "string" || value.trim() === "") return null;

  // The dictionary form first, because it is what a current signer sends.
  try {
    const dict = parseDictionary(value);
    if (dict.size > 0) {
      // Keyed by the label of the signature it belongs to. With one member the
      // key cannot be ambiguous; with several, only the one covering THIS
      // signature is ours to use.
      const entry = (label && dict.get(label)) ?? (dict.size === 1 ? [...dict.values()][0] : null);
      if (!entry) return null;
      const [item] = entry;
      return typeof item === "string" ? item : null;
    }
  } catch {
    // Not a dictionary. Fall through to the legacy string.
  }

  // The legacy bare sf-string: `Signature-Agent: "https://host"`.
  const bare = value.trim().replace(/^"|"$/g, "");
  return bare === "" ? null : bare;
}

export function coveredComponents(base) {
  const marker = '"@signature-params": ';
  const at = base.lastIndexOf(marker);
  if (at === -1) return null;
  try {
    // parseDictionary wants `label=value`; the label is discarded.
    const entry = parseDictionary("sig=" + base.slice(at + marker.length));
    const [members] = entry.get("sig");
    if (!Array.isArray(members)) return null;
    // Only genuine strings count. A structured-headers Token or DisplayString
    // stringifies back to its plain text, so String() would read %"@method" as
    // @method. Upstream rejects non-string components today, but this check
    // must not depend on that surviving a dependency bump -- it is the third
    // implementation of this rule, and the first two were both defeated.
    const names = members.map(([name]) => name);
    if (names.some((name) => typeof name !== "string")) return null;
    return names;
  } catch {
    return null;
  }
}

/**
 * Verify one request.
 *
 * `lookupKey(keyId, signatureAgent)` returns the public JWK or null. The key id
 * is only known once the signature is parsed, which is why the lookup happens
 * inside the verifier callback rather than before the call.
 */
export async function verifyRequest(request, lookupKey) {
  // The header as it arrived, and the URL it names -- which are not the same
  // thing since the field became a dictionary. See signatureAgentUrl.
  const signatureAgentHeader = headerOf(request, "signature-agent");
  const signatureAgent = signatureAgentUrl(signatureAgentHeader, signatureLabel(request));
  let reason = "signature";
  let verifiedKeyId = null;
  let verifiedExpiresAt = null;
  let verifiedSigHash = null;

  try {
    await verifyWebBotAuth(request, async (data, signature, params) => {
      const covered = coveredComponents(data);
      if (!covered) {
        reason = "components";
        throw new Error("signature base carries no @signature-params line");
      }
      for (const component of REQUIRED) {
        if (!covered.includes(component)) {
          reason = "components";
          throw new Error(`signature does not cover ${component}`);
        }
      }

      if (params.expires.getTime() - params.created.getTime() > MAX_WINDOW_MS) {
        // `window`, NOT `expired`. Nothing has expired: the client asked for a
        // validity longer than the door allows, and the remedy is to ask for
        // less. `expired`'s published prescription is "sign a fresh one per
        // request", which a client can follow forever without fixing this.
        reason = "window";
        throw new Error("signature window exceeds five minutes");
      }

      let jwk;
      try {
        jwk = await lookupKey(params.keyid, signatureAgent);
      } catch {
        // The directory could not be reached. Fail CLOSED, but say so: telling
        // an honest client its crypto is bad during an outage sends it to
        // debug the wrong thing.
        reason = "directory";
        throw new Error("key lookup failed");
      }
      if (!jwk) {
        reason = "unknown-key";
        throw new Error("no key for that key id");
      }

      const verifier = await verifierFromJWK(jwk);
      await verifier(data, signature, params);

      // The key id the library VERIFIED, captured here. Reading it back off the
      // raw header afterwards would mean trusting a regex over attacker-shaped
      // text to agree with what the cryptography actually checked.
      verifiedKeyId = params.keyid;
      // Taken from the VERIFIED parameters for the same reason as the key id:
      // it decides how long the door must remember this signature, and reading
      // it off the raw header would let a replayer shorten its own sentence.
      verifiedExpiresAt = params.expires.getTime();
      // THE REPLAY IDENTITY, AND IT IS THE SIGNATURE BASE -- the exact bytes
      // this verifier just checked -- not the raw `Signature` header.
      //
      // The header carries a LABEL (`sig1=`), RFC 9421 lets the caller choose
      // it, and the base does not contain it: the library strips it before
      // building `data`, and only requires the two headers to agree with each
      // other. So a captured request renamed `sig1` -> `sig2` in both headers
      // verifies identically while the header TEXT differs -- and the door,
      // which hashed that text, admitted the same signature once per label,
      // unbounded, for its whole five-minute life. Measured at twelve
      // admissions from one signature, and 200 over real HTTP.
      //
      // `data` cannot have that problem: it is what was signed, so anything a
      // replayer can change without breaking the signature is by definition
      // not in it, and it commits to created, expires, nonce and keyid.
      verifiedSigHash = createHash("sha256").update(data, "utf8").digest("hex");
      reason = null;
    });
  } catch {
    // web-bot-auth throws on every failure, including its own expiry, its
    // created-in-the-future check and its tag check. `reason` carries
    // whichever of OUR checks fired; anything else used to be called a
    // signature failure, which was a lie for the two time cases.
    if (reason === "signature") reason = timeReason(request) ?? "signature";
    // The server's own time, on the refusals where time IS the problem. It is
    // the single fact that makes a skew fixable from the other end: a client
    // that is told only "no" can do nothing, and one that is told our clock
    // can re-sign against it. Omitted elsewhere, because a timestamp beside
    // an unrelated refusal invites debugging the wrong thing.
    if (reason === "clock-skew" || reason === "expired") {
      return { ok: false, reason, serverTime: new Date().toISOString() };
    }
    return { ok: false, reason: reason ?? "signature" };
  }

  if (!verifiedKeyId) return { ok: false, reason: "signature" };
  return { ok: true, keyId: verifiedKeyId, expiresAt: verifiedExpiresAt, sigHash: verifiedSigHash };
}

/**
 * Read one header, whatever case it was written in.
 *
 * HTTP header names are case-insensitive (RFC 9110), and the two sources that
 * reach this function genuinely disagree: Node lowercases everything it
 * receives, while web-bot-auth's own signatureHeaders() returns "Signature" and
 * "Signature-Input" capitalized -- measured 2026-08-30. The library's verify()
 * is case-blind and finds them either way; a case-sensitive lookup here would
 * verify a signature successfully and then fail to read back its own key id.
 * A Headers instance handles case itself; a plain object is matched manually.
 */
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
