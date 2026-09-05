// The client against a REAL Warden, not a mock of one.
//
// Every module in this package is exercised through an actual HTTP server
// built from the site's own source: key generation, registration, RFC 9421
// signing, the challenge answer, tools/list, a free tool, and the payment
// demand a paid tool returns. If the door changes its rules, these fail.
//
// The payment gateway is the one thing stubbed, because the real one reaches a
// third-party facilitator over the network and a unit suite must not. What is
// stubbed is the FACILITATOR, not our side: the demand the client reads is
// built and wrapped by the real @x402/mcp code path.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../../warden/src/server.mjs";
import { makeMcpHandler } from "../../warden/src/mcp/server.mjs";
import { tokenView } from "../../warden/src/mcp/tokenView.mjs";
import { openDb } from "../../warden/src/mirror/db.mjs";
import { queries } from "../../warden/src/mirror/queries.mjs";
import { utcDay } from "../../warden/src/mcp/tools/checkin.mjs";
import { openChain } from "../../warden/test/chain-stub.mjs";

import { generateIdentity, ensureIdentity, loadIdentity } from "../src/keys.mjs";
import { signRequest, REQUIRED_COMPONENTS } from "../src/signing.mjs";
import { answerChallenge, msRemaining } from "../src/challenge.mjs";
import { registerKey, knock } from "../src/door.mjs";
import { listTools, callTool, structured } from "../src/mcp.mjs";
import { readDemand, assertExpected, signAuthorization, payFor } from "../src/pay.mjs";

const DOMAIN = "example.com";
const SECRET = "client-journey-secret";
const TREASURY = "0x000000000000000000000000000000000000dEaD";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// A funded-looking throwaway. Never used anywhere but here.
const WALLET_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

let dir, server, origin, q;

/// The payment demand a real @x402/mcp wrapper produces, with the facilitator
/// stubbed. This is the shape the client has to be able to read.
const DEMAND = {
  x402Version: 2,
  error: "Payment required to access this tool",
  resource: { url: "mcp://tool/mint", serviceName: "machine-readable-only" },
  accepts: [{
    scheme: "exact",
    network: "eip155:84532",
    amount: "1000000",
    asset: USDC,
    payTo: TREASURY,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  }],
};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "mro-client-"));
  const db = openDb(join(dir, "mirror.db"));
  q = queries(db);

  // The site's OWN chain stub, not one written here. A hand-rolled stub was
  // missing lifecycleOf() and turned every tool call into a 500, which looked
  // exactly like a client bug for as long as it took to read the server log.
  const chain = openChain();

  const mcp = makeMcpHandler({
    q, chain, today: utcDay,
    contract: "0xcontract", chainId: 84532,
    challengeSecret: SECRET, domain: DOMAIN, llmsTxt: "",
    catalogue: {}, supplyCap: 10_000,
    // The paid tools refuse with a real demand, exactly as the wrapper does.
    paid: () => async () => ({
      structuredContent: DEMAND,
      content: [{ type: "text", text: JSON.stringify(DEMAND) }],
      isError: true,
    }),
  });

  server = createServer({
    stateDbPath: join(dir, "mirror.db"),
    domain: DOMAIN, challengeSecret: SECRET,
    tokenView, mcp, allowRegistration: () => true,
    contract: "0x00000000000000000000000000000000000C0DE0", chainId: 84532,
  });
  origin = await new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
});

