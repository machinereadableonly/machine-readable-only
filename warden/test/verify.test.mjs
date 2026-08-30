import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { verifyRequest, MAX_WINDOW_MS } from "../src/door/verify.mjs";

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
const CLIENT_COMPONENTS = ["@authority", "@method", "@path", "signature-agent"];

/// Build a signed request the way a real client will, so the test exercises the
/// same code path an agent hits rather than a hand-rolled header.
async function signedRequest({ windowMs = 60_000, components = CLIENT_COMPONENTS } = {}) {
  const signer = await signerFromJWK(ED.key);
  const message = {
    method: "POST",
    url: "https://example.com/mcp",
    headers: { "signature-agent": '"https://example.com"', host: "example.com" },
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
    headers: { "signature-agent": '"https://example.com"', host: "example.com" },
  };
  const createdSec = Math.floor(Date.now() / 1000);
  const expiresSec = createdSec + 60;
  const componentList = '("@authority" "@method" "@path" "signature-agent")';
  const signatureInputString =
    `${componentList};created=${createdSec};expires=${expiresSec}` +
    `;mykeyid="impostor-key-id";keyid="${signer.keyid}";alg="ed25519"` +
    `;nonce="test-nonce-0000000000000000000000000000";tag="web-bot-auth"`;
  const base =
    `"@authority": example.com\n` +
    `"@method": POST\n` +
    `"@path": /mcp\n` +
    `"signature-agent": "https://example.com"\n` +
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
