// The Clock proves every row before it signs it. These drive the REAL prover
// with evidence the REAL door produced, so a forged row is refused for the
// reason the Clock would give in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { signatureHeaders } from "../tools/sign-headers.mjs";
import { signerFromJWK } from "web-bot-auth/crypto";
import { encodeEventTopics, encodeAbiParameters } from "viem";
import { getDefaultAsset } from "@x402/evm";
import { admit } from "../src/door/middleware.mjs";
import { contentDigest } from "../src/door/verify.mjs";
import { issueChallenge } from "../src/door/challenge.mjs";
import { keyIdToBytes32 } from "../src/mcp/keyId.mjs";
import { utcDay } from "../src/day.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeProver, priceUnits } from "../src/clock/prove.mjs";
import { openLedger } from "../src/clock/ledger.mjs";
import { AUTHORIZATION_USED, TRANSFER } from "../src/clock/unresolved.mjs";
import { readFileSync } from "node:fs";

/// Plain version-10 QR codes for https://example.com/t/<id>#, and one real solved QArt bitmap for id 7.
const QR = JSON.parse(readFileSync(new URL("./fixtures/qr-examples.json", import.meta.url), "utf8"));
const QART_7 = readFileSync(new URL("./fixtures/qart-example-t7.hex", import.meta.url), "utf8").trim();

const DOMAIN = "example.com";
const SECRET = "test-secret";
const CHAIN_ID = 84532;
const ASSET = getDefaultAsset(`eip155:${CHAIN_ID}`).asset;
const TREASURY = "0x2222222222222222222222222222222222222222";
const PAYER = "0x3333333333333333333333333333333333333333";
const OWNER = "0x4444444444444444444444444444444444444444";
const COMPONENTS = ["@authority", "@method", "@path", "signature-agent", "content-digest", "challenge", "challenge-response"];
const BANK = [{ id: "q1", text: "?", answers: ["red", "green", "blue"] }];
const DAY = utcDay();

function newKey() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  return { jwk, pub: { kty: jwk.kty, crv: jwk.crv, x: jwk.x } };
}
const AGENT = newKey();
const STRANGER = newKey();

/// A tools/call admitted by the real door, and the evidence it hands on.
async function signedCall(key, tool, args, { meta = null, domain = DOMAIN } = {}) {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "tools/call",
    params: { name: tool, arguments: args, ...(meta ? { _meta: meta } : {}) },
  });
  const signer = await signerFromJWK(key.jwk);
  const { challenge } = issueChallenge(SECRET);
  const message = {
    method: "POST",
    url: `https://${domain}/mcp`,
    headers: {
      "signature-agent": `"https://${domain}"`,
      host: domain,
      "content-digest": contentDigest(body),
      challenge,
      "challenge-response": createHash("sha256").update(challenge + signer.keyid).digest("hex"),
    },
  };
  const created = new Date();
  const sig = await signatureHeaders(message, signer, { created, expires: new Date(created.getTime() + 60_000), components: COMPONENTS });
  const decision = await admit(
    { method: "POST", url: "/mcp", headers: { ...message.headers, ...sig } },
    { secret: SECRET, lookupKey: async () => key.pub, seen: new Set(), spent: new Map(), domain, body },
  );
  assert.equal(decision.ok, true, JSON.stringify(decision.body));
  return { evidence: decision.evidence, keyId: decision.keyId };
}

const payment = (nonce, value = "1000000", to = TREASURY) => ({
  "x402/payment": {
    x402Version: 2,
    scheme: "exact",
    network: `eip155:${CHAIN_ID}`,
    payload: {
      signature: "0x00",
      authorization: { from: PAYER, to, value, validAfter: "0", validBefore: "9999999999", nonce },
    },
  },
});

const nonce = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const txHash = (n) => `0x${(0xabc000 + n).toString(16).padStart(64, "0")}`;

