import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { toRequestLike, pinnedUrl, challengeBody, admit, sweepSeen, sweepSpent } from "../src/door/middleware.mjs";
import { contentDigest, MAX_WINDOW_MS } from "../src/door/verify.mjs";
import { issueChallenge, CHALLENGE_MS } from "../src/door/challenge.mjs";
import { createServer } from "../src/server.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const VECTORS = JSON.parse(
  readFileSync(new URL("./vectors/web_bot_auth_architecture_v1.json", import.meta.url), "utf8")
);
const ED = VECTORS.find((v) => v.key.kty === "OKP");
const CLIENT_COMPONENTS = ["@authority", "@method", "@path", "signature-agent", "content-digest"];

// -- toRequestLike ----------------------------------------------------------

test("a Node request becomes an absolute URL for signature verification", () => {
  // Node gives req.url as a path only. @authority and @path are derived from
  // the URL, so a relative one would verify against the wrong authority.
  const like = toRequestLike(
    { method: "POST", url: "/mcp", headers: { host: "example.com", "signature-agent": '"https://example.com"' } },
    "example.com"
  );
  assert.equal(like.url, "https://example.com/mcp");
  assert.equal(like.method, "POST");
  assert.equal(like.headers["signature-agent"], '"https://example.com"');
});

test("the configured domain wins over a forged Host header", () => {
  // Behind nginx the Host header is attacker-controlled. Deriving @authority
  // from it would let a signature made for another site verify here.
  const like = toRequestLike(
    { method: "POST", url: "/mcp", headers: { host: "evil.example" } },
    "example.com"
  );
  assert.equal(like.url, "https://example.com/mcp");
});

test("pinnedUrl reduces a protocol-relative target's authority to the configured domain", () => {
  // "//evil.example/mcp" is protocol-relative; parsed against a base its
  // authority wins over the base's. pinnedUrl must not let that survive.
  const url = pinnedUrl("//evil.example/mcp", "example.com");
  assert.equal(url.host, "example.com");
  assert.equal(url.pathname, "/mcp");
});

test("pinnedUrl reduces an absolute-form target's authority to the configured domain", () => {
  const url = pinnedUrl("http://evil.example/mcp", "example.com");
  assert.equal(url.host, "example.com");
  assert.equal(url.pathname, "/mcp");
});

// -- challengeBody ------------------------------------------------------------

test("a challenge body says what the piece is, not only how to answer it", () => {
  const body = challengeBody("nonce.1.mac", "2026-01-01T00:00:00.000Z", "example.com");
  assert.deepEqual(body, {
    about: "An artwork that only admits programs. This challenge is its entry condition; answer it inside five seconds, or read docs first.",
    challenge: "nonce.1.mac",
    expires: "2026-01-01T00:00:00.000Z",
    mcp: "https://example.com/mcp",
    docs: "https://example.com/llms.txt",
  });
  assert.equal("reason" in body, false);
});

// C1.4. /client.mjs is answered 404 by design, so advertising it made the very
// first thing the piece says point at dead infrastructure. Its absence is also
// what makes this body and the `challenge` tool agree -- they did not before,
// and two challenge shapes from one service is a bug waiting to be believed.
test("the 401 advertises nothing the server does not serve", () => {
  const body = challengeBody("n.1.m", "exp", "example.com");
  assert.equal("client" in body, false, "put it back only when /client.mjs is served");
  assert.equal(JSON.stringify(body).includes("client.mjs"), false);
});

test("a challenge body carries the reason when one is given", () => {
  const body = challengeBody("n.1.m", "exp", "example.com", "expired");
  assert.equal(body.reason, "expired");
});

// -- admit --------------------------------------------------------------------

const SECRET = "test-secret";
const DOMAIN = "example.com";
const lookupED = async () => ED.key;

/// Build a signed request the way a real client will, with the challenge
/// headers a real client would also carry. `req.url` is a PATH, matching what
/// Node's IncomingMessage actually gives admit() -- the whole point of
/// toRequestLike is turning that back into what the signature covers.
async function signedRequest({ extraHeaders = {}, windowMs = 60_000, body = "", components = CLIENT_COMPONENTS } = {}) {
  const signer = await signerFromJWK(ED.key);
  const message = {
    method: "POST",
    url: `https://${DOMAIN}/mcp`,
    headers: {
      "signature-agent": `"https://${DOMAIN}"`,
      host: DOMAIN,
      "content-digest": contentDigest(body),
      ...extraHeaders,
    },
  };
  const created = new Date();
  const headers = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + windowMs),
    components,
  });
  return {
    method: "POST",
    url: "/mcp",
    headers: { ...message.headers, ...headers },
  };
}

