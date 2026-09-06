import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { parseDictionary } from "structured-headers";
import { verify } from "web-bot-auth";
import { verifierFromJWK } from "web-bot-auth/crypto";
import { verifyRequest, MAX_WINDOW_MS, coveredComponents, contentDigest, signatureAgentUrl, signatureLabel } from "../src/door/verify.mjs";

const VECTORS = JSON.parse(
  readFileSync(new URL("./vectors/web_bot_auth_architecture_v1.json", import.meta.url), "utf8")
);

/// The Ed25519 vector. The piece only ever issues Ed25519 keys, so that is the
/// one the door must handle; the RSA vectors are carried for completeness.
const ED = VECTORS.find((v) => v.key.kty === "OKP");

/// What a real MRO client signs. This MUST be passed explicitly: web-bot-auth's
/// own default covers only ("@authority" "signature-agent") -- confirmed by
/// capturing a Signature-Input header on 2026-08-30 -- and this project requires
/// @method and @path on top of that, so a helper that omitted the list would
/// sign too little and every happy-path test would be refused for "components".
/// content-digest joined the list on 2026-09-02: it is what binds a signature to
/// a body, and without it a captured signature authenticates any tool call.
const CLIENT_COMPONENTS = ["@authority", "@method", "@path", "signature-agent", "content-digest"];

/// The digest of an EMPTY body, which is what these unit tests sign over.
/// verifyRequest never sees a body -- `admit` compares the digest to what
/// arrived -- so the value only has to exist and be covered.
const EMPTY_DIGEST = contentDigest("");

/// Build a signed request the way a real client will, so the test exercises the
/// same code path an agent hits rather than a hand-rolled header.
async function signedRequest({ windowMs = 60_000, components = CLIENT_COMPONENTS } = {}) {
  const signer = await signerFromJWK(ED.key);
  const message = {
    method: "POST",
    url: "https://example.com/mcp",
    headers: {
      "signature-agent": '"https://example.com"',
      host: "example.com",
      "content-digest": EMPTY_DIGEST,
    },
  };
  const created = new Date();
  const headers = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + windowMs),
    components,
  });
  return { ...message, headers: { ...message.headers, ...headers } };
}

const lookup = async () => ED.key;

/// Critical bypass 1's exact shape, reproduced 2026-08-30: signs only
/// @authority and signature-agent, with the signature-agent header's own
/// VALUE smuggling the text of the components that were never actually
/// covered. A check that searches the whole signature base for a substring
/// is satisfied by this; a check that reads only the base's own
/// "@signature-params" line is not.
async function smuggledRequest() {
  const signer = await signerFromJWK(ED.key);
  const message = {
    method: "POST",
    url: "https://example.com/mcp",
    headers: {
      "signature-agent": '"https://example.com" "@method" "@path"',
      host: "example.com",
    },
  };
  const created = new Date();
  const headers = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + 60_000),
    components: ["@authority", "signature-agent"],
  });
  return { ...message, headers: { ...message.headers, ...headers } };
}

/// Critical bypass 3's exact shape, reproduced 2026-08-30. Signs four
/// components, but two of them are the header names "a @method" and
/// "b @path" -- ordinary quoted component names that happen to contain a
/// space. @method and @path themselves are NOT covered. The extra headers
/// have to exist on the message so the library can sign them.
async function attackRequest(components) {
  const signer = await signerFromJWK(ED.key);
  const message = {
    method: "POST",
    url: "https://example.com/mcp",
    headers: {
      "signature-agent": '"https://example.com"',
      host: "example.com",
      "a @method": "x",
      "b @path": "y",
    },
  };
  const created = new Date();
  const headers = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + 60_000),
    components,
  });
  return { ...message, headers: { ...message.headers, ...headers } };
}

const spacedNameRequest = () =>
  attackRequest(["@authority", "signature-agent", "a @method", "b @path"]);

