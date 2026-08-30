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