function answerFor(challenge, keyId) {
  return createHash("sha256").update(challenge + keyId).digest("hex");
}

test("a request with no signature header gets a 401 challenge, undefined reason", async () => {
  const seen = new Set();
  const req = { method: "POST", url: "/mcp", headers: { host: DOMAIN } };
  const decision = await admit(req, { secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal("reason" in decision.body, false);
  assert.equal(typeof decision.body.challenge, "string");
  assert.equal(decision.body.mcp, `https://${DOMAIN}/mcp`);
});

test("a signed request with no challenge answer is refused with reason challenge", async () => {
  const seen = new Set();
  const req = await signedRequest();
  const decision = await admit(req, { secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 401);
  assert.equal(decision.body.reason, "challenge");
});

test("a signed request with a correct challenge answer is admitted", async () => {
  const seen = new Set();
  const signer = await signerFromJWK(ED.key);
  const { challenge } = issueChallenge(SECRET);
  const req = await signedRequest({
    extraHeaders: { challenge, "challenge-response": answerFor(challenge, signer.keyid) },
  });
  const decision = await admit(req, { secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN });
  assert.equal(decision.ok, true, `expected admission, got ${JSON.stringify(decision)}`);
  assert.equal(decision.keyId, signer.keyid);
});

test("the same challenge answer cannot be replayed", async () => {
  const seen = new Set();
  const signer = await signerFromJWK(ED.key);
  const { challenge } = issueChallenge(SECRET);
  const answer = answerFor(challenge, signer.keyid);
  const req1 = await signedRequest({ extraHeaders: { challenge, "challenge-response": answer } });
  const first = await admit(req1, { secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN });
  assert.equal(first.ok, true);

  const req2 = await signedRequest({ extraHeaders: { challenge, "challenge-response": answer } });
  const second = await admit(req2, { secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN });
  assert.equal(second.ok, false);
  assert.equal(second.body.reason, "challenge");
});

// -- one signature, one admission -------------------------------------------
//
// The test above pins the CHALLENGE burn and nothing more: it re-signs on each
// attempt, so it never presents the same signature twice. The challenge is not
// a second factor -- key ids are public, challenges are free and
// unauthenticated, and the answer is a pure function of the two -- so until the
// signature itself was recorded, one captured request was replayable for the
// whole five-minute window. Demonstrated at four admissions with one signature.

/// Swap in a fresh challenge pair, leaving the signature exactly as captured.
/// The challenge headers are not covered by the signature, which is what makes
/// this a replay rather than a forgery.
function withFreshChallenge(req, keyId) {
  const { challenge } = issueChallenge(SECRET);
  return {
    ...req,
    headers: { ...req.headers, challenge, "challenge-response": answerFor(challenge, keyId) },
  };
}

test("one captured signature cannot be presented twice, even with a fresh challenge", async () => {
  const seen = new Set();
  const spent = new Map();
  const signer = await signerFromJWK(ED.key);
  const deps = { secret: SECRET, lookupKey: lookupED, seen, spent, domain: DOMAIN };

  const captured = await signedRequest();
  const first = await admit(withFreshChallenge(captured, signer.keyid), deps);
  assert.equal(first.ok, true, `expected the first presentation to be admitted, got ${JSON.stringify(first)}`);

  const second = await admit(withFreshChallenge(captured, signer.keyid), deps);
  assert.equal(second.ok, false);
  assert.equal(second.body.reason, "replay");
});

test("a captured signature stays refused however many times it is presented", async () => {
  const seen = new Set();
  const spent = new Map();
  const signer = await signerFromJWK(ED.key);
  const deps = { secret: SECRET, lookupKey: lookupED, seen, spent, domain: DOMAIN };

  const captured = await signedRequest();
  const admitted = [];
  for (let i = 0; i < 5; i++) {
    const decision = await admit(withFreshChallenge(captured, signer.keyid), deps);
    if (decision.ok) admitted.push(decision.sigHash);
  }
  // Before the fix this was five admissions carrying one identical sigHash.
  assert.equal(admitted.length, 1);
});

test("two genuinely distinct signatures are both admitted", async () => {
  // The control. A replay guard that refused everything would pass the two
  // tests above and close the door.
  const seen = new Set();
  const spent = new Map();
  const signer = await signerFromJWK(ED.key);
  const deps = { secret: SECRET, lookupKey: lookupED, seen, spent, domain: DOMAIN };

  const one = await admit(withFreshChallenge(await signedRequest(), signer.keyid), deps);
  const two = await admit(
    withFreshChallenge(await signedRequest({ body: '{"n":2}' }), signer.keyid),
    { ...deps, body: '{"n":2}' }
  );
  assert.equal(one.ok, true);
  assert.equal(two.ok, true, `expected a distinct signature to be admitted, got ${JSON.stringify(two)}`);
  assert.notEqual(one.sigHash, two.sigHash);
});

test("a refused request records nothing, so its signature cannot be poisoned in advance", async () => {
  // If the set were written before the proof verified, an attacker could
  // pre-spend a signature it had seen but could not use, locking out the agent
  // that legitimately holds it. The same mistake is filed against the
  // registration nonce as 13.7.
  const seen = new Set();
  const spent = new Map();
  const signer = await signerFromJWK(ED.key);

  const captured = await signedRequest();
  const refused = await admit(withFreshChallenge(captured, signer.keyid), {
    secret: SECRET, lookupKey: async () => null, seen, spent, domain: DOMAIN,
  });
  assert.equal(refused.ok, false);
  assert.equal(spent.size, 0, "an unverified signature was recorded");

  // The same signature, once the key is known, is still good exactly once.
  const admitted = await admit(withFreshChallenge(captured, signer.keyid), {
    secret: SECRET, lookupKey: lookupED, seen, spent, domain: DOMAIN,
  });
  assert.equal(admitted.ok, true, `expected admission, got ${JSON.stringify(admitted)}`);
});

test("a spent signature is forgotten once its own window has passed", async () => {
  const seen = new Set();
  const spent = new Map();
  const signer = await signerFromJWK(ED.key);
  const deps = { secret: SECRET, lookupKey: lookupED, seen, spent, domain: DOMAIN };

  await admit(withFreshChallenge(await signedRequest(), signer.keyid), deps);
  assert.equal(spent.size, 1);

  // Sweeping while the signature is still live must keep it: dropping it early
  // would reopen the replay window rather than merely wasting memory.
  sweepSpent(spent, Date.now());
  assert.equal(spent.size, 1);

  sweepSpent(spent, Date.now() + MAX_WINDOW_MS + 1);
  assert.equal(spent.size, 0);
});

test("admit refuses to run without a spent set rather than silently allowing replay", async () => {
  // A security control that a caller can drop by forgetting an argument is not
  // a control. server.mjs owns the only real one.
  await assert.rejects(
    () => admit({ method: "POST", url: "/mcp", headers: {} }, { secret: SECRET, lookupKey: lookupED, seen: new Set(), domain: DOMAIN }),
    /spent/
  );
});

test("an unknown key is refused before any challenge is checked", async () => {
  const seen = new Set();
  const req = await signedRequest();
  const decision = await admit(req, { secret: SECRET, lookupKey: async () => null, seen, spent: new Map(), domain: DOMAIN });
  assert.equal(decision.ok, false);
  assert.equal(decision.body.reason, "unknown-key");
});

// -- the signature must be bound to the BODY --------------------------------
//
// Found 2026-09-02 by a fresh reader of the protocol doc, reasoning from the
// document's own statements. Every MCP call is POST /mcp, so @method and @path
// are identical across all nine tools and separate none of them. Without
// content-digest the body is unsigned, and a captured Signature pair
// authenticates ANY tool call until it expires -- up to five minutes.
//
// The challenge is not a second factor here: key ids are public, challenges are
// free and unauthenticated, and the answer is a pure function of the two. So
// these tests answer the challenge HONESTLY, exactly as an attacker holding a
// captured signature could.

const BODY_A = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "status" } });
const BODY_B = JSON.stringify({
  jsonrpc: "2.0", id: 1, method: "tools/call",
  params: { name: "mint", arguments: { to: "0x000000000000000000000000000000000000dEaD" } },
});

