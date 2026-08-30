import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { registerKey, guardedFetchDirectory, renderDirectory, isBlockedAddress, makeLookup } from "../src/door/directory.mjs";
import { issueChallenge, verifyNonceMinted, CHALLENGE_MS } from "../src/door/challenge.mjs";

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

// The deps below are `request` and `lookup`, not `fetch` and `resolve`: the
// address decision now happens inside the resolution the socket uses, so the
// tests drive that same seam.
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

/// A stand-in for https.request that replies with one body and never touches a
/// network. `lookup` is still exercised, because the real code calls it.
function stubRequest(body, status = 200) {
  return (opts, cb) => {
    const req = new EventEmitter();
    req.end = () => {
      // Drive the pinned lookup exactly as a real connection would.
      opts.lookup("host.example", { all: true }, (err) => {
        if (err) return req.emit("error", err);
        const res = Readable.from([Buffer.from(body)]);
        res.statusCode = status;
        cb(res);
      });
    };
    req.destroy = () => {};
    return req;
  };
}

const publicLookup = (h, o, cb) => cb(null, [{ address: "93.184.216.34", family: 4 }]);
const lookupOf = (addr) => (h, o, cb) =>
  cb(null, [{ address: addr, family: addr.includes(":") ? 6 : 4 }]);

test("a directory that resolves to a private address is refused", async () => {
  await assert.rejects(
    () => guardedFetchDirectory("https://internal.example.com/x", {
      request: stubRequest("{}"), lookup: lookupOf("10.1.2.3"),
    }),
    /blocked address/i
  );
});

// Each of these got through a previous version of the guard. They are kept as
// end-to-end cases, not just predicate cases, because the bug that mattered was
// always "the connection still happened".
for (const addr of ["::ffff:169.254.169.254", "::ffff:0:169.254.169.254", "::127.0.0.1", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1"]) {
  test(`a directory resolving to ${addr} is refused end to end`, async () => {
    await assert.rejects(
      () => guardedFetchDirectory("https://evil.example.com/x", {
        request: stubRequest("{}"), lookup: lookupOf(addr),
      }),
      /blocked address/i
    );
  });
}

test("one bad address among several refuses the whole connection", async () => {
  // A resolver that returns a good address and a bad one must get nothing.
  await assert.rejects(
    () => guardedFetchDirectory("https://mixed.example.com/x", {
      request: stubRequest("{}"),
      lookup: (h, o, cb) => cb(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
    }),
    /blocked address/i
  );
});

test("a body over the cap is refused", async () => {
  await assert.rejects(
    () => guardedFetchDirectory("https://example.com/x", {
      request: stubRequest("x".repeat(70_000)), lookup: publicLookup,
    }),
    /too large/i
  );
});

test("a redirect is refused rather than followed", async () => {
  await assert.rejects(
    () => guardedFetchDirectory("https://example.com/x", {
      request: stubRequest("", 302), lookup: publicLookup,
    }),
    /redirect/i
  );
});

// A hostname that is already an IP never reaches the pinned lookup, so it is
// checked separately. Each of these opened a real connection before the fix.
for (const url of [
  "https://169.254.169.254/x",
  "https://127.0.0.1/x",
  "https://10.0.0.1/x",
  "https://[::1]/x",
  "https://[::ffff:169.254.169.254]/x",
  "https://[::ffff:0:169.254.169.254]/x",
]) {
  test(`a literal address url ${url} is refused without any dns`, async () => {
    let lookupCalled = false;
    await assert.rejects(
      () => guardedFetchDirectory(url, {
        request: stubRequest("{}"),
        lookup: (h, o, cb) => { lookupCalled = true; cb(null, [{ address: "93.184.216.34", family: 4 }]); },
      }),
      /blocked address/i
    );
    assert.equal(lookupCalled, false, "it must be refused before any resolution is attempted");
  });
}

test("a public literal address is still allowed", async () => {
  // The control for the pre-check: it must reject addresses, not literals.
  const jwks = await guardedFetchDirectory("https://8.8.8.8/x", {
    request: stubRequest(JSON.stringify({ keys: [] })),
    lookup: (h, o, cb) => cb(null, [{ address: "8.8.8.8", family: 4 }]),
  });
  assert.deepEqual(jwks, { keys: [] });
});

test("a url carrying credentials is refused", async () => {
  await assert.rejects(
    () => guardedFetchDirectory("https://user:pw@example.com/x", {
      request: stubRequest("{}"), lookup: publicLookup,
    }),
    /credentials/i
  );
});

test("a well-formed directory from a public address is returned", async () => {
  // The control. A guard that refuses everything would pass every test above.
  const jwks = await guardedFetchDirectory("https://example.com/x", {
    request: stubRequest(JSON.stringify({ keys: [{ kty: "OKP" }] })), lookup: publicLookup,
  });
  assert.equal(jwks.keys.length, 1);
});

import { registerRoute } from "../src/door/directory.mjs";

/// A caller proves possession by signing a nonce this server issued.
async function proofFor(nonce, privateKey) {
  const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(nonce));
  return Buffer.from(sig).toString("base64url");
}

// The nonce must be one THIS server minted, and it is spent on use. Proof of
// possession alone shows the caller holds the key, not that the exchange is
// fresh: before this, an invented nonce was accepted and a captured triple
// replayed verbatim.
const alwaysFreshNonce = () => true;

test("a nonce the caller invented is refused, and nothing is stored", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const nonce = "i-made-this-up-myself";
  const r = await registerRoute(
    q,
    { jwk, nonce, proof: await proofFor(nonce, pair.privateKey) },
    () => true,
    () => false                                   // this server did not mint it
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "nonce");
  assert.equal(q.allKeys().length, 0, "nothing may be stored on a bad nonce");
});