/// A settlement receipt: AuthorizationUsed, then the Transfer it caused.
function settlement({ payNonce, value = 1_000_000n, to = TREASURY, from = PAYER }) {
  return {
    status: "success",
    logs: [
      { address: ASSET, logIndex: 3, data: "0x",
        topics: encodeEventTopics({ abi: [AUTHORIZATION_USED], eventName: "AuthorizationUsed", args: { authorizer: from, nonce: payNonce } }) },
      { address: ASSET, logIndex: 4, data: encodeAbiParameters([{ type: "uint256" }], [value]),
        topics: encodeEventTopics({ abi: [TRANSFER], eventName: "Transfer", args: { from, to } }) },
    ],
  };
}

function setup({ bound = {}, receipts = {}, houseKeyId = null } = {}) {
  const q = queries(openDb(":memory:"));
  const publicClient = {
    async readContract({ functionName, args }) {
      const key = bound[Number(args[0])];
      if (functionName !== "viewOf" || !key) throw new Error("no such token");
      return { agentKeyId: keyIdToBytes32(key) };
    },
    async getTransactionReceipt({ hash }) {
      if (!receipts[hash]) throw new Error("receipt not found");
      return receipts[hash];
    },
  };
  const prover = makeProver({
    q, publicClient, contract: "0xcontract", chainId: CHAIN_ID, domain: DOMAIN, treasury: TREASURY,
    houseKeyId, ledger: openLedger(":memory:"), bank: BANK,
  });
  return { q, prover };
}

// --- credits

test("a check-in the agent signed is proven, and the answer it signed is kept", async () => {
  const { evidence, keyId } = await signedCall(AGENT, "checkin", { tokenId: 7, answer: "green" });
  const { q, prover } = setup({ bound: { 7: keyId } });
  q.putEvidence("credit", `7:${DAY}`, evidence);
  assert.deepEqual(await prover.credit({ tokenId: 7, day: DAY, questionId: "q1", answer: 1 }), { ok: true, answer: 1 });
});

test("a credit with no signed request behind it is refused", async () => {
  const { prover } = setup({ bound: { 7: "k" } });
  const r = await prover.credit({ tokenId: 7, day: DAY, questionId: null, answer: null });
  assert.equal(r.ok, false);
  assert.match(r.why, /no signed request/);
});

test("a check-in signed by a key the chain does not bind to the token is refused", async () => {
  const agent = await signedCall(AGENT, "checkin", { tokenId: 7 });
  const stranger = await signedCall(STRANGER, "checkin", { tokenId: 7 });
  const { q, prover } = setup({ bound: { 7: agent.keyId } });
  q.putEvidence("credit", `7:${DAY}`, stranger.evidence);
  const r = await prover.credit({ tokenId: 7, day: DAY, questionId: null, answer: null });
  assert.equal(r.ok, false);
  assert.match(r.why, /not signed by the key the chain binds/);
});

test("a signed check-in cannot be moved to another day or another token", async () => {
  const { evidence, keyId } = await signedCall(AGENT, "checkin", { tokenId: 7 });
  const { q, prover } = setup({ bound: { 7: keyId, 8: keyId } });
  q.putEvidence("credit", `7:${DAY + 5}`, evidence);
  q.putEvidence("credit", `8:${DAY}`, evidence);
  assert.match((await prover.credit({ tokenId: 7, day: DAY + 5, questionId: null, answer: null })).why, /not the day it was signed/);
  assert.match((await prover.credit({ tokenId: 8, day: DAY, questionId: null, answer: null })).why, /different token/);
});

test("an answer the database holds but the agent never signed is written as silence", async () => {
  const { evidence, keyId } = await signedCall(AGENT, "checkin", { tokenId: 7 });
  const { q, prover } = setup({ bound: { 7: keyId } });
  q.putEvidence("credit", `7:${DAY}`, evidence);
  assert.deepEqual(await prover.credit({ tokenId: 7, day: DAY, questionId: "q1", answer: 2 }), { ok: true, answer: null });
});