test("a signature bought for one body does not admit a different one", async () => {
  // THE ATTACK. One key may mint once, ever, so replaying a captured signature
  // against `mint` consumes the victim's only mint to an address of the
  // attacker's choosing. This is the test the whole fix exists for.
  const seen = new Set();
  const signer = await signerFromJWK(ED.key);
  const { challenge } = issueChallenge(SECRET);
  const req = await signedRequest({
    body: BODY_A,
    extraHeaders: { challenge, "challenge-response": answerFor(challenge, signer.keyid) },
  });

  const decision = await admit(req, {
    secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN, body: BODY_B,
  });

  assert.equal(decision.ok, false, "a swapped body must not be admitted");
  assert.equal(decision.body.reason, "digest");
});

test("a signature over the body it was made for is admitted", async () => {
  // The control. Without this the test above passes for a token that refuses
  // everything, which would prove nothing.
  const seen = new Set();
  const signer = await signerFromJWK(ED.key);
  const { challenge } = issueChallenge(SECRET);
  const req = await signedRequest({
    body: BODY_A,
    extraHeaders: { challenge, "challenge-response": answerFor(challenge, signer.keyid) },
  });

  const decision = await admit(req, {
    secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN, body: BODY_A,
  });

  assert.equal(decision.ok, true, `expected admission, got ${JSON.stringify(decision)}`);
  assert.equal(decision.keyId, signer.keyid);
});

