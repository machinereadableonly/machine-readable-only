import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { registerKey, guardedFetchDirectory, renderDirectory, isBlockedAddress } from "../src/door/directory.mjs";

const JWK = { kty: "OKP", crv: "Ed25519", x: "JrQLj5P_89iXES9-vFgrIy29clF9CC_oPPsw3c5D0bs" };

test("a registered key can be looked up by its thumbprint", async () => {
  const q = queries(openDb(":memory:"));
  const r = await registerKey(q, JWK, 1000);
  assert.equal(r.ok, true);
  assert.ok(q.getKey(r.keyId));
});

test("the directory renders every registered key as a JWKS", async () => {
  const q = queries(openDb(":memory:"));
  await registerKey(q, JWK, 1000);
  const parsed = JSON.parse(renderDirectory(q));
  assert.equal(parsed.keys.length, 1);
  assert.equal(parsed.keys[0].crv, "Ed25519");
});

// Each of these is an address a fetch must never reach. Loopback and the
// 169.254.169.254 metadata address are the two that turn a directory fetch
// into a way to read this machine.
//
// The IPv6 spellings are not padding. A text-prefix version of this guard
// shipped and let EVERY one of these through in ::ffff: form, with the fetch
// genuinely made. An agent registering its own domain controls its own AAAA
// records, so it picks the spelling.
for (const addr of [
  "127.0.0.1", "::1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "0.0.0.0",
  "100.64.0.1", "224.0.0.1",
  "::ffff:169.254.169.254", "::ffff:127.0.0.1", "::ffff:10.0.0.1",
  "0:0:0:0:0:ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::127.0.0.1",
  "fe80::1", "fe80::1%eth0", "fc00::1", "fd12:3456::1", "ff02::1",
  "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "::",
]) {
  test(`${addr} is blocked`, () => assert.equal(isBlockedAddress(addr), true));
}

// A guard must fail CLOSED on what it cannot parse. The first version returned
// "not blocked" for any string that was not a dotted quad.
for (const junk of ["", "garbage", "not-an-ip", "999.999.999.999"]) {
  test(`unparseable input ${JSON.stringify(junk)} is blocked`, () =>
    assert.equal(isBlockedAddress(junk), true));
}

// The control: a guard that blocks everything is not a guard.
for (const ok of ["93.184.216.34", "8.8.8.8", "2606:2800:220:1:248:1893:25c8:1946", "2001:4860:4860::8888"]) {
  test(`public address ${ok} is allowed`, () => assert.equal(isBlockedAddress(ok), false));
}

test("a directory that resolves to an IPv4-mapped IPv6 metadata address is refused", async () => {
  // End to end through the guard, not just the predicate: this is the exact
  // shape that was measured getting through.
  let fetched = false;
  await assert.rejects(
    () =>
      guardedFetchDirectory("https://evil.example.com/x", {
        resolve: async () => ["::ffff:169.254.169.254"],
        fetch: async () => { fetched = true; return new Response("{}", { status: 200 }); },
      }),
    /address/i
  );
  assert.equal(fetched, false, "fetch must never be reached for a blocked address");
});

test("a non-https directory URL is refused", async () => {
  await assert.rejects(
    () => guardedFetchDirectory("http://example.com/.well-known/http-message-signatures-directory", {}),
    /https/i
  );
});

test("a non-443 port is refused", async () => {
  await assert.rejects(
    () => guardedFetchDirectory("https://example.com:8443/x", {}),
    /port/i
  );
});

test("a directory that resolves to a private address is refused", async () => {
  await assert.rejects(
    () =>
      guardedFetchDirectory("https://internal.example.com/x", {
        resolve: async () => ["10.1.2.3"],
      }),
    /address/i
  );
});

test("a body over the cap is refused", async () => {
  const big = "x".repeat(70_000);
  await assert.rejects(
    () =>
      guardedFetchDirectory("https://example.com/x", {
        resolve: async () => ["93.184.216.34"],
        fetch: async () => new Response(big, { status: 200 }),
      }),
    /too large/i
  );
});

test("a redirect is not followed", async () => {
  await assert.rejects(
    () =>
      guardedFetchDirectory("https://example.com/x", {
        resolve: async () => ["93.184.216.34"],
        fetch: async (url, opts) => {
          assert.equal(opts.redirect, "error", "fetch must be called with redirect: error");
          throw new TypeError("redirect");
        },
      }),
    /redirect/i
  );
});

import { registerRoute } from "../src/door/directory.mjs";

/// A caller proves possession by signing a nonce this server issued.
async function proofFor(nonce, privateKey) {
  const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(nonce));
  return Buffer.from(sig).toString("base64url");
}

test("a registration with a valid proof of possession is accepted", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const nonce = "server-issued-nonce";
  const r = await registerRoute(q, { jwk, nonce, proof: await proofFor(nonce, pair.privateKey) }, () => true);
  assert.equal(r.ok, true);
  assert.ok(q.getKey(r.keyId));
});

test("a registration with no proof is refused", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const r = await registerRoute(q, { jwk, nonce: "server-issued-nonce", proof: "" }, () => true);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "proof");
  assert.equal(q.allKeys().length, 0, "nothing may be stored on a failed proof");
});

test("a proof over a different nonce is refused", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const r = await registerRoute(
    q,
    { jwk, nonce: "server-issued-nonce", proof: await proofFor("some-other-nonce", pair.privateKey) },
    () => true
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "proof");
});

test("a registration is refused when the rate limit says so", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const nonce = "server-issued-nonce";
  const r = await registerRoute(q, { jwk, nonce, proof: await proofFor(nonce, pair.privateKey) }, () => false);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "rate-limited");
});
