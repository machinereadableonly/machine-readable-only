// Getting in, and staying in.
//
// Three things happen here: registering a key with a site that will hold it,
// knocking to collect a challenge, and making one admitted request. Everything
// past the door is JSON-RPC, which mcp.mjs layers on top.
import { sign as edSign, createPrivateKey } from "node:crypto";
import { signRequest } from "./signing.mjs";
import { publicFromPrivate } from "./keys.mjs";

/// What a registration proof signs; warden/src/door/directory.mjs builds the same.
export const registrationMessage = (origin, nonce) => `mro-key-registration-v1\n${origin}\n${nonce}`;

/// A site's nonce is `nonce.unix-ms.hmac`. Anything else is not signed: a
/// hostile site could hand over the bytes of a request it wants signed.
const NONCE_SHAPE = /^[A-Za-z0-9_-]{43}\.\d{13}\.[0-9a-f]{64}$/;

/**
 * Register a key with the site, for an agent with no domain of its own.
 *
 * Two requests: the site issues the nonce, and the proof is that nonce signed
 * with the key being registered, which stops anyone registering a public key
 * lifted from somebody else's published directory.
 *
 * An agent that HAS a domain skips this entirely: host a JWKS at
 * /.well-known/http-message-signatures-directory and pass that origin as the
 * signature agent, and the site stores nothing.
 *
 * `site` is the public origin the proof is bound to, `origin` is where the
 * requests go: the same split every signed request makes.
 */
export async function registerKey({ origin, site = origin, privateJwk, fetchImpl = fetch }) {
  const nonceRes = await fetchImpl(new URL("/keys/nonce", origin));
  if (!nonceRes.ok) throw new Error(`nonce request failed: ${nonceRes.status}`);
  const { nonce } = await nonceRes.json();
  if (typeof nonce !== "string" || !NONCE_SHAPE.test(nonce)) throw new Error("the site's nonce is not shaped nonce.ms.hmac; refusing to sign it");

  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  const proof = edSign(null, Buffer.from(registrationMessage(new URL(site).origin, nonce), "utf8"), key).toString("base64url");

  const res = await fetchImpl(new URL("/keys", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jwk: publicFromPrivate(privateJwk), nonce, proof }),
  });
  const body = await readJson(res, `${origin}/keys`);
  if (res.status !== 201) {
    // reason is one of: proof, nonce, invalid-jwk, rate-limited.
    throw new Error(`registration refused (${res.status}): ${body.reason ?? "unknown"}`);
  }
  return body.keyId;
}

/**
 * Read a JSON body, or say what actually came back.
 *
 * `res.json()` on a proxy error page throws `Unexpected token '<'`, which
 * names neither the site, the status, nor anything to do about it, and it
 * bypasses the whole DOOR_REASONS table on the way past. A site that is down,
 * proxied, or rate-limited by something in front of it is an ordinary thing to
 * meet, so it gets an ordinary sentence.
 */
async function readJson(res, what) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 200);
    throw new Error(`${what} answered ${res.status} with something that is not JSON: ${snippet || "(empty body)"}`);
  }
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
  const body = await readJson(res, `${origin}${path}`);
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
 * the Host header it was sent. Signing the address you dialled rather than the
 * one the site answers to will not verify, which is the same check that stops
 * a signature minted for another site being replayed here.
 *
 * `signatureAgent` is separate again: it is the site's origin when you
 * registered a key with it, and YOUR origin when you host your own JWKS.
 */
export async function admittedFetch({ origin, site = origin, privateJwk, signatureAgent = site, path = "/mcp", body, headers: extraHeaders = {}, fetchImpl = fetch, onTiming, clockOffsetMs = 0 }) {
  const started = Date.now();
  // WHY THE `challenge` TOOL IS NOT USED HERE. It exists to save this unsigned
  // knock, and for a client shaped like this one it saves nothing: a challenge
  // lives five seconds and is spent once, and the tool that mints the next one
  // is itself a signed call needing a challenge of its own. It would only pay
  // for a client that keeps a session open and calls repeatedly inside a
  // five-second window; every command here is one operation and exits.
  const { challenge } = await knock({ origin, path, fetchImpl });
  // The body is signed, not just sent: the door binds the signature to it with
  // content-digest. `body` is passed through to fetch UNCHANGED below, so what
  // is hashed is exactly what goes on the wire -- re-serialising it here would
  // produce a digest for bytes nobody sends.
  // `clockOffsetMs` is 0 except on the one retry after a `clock-skew` refusal,
  // where it carries this machine's difference from the site's clock so the
  // retry is stamped in the site's present. It shifts the timestamp only.
  const { headers } = await signRequest({
    privateJwk, origin: site, signatureAgent, challenge, path, body,
    now: new Date(Date.now() + clockOffsetMs),
  });

  const res = await fetchImpl(new URL(path, origin), {
    method: "POST",
    headers: {
      // The transport's own metadata headers, supplied by the caller because
      // only it knows the JSON-RPC method and name. They need not be signed:
      // they mirror values in the body, which content-digest binds to the
      // signature, so one that disagreed is caught by the server's header-body
      // validation rather than smuggled past the signature.
      //
      // FIRST, so the signed headers win every collision. Spread last, a
      // caller passing `challenge` would replace the pair the signature covers.
      ...extraHeaders,
      ...headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body,
  });

  // Five seconds is the piece's one theatrical rule and this is where an agent
  // meets it; a number is the smallest honest way to let it be felt.
  onTiming?.(Date.now() - started, CHALLENGE_LIFETIME_MS);
  return res;
}

/// The window the door allows. Named rather than repeated as a literal, because
/// the client reports it to the operator and a wrong number there is worse than
/// none.
export const CHALLENGE_LIFETIME_MS = 5000;