test("a signature that does not cover content-digest is refused", async () => {
  // Covering the header is not enough; the signature must include it in the
  // components, or an attacker simply rewrites the header alongside the body.
  const seen = new Set();
  const signer = await signerFromJWK(ED.key);
  const { challenge } = issueChallenge(SECRET);
  const req = await signedRequest({
    body: BODY_A,
    components: ["@authority", "@method", "@path", "signature-agent"],
    extraHeaders: { challenge, "challenge-response": answerFor(challenge, signer.keyid) },
  });

  const decision = await admit(req, {
    secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN, body: BODY_A,
  });

  assert.equal(decision.ok, false);
  assert.equal(decision.body.reason, "components");
});

test("a request carrying no content-digest at all is refused", async () => {
  const seen = new Set();
  const signer = await signerFromJWK(ED.key);
  const { challenge } = issueChallenge(SECRET);
  const req = await signedRequest({
    body: BODY_A,
    extraHeaders: { challenge, "challenge-response": answerFor(challenge, signer.keyid) },
  });
  delete req.headers["content-digest"];

  const decision = await admit(req, {
    secret: SECRET, lookupKey: lookupED, seen, spent: new Map(), domain: DOMAIN, body: BODY_A,
  });

  assert.equal(decision.ok, false);
});

// -- sweepSeen ------------------------------------------------------------

test("sweepSeen removes a challenge older than twice the window and keeps a fresh one", () => {
  const now = 1_000_000;
  const stale = `n.${now - CHALLENGE_MS * 2 - 1}.m`;
  const fresh = `n.${now - 100}.m`;
  const malformed = "not-a-challenge";
  const seen = new Set([stale, fresh, malformed]);
  sweepSeen(seen, undefined, now);
  assert.equal(seen.has(stale), false);
  assert.equal(seen.has(fresh), true);
  assert.equal(seen.has(malformed), false);
});

// -- createServer: the four cases, over real HTTP --------------------------