test("a captured registration cannot be replayed", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const nonce = "server-issued-nonce";
  const body = { jwk, nonce, proof: await proofFor(nonce, pair.privateKey) };

  // A nonce checker that spends what it accepts, like the real one.
  const spent = new Set();
  const checkNonce = (n) => (spent.has(n) ? false : (spent.add(n), true));

  assert.equal((await registerRoute(q, body, () => true, checkNonce)).ok, true);
  const replay = await registerRoute(q, body, () => true, checkNonce);
  assert.equal(replay.ok, false);
  assert.equal(replay.reason, "nonce");
  assert.equal(q.allKeys().length, 1, "the replay must not rewrite the stored row");
});

test("verifyNonceMinted accepts only what this server issued", () => {
  const now = 1_000_000;
  const { challenge } = issueChallenge("a-secret", now);
  assert.equal(verifyNonceMinted("a-secret", challenge, now).ok, true);
  assert.equal(verifyNonceMinted("another-secret", challenge, now).ok, false);
  assert.equal(verifyNonceMinted("a-secret", "made.up.nonce", now).ok, false);
  assert.equal(verifyNonceMinted("a-secret", challenge, now + CHALLENGE_MS + 1).reason, "expired");
});

test("the directory owner is decided by exact hostname, not by substring", async () => {
  // https://attacker.net/?x=our.domain was treated as ours, and a legitimate
  // third party whose hostname contained our domain could never be fetched.
  const q = queries(openDb(":memory:"));
  let fetchedUrl = null;
  const lookup = makeLookup(q, async (url) => { fetchedUrl = url; return { keys: [] }; }, "warden.example.com");

  await lookup("some-key", '"https://attacker.net/?x=warden.example.com"');
  assert.ok(fetchedUrl && fetchedUrl.startsWith("https://attacker.net/"),
    "a foreign agent must be fetched, not read from our own store");

  fetchedUrl = null;
  await lookup("some-key", '"https://warden.example.com/"');
  assert.equal(fetchedUrl, null, "our own domain must be served from the mirror");
});

