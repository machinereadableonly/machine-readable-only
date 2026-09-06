import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { registerKey, guardedFetchDirectory, renderDirectory, isBlockedAddress, makeLookup, makeDirectoryCache } from "../src/door/directory.mjs";
import { issueChallenge, verifyNonceMinted, CHALLENGE_MS } from "../src/door/challenge.mjs";
import { jwkToKeyID } from "web-bot-auth";

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
  // It THROWS rather than answering null -- see the next test for why.
  await assert.rejects(() => lookup("k", '"https://dead.example.com/"'), /could not be fetched/);
  await assert.rejects(() => lookup("k", '"https://dead.example.com/"'), /could not be fetched/);
  assert.equal(fetches, 1, "a remembered failure must not be refetched");

  // The cache key is caller-chosen, so it must not grow without bound.
  for (let i = 0; i < 400; i++) {
    await lookup("k", `"https://host${i}.example.com/"`).catch(() => {});
  }
  assert.ok(cache.size <= 256, `cache grew to ${cache.size}`);
});

// 13.5. `reason: "directory"` was unreachable through the real lookup, because
// makeLookup caught its own fetch failure and returned null -- which
// verifyRequest reads as "no key for that key id". So an agent whose own JWKS
// host had a transient outage was told `unknown-key`, and the protocol
// document's table sends it to re-derive its RFC 7638 thumbprint: the one trap
// that document already warns "produces a wrong key id silently". It
// re-registers, or gives up. Neither fixes anything.
test("a directory that cannot be FETCHED is told apart from one that lacks the key", async () => {
  const q = queries(openDb(":memory:"));
  const empty = makeLookup(q, async () => ({ keys: [] }), "warden.example.com", new Map());
  // Fetched, and the key is genuinely not in it: null, which the door reports
  // as `unknown-key`. That is the honest answer here.
  assert.equal(await empty("no-such-key", '"https://agent.example.com/"'), null);

  const down = makeLookup(q, async () => { throw new Error("ETIMEDOUT"); }, "warden.example.com", new Map());
  await assert.rejects(() => down("k", '"https://agent.example.com/"'), /could not be fetched/);
});

// 13.3. The cache key comes from `Signature-Agent`, an unverified header read
// before any signature is checked, so remembering a failure for an HOUR meant
// one unauthenticated request locked a victim agent out of its own key for an
// hour -- with no invalidation path and nothing it could do. Mid-mint, it could
// not mint. The fetch cache is still needed (without it every such request is
// an outbound probe the caller aims), so the fix is the TTL, not the cache.
test("a remembered failure expires in SECONDS, and a success still lasts an hour", async () => {
  const q = queries(openDb(":memory:"));
  let fetches = 0;
  let alive = false;
  let now = 1_000_000;
  const lookup = makeLookup(q,
    async () => { fetches += 1; if (!alive) throw new Error("down"); return { keys: [] }; },
    "warden.example.com", new Map(), new Map(), () => now);

  await assert.rejects(() => lookup("k", '"https://victim.example.com/"'));
  assert.equal(fetches, 1);

  // Still remembered a few seconds later: the probe amplification the cache
  // exists for is bounded.
  now += 10_000;
  await assert.rejects(() => lookup("k", '"https://victim.example.com/"'));
  assert.equal(fetches, 1, "a fresh failure is not re-probed");

  // Past the failure TTL, the victim gets another chance -- an hour later would
  // have been the lockout.
  now += 40_000;
  alive = true;
  assert.equal(await lookup("k", '"https://victim.example.com/"'), null);
  assert.equal(fetches, 2, "an expired failure is retried");

  // And the SUCCESS now cached is trusted far longer than a failure ever is.
  now += 60_000;
  await lookup("k", '"https://victim.example.com/"');
  assert.equal(fetches, 2, "a success lasts the full hour");
});

test("repeated failures back off, so a genuinely dead host is not probed on a loop", async () => {
  const q = queries(openDb(":memory:"));
  let fetches = 0;
  let now = 0;
  const lookup = makeLookup(q, async () => { fetches += 1; throw new Error("down"); },
    "warden.example.com", new Map(), new Map(), () => now);

  // Each failure doubles the wait before the next probe: 45s, then 90s.
  await assert.rejects(() => lookup("k", '"https://dead.example.com/"'));
  now += 46_000;
  await assert.rejects(() => lookup("k", '"https://dead.example.com/"'));
  assert.equal(fetches, 2);
  now += 46_000;
  await assert.rejects(() => lookup("k", '"https://dead.example.com/"'));
  assert.equal(fetches, 2, "the second failure must wait longer than the first");
  now += 46_000;
  await assert.rejects(() => lookup("k", '"https://dead.example.com/"'));
  assert.equal(fetches, 3);
});

// 13.4. The cache was written only when a fetch SETTLED, so N concurrent
// requests naming one host all missed and all went out: an unauthenticated
// caller with a worthless signature got one outbound connection per request,
// aimed wherever it liked, each held for the timeout and buffering up to 64 KB.
test("concurrent lookups of one directory share ONE outbound fetch", async () => {
  const q = queries(openDb(":memory:"));
  let fetches = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const lookup = makeLookup(q, async () => { fetches += 1; await gate; return { keys: [] }; },
    "warden.example.com", new Map());

  const all = Promise.all(Array.from({ length: 25 }, () => lookup("k", '"https://agent.example.com/"')));
  release();
  await all;
  assert.equal(fetches, 1, "twenty-five callers, one connection");
});