async function startServer(overrides = {}) {
  const config = {
    stateDbPath: ":memory:",
    domain: DOMAIN,
    challengeSecret: SECRET,
    tokenView: (q, id, links) => (id === 1 ? { tokenId: 1, ...links } : null),
    mcp: { nodeHandler: (req, res) => { res.writeHead(200); res.end("mcp-reached"); } },
    allowRegistration: () => true,
    contract: "0x00000000000000000000000000000000000C0DE0",
    chainId: 84532,
    ...overrides,
  };
  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}` };
}

/**
 * Send a request whose request-target (the raw string on the request line) is
 * exactly `path`, bypassing the normalisation `fetch`/the URL constructor
 * would apply. This is how a protocol-relative ("//evil.example/mcp") or
 * absolute-form ("http://evil.example/mcp") target reaches a real server:
 * Node hands `req.url` through verbatim, whatever the client wrote on the
 * request line.
 */
function rawRequest(base, { method = "GET", path, headers = {}, body } = {}) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/// Register a fresh key on `base` through the real /keys endpoint, so a
/// forged-authority attack has a genuinely known, verifiable key to sign
/// with -- this is not testing "unknown key", it is testing the authority pin.
async function registerFreshKey(base) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  const nonceRes = await fetch(`${base}/keys/nonce`);
  const { nonce } = await nonceRes.json();
  const proof = edSign(null, Buffer.from(nonce), privateKey).toString("base64url");
  const regRes = await fetch(`${base}/keys`, { method: "POST", body: JSON.stringify({ jwk: publicJwk, nonce, proof }) });
  assert.equal((await regRes.json()).ok, true);
  return { privateJwk };
}

/// Sign a message the way a real client would, for an arbitrary target URL
/// (which may name a different authority than this server).
async function signFor(privateJwk, targetUrl, body = "") {
  const target = new URL(targetUrl);
  const signer = await signerFromJWK(privateJwk);
  const message = {
    method: "POST",
    url: target.toString(),
    headers: {
      "signature-agent": `"https://${DOMAIN}"`,
      host: target.host,
      "content-digest": contentDigest(body),
    },
  };
  const created = new Date();
  const headers = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + 60_000),
    components: CLIENT_COMPONENTS,
  });
  return { headers: { ...message.headers, ...headers }, keyId: signer.keyid };
}

test("GET /t/<id> is public: no signature required, 200 for a known token, 404 for an unknown one", async () => {
  const { server, base } = await startServer();
  try {
    const hit = await fetch(`${base}/t/1`);
    assert.equal(hit.status, 200);
    // C1.5. The QR's destination is the one arrival the artwork itself makes,
    // and the url is written into the bitmap at mint and never rewritten. So
    // the answer has to carry a route onward and the handles to check the
    // token against the chain instead of against this service.
    assert.deepEqual(await hit.json(), {
      tokenId: 1,
      docs: `https://${DOMAIN}/llms.txt`,
      mcp: `https://${DOMAIN}/mcp`,
      contract: "0x00000000000000000000000000000000000C0DE0",
      chainId: 84532,
    });

    const miss = await fetch(`${base}/t/999`);
    assert.equal(miss.status, 404);
  } finally {
    server.close();
  }
});

test("GET /.well-known/http-message-signatures-directory is public", async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/.well-known/http-message-signatures-directory`);
    assert.equal(res.status, 200);
    const parsed = JSON.parse(await res.text());
    assert.deepEqual(parsed, { keys: [] });
  } finally {
    server.close();
  }
});

test("an unsigned POST /mcp gets a 401 challenge carrying about, challenge, expires, mcp and docs", async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/mcp`, { method: "POST" });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.deepEqual(Object.keys(body).sort(), ["about", "challenge", "docs", "expires", "mcp"]);
    assert.match(body.about, /only admits programs/, "the first thing the piece says must say what it is");
  } finally {
    server.close();
  }
});

test("an unsigned request to an unknown route gets the same 401 challenge as /mcp, not a 404", async () => {
  // Only /t/<id>, the directory, /keys and /keys/nonce are public. Everything
  // else -- including a path this router does not otherwise recognise -- goes
  // through admit() first, so an unauthenticated prober learns nothing about
  // which paths exist.
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/nowhere`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test("a signed and answered request to an unmatched path gets 404", async () => {
  const { server, base } = await startServer();
  try {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicJwk = publicKey.export({ format: "jwk" });
    const privateJwk = privateKey.export({ format: "jwk" });

    const nonceRes = await fetch(`${base}/keys/nonce`);
    const { nonce } = await nonceRes.json();
    const proof = edSign(null, Buffer.from(nonce), privateKey).toString("base64url");
    await fetch(`${base}/keys`, { method: "POST", body: JSON.stringify({ jwk: publicJwk, nonce, proof }) });

    const challengeRes = await fetch(`${base}/nowhere`, { method: "POST" });
    const { challenge } = await challengeRes.json();

    const message = {
      method: "POST",
      url: `https://${DOMAIN}/nowhere`,
      headers: {
        "signature-agent": `"https://${DOMAIN}"`,
        host: DOMAIN,
        // No body is sent, so the digest is of the empty string -- which is
        // exactly what the door will compute from the request it receives.
        "content-digest": contentDigest(""),
      },
    };
    const signer = await signerFromJWK(privateJwk);
    const created = new Date();
    const sigHeaders = await signatureHeaders(message, signer, {
      created,
      expires: new Date(created.getTime() + 60_000),
      components: CLIENT_COMPONENTS,
    });
    const answer = createHash("sha256").update(challenge + signer.keyid).digest("hex");

    const res = await fetch(`${base}/nowhere`, {
      method: "POST",
      headers: { ...message.headers, ...sigHeaders, challenge, "challenge-response": answer },
    });
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test("GET /keys/nonce is public and POST /keys registers a key with a fresh proof", async () => {
  const { server, base } = await startServer();
  try {
    const nonceRes = await fetch(`${base}/keys/nonce`);
    assert.equal(nonceRes.status, 200);
    const { nonce } = await nonceRes.json();
    assert.equal(typeof nonce, "string");

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const jwk = publicKey.export({ format: "jwk" });
    const proof = edSign(null, Buffer.from(nonce), privateKey).toString("base64url");

    const regRes = await fetch(`${base}/keys`, {
      method: "POST",
      body: JSON.stringify({ jwk, nonce, proof }),
    });
    assert.equal(regRes.status, 201, `expected registration, got ${JSON.stringify(await regRes.clone().json())}`);
    const body = await regRes.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.keyId, "string");

    // The same nonce cannot register twice: it was already spent above.
    const replayProof = edSign(null, Buffer.from(nonce), privateKey).toString("base64url");
    const replay = await fetch(`${base}/keys`, {
      method: "POST",
      body: JSON.stringify({ jwk, nonce, proof: replayProof }),
    });
    assert.equal(replay.status, 400);
    const replayBody = await replay.json();
    assert.equal(replayBody.reason, "nonce");
  } finally {
    server.close();
  }
});