test("the directory cache is bounded and remembers failures", async () => {
  const q = queries(openDb(":memory:"));
  let fetches = 0;
  const cache = new Map();
  const lookup = makeLookup(q, async () => { fetches += 1; throw new Error("unreachable"); },
    "warden.example.com", cache);

  // A failing directory is fetched once, not once per request: otherwise every
  // unauthenticated call becomes an outbound request the caller aims.
  await lookup("k", '"https://dead.example.com/"');
  await lookup("k", '"https://dead.example.com/"');
  assert.equal(fetches, 1, "a remembered failure must not be refetched");

  // The cache key is caller-chosen, so it must not grow without bound.
  for (let i = 0; i < 400; i++) await lookup("k", `"https://host${i}.example.com/"`);
  assert.ok(cache.size <= 256, `cache grew to ${cache.size}`);
});

test("a registration with a valid proof of possession is accepted", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const nonce = "server-issued-nonce";
  const r = await registerRoute(q, { jwk, nonce, proof: await proofFor(nonce, pair.privateKey) }, () => true, alwaysFreshNonce);
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
    () => true,
    alwaysFreshNonce
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "proof");
});

test("a registration is refused when the rate limit says so", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const nonce = "server-issued-nonce";
  const r = await registerRoute(
    q,
    { jwk, nonce, proof: await proofFor(nonce, pair.privateKey) },
    () => false,
    alwaysFreshNonce
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "rate-limited");
  assert.equal(q.allKeys().length, 0, "a rate-limited registration must not be stored");
});

// THE BUDGET IS SPENT LAST, AND PER KEY.
//
// `allow()` used to be the FIRST line of registerRoute, before a single field
// was looked at, and it was called with no argument so the limiter behind it
// could only ever be global. Together that meant 21 junk bodies -- costing an
// attacker nothing to produce -- spent the whole minute's budget for EVERY
// agent on earth. POST /keys is the only way in for an agent with no domain of
// its own, so that closed the entrance.

test("a malformed registration never reaches the rate limiter", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  const charged = [];
  const allow = (keyId) => { charged.push(keyId); return true; };

  // Thirty junk registrations, in every shape the route can be handed: no
  // fields at all, a bad nonce, a bad proof, an unparseable JWK.
  const spent = new Set();
  const checkNonce = (n) => (spent.has(n) ? false : (spent.add(n), true));
  for (let i = 0; i < 30; i++) {
    const shape = [
      {},
      { jwk, nonce: `n${i}`, proof: "" },
      { jwk, nonce: 12345, proof: "abc" },
      { jwk, nonce: `stale${i}`, proof: await proofFor(`stale${i}`, pair.privateKey) },
      { jwk: { kty: "OKP" }, nonce: `n${i}`, proof: "not-base64url-of-a-signature" },
    ][i % 5];
    // The fourth shape is a well-formed request with a nonce this server did
    // not mint, which is refused at the nonce check.
    const nonceCheck = i % 5 === 3 ? () => false : checkNonce;
    const r = await registerRoute(q, shape, allow, nonceCheck);
    assert.equal(r.ok, false);
  }

  assert.deepEqual(charged, [], "an invalid registration must cost no budget at all");
  assert.equal(q.allKeys().length, 0);
});

test("the budget is charged to the derived thumbprint, so one key cannot lock out another", async () => {
  const q = queries(openDb(":memory:"));
  const charged = [];
  const spent = new Set();
  const checkNonce = (n) => (spent.has(n) ? false : (spent.add(n), true));

  // Two DIFFERENT keys registering. The id `allow` is handed must be each
  // key's own RFC 7638 thumbprint -- the value the route derives from the key
  // it has just proved possession of, and the same one it stores.
  for (let i = 0; i < 2; i++) {
    const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
    const nonce = `nonce-${i}`;
    const r = await registerRoute(
      q,
      { jwk, nonce, proof: await proofFor(nonce, pair.privateKey) },
      (keyId) => { charged.push(keyId); return true; },
      checkNonce
    );
    assert.equal(r.ok, true);
    assert.equal(charged[i], r.keyId, "the budget key must be the stored key id");
  }

  assert.equal(new Set(charged).size, 2, "two distinct keys must be charged separately");
});
