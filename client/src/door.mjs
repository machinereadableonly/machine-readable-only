// Getting in, and staying in.
//
// Three things happen here: registering a key with a site that will hold it,
// knocking to collect a challenge, and making one admitted request. Everything
// past the door is JSON-RPC, which mcp.mjs layers on top.
import { sign as edSign, createPrivateKey } from "node:crypto";
import { signRequest } from "./signing.mjs";
import { answerChallenge } from "./challenge.mjs";
import { publicFromPrivate } from "./keys.mjs";

/**
 * Register a key with the site, for an agent that has no domain of its own.
 *
 * Two requests. The nonce comes from the site; the proof is that nonce signed
 * with the key being registered, which is what stops anyone registering a
 * public key lifted from somebody else's published directory.
 *
 * If you DO have a domain, skip this entirely: host a JWKS at
 * /.well-known/http-message-signatures-directory and pass your own origin as
 * the signature agent. Nothing is registered and the site stores nothing.
 */
export async function registerKey({ origin, privateJwk, fetchImpl = fetch }) {
  const nonceRes = await fetchImpl(new URL("/keys/nonce", origin));
  if (!nonceRes.ok) throw new Error(`nonce request failed: ${nonceRes.status}`);
  const { nonce } = await nonceRes.json();

  // The nonce's own ASCII bytes, signed raw. Not hashed first, and not
  // wrapped in any envelope -- the server verifies exactly these bytes.
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  const proof = edSign(null, Buffer.from(nonce, "utf8"), key).toString("base64url");

  const res = await fetchImpl(new URL("/keys", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jwk: publicFromPrivate(privateJwk), nonce, proof }),
  });
  const body = await res.json();
  if (res.status !== 201) {
    // reason is one of: proof, nonce, invalid-jwk, rate-limited.
    throw new Error(`registration refused (${res.status}): ${body.reason ?? "unknown"}`);
  }
  return body.keyId;
}

/**
 * Knock, and collect a challenge.
 *
 * An unsigned POST earns a 401 whose body carries a fresh challenge. This is
 * the intended first request -- it is how you are meant to find out what to
 * answer, not a failure.
 */
export async function knock({ origin, path = "/mcp", fetchImpl = fetch }) {
  const res = await fetchImpl(new URL(path, origin), { method: "POST" });
  const body = await res.json();
  if (!body.challenge) throw new Error(`no challenge in a ${res.status} response`);
  return body;
}

/**
 * One admitted request: knock, sign, answer, send.
 *
 * A FRESH CHALLENGE PER REQUEST, always. Each one answers exactly once and
 * lives five seconds, so there is nothing to cache and reusing one is simply
 * refused. That is why this does the knock itself rather than taking a
 * challenge as an argument: a caller holding one for later would be holding
 * something already dead.
 *
 * THREE ADDRESSES, AND THEY ARE NOT THE SAME THING.
 *
 *   origin          where the bytes are actually sent
 *   site            the public https origin, which is what gets SIGNED
 *   signatureAgent  the directory holding your public key
 *
 * They collapse to one value in ordinary use, and `site` and `signatureAgent`
 * both default to `origin` for exactly that reason. They come apart the moment
 * anything sits in front of the server -- a tunnel, a local port, a proxy --
 * because the door pins @authority to ITS OWN configured domain and never to
 * the Host header it was sent. Sign over the address you dialled instead of
 * the address the site answers to and the signature will not verify, which is
 * the correct outcome: it is the same check that stops a signature minted for
 * another site being replayed here.
 *
 * `signatureAgent` is separate again: it is the site's origin when you
 * registered a key with it, and YOUR origin when you host your own JWKS.
 */
export async function admittedFetch({ origin, site = origin, privateJwk, signatureAgent = site, path = "/mcp", body, fetchImpl = fetch }) {
  const { challenge } = await knock({ origin, path, fetchImpl });
  // The body is signed, not just sent: the door binds the signature to it with
  // content-digest. `body` is passed through to fetch UNCHANGED below, so what
  // is hashed is exactly what goes on the wire -- re-serialising it here would
  // produce a digest for bytes nobody sends.
  const { headers, keyId } = await signRequest({ privateJwk, origin: site, signatureAgent, path, body });

  return fetchImpl(new URL(path, origin), {
    method: "POST",
    headers: {
      ...headers,
      challenge,
      "challenge-response": answerChallenge(challenge, keyId),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body,
  });
}