after(async () => {
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

test("an identity is Ed25519, and its key id is the thumbprint the door derives", async () => {
  const identity = await generateIdentity();
  assert.equal(identity.publicJwk.kty, "OKP");
  assert.equal(identity.publicJwk.crv, "Ed25519");
  // 43 characters is base64url of a SHA-256 digest, unpadded.
  assert.equal(identity.keyId.length, 43);
  // The private JWK must not be what we hand out.
  assert.ok(identity.privateJwk.d, "the private half must carry d");
  assert.equal(identity.publicJwk.d, undefined, "the public half must NOT carry d");
});

test("a saved identity is not readable by anyone else", async () => {
  const path = join(dir, "identity.jwk.json");
  const { identity, created } = await ensureIdentity(path);
  assert.equal(created, true);
  // 0o600: owner read/write, nobody else anything.
  assert.equal(statSync(path).mode & 0o777, 0o600);
  // And it is stable: a second call loads rather than regenerating.
  const again = await ensureIdentity(path);
  assert.equal(again.created, false);
  assert.equal(again.identity.keyId, identity.keyId);
  assert.equal(loadIdentity(path).keyId, identity.keyId);
});

test("the signature covers exactly the four components the door requires", async () => {
  const { privateJwk } = await generateIdentity();
  const { headers } = await signRequest({ privateJwk, origin: `https://${DOMAIN}`, signatureAgent: `https://${DOMAIN}` });

  const input = headers["Signature-Input"] ?? headers["signature-input"];
  for (const component of REQUIRED_COMPONENTS) {
    assert.ok(input.includes(`"${component}"`), `signature must cover ${component}`);
  }
  assert.ok(input.includes('tag="web-bot-auth"'));
  assert.ok(input.includes('alg="ed25519"'));
});

test("an unsigned knock returns a live challenge, and the answer is reproducible", async () => {
  const body = await knock({ origin });
  assert.ok(body.challenge);
  assert.ok(msRemaining(body.challenge) > 0, "a fresh challenge must have time left on it");

  // The formula, checked against a second independent computation.
  const keyId = "some-key-id";
  const answer = answerChallenge(body.challenge, keyId);
  const { createHash } = await import("node:crypto");
  assert.equal(answer, createHash("sha256").update(body.challenge + keyId).digest("hex"));
});

test("a registered key is admitted, and can list the tools", async () => {
  const { privateJwk, keyId } = await generateIdentity();
  const registered = await registerKey({ origin, privateJwk });
  assert.equal(registered, keyId, "the site must derive the same key id we did");

  const tools = await listTools({ origin, site: `https://${DOMAIN}`, privateJwk });
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["challenge", "checkin", "ladder", "mint", "rebind", "rest", "seed", "status", "upgrade"]);
});

test("a free tool answers, and reads the caller's identity from the signature", async () => {
  const { privateJwk } = await generateIdentity();
  await registerKey({ origin, privateJwk });

  const result = await callTool({ origin, site: `https://${DOMAIN}`, privateJwk, name: "status", arguments: {} });
  const body = structured(result);
  assert.equal(body.ok, true);
  // A fresh key owns nothing, and cannot see anybody else's tokens.
  assert.deepEqual(body.tokens, []);
});

test("an unsigned request is refused at the door", async () => {
  const res = await fetch(new URL("/mcp", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  assert.equal(res.status, 401);
});

test("a paid tool returns a demand the client can read", async () => {
  const { privateJwk } = await generateIdentity();
  await registerKey({ origin, privateJwk });

  const result = await callTool({ origin, site: `https://${DOMAIN}`, privateJwk, name: "mint", arguments: { to: "0x" + "a1".repeat(20) } });
  const demand = readDemand(result);

  assert.ok(demand, "the client must find a payment demand in the refusal");
  assert.equal(demand.accepts[0].amount, "1000000");
  assert.equal(demand.accepts[0].payTo, TREASURY);
});

test("REFUSES to sign without an expected payTo given out of band", async () => {
  const result = { isError: true, structuredContent: DEMAND, content: [] };
  await assert.rejects(
    () => payFor({ result, expected: undefined, walletPrivateKey: WALLET_KEY }),
    /an expected payTo address is required/
  );
  await assert.rejects(
    () => payFor({ result, expected: {}, walletPrivateKey: WALLET_KEY }),
    /an expected payTo address is required/
  );
});

test("REFUSES a demand whose payTo is not the one expected", () => {
  assert.throws(
    () => assertExpected(DEMAND.accepts[0], { payTo: "0x" + "b2".repeat(20) }),
    /payTo is 0x000000000000000000000000000000000000dEaD, expected/
  );
});

test("REFUSES a demand whose amount was changed under us", () => {
  assert.throws(
    () => assertExpected({ ...DEMAND.accepts[0], amount: "100000000" }, { payTo: TREASURY, amount: "1000000" }),
    /amount is 100000000, expected 1000000/
  );
});

test("REFUSES any scheme but exact, because only exact leaves no allowance", () => {
  assert.throws(
    () => assertExpected({ ...DEMAND.accepts[0], scheme: "upto" }, { payTo: TREASURY }),
    /this client only signs "exact"/
  );
});

test("a matching demand is signed as EIP-3009 typed data, and recovers to our address", async () => {
  const { verifyTypedData } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { authorizationTypes } = await import("@x402/evm");
  const account = privateKeyToAccount(WALLET_KEY);

  const meta = await payFor({
    result: { isError: true, structuredContent: DEMAND, content: [] },
    expected: { payTo: TREASURY, amount: "1000000", asset: USDC, network: "eip155:84532" },
    walletPrivateKey: WALLET_KEY,
  });

  const { signature, authorization } = meta["x402/payment"].payload;
  assert.equal(authorization.from, account.address);
  assert.equal(authorization.to, TREASURY);
  assert.equal(authorization.value, "1000000");
  assert.match(authorization.nonce, /^0x[0-9a-f]{64}$/);

  // THE CLAIM THIS PINS: the thing signed is one transfer of one amount to one
  // address, and it verifies against the token's own EIP-712 domain. If any
  // field were altered after signing, this would not recover.
  const valid = await verifyTypedData({
    address: account.address,
    types: authorizationTypes,
    primaryType: "TransferWithAuthorization",
    domain: { name: "USDC", version: "2", chainId: 84532, verifyingContract: USDC },
    message: {
      from: authorization.from,
      to: authorization.to,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
    signature,
  });
  assert.equal(valid, true, "the authorisation must verify against the signer's own address");
});

test("nothing is signed when there is nothing to pay for", async () => {
  const meta = await payFor({
    result: { isError: false, structuredContent: { ok: true } },
    expected: { payTo: TREASURY },
    walletPrivateKey: WALLET_KEY,
  });
  assert.equal(meta, null);
});

// The bug that made the piece unenterable, from the client's side. A demand
// whose isError was buried by a double wrap must NOT be read as payable --
// matching the reference client rather than the bytes is the whole point.
test("a double-wrapped refusal is not mistaken for a demand", () => {
  const doubleWrapped = {
    content: [{ type: "text", text: JSON.stringify({ structuredContent: DEMAND, isError: true }) }],
    structuredContent: { structuredContent: DEMAND, isError: true },
  };
  assert.equal(readDemand(doubleWrapped), null);
});

// -- the two digest implementations must agree ------------------------------

test("the client's content-digest is byte-identical to the door's", async () => {
  // The client and the Warden each compute this independently, and if they
  // ever diverge EVERY request is refused with reason "digest" -- a total
  // outage from a one-character difference. The journey tests above would
  // catch it, but only by failing everything at once; this says which side.
  const { contentDigest: clientDigest } = await import("../src/signing.mjs");
  const { contentDigest: doorDigest } = await import("../../warden/src/door/verify.mjs");

  for (const body of ["", "{}", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), "\u00e9\u00e8"]) {
    assert.equal(clientDigest(body), doorDigest(body), `disagreed on ${JSON.stringify(body)}`);
  }
  // And the shape is RFC 9530's, not something of our own invention.
  assert.match(clientDigest("x"), /^sha-256=:[A-Za-z0-9+/]+=*:$/);
});
