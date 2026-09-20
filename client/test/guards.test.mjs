// The client's refusals, and the two places it was trusting the site.
//
// Every test here is a 2026-09-17 review finding, checked before it was fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, statSync, readFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDictionary } from "structured-headers";

import { signAuthorization, chooseAccepted, assertExpected, MAX_AUTHORISATION_SECONDS } from "../src/pay.mjs";
import { signRequest } from "../src/signing.mjs";
import { generateIdentity, saveIdentity, loadIdentity } from "../src/keys.mjs";
import { knock } from "../src/door.mjs";

const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const ASSET = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const KEY = "0x" + "11".repeat(32);

function accepted(overrides = {}) {
  return {
    scheme: "exact",
    network: "eip155:84532",
    payTo: PAY_TO,
    amount: "1000000",
    asset: ASSET,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// THE VALIDITY WINDOW WAS THE SITE'S TO CHOOSE
// -----------------------------------------------------------------------

test("an authorisation is never signed for longer than the client's own maximum", async () => {
  // The site names `maxTimeoutSeconds` and the client used it verbatim, so a
  // site that asked for a year got a signature valid for a year. An EIP-3009
  // authorisation cannot be recalled: whoever holds it can spend it any time
  // inside the window, and the ladder runs to $1,250.00.
  const now = 1_700_000_000;
  const signed = await signAuthorization({
    accepted: accepted({ maxTimeoutSeconds: 31_536_000 }),   // one year
    walletPrivateKey: KEY,
    now,
  });
  const validBefore = Number(signed.authorization.validBefore);
  assert.equal(validBefore, now + MAX_AUTHORISATION_SECONDS, "clamped to the client's ceiling");
  assert.ok(MAX_AUTHORISATION_SECONDS <= 600, "and that ceiling is ten minutes");
});

test("a shorter window the site asks for is still honoured", async () => {
  // THE CONTROL. The clamp is a ceiling, not a replacement: a site asking for
  // less than the maximum must still get less.
  const now = 1_700_000_000;
  const signed = await signAuthorization({ accepted: accepted({ maxTimeoutSeconds: 120 }), walletPrivateKey: KEY, now });
  assert.equal(Number(signed.authorization.validBefore), now + 120);
});

test("a nonsense window is refused rather than guessed at", async () => {
  for (const bad of [0, -1, "soon", NaN, Infinity]) {
    await assert.rejects(
      () => signAuthorization({ accepted: accepted({ maxTimeoutSeconds: bad }), walletPrivateKey: KEY }),
      /refusing to pay/,
      `maxTimeoutSeconds ${bad} must be refused`
    );
  }
});

// -----------------------------------------------------------------------
// ONLY THE FIRST PAYMENT REQUIREMENT WAS EVER READ
// -----------------------------------------------------------------------

test("the requirement that matches what you expect is the one chosen", () => {
  // A site may offer several. The client read `accepts[0]` and compared THAT
  // to the expectation, so an honest site offering mainnet first and the
  // expected chain second was refused, and a hostile one could put the
  // attractive entry first and the real one out of reach.
  const list = [
    accepted({ network: "eip155:8453", amount: "9000000" }),
    accepted({ network: "eip155:84532", amount: "1000000" }),
  ];
  const chosen = chooseAccepted(list, { payTo: PAY_TO, amount: "1000000", network: "eip155:84532" });
  assert.equal(chosen.network, "eip155:84532");
  assert.equal(chosen.amount, "1000000");
});

test("no requirement matching what you expect is a refusal, not a fallback", () => {
  // Two or more offers and none matching: there is no "the one they meant", so
  // this refuses here. A SINGLE non-matching offer is handed to assertExpected
  // instead, which names the field that is wrong -- see the test below.
  const list = [accepted({ network: "eip155:8453" }), accepted({ amount: "5000000" })];
  assert.throws(
    () => chooseAccepted(list, { payTo: PAY_TO, amount: "1000000", network: "eip155:84532" }),
    /refusing to pay/
  );
});

test("a SINGLE offer that does not match is handed on, so the field can be named", () => {
  // Refused either way -- by assertExpected, whose message says which field is
  // wrong. A vaguer refusal here would be a worse diagnosis, not a safer one.
  const only = [accepted({ payTo: "0x" + "b2".repeat(20) })];
  assert.equal(chooseAccepted(only, { payTo: PAY_TO, amount: "1000000" }), only[0]);
  assert.throws(() => assertExpected(only[0], { payTo: PAY_TO, amount: "1000000" }), /refusing to pay: payTo is/);
});

test("an empty offer is refused", () => {
  assert.throws(() => chooseAccepted([], { payTo: PAY_TO, amount: "1" }), /refusing to pay/);
});

// -----------------------------------------------------------------------
// THE KEY FILE'S WORLD-READABLE WINDOW
// -----------------------------------------------------------------------

test("overwriting an existing key file never leaves it readable by others", () => {
  // `writeFileSync`'s `mode` applies only when it CREATES the file. Over an
  // existing 0644 file the new key bytes landed world-readable, and the chmod
  // that fixed it came after the write.
  const dir = mkdtempSync(join(tmpdir(), "mro-key-"));
  const path = join(dir, "identity.json");
  writeFileSync(path, "{}");
  chmodSync(path, 0o644);

  const identity = { publicJwk: { kty: "OKP" }, privateJwk: { kty: "OKP", d: "secret" }, keyId: "k" };
  saveIdentity(identity, path);

  assert.equal(statSync(path).mode & 0o777, 0o600, "the file must end at 0600");
  assert.ok(readFileSync(path, "utf8").includes("secret"), "and it must actually have been written");
  assert.deepEqual(loadIdentity(path), identity);
});

test("a fresh key file is 0600 too", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mro-key-"));
  const path = join(dir, "identity.json");
  saveIdentity(await generateIdentity(), path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

// -----------------------------------------------------------------------
// A SITE THAT ANSWERS WITH SOMETHING THAT IS NOT JSON
// -----------------------------------------------------------------------

test("a non-JSON answer is a sentence, not a raw SyntaxError", async () => {
  // A proxy error page, a rate-limit page, a site that is simply down: the
  // client called res.json() and threw `Unexpected token '<'`, which says
  // nothing about the site, the status or what to do.
  const fetchImpl = async () =>
    new Response("<html><title>502 Bad Gateway</title></html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });

  await assert.rejects(
    () => knock({ origin: "https://example.com", fetchImpl }),
    (err) => {
      assert.match(err.message, /502/, "the status is the first useful fact");
      assert.match(err.message, /Bad Gateway/, "and a snippet of what actually came back");
      assert.doesNotMatch(err.message, /Unexpected token/, "never the parser's complaint");
      return true;
    }
  );
});

// -----------------------------------------------------------------------
// THE SIGNATURE-AGENT FORM THE DRAFT ASKS FOR
// -----------------------------------------------------------------------

test("Signature-Agent is sent as a dictionary keyed by the signature label", async () => {
  // draft-meunier-web-bot-auth-architecture-05, section 4.2.1: the header is a
  // Dictionary and "It is RECOMMENDED that the `key` matches the signature
  // label". The bare string appears only in the appendix's LEGACY EXAMPLES,
  // which say "IF YOU ARE AN IMPLEMENTER, PLEASE UPDATE TO THE ABOVE".
  // This package is the worked example agents copy, so it sends the current
  // form. Checked against the live draft on 2026-09-19.
  const { privateJwk } = await generateIdentity();
  const { headers } = await signRequest({
    privateJwk,
    origin: "https://example.com",
    signatureAgent: "https://example.com",
  });

  const agent = headers["signature-agent"] ?? headers["Signature-Agent"];
  const dict = parseDictionary(agent);
  const input = String(headers["Signature-Input"] ?? headers["signature-input"]);
  const label = input.slice(0, input.indexOf("="));

  assert.ok(dict.has(label), `the dictionary key must be the signature label (${label}), got ${agent}`);
  assert.equal(dict.get(label)[0], "https://example.com");
  assert.ok(input.includes('"signature-agent"'), "and it is still a covered component");
});


// -- the library surface -----------------------------------------------------

// A CONSUMER USING THIS AS A LIBRARY NEEDS THE SENTENCE TABLE. rpc and callTool
// throw door refusals as bare reason strings; doorMessage and DOOR_REASONS are
// what turn one into something an operator can read. They were exported from
// messages.mjs and reachable through neither index.mjs nor a subpath, so a
// consumer had to write its own table and let it drift from ours.
test("index.mjs exposes the message helpers a library consumer needs", async () => {
  const api = await import("../src/index.mjs");
  for (const name of ["doorMessage", "DOOR_REASONS", "paymentFailedMessage", "lostResponseMessage"]) {
    assert.equal(typeof api[name], name === "DOOR_REASONS" ? "object" : "function", `index.mjs must export ${name}`);
  }
  // The table and the function agree: every reason has a sentence.
  for (const reason of Object.keys(api.DOOR_REASONS)) {
    assert.equal(typeof api.doorMessage(reason), "string");
  }
});

test('package.json exposes "./messages" so the table is reachable without the barrel', () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.exports["./messages"], "./src/messages.mjs");
});

// A SETTLED PAYMENT WHOSE ANSWER WAS LOST IS NOT A REFUSAL. paymentFailedMessage
// covers the case where the site answered and said the settlement failed; that
// one says NOTHING WAS MINTED, which would be a lie here. The money may be
// gone and the token may exist, so the one thing this must never do is invite
// paying again.
test("the lost-response message says to check before paying a second time", async () => {
  const { lostResponseMessage } = await import("../src/messages.mjs");
  const text = lostResponseMessage("https://example.com");
  assert.match(text, /mro-agent status --site https:\/\/example\.com/);
  assert.match(text, /do\s+NOT simply run this again/);
  assert.doesNotMatch(text, /NOTHING WAS MINTED/, "that is the other case, and asserting it here would be false");
});