test("a fully signed and answered POST /mcp reaches the mcp handler", async () => {
  const { server, base } = await startServer();
  try {
    // Register a fresh key through the real /keys endpoint -- Case 2 -- then
    // use it to satisfy Case 3, so the whole chain is exercised end to end
    // rather than seeding the mirror directly.
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const publicJwk = publicKey.export({ format: "jwk" });
    const privateJwk = privateKey.export({ format: "jwk" });

    const nonceRes = await fetch(`${base}/keys/nonce`);
    const { nonce } = await nonceRes.json();
    const proof = edSign(null, Buffer.from(nonce), privateKey).toString("base64url");
    const regRes = await fetch(`${base}/keys`, {
      method: "POST",
      body: JSON.stringify({ jwk: publicJwk, nonce, proof }),
    });
    assert.equal((await regRes.json()).ok, true);

    const challengeRes = await fetch(`${base}/mcp`, { method: "POST" });
    const { challenge } = await challengeRes.json();

    const message = {
      method: "POST",
      url: `https://${DOMAIN}/mcp`,
      headers: {
        "signature-agent": `"https://${DOMAIN}"`,
        host: DOMAIN,
        // No body is sent, so the digest is of the empty string -- which is
        // exactly what the door will compute from the request it receives.
        "content-digest": contentDigest(""),
      },
    };
    const signer = await signerFromJWK(privateJwk);
    const created = new Date();
    const sigHeaders = await signatureHeaders(message, signer, {
      created,
      expires: new Date(created.getTime() + 60_000),
      components: CLIENT_COMPONENTS,
    });
    const answer = createHash("sha256").update(challenge + signer.keyid).digest("hex");

    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...message.headers, ...sigHeaders, challenge, "challenge-response": answer },
    });
    assert.equal(res.status, 200, `expected the mcp handler to run, got ${JSON.stringify(await res.clone().text())}`);
    assert.equal(await res.text(), "mcp-reached");
  } finally {
    server.close();
  }
});

// -- CRITICAL: the authority pin cannot be defeated by the request target ---

test("a signature minted for https://evil.example/mcp, sent with a protocol-relative target, is refused", async () => {
  const { server, base } = await startServer();
  try {
    const { privateJwk } = await registerFreshKey(base);
    const { headers } = await signFor(privateJwk, "https://evil.example/mcp");
    const res = await rawRequest(base, { method: "POST", path: "//evil.example/mcp", headers });
    assert.equal(res.status, 401, `expected the forged authority to be refused, got ${res.status}: ${res.text}`);
  } finally {
    server.close();
  }
});

test("a signature minted for https://evil.example/mcp, sent with an absolute-form target, is refused", async () => {
  const { server, base } = await startServer();
  try {
    const { privateJwk } = await registerFreshKey(base);
    const { headers } = await signFor(privateJwk, "https://evil.example/mcp");
    const res = await rawRequest(base, { method: "POST", path: "http://evil.example/mcp", headers });
    assert.equal(res.status, 401, `expected the forged authority to be refused, got ${res.status}: ${res.text}`);
  } finally {
    server.close();
  }
});

