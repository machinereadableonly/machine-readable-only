// RFC 9421 verification: the piece's entry rule.
//
// WHAT THE LIBRARY DOES AND DOES NOT DO. Read from web-bot-auth 0.1.3's own
// source on 2026-08-30, because the difference is the whole reason this file
// exists. verify() checks: the tag is web-bot-auth, created is not in the
// future, expires is not past, and keyid is present. It does NOT check WHICH
// components the signature covered, and it does NOT bound how long the
// signature is valid for. Both of those are required by the spec, so both are
// enforced here.
import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";

/// The spec's window bound. The standard sets no maximum, so a signature could
/// otherwise be minted valid for a year and replayed for a year.
export const MAX_WINDOW_MS = 5 * 60 * 1000;

/// The components a signature must cover. The standard mandates only
/// @authority; method and path are added so a signature captured from one tool
/// call cannot be replayed against a different one.
const REQUIRED = ["@authority", "@method", "@path", "signature-agent"];

/**
 * Verify one request.
 *
 * `lookupKey(keyId, signatureAgent)` returns the public JWK or null. The key id
 * is only known once the signature is parsed, which is why the lookup happens
 * inside the verifier callback rather than before the call.
 */
export async function verifyRequest(request, lookupKey) {
  const signatureAgent = headerOf(request, "signature-agent");
  let reason = "signature";

  try {
    await verify(request, async (data, signature, params) => {
      // `data` is the signature base: one line per covered component. Reading
      // the covered set from it needs no parser and cannot disagree with what
      // was actually signed.
      for (const component of REQUIRED) {
        if (!data.includes(`"${component}"`)) {
          reason = "components";
          throw new Error(`signature does not cover ${component}`);
        }
      }

      if (params.expires.getTime() - params.created.getTime() > MAX_WINDOW_MS) {
        reason = "expired";
        throw new Error("signature window exceeds five minutes");
      }

      const jwk = await lookupKey(params.keyid, signatureAgent);
      if (!jwk) {
        reason = "unknown-key";
        throw new Error("no key for that key id");
      }

      const verifier = await verifierFromJWK(jwk);
      await verifier(data, signature, params);
      reason = null;
    });
  } catch {
    // web-bot-auth throws on every failure, including its own expiry and tag
    // checks. `reason` carries whichever of ours fired; anything else is a
    // signature failure.
    return { ok: false, reason: reason ?? "signature" };
  }

  const keyId = keyIdFrom(request);
  if (!keyId) return { ok: false, reason: "signature" };
  return { ok: true, keyId };
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

/// The key id, read back off the Signature-Input header after verification has
/// already proved the signature over it.
function keyIdFrom(request) {
  const input = headerOf(request, "signature-input");
  const m = typeof input === "string" ? input.match(/keyid="([^"]+)"/) : null;
  return m ? m[1] : null;
}