/// The same bypass through component PARAMETERS rather than names: the
/// parameter values sit on the same raw line and were split on spaces too.
const parameterTextRequest = () =>
  attackRequest([
    "@authority",
    {
      name: "signature-agent",
      parameters: new Map([
        ["x", "a @method"],
        ["y", "b @path"],
      ]),
    },
  ]);

/// Critical bypass 2's exact shape, reproduced 2026-08-30: a signature base
/// built and signed BY HAND (not via signatureHeaders(), which always signs
/// with signer.keyid and gives no way to inject a parameter ahead of it),
/// whose "@signature-params" line carries a covered "mykeyid" parameter set
/// to an attacker-chosen string, placed BEFORE the real "keyid" parameter.
/// "mykeyid" contains the literal text "keyid" as a substring, so a regex
/// search for keyid="([^"]+)" over the raw header finds it first. The
/// signature is genuinely valid -- the real key signed this exact base --
/// so this proves the returned identity comes from the parsed, cryptographically
/// checked parameter and not from re-scanning the header text afterward.
async function impostorKeyIdRequest() {
  const signer = await signerFromJWK(ED.key);
  const message = {
    method: "POST",
    url: "https://example.com/mcp",
    headers: {
      "signature-agent": '"https://example.com"',
      host: "example.com",
      "content-digest": EMPTY_DIGEST,
    },
  };
  const createdSec = Math.floor(Date.now() / 1000);
  const expiresSec = createdSec + 60;
  const componentList = '("@authority" "@method" "@path" "signature-agent" "content-digest")';
  const signatureInputString =
    `${componentList};created=${createdSec};expires=${expiresSec}` +
    `;mykeyid="impostor-key-id";keyid="${signer.keyid}";alg="ed25519"` +
    `;nonce="test-nonce-0000000000000000000000000000";tag="web-bot-auth"`;
  const base =
    `"@authority": example.com\n` +
    `"@method": POST\n` +
    `"@path": /mcp\n` +
    `"signature-agent": "https://example.com"\n` +
    `"content-digest": ${EMPTY_DIGEST}\n` +
    `"@signature-params": ${signatureInputString}`;
  const signature = await signer.sign(base);
  const sigB64 = Buffer.from(signature).toString("base64");
  return {
    ...message,
    headers: {
      ...message.headers,
      Signature: `sig1=:${sigB64}:`,
      "Signature-Input": `sig1=${signatureInputString}`,
    },
  };
}

test("a correctly signed request is admitted", async () => {
  const req = await signedRequest();
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, true, `expected admission, got ${JSON.stringify(r)}`);
  assert.equal(typeof r.keyId, "string");
});

test("an unknown key is refused without calling the verifier", async () => {
  const req = await signedRequest();
  const r = await verifyRequest(req, async () => null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-key");
});

test("a signature window longer than five minutes is refused", async () => {
  const req = await signedRequest({ windowMs: MAX_WINDOW_MS + 1000 });
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "expired");
});

test("a signature that does not cover @path is refused", async () => {
  // This is web-bot-auth's OWN DEFAULT component set being rejected, not an
  // exotic case: measured 2026-08-30, signatureHeaders with no components
  // option signs exactly ("@authority" "signature-agent"). The spec adds
  // @method and @path so a signature captured from one tool call cannot be
  // replayed against a different one, and that difference is what this asserts.
  const req = await signedRequest({ components: ["@authority", "signature-agent"] });
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "components");
});

test("a tampered path is refused", async () => {
  const req = await signedRequest();
  req.url = "https://example.com/mcp-evil";
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "signature");
});

test("an unsigned request is refused", async () => {
  const r = await verifyRequest(
    { method: "POST", url: "https://example.com/mcp", headers: { host: "example.com" } },
    lookup
  );
  assert.equal(r.ok, false);
  assert.equal(r.reason, "signature");
});