test("CONTROL: a correctly signed request for the configured domain still reaches the handler", async () => {
  // Proves the pin refuses a FORGED authority specifically, not every
  // request: a pin that rejected everything would also pass the two tests
  // above for the wrong reason.
  const { server, base } = await startServer();
  try {
    const { privateJwk } = await registerFreshKey(base);
    const { headers, keyId } = await signFor(privateJwk, `https://${DOMAIN}/mcp`);
    const challengeRes = await rawRequest(base, { method: "POST", path: "/mcp", headers: {} });
    assert.equal(challengeRes.status, 401);
    const { challenge } = JSON.parse(challengeRes.text);
    const answer = createHash("sha256").update(challenge + keyId).digest("hex");
    const res = await rawRequest(base, {
      method: "POST",
      path: "/mcp",
      headers: { ...headers, challenge, "challenge-response": answer },
    });
    assert.equal(res.status, 200, `expected the mcp handler to run, got ${res.status}: ${res.text}`);
    assert.equal(res.text, "mcp-reached");
  } finally {
    server.close();
  }
});

// -- strict token id parsing -------------------------------------------------

test("/t/0x1 is 404 while /t/1 is 200: Number() must not decide what counts as a token id", async () => {
  const { server, base } = await startServer();
  try {
    const hex = await fetch(`${base}/t/0x1`);
    assert.equal(hex.status, 404);
    const decimal = await fetch(`${base}/t/1`);
    assert.equal(decimal.status, 200);
  } finally {
    server.close();
  }
});

// -- POST /keys body validation ----------------------------------------------

test("a null JSON body to POST /keys is 400, not 500", async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/keys`, { method: "POST", body: "null" });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).reason, "malformed");
  } finally {
    server.close();
  }
});

test("a number or array JSON body to POST /keys is also 400, not 500", async () => {
  const { server, base } = await startServer();
  try {
    const num = await fetch(`${base}/keys`, { method: "POST", body: "5" });
    assert.equal(num.status, 400);
    const arr = await fetch(`${base}/keys`, { method: "POST", body: "[]" });
    assert.equal(arr.status, 400);
  } finally {
    server.close();
  }
});

test("an oversized POST /keys body gets the 400 the code means to send, not a connection reset", async () => {
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/keys`, { method: "POST", body: "x".repeat(64 * 1024 + 1) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).reason, "too-large");
  } finally {
    server.close();
  }
});

test("createServer refuses to start without an allowRegistration decision", async () => {
  assert.throws(() => createServer({
    stateDbPath: ":memory:",
    domain: DOMAIN,
    challengeSecret: SECRET,
    tokenView: () => null,
    mcp: { nodeHandler: () => {} },
  }));
});

// -- a request target that will not parse -------------------------------------

// "//evil.example%2fmcp" makes pinnedUrl throw. It was caught by the router's
// outer catch, which answered 500 and wrote a console.error line -- so a
// malformed target was a free, unauthenticated way to flood the log. It is the
// CALLER's mistake, so it is a 400. Confirmed not a bypass: nothing dispatches
// and nothing verifies, which is what the mcp assertion below pins.
test("a malformed percent-encoded target is a 400, never a 500 and never a dispatch", async () => {
  let mcpReached = false;
  const { server, base } = await startServer({
    mcp: { nodeHandler: (req, res) => { mcpReached = true; res.writeHead(200); res.end("mcp-reached"); } },
  });
  try {
    for (const path of ["//evil.example%2fmcp", "//%2f%2fevil.example/mcp", "http://evil.example%2fmcp"]) {
      const res = await rawRequest(base, { method: "POST", path });
      assert.equal(res.status, 400, `${path} should be 400, got ${res.status}`);
      assert.equal(JSON.parse(res.text).reason, "target");
    }
    assert.equal(mcpReached, false, "a malformed target must never reach the MCP handler");

    // CONTROL: a well-formed target still routes, so the guard above refuses
    // only what it means to.
    const control = await rawRequest(base, { method: "GET", path: "/t/1" });
    assert.equal(control.status, 200);
  } finally {
    server.close();
  }
});

// -- the public key directory is cheap to ask about -------------------------