test("a request signed for another site is refused", async () => {
  const { evidence, keyId } = await signedCall(AGENT, "checkin", { tokenId: 7 }, { domain: "other.example" });
  const { q, prover } = setup({ bound: { 7: keyId } });
  q.putEvidence("credit", `7:${DAY}`, evidence);
  assert.match((await prover.credit({ tokenId: 7, day: DAY, questionId: null, answer: null })).why, /signed for other\.example/);
});

test("a body changed after signing is refused", async () => {
  const { evidence, keyId } = await signedCall(AGENT, "checkin", { tokenId: 7 });
  const forged = JSON.parse(Buffer.from(evidence.body, "base64").toString("utf8"));
  forged.params.arguments.tokenId = 8;
  const { q, prover } = setup({ bound: { 8: keyId } });
  q.putEvidence("credit", `8:${DAY}`, { ...evidence, body: Buffer.from(JSON.stringify(forged)).toString("base64") });
  assert.match((await prover.credit({ tokenId: 8, day: DAY, questionId: null, answer: null })).why, /not the one that was signed/);
});

test("a stored signature that does not verify is refused", async () => {
  const { evidence, keyId } = await signedCall(AGENT, "checkin", { tokenId: 7 });
  const { q, prover } = setup({ bound: { 7: keyId } });
  const sig = Buffer.from(evidence.signature, "base64");
  sig[0] ^= 1;
  q.putEvidence("credit", `7:${DAY}`, { ...evidence, signature: sig.toString("base64") });
  assert.match((await prover.credit({ tokenId: 7, day: DAY, questionId: null, answer: null })).why, /does not verify/);
});

// --- mints

async function mintCase({ n = 1, tokenId = 2, key = AGENT, to = OWNER, value = "1000000", payTo = TREASURY } = {}) {
  const call = await signedCall(key, "mint", { to }, { meta: payment(nonce(n), value, payTo) });
  return {
    call,
    row: { tokenId, toAddress: to, keyId: call.keyId, agentKeyId: call.keyId, qr: QR[tokenId], payNonce: nonce(n), paymentTx: txHash(n), day: DAY },
  };
}

test("a paid mint is proven from its own settlement receipt", async () => {
  const { call, row } = await mintCase();
  const { q, prover } = setup({ receipts: { [txHash(1)]: settlement({ payNonce: nonce(1) }) } });
  q.putEvidence("mint", 2, call.evidence);
  assert.deepEqual(await prover.mint(row), { ok: true });
});

test("a mint whose recipient was changed after signing is refused", async () => {
  const { call, row } = await mintCase();
  const { q, prover } = setup({ receipts: { [txHash(1)]: settlement({ payNonce: nonce(1) }) } });
  q.putEvidence("mint", 2, call.evidence);
  assert.match((await prover.mint({ ...row, toAddress: STRANGER_ADDRESS })).why, /different recipient/);
});
const STRANGER_ADDRESS = "0x5555555555555555555555555555555555555555";

test("a mint whose recorded transaction paid someone else, or paid less, is refused", async () => {
  const { call, row } = await mintCase();
  for (const receipt of [
    settlement({ payNonce: nonce(1), to: STRANGER_ADDRESS }),
    settlement({ payNonce: nonce(1), value: 1n }),
    settlement({ payNonce: nonce(9) }),
    { ...settlement({ payNonce: nonce(1) }), status: "reverted" },
  ]) {
    const { q, prover } = setup({ receipts: { [txHash(1)]: receipt } });
    q.putEvidence("mint", 2, call.evidence);
    const r = await prover.mint(row);
    assert.equal(r.ok, false, JSON.stringify(receipt.logs?.[1]));
  }
});

test("a mint the agent signed a cheaper or misdirected payment for is refused before the receipt is read", async () => {
  for (const [opts, why] of [[{ value: "1" }, /not 1000000 units/], [{ payTo: STRANGER_ADDRESS }, /not to the treasury/]]) {
    const { call, row } = await mintCase(opts);
    const { q, prover } = setup({ receipts: {} });
    q.putEvidence("mint", 2, call.evidence);
    assert.match((await prover.mint(row)).why, why);
  }
});