test("headers are matched case-insensitively, as HTTP requires", async () => {
  // signatureHeaders returns "Signature-Input" capitalized; Node lowercases
  // what it receives. Both must verify, or the door admits requests from one
  // source and silently refuses identical ones from the other.
  const req = await signedRequest();
  const lowered = {};
  for (const [k, v] of Object.entries(req.headers)) lowered[k.toLowerCase()] = v;
  const r = await verifyRequest({ ...req, headers: lowered }, lookup);
  assert.equal(r.ok, true, `lower-cased headers must verify: ${JSON.stringify(r)}`);
});

test("smuggled component names in a covered header value are refused", async () => {
  // Critical bypass 1, reproduced 2026-08-30: this signs only @authority and
  // signature-agent, but the signature-agent header's own VALUE contains the
  // text "@method" and "@path". A check that searches the whole base for
  // that text would be satisfied; ok:true here means it was not.
  const req = await smuggledRequest();
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "components");
});

test("a smuggled signature does not replay against a different method and path", async () => {
  // The other half of the same bypass, reproduced 2026-08-30: because
  // @method and @path were never actually covered, the identical headers
  // verified at DELETE /admin-evil just as they did at POST /mcp.
  const req = await smuggledRequest();
  req.method = "DELETE";
  req.url = "https://example.com/admin-evil";
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, false);
});

test("the verified key id is the one the signature covered, not a smuggled parameter", async () => {
  // Critical bypass 2, reproduced 2026-08-30: a hand-built, genuinely valid
  // signature whose Signature-Input carries a covered "mykeyid" parameter --
  // set to an attacker-chosen string -- placed before the real "keyid". The
  // old code read the key id back off the raw header with
  // keyid="([^"]+)".exec(...), which matched "mykeyid" first because that
  // text contains "keyid" as a substring, and returned the attacker's
  // string despite the signature having genuinely verified under the real
  // key.
  const signer = await signerFromJWK(ED.key);
  const req = await impostorKeyIdRequest();
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, true, `expected admission, got ${JSON.stringify(r)}`);
  assert.equal(r.keyId, signer.keyid);
  assert.notEqual(r.keyId, "impostor-key-id");
});

test("a quoted component name containing a space does not count as covering that component", async () => {
  // Critical bypass 3, reproduced 2026-08-30 against the committed code: the
  // last line of a signature base is the caller's own raw Signature-Input
  // value, so splitting that line on spaces turned the single component
  // "a @method" into the two tokens `a` and `@method`. The covered set then
  // appeared to contain @method and @path when it genuinely did not, and the
  // identical headers replayed at DELETE /admin-evil. An RFC 8941 parser
  // keeps "a @method" as ONE member, so it is simply not @method.
  const req = await spacedNameRequest();
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "components");
});

test("component parameters carrying a component name do not count as covering it", async () => {
  // The same bypass by its other route: the parameters attached to a covered
  // component are part of that same raw line, so their VALUES were split on
  // spaces too. Here signature-agent carries ;x="a @method";y="b @path" and
  // nothing else covers method or path.
  const req = await parameterTextRequest();
  const r = await verifyRequest(req, lookup);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "components");
});

test("a component name that is not a string is refused, whatever it stringifies to", async () => {
  // Hardening, not a live bug: a structured-headers Token or DisplayString
  // stringifies back to its plain text, so a member written as %"@method"
  // would have read as @method under String(). Upstream rejects a non-string
  // component ("type is not string") before verifyRequest's callback runs, so
  // this is unreachable through a whole request today -- which is exactly why
  // the test calls coveredComponents directly. Going through a request would
  // prove upstream's check, not ours, and ours must not depend on somebody
  // else's validation surviving a dependency bump.
  const params = '(%"@authority" %"@method" %"@path" %"signature-agent");created=1;expires=2';
  // The parser accepts the line, and every member stringifies to exactly the
  // name REQUIRED wants -- so without the guard this would return the full set.
  assert.deepEqual(
    parseDictionary("sig=" + params).get("sig")[0].map(([name]) => String(name)),
    ["@authority", "@method", "@path", "signature-agent"]
  );
  assert.equal(coveredComponents('"@signature-params": ' + params), null);

  // A bare Token takes the same path. Tokens cannot start with "@", so this
  // one stands in for a header component name.
  assert.equal(coveredComponents('"@signature-params": (signature-agent);created=1'), null);

  // Control: the same line written with genuine strings does parse.
  assert.deepEqual(
    coveredComponents('"@signature-params": ("@authority" "@method" "@path" "signature-agent");created=1'),
    ["@authority", "@method", "@path", "signature-agent"]
  );
});