test("the key directory carries an ETag and answers a conditional GET with 304", async () => {
  const { server, base } = await startServer();
  try {
    const first = await rawRequest(base, { path: "/.well-known/http-message-signatures-directory" });
    assert.equal(first.status, 200);
    assert.match(first.headers.etag, /^"[0-9a-f]{64}"$/);
    assert.equal(first.headers["content-length"], String(Buffer.byteLength(first.text)));

    const second = await rawRequest(base, {
      path: "/.well-known/http-message-signatures-directory",
      headers: { "if-none-match": first.headers.etag },
    });
    assert.equal(second.status, 304);
    assert.equal(second.text, "", "a 304 must carry no body");
    assert.equal(second.headers.etag, first.headers.etag);

    // A caller offering the WRONG validator gets the document, not a 304.
    const stale = await rawRequest(base, {
      path: "/.well-known/http-message-signatures-directory",
      headers: { "if-none-match": '"' + "0".repeat(64) + '"' },
    });
    assert.equal(stale.status, 200);
    assert.equal(stale.text, first.text);
  } finally {
    server.close();
  }
});

// -- a key that gets in is marked as used -----------------------------------
//
// The unit tests for markKeyUsed and pruneUnusedKeys pass whether or not the
// server ever CALLS them. That is the exact shape of this build's worst defect
// -- mint and upgrade were built, tested, and never registered on the MCP
// server -- so this one goes through the real door to a real file database.

test("an admitted request marks its key used, so the prune will not forget it", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "mro-keyuse-")), "state.db");
  const signer = await signerFromJWK(ED.key);

  // A registered key that has never been used: exactly a prune candidate.
  const setup = queries(openDb(path));
  setup.insertKey({ keyId: signer.keyid, jwk: ED.key, directory: null, registeredAt: Date.now() });
  assert.equal(setup.getKey(signer.keyid).lastUsedAt, null);
  // Registered just now, so a 30-day cutoff must not reach it yet.
  assert.equal(setup.pruneUnusedKeys(Date.now() - 30 * 24 * 60 * 60 * 1000), 0, "guard: not yet a candidate");

  const { server, base } = await startServer({ stateDbPath: path });
  try {
    const knock = await rawRequest(base, { method: "POST", path: "/mcp" });
    const { challenge } = JSON.parse(knock.text);
    const req = await signedRequest({
      extraHeaders: { challenge, "challenge-response": answerFor(challenge, signer.keyid) },
    });
    const res = await rawRequest(base, {
      method: "POST", path: "/mcp", headers: req.headers, body: "",
    });
    assert.equal(res.status, 200, `expected to be admitted, got ${res.status} ${res.text}`);
  } finally {
    server.close();
  }

  const after = queries(openDb(path));
  assert.notEqual(after.getKey(signer.keyid).lastUsedAt, null, "the door did not mark the key used");
  assert.equal(after.pruneUnusedKeys(Date.now()), 0, "a key that just got in must survive the prune");
});

// -- 14.6: /mcp had no per-caller budget at all --------------------------------

// The only limiter in this service guarded POST /keys. So an agent that had
// registered once could loop any tool for ever, and two free tools (`checkin`
// and `seed`) each spent three eth_calls before their local refusals. When the
// RPC provider throttles, `writesOpen` answers "unreadable" and every PAID
// write refuses for everyone -- the mint path denied through a free tool, from
// one key, for one dollar.
//
// This drives the REAL route: a request that is fully signed and answered, and
// therefore admitted, must still be refused when the budget says so, and the
// mcp handler must never run. The budget mechanics themselves are tested
// against makeAllowToolCall in bootstrap.test.mjs.
test("an admitted request over its budget is refused 429, and never reaches a tool", async () => {
  const asked = [];
  let mcpReached = false;
  const { server, base } = await startServer({
    allowToolCall: (keyId) => { asked.push(keyId); return false; },
    mcp: { nodeHandler: (req, res) => { mcpReached = true; res.writeHead(200); res.end("mcp-reached"); } },
  });
  try {
    const { privateJwk } = await registerFreshKey(base);
    const challengeRes = await fetch(`${base}/mcp`, { method: "POST" });
    const { challenge } = await challengeRes.json();
    const { headers, keyId } = await signFor(privateJwk, `https://${DOMAIN}/mcp`);
    const answer = createHash("sha256").update(challenge + keyId).digest("hex");

    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { ...headers, challenge, "challenge-response": answer },
    });

    assert.equal(res.status, 429);
    const body = await res.json();
    assert.equal(body.reason, "rate-limited");
    assert.match(body.next, /per key/);
    assert.equal(mcpReached, false, "nothing may run once the budget is spent");
    // Counted against the VERIFIED key id -- the one identity a caller cannot
    // rotate for a fresh bucket, which is why this is applied after admission
    // rather than on an address header.
    assert.deepEqual(asked, [keyId]);
  } finally {
    server.close();
  }
});
