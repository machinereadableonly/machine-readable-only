// THE MAINNET FACILITATOR'S BEARER TOKEN, checked without a network.
//
// Everything this project has measured about payment went through
// https://x402.org/facilitator, which needs no key. The mainnet host answers
// 401 without one, so this whole path is untested by construction -- and the
// failure mode is a piece that boots healthy and refuses every mint forever.
//
// These tests generate a real Ed25519 key pair, hand the private half to the
// signer in CDP's own secret format, and then verify the resulting token with
// the PUBLIC half. That proves the encoding and the signature are right. What
// it cannot prove is that Coinbase ACCEPTS it -- only their host can say that,
// which is what tools/cdp-live-check.mjs is for.
//
// AND THAT DISTINCTION IS NOT THEORETICAL. The first version of this file was
// written from CDP's prose reference, passed every test below, and was refused
// 401 by the live host. The claim set here now matches what
// `@coinbase/cdp-sdk`'s own `generateJwt` emits, which differs from the prose
// in three ways: `uris` is PLURAL and an array, there is an `iat`, and there is
// no `aud`. An offline test can only ever pin what its author already believed,
// so the shape below is transcribed from the reference implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify as verifyOneShot } from "node:crypto";
import { cdpJwt, makeCdpAuthHeaders, isCdpFacilitator } from "../src/pay/cdp.mjs";

const KEY_ID = "organizations/1/apiKeys/2";
const FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";

/**
 * A key pair in the shape CDP issues one.
 *
 * The secret is base64 of 64 raw bytes: the 32-byte seed followed by the
 * 32-byte public half. Node exports Ed25519 as DER, so the raw halves are cut
 * out of it -- the seed is the last 32 bytes of the PKCS#8 and the public key
 * the last 32 of the SPKI, both fixed-length structures for this curve.
 */
function cdpKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
  const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { publicKey, secret: Buffer.concat([seed, pub]).toString("base64") };
}

const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

test("the token is a real EdDSA JWT that verifies against the key's public half", () => {
  const { publicKey, secret } = cdpKeyPair();
  const token = cdpJwt({
    keyId: KEY_ID,
    secret,
    method: "POST",
    host: "api.cdp.coinbase.com",
    path: "/platform/v2/x402/settle",
  });

  const [h, c, sig] = token.split(".");
  assert.equal(token.split(".").length, 3);

  // THE SIGNATURE IS CHECKED, not merely present. A token that is shaped right
  // and signed wrong is exactly what a 401 on settle looks like, and it is the
  // one thing an offline test can still prove.
  const ok = verifyOneShot(null, Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, "base64url"));
  assert.equal(ok, true, "CDP will verify this signature with the public half of the same key");
});

test("the header and claims are exactly what CDP's reference requires", () => {
  const { secret } = cdpKeyPair();
  const now = 1_760_000_000_000;
  const token = cdpJwt({
    keyId: KEY_ID,
    secret,
    method: "POST",
    host: "api.cdp.coinbase.com",
    path: "/platform/v2/x402/verify",
    now,
  });
  const [h, c] = token.split(".");

  assert.deepEqual(
    { ...decode(h), nonce: "<checked separately>" },
    { alg: "EdDSA", kid: KEY_ID, typ: "JWT", nonce: "<checked separately>" }
  );
  assert.deepEqual(decode(c), {
    sub: KEY_ID,
    iss: "cdp",
    // PLURAL and an array, with `iat` beside `nbf`, and NO `aud`. Every one of
    // those three is a departure from the prose documentation and every one is
    // what the reference implementation actually emits.
    uris: ["POST api.cdp.coinbase.com/platform/v2/x402/verify"],
    iat: 1_760_000_000,
    nbf: 1_760_000_000,
    // Two minutes, which is CDP's own maximum.
    exp: 1_760_000_120,
  });
});

// The claim NAMES are the thing that gets silently wrong, so they are asserted
// as a set. A token carrying `uri` or `aud` is the exact token the live host
// refused on 2026-09-05.
test("the claim set has no singular uri and no audience", () => {
  const { secret } = cdpKeyPair();
  const [, c] = cdpJwt({ keyId: KEY_ID, secret, method: "GET", host: "h", path: "/p" }).split(".");
  assert.deepEqual(Object.keys(decode(c)).sort(), ["exp", "iat", "iss", "nbf", "sub", "uris"]);
});