// 13.5, THROUGH THE DOOR. `reason: "directory"` existed in verifyRequest from
// the start and was UNREACHABLE through the real lookup: makeLookup caught its
// own fetch failure and returned null, which this function reads as "no key for
// that key id". So an agent whose JWKS host had a transient outage -- or one
// that was the target of 13.3 -- was told `unknown-key`, and the protocol
// document's table sends it to re-derive its RFC 7638 thumbprint: precisely the
// trap that document warns "produces a wrong key id silently". It re-registers,
// or gives up. Neither fixes anything, and the failure was cached for an hour.
//
// makeLookup now throws DirectoryUnavailableError for "could not fetch" and
// keeps null for "fetched, and the key is not in it". This asserts the door
// tells the two apart -- the branch, not the lookup that feeds it.
test("an outage is reported as `directory`, and an absent key as `unknown-key`", async () => {
  const req = await signedRequest();

  const outage = await verifyRequest(req, async () => { throw new Error("directory could not be fetched"); });
  assert.equal(outage.ok, false);
  assert.equal(outage.reason, "directory", "an outage must never be reported as a bad key id");

  const absent = await verifyRequest(req, async () => null);
  assert.equal(absent.ok, false);
  assert.equal(absent.reason, "unknown-key");
});

// 3.M1. Signature-Agent became a Structured Field Dictionary keyed by the
// signature label, and this door accepted only the legacy bare string -- so an
// agent following the current specification could not enter at all, and was
// refused `unknown-key`, which points a correct implementer at its thumbprint:
// the one thing that was not wrong. web-bot-auth treats the header as opaque,
// so the encoding decision is entirely ours.
//
// Verified live 2026-09-06 against draft-meunier-webbotauth-httpsig-protocol-02
// (which REPLACES the architecture draft the finding cited): signers MUST send
// the dictionary form, and a verifier MAY accept the bare string. Both are read.
test("Signature-Agent is read as a dictionary, and the legacy string still works", () => {
  const url = "https://signer.example.com";

  // The form a current signer sends.
  assert.equal(signatureAgentUrl(`sig1="${url}"`, "sig1"), url);
  // With one member the key cannot be ambiguous, so no label is needed.
  assert.equal(signatureAgentUrl(`whatever="${url}"`), url);
  // With several, only the member for THIS signature is ours to use.
  assert.equal(signatureAgentUrl(`sig1="${url}", sig2="https://other.example"`, "sig1"), url);
  assert.equal(signatureAgentUrl(`sig1="${url}", sig2="https://other.example"`, "sig2"), "https://other.example");
  assert.equal(signatureAgentUrl(`sig1="${url}", sig2="https://other.example"`), null, "ambiguous is refused, not guessed");

  // The legacy bare string, which the draft still permits a verifier to accept.
  assert.equal(signatureAgentUrl(`"${url}"`), url);

  // And nothing usable is null rather than a guess.
  assert.equal(signatureAgentUrl(""), null);
  assert.equal(signatureAgentUrl(undefined), null);
  assert.equal(signatureAgentUrl(`sig1=42`, "sig1"), null, "a member that is not a string is not a URL");
});

// The label comes from the request, not from a hardcoded "sig1".
test("the signature label is read off Signature-Input", () => {
  const req = new Request("https://example.com/mcp", { method: "POST" });
  req.headers.set("signature-input", 'mylabel=("@authority");created=1;expires=2;keyid="k"');
  assert.equal(signatureLabel(req), "mylabel");

  const bare = new Request("https://example.com/mcp", { method: "POST" });
  assert.equal(signatureLabel(bare), null);
});