test("outbound directory fetches are capped process-wide, and the refusal is honest", async () => {
  const q = queries(openDb(":memory:"));
  let fetches = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const lookup = makeLookup(q, async () => { fetches += 1; await gate; return { keys: [] }; },
    "warden.example.com", new Map());

  // Eight different hosts saturate the ceiling; sharing per URL cannot bound a
  // caller that names a thousand of them.
  const held = Array.from({ length: 8 }, (_, i) => lookup("k", `"https://h${i}.example.com/"`));
  await assert.rejects(
    () => lookup("k", '"https://ninth.example.com/"'),
    /could not be fetched/,
    "over the ceiling it refuses as an outage -- which is what it is -- rather than as a bad key"
  );
  assert.equal(fetches, 8, "the ninth host was never dialled");
  release();
  await Promise.all(held);

  // And the ceiling is not sticky: once the first eight settle, the next call
  // goes out normally. It answers null because this stub's JWKS holds no key
  // "k" -- fetched and absent, which is the honest null.
  assert.equal(await lookup("k", '"https://ninth.example.com/"'), null);
  assert.equal(fetches, 9);
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

// -- the directory cache ----------------------------------------------------
//
// The route serving this is public, unsigned and unmetered, and it used to
// re-render every stored key on every GET: 11.8 ms of synchronous CPU and a
// 1.1 MB response at the 10,000-key ceiling, which is about 85 requests a
// second to saturate one core.

test("the directory is rendered once per change, not once per read", async () => {
  const q = queries(openDb(":memory:"));
  let renders = 0;
  const cache = makeDirectoryCache(q, (qq) => { renders++; return renderDirectory(qq); });

  const first = cache.current();
  for (let i = 0; i < 20; i++) cache.current();
  assert.equal(renders, 1, "reading the directory must not re-render it");

  // Every read must still be the SAME answer, not a stale first one.
  assert.equal(cache.current().body, first.body);
  assert.equal(cache.current().etag, first.etag);
});

test("registering a key invalidates the remembered directory", async () => {
  const q = queries(openDb(":memory:"));
  let renders = 0;
  const cache = makeDirectoryCache(q, (qq) => { renders++; return renderDirectory(qq); });

  const before = cache.current();
  assert.equal(JSON.parse(before.body).keys.length, 0);

  await registerKey(q, JWK, 1000);
  // Without the invalidate this returns the empty directory forever.
  cache.invalidate();
  const after = cache.current();

  assert.equal(renders, 2);
  assert.equal(JSON.parse(after.body).keys.length, 1);
  assert.notEqual(after.etag, before.etag, "a changed directory must change its ETag");
});

test("the ETag is a strong validator over the body itself", () => {
  const q = queries(openDb(":memory:"));
  const doc = makeDirectoryCache(q).current();
  // Quoted, per RFC 9110, and derived from the bytes rather than from a clock
  // or a counter -- two Wardens serving the same keys agree.
  assert.match(doc.etag, /^"[0-9a-f]{64}"$/);
  const same = makeDirectoryCache(q).current();
  assert.equal(same.etag, doc.etag);
});

// Test gap 22. THE STANDARDS-PURE PATH HAD NO GREEN CASE. Every third-party
// directory test above is a refusal: a blocked address, an unreachable host, a
// remembered failure, a hostname that only looks like ours. The one success
// case hands back `{ keys: [] }` and asserts only WHICH url was fetched -- so
// nothing anywhere showed a remote JWK being matched by its RFC 7638 thumbprint
// and RETURNED.
//
// That matters more than a missing happy path usually does. This is the route
// the spec calls standards-pure -- an agent that already publishes a Web Bot
// Auth directory walks in without registering anything -- and it is the half of
// the door that MRO does not control. A guard that refused every third party
// would have passed the entire existing suite.
test("a third party's own directory admits its key, matched by thumbprint", async () => {
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  // The key id an agent derives for itself: the RFC 7638 thumbprint. Computed
  // here the way the client does, NOT read back from our own lookup -- a test
  // that asked the code under test for the answer would agree with it always.
  const thumbprint = await jwkToKeyID(
    jwk,
    async (b) => crypto.subtle.digest("SHA-256", b),
    (u) => Buffer.from(u).toString("base64url"),
  );

  let fetched = null;
  const lookup = makeLookup(
    q,
    async (url) => { fetched = url; return { keys: [jwk] }; },
    "warden.example.com",
    new Map(),
  );

  const found = await lookup(thumbprint, '"https://agent.example.com/"');
  assert.ok(found, "a third party's own key must be admitted without registering");
  assert.equal(found.x, jwk.x, "and it must be THAT key, not some other one");
  assert.equal(
    fetched,
    "https://agent.example.com/.well-known/http-message-signatures-directory",
    "the well-known path RFC 9421 specifies",
  );

  // Nothing was stored: the whole point of this route is that the piece keeps
  // no record of an agent that brought its own directory.
  assert.equal(q.allKeys().length, 0, "the standards-pure path must store nothing");
});

test("CONTROL: a key that is not in the third party's directory is not admitted", async () => {
  // Without this, the test above would pass on a lookup that returned the first
  // key it found regardless of the id asked for -- which is the same bug as no
  // thumbprint check at all.
  const q = queries(openDb(":memory:"));
  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);

  const lookup = makeLookup(q, async () => ({ keys: [jwk] }), "warden.example.com", new Map());
  const found = await lookup("a-thumbprint-of-some-other-key", '"https://agent.example.com/"');
  assert.equal(found, null, "a directory holding one key must not answer for another");
});