// The nonce is what stops a captured token being replayed inside its two-minute
// life, so it must actually differ per token rather than being decorative.
test("every token carries a fresh nonce", () => {
  const { secret } = cdpKeyPair();
  const nonces = new Set();
  for (let i = 0; i < 20; i += 1) {
    const [h] = cdpJwt({ keyId: KEY_ID, secret, method: "GET", host: "h", path: "/p" }).split(".");
    nonces.add(decode(h).nonce);
  }
  assert.equal(nonces.size, 20);
});

// THE ONE THAT WOULD BE EASIEST TO GET WRONG. `uri` names the exact request, so
// a single token cannot authenticate all four calls -- which is why
// createAuthHeaders is keyed by path at all. A flat object here would be a
// throw from @x402/core, and a shared token would be a 401 on settle: a payment
// that verified and then failed to move.
test("each path gets its own token naming its own request", async () => {
  const { secret } = cdpKeyPair();
  const headers = await makeCdpAuthHeaders({ keyId: KEY_ID, secret, facilitatorUrl: FACILITATOR })();

  assert.deepEqual(Object.keys(headers).sort(), ["bazaar", "settle", "supported", "verify"]);
  const uriOf = (h) => decode(h.Authorization.replace("Bearer ", "").split(".")[1]).uris[0];
  assert.equal(uriOf(headers.verify), "POST api.cdp.coinbase.com/platform/v2/x402/verify");
  assert.equal(uriOf(headers.settle), "POST api.cdp.coinbase.com/platform/v2/x402/settle");
  assert.equal(uriOf(headers.supported), "GET api.cdp.coinbase.com/platform/v2/x402/supported");
  assert.equal(uriOf(headers.bazaar), "GET api.cdp.coinbase.com/platform/v2/x402/discovery/resources");

  // Every one of them is a DIFFERENT token, not one token relabelled.
  const tokens = new Set(Object.values(headers).map((h) => h.Authorization));
  assert.equal(tokens.size, 4);
});

// A trailing slash on the configured url would otherwise produce a doubled
// slash in the uri claim, which CDP compares against the real request path.
test("a trailing slash on the facilitator url does not corrupt the uri claim", async () => {
  const { secret } = cdpKeyPair();
  const headers = await makeCdpAuthHeaders({
    keyId: KEY_ID,
    secret,
    facilitatorUrl: `${FACILITATOR}/`,
  })();
  const uri = decode(headers.settle.Authorization.replace("Bearer ", "").split(".")[1]).uris[0];
  assert.equal(uri, "POST api.cdp.coinbase.com/platform/v2/x402/settle");
});

test("a secret that is not a CDP key is refused with a message that says why", () => {
  assert.throws(
    () => cdpJwt({ keyId: KEY_ID, secret: Buffer.alloc(48).toString("base64"), method: "GET", host: "h", path: "/p" }),
    /decodes to 48 bytes/
  );
});

// The 32-byte seed-only form is accepted too: the public half is derivable, so
// demanding it would refuse a secret that is complete.
test("a bare 32-byte seed is accepted", () => {
  const { publicKey, secret } = cdpKeyPair();
  const seedOnly = Buffer.from(secret, "base64").subarray(0, 32).toString("base64");
  const token = cdpJwt({ keyId: KEY_ID, secret: seedOnly, method: "GET", host: "h", path: "/p" });
  const [h, c, sig] = token.split(".");
  assert.equal(verifyOneShot(null, Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, "base64url")), true);
});

test("only Coinbase's host is treated as needing a key", () => {
  assert.equal(isCdpFacilitator(FACILITATOR), true);
  assert.equal(isCdpFacilitator("https://api.cdp.coinbase.com/anything"), true);
  assert.equal(isCdpFacilitator("https://x402.org/facilitator"), false);
  // A lookalike host must NOT be taken for Coinbase's.
  assert.equal(isCdpFacilitator("https://cdp.coinbase.com.evil.example/x402"), false);
  assert.equal(isCdpFacilitator("not a url"), false);
});