// ---------------------------------------------------------------------------
// The published vectors, verified as SIGNATURES rather than mined for keys
// ---------------------------------------------------------------------------

// Test gap 20. The vectors in test/vectors/ are the Web Bot Auth draft's own
// Appendix values, and until now the suite used them ONLY as a source of key
// material: every test above re-signs with signatureHeaders() and checks the
// result. That proves our verifier agrees with our SIGNER. It cannot fail if
// both sides share a mistake, and it never once looked at the `signature` the
// draft recorded.
//
// This feeds the recorded signature back in and asserts it verifies under the
// vector's own key -- the only test here that would notice if this project and
// the specification disagreed about what a signature base is.
//
// TWO THINGS MAKE IT AWKWARD, both dealt with rather than worked around:
//
//   The vectors cover only @authority, so they cannot go through
//   verifyRequest -- its REQUIRED list demands @method, @path and
//   content-digest, and would refuse them for "components" before reaching any
//   cryptography. web-bot-auth's verify() is the layer underneath, and that is
//   what this drives.
//
//   They expired on 2025-01-01. http-message-sig checks expiry with a bare
//   `new Date()` and takes no clock, so the clock is frozen inside the vector's
//   own validity window for the duration of the call. Expiry is not what is
//   under test here; the signature is.
const RealDate = globalThis.Date;

/// Run `fn` with the global clock frozen at `ms`. Restores it even on a throw.
function atTime(ms, fn) {
  class Frozen extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }
    static now() { return ms; }
  }
  globalThis.Date = Frozen;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.Date = RealDate; });
}

/// Every Ed25519 vector in the file, not just the first: there are two, and the
/// second is the one carrying a Signature-Agent.
const ED_VECTORS = VECTORS.filter((v) => v.key.kty === "OKP");

function requestFromVector(v) {
  const headers = { signature: v.signature, "signature-input": v.signature_input };
  if (v.signature_agent) headers["signature-agent"] = v.signature_agent;
  return { method: "GET", url: v.target_url, headers };
}

const verifyWithVectorKey = (v) => async (data, signature, params) => {
  const verifier = await verifierFromJWK(v.key);
  await verifier(data, signature, params);
};

test("the draft's own recorded signatures verify under the draft's own keys", async () => {
  assert.equal(ED_VECTORS.length, 2, "both Ed25519 vectors must be exercised");

  for (const v of ED_VECTORS) {
    await atTime(v.created_ms + 1000, async () => {
      await verify(requestFromVector(v), verifyWithVectorKey(v));
    });
  }
});

test("CONTROL: one flipped bit in a recorded signature is refused", async () => {
  // Without this the test above would pass against a verifier that accepted
  // anything -- which is precisely the failure mode of using the vectors as
  // key material and never checking what they signed.
  for (const v of ED_VECTORS) {
    const raw = Buffer.from(v.signature.replace(/^[^:]+:/, "").replace(/:$/, ""), "base64");
    raw[0] ^= 1;
    const tampered = v.signature.replace(/:[^:]+:/, `:${raw.toString("base64")}:`);
    const request = requestFromVector(v);
    request.headers.signature = tampered;

    await atTime(v.created_ms + 1000, async () => {
      await assert.rejects(
        () => verify(request, verifyWithVectorKey(v)),
        /invalid signature/,
      );
    });
  }
});

test("CONTROL: the frozen clock is put back, so no later test inherits it", () => {
  assert.equal(globalThis.Date, RealDate, "the global Date was not restored");
  // Compared against the vectors' own expiry rather than a hardcoded date:
  // the property that matters is that we are no longer inside their window,
  // and that stays true however far in the future this runs.
  assert.ok(
    Date.now() > Math.max(...ED_VECTORS.map((v) => v.expires_ms)),
    "the clock is still frozen inside a vector's window",
  );
});