test("one signed, paid mint cannot be written twice under two ids", async () => {
  const { call, row } = await mintCase();
  const { q, prover } = setup({ receipts: { [txHash(1)]: settlement({ payNonce: nonce(1) }) } });
  q.putEvidence("mint", 2, call.evidence);
  q.putEvidence("mint", 3, call.evidence);
  assert.equal((await prover.mint(row)).ok, true);
  assert.equal((await prover.mint(row)).ok, true, "re-proving the same row is idempotent");
  const second = await prover.mint({ ...row, tokenId: 3, qr: QR[3] });
  assert.equal(second.ok, false);
  assert.match(second.why, /already backs another row/);
});

test("token 1 is written only for the house key", async () => {
  const { call, row } = await mintCase({ tokenId: 1 });
  for (const [houseKeyId, ok] of [[null, false], ["someone-else", false], [call.keyId, true]]) {
    const { q, prover } = setup({ receipts: { [txHash(1)]: settlement({ payNonce: nonce(1) }) }, houseKeyId });
    q.putEvidence("mint", 1, call.evidence);
    assert.equal((await prover.mint(row)).ok, ok, `house key ${houseKeyId}`);
  }
});

// --- seeds

test("a seed is proven against its parent and recipient as signed", async () => {
  const call = await signedCall(AGENT, "seed", { parentId: 5, to: OWNER });
  const row = { tokenId: 9, parentId: 5, toAddress: OWNER, agentKeyId: call.keyId, qr: QR[9], day: DAY };
  const { q, prover } = setup({ bound: { 5: call.keyId } });
  q.putEvidence("seed", 9, call.evidence);
  assert.equal((await prover.seed(row)).ok, true);
  assert.match((await prover.seed({ ...row, toAddress: STRANGER_ADDRESS })).why, /different recipient/);
  assert.match((await prover.seed({ ...row, parentId: 6 })).why, /different parent/);
});

// --- Marks

test("a bought Mark is proven against its own price, and refused at another", async () => {
  const vessel = await signedCall(AGENT, "upgrade", { tokenId: 7, upgradeId: 7 }, { meta: payment(nonce(2), "1250000000") });
  const cheap = await signedCall(AGENT, "upgrade", { tokenId: 7, upgradeId: 7 }, { meta: payment(nonce(3), "1000000") });
  const row = (n) => ({ tokenId: 7, upgradeId: 7, variant: 0, payNonce: nonce(n), paymentTx: txHash(n) });
  const { q, prover } = setup({
    bound: { 7: vessel.keyId },
    receipts: {
      [txHash(2)]: settlement({ payNonce: nonce(2), value: priceUnits("$1250.00") }),
      [txHash(3)]: settlement({ payNonce: nonce(3), value: 1_000_000n }),
    },
  });
  q.putEvidence("mark", "7:7", cheap.evidence);
  assert.match((await prover.mark(row(3))).why, /not 1250000000 units/);
  q.putEvidence("mark", "7:7", vessel.evidence);
  assert.deepEqual(await prover.mark(row(2)), { ok: true });
});

test("an earned Mark needs no payment but must be signed by the token's key", async () => {
  const agent = await signedCall(AGENT, "upgrade", { tokenId: 7, upgradeId: 2 });
  const stranger = await signedCall(STRANGER, "upgrade", { tokenId: 7, upgradeId: 2 });
  const row = { tokenId: 7, upgradeId: 2, variant: 0, payNonce: null, paymentTx: null };
  const { q, prover } = setup({ bound: { 7: agent.keyId } });
  q.putEvidence("mark", "7:2", stranger.evidence);
  assert.equal((await prover.mark(row)).ok, false);
  q.putEvidence("mark", "7:2", agent.evidence);
  assert.equal((await prover.mark(row)).ok, true);
  assert.match((await prover.mark({ ...row, variant: 1 })).why, /different Mark/);
});

// --- the ledger

