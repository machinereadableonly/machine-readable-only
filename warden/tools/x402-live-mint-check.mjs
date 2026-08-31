// The live half of the mint journey: a real agent, through the real door, to
// the real facilitator's requirements.
//
// NOT part of `npm test` -- it makes network calls. It proves everything about
// paying for a mint that does not require money to have moved:
//
//   1. a fresh key registers and is admitted through the door
//   2. `mint` with NO payment is refused with a payment-required error
//   3. that refusal carries the requirements this Warden built from the LIVE
//      facilitator: the right price, the right USDC, the right treasury, the
//      right chain
//
// What it deliberately cannot show is settlement. That needs a funded wallet
// signing an EIP-3009 authorization, which needs testnet USDC from a
// captcha-gated faucet. Everything up to the moment money moves is here.
//
//   node tools/x402-live-mint-check.mjs
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { createServer } from "../src/server.mjs";
import { makeMcpHandler } from "../src/mcp/server.mjs";
import { tokenView } from "../src/mcp/tokenView.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { utcDay } from "../src/mcp/tools/checkin.mjs";
import { makePaymentGateway, MINT_PRICE } from "../src/pay/x402.mjs";
import { makeChainReader } from "../src/chain/read.mjs";

const DOMAIN = "example.com";
const SECRET = "live-check-secret";
const FACILITATOR = process.argv[2] ?? "https://x402.org/facilitator";
const CHAIN_ID = Number(process.argv[3] ?? 84_532);
const TREASURY = process.argv[4] ?? "0x000000000000000000000000000000000000dEaD";
const NETWORK = `eip155:${CHAIN_ID}`;
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CLIENT_COMPONENTS = ["@authority", "@method", "@path", "signature-agent"];
const CONTRACT = "0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D";
const RPC = process.env.BASE_RPC_URL ?? "https://sepolia.base.org";

const dir = mkdtempSync(join(tmpdir(), "mro-live-"));
const db = openDb(join(dir, "mirror.db"));
const q = queries(db);

// THE REAL GATEWAY. This is the only difference from test/e2e/join.test.mjs,
// which mocks `paid` at this exact seam.
const paid = makePaymentGateway({ facilitatorUrl: FACILITATOR, network: NETWORK, payTo: TREASURY });

// THE REAL CHAIN READER, against the deployed contract. mint now checks the
// contract's own gates -- sunset, pause, wallet cap -- before it will ask for
// money, so this journey only reaches a payment demand if those really pass.
const chain = makeChainReader({ rpcUrl: RPC, contract: CONTRACT });
console.log("0. chain gates:", JSON.stringify({
  writesOpen: await chain.writesOpen(),
  walletRoom: await chain.walletRoomFor("0x" + "a1".repeat(20)),
}), "(writesOpen null means open)");

const mcp = makeMcpHandler({
  q,
  chain,
  today: utcDay,
  contract: CONTRACT,
  chainId: CHAIN_ID,
  challengeSecret: SECRET,
  domain: DOMAIN,
  llmsTxt: "",
  paid,
  catalogue: {},
  supplyCap: 10_000,
});

const server = createServer({
  stateDbPath: join(dir, "mirror.db"),
  domain: DOMAIN,
  challengeSecret: SECRET,
  tokenView,
  mcp,
  allowRegistration: () => true,
});
const base = await new Promise((resolve) =>
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`))
);

async function registerKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const { nonce } = await (await fetch(`${base}/keys/nonce`)).json();
  const proof = edSign(null, Buffer.from(nonce), privateKey).toString("base64url");
  const res = await fetch(`${base}/keys`, {
    method: "POST",
    body: JSON.stringify({ jwk: publicKey.export({ format: "jwk" }), nonce, proof }),
  });
  assert.equal(res.status, 201);
  return privateKey.export({ format: "jwk" });
}

async function callMcp(privateJwk, payload) {
  const { challenge } = await (await fetch(`${base}/mcp`, { method: "POST" })).json();
  const signer = await signerFromJWK(privateJwk);
  const message = {
    method: "POST",
    url: `https://${DOMAIN}/mcp`,
    headers: { "signature-agent": `"https://${DOMAIN}"`, host: DOMAIN },
  };
  const created = new Date();
  const signed = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + 60_000),
    components: CLIENT_COMPONENTS,
  });
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      ...message.headers,
      ...signed,
      challenge,
      "challenge-response": createHash("sha256").update(challenge + signer.keyid).digest("hex"),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...payload }),
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return { status: res.status, body: JSON.parse((line ?? text).replace(/^data:\s*/, "")) };
}

try {
  const key = await registerKey();
  console.log("1. key registered and admitted through the door");

  const listed = await callMcp(key, { method: "tools/list", params: {} });
  const names = listed.body.result.tools.map((t) => t.name).sort();
  assert.ok(names.includes("mint"), "mint must be on the live tool surface");
  console.log(`2. tools/list: ${names.join(", ")}`);

  const minted = await callMcp(key, {
    method: "tools/call",
    params: { name: "mint", arguments: { to: "0x" + "a1".repeat(20) } },
  });
  const payload = JSON.stringify(minted.body);
  console.log("3. mint with no payment ->", payload.slice(0, 400));

  // The refusal must be a PAYMENT demand, not our fail-closed refusal. If the
  // gateway had not built, this would say payment-unavailable instead.
  assert.ok(
    !payload.includes("payment-unavailable") && !payload.includes("payment-not-configured"),
    "the gateway did not build: mint refused instead of demanding payment"
  );

  // The requirements the agent is handed, dug out of wherever the error carries
  // them, and checked field by field. This is the number that costs money.
  const accepts = JSON.parse(payload.match(/\{"scheme":"exact".*?\}\}/)?.[0] ?? "null")
    ?? minted.body.error?.data?.accepts?.[0]
    ?? minted.body.error?.data?.paymentRequired?.accepts?.[0];
  assert.ok(accepts, `no payment requirements found in the refusal: ${payload}`);
  console.log("4. requirements handed to the agent:", JSON.stringify(accepts, null, 1));

  assert.equal(accepts.scheme, "exact");
  assert.equal(accepts.network, NETWORK);
  assert.equal(accepts.payTo, TREASURY);
  assert.equal(accepts.amount, "100000", `${MINT_PRICE} must be 100000 units of 6-decimal USDC`);
  if (CHAIN_ID === 84_532) assert.equal(accepts.asset.toLowerCase(), USDC_BASE_SEPOLIA.toLowerCase());

  // Nothing was written: an unpaid mint must not leave a token behind.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
  console.log("5. no token and no mint row was written for an unpaid call");

  console.log("\nOK: a real agent is told to pay exactly", accepts.amount, "of", accepts.asset, "to", accepts.payTo, "on", accepts.network);
} finally {
  await new Promise((done) => server.close(done));
  db.close();
  rmSync(dir, { recursive: true, force: true });
}
