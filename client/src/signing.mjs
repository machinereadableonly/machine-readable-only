// RFC 9421 request signing, Web Bot Auth profile.
//
// This is the part that would be a morning's work to write from scratch, and
// the reason this package exists at all. It is thin on purpose: the signing is
// done by `web-bot-auth`, the same library the door verifies with, and what
// this module adds is the four rules the door enforces on top of the standard.
import { createHash } from "node:crypto";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";

/**
 * The components the door requires a signature to cover.
 *
 * The standard mandates only @authority. The other four are the door's own
 * rule: method and path, signature-agent so the directory a key came from is
 * part of what was signed, and content-digest so the signature is bound to the
 * BODY. Sign fewer than these five and the door answers 401 with reason
 * "components".
 *
 * CONTENT-DIGEST IS THE ONE THAT MATTERS. Every call goes to POST /mcp, so
 * method and path are the same for every tool and separate none of them.
 * Without the digest, anyone who captures your Signature headers can send any
 * tool call they like as you until the signature expires -- and one key may
 * mint only once, ever. Added 2026-09-02.
 */
export const REQUIRED_COMPONENTS = ["@authority", "@method", "@path", "signature-agent", "content-digest"];

/**
 * The RFC 9530 `Content-Digest` for a body: `sha-256=:<base64>:`.
 *
 * Must produce byte-identical output to the door's own `contentDigest`, or
 * every request is refused with reason "digest".
 */
export function contentDigest(body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
  return `sha-256=:${createHash("sha256").update(bytes).digest("base64")}:`;
}

/// The door refuses a signature whose validity window is longer than five
/// minutes. One minute is plenty for a request that is about to be sent.
export const WINDOW_MS = 60_000;

/**
 * The headers for one signed request.
 *
 * `signatureAgent` is the URL of the directory holding your public key -- your
 * own domain if you host a JWKS, or the site's own origin if you registered
 * with it. It is sent quoted, which is what the standard's structured-field
 * syntax requires and a detail that is easy to get wrong.
 *
 * The URL signed is the PUBLIC https URL, not whatever local address the
 * request is actually sent to. The door pins @authority to its configured
 * domain rather than to the Host header, so a signature over anything else
 * simply will not verify -- which is the point, and is why this takes the
 * origin explicitly rather than inferring it.
 */
export async function signRequest({ privateJwk, origin, signatureAgent, method = "POST", path = "/mcp", body = "", now = new Date() }) {
  const signer = await signerFromJWK(privateJwk);
  const message = {
    method,
    url: new URL(path, origin).toString(),
    headers: {
      "signature-agent": `"${signatureAgent}"`,
      host: new URL(origin).host,
      // The EXACT bytes that will be sent. Sign a re-serialised copy of the
      // same object and the digest will not match what arrives.
      "content-digest": contentDigest(body),
    },
  };
  const signed = await signatureHeaders(message, signer, {
    created: now,
    expires: new Date(now.getTime() + WINDOW_MS),
    components: REQUIRED_COMPONENTS,
  });
  return { headers: { ...message.headers, ...signed }, keyId: signer.keyid };
}