test("the ledger lets a row re-claim its own proofs and refuses them to any other row", () => {
  const ledger = openLedger(":memory:");
  const proofs = { requestHash: "h1", payment: { txHash: "0xAB", logIndex: 4 }, mintKey: "k1" };
  assert.deepEqual(ledger.claim("mint", 2, proofs), { ok: true });
  assert.deepEqual(ledger.claim("mint", 2, proofs), { ok: true });
  assert.match(ledger.claim("mint", 3, { ...proofs, requestHash: "h2", mintKey: "k2" }).why, /payment already paid/);
  assert.match(ledger.claim("mint", 3, { requestHash: "h2", mintKey: "k1" }).why, /already minted/);
  assert.match(ledger.claim("credit", "3:1", { requestHash: "h1" }).why, /already backs another row/);
  assert.deepEqual(ledger.claim("credit", "3:1", { requestHash: "h3" }), { ok: true });
});

test("a mint or seed recorded on a day other than the one it was signed is refused", async () => {
  const { call, row } = await mintCase();
  const seed = await signedCall(AGENT, "seed", { parentId: 5, to: OWNER });
  const { q, prover } = setup({ bound: { 5: seed.keyId }, receipts: { [txHash(1)]: settlement({ payNonce: nonce(1) }) } });
  q.putEvidence("mint", 2, call.evidence);
  q.putEvidence("seed", 9, seed.evidence);
  assert.match((await prover.mint({ ...row, day: DAY - 3 })).why, /not the day it was signed/);
  assert.match((await prover.seed({ tokenId: 9, parentId: 5, toAddress: OWNER, agentKeyId: seed.keyId, qr: QR[9], day: DAY + 2 })).why, /not the day it was signed/);
});

test("a mint whose artwork points anywhere but its own token is refused", async () => {
  const { call, row } = await mintCase();
  const { q, prover } = setup({ receipts: { [txHash(1)]: settlement({ payNonce: nonce(1) }) } });
  q.putEvidence("mint", 2, call.evidence);
  assert.match((await prover.mint({ ...row, qr: QR[3] })).why, /points at https:\/\/example\.com\/t\/3, not https:\/\/example\.com\/t\/2/);
  assert.match((await prover.mint({ ...row, qr: "00".repeat(407) })).why, /does not decode/);
  assert.match((await prover.mint({ ...row, qr: null })).why, /does not decode/);
});

test("a real solved artwork is read as the token it names", async () => {
  const { call, row } = await mintCase({ tokenId: 7 });
  const { q, prover } = setup({ receipts: { [txHash(1)]: settlement({ payNonce: nonce(1) }) } });
  q.putEvidence("mint", 7, call.evidence);
  assert.deepEqual(await prover.mint({ ...row, qr: QART_7 }), { ok: true });
});

test("a row's evidence is dropped once the row is written, and kept until then", () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 7, keyId: "k", owner: OWNER, lastDay: DAY - 1, mintDay: DAY - 1 });
  q.insertCredit(7, DAY, "h");
  q.putEvidence("credit", `7:${DAY}`, { base: "b" });
  q.putEvidence("credit", `7:${DAY + 1}`, { base: "c" });
  q.markCreditWritten(7, DAY);
  assert.equal(q.evidenceFor("credit", `7:${DAY}`), null);
  assert.deepEqual(q.evidenceFor("credit", `7:${DAY + 1}`), { base: "c" });
});

test("a seed signed by a key the chain does not bind to the parent is refused", async () => {
  const stranger = await signedCall(STRANGER, "seed", { parentId: 5, to: OWNER });
  const agent = await signedCall(AGENT, "seed", { parentId: 5, to: OWNER });
  const { q, prover } = setup({ bound: { 5: agent.keyId } });
  q.putEvidence("seed", 9, stranger.evidence);
  const r = await prover.seed({ tokenId: 9, parentId: 5, toAddress: OWNER, agentKeyId: stranger.keyId, qr: QR[9], day: DAY });
  assert.match(r.why, /not signed by the key the chain binds/);
});
