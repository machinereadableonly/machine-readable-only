// The raw protocol, captured off the wire.
//
// docs/2026-09-01-mro-raw-protocol.md is transcribed from this script's output
// rather than written from reading the source, so the documentation can be
// re-verified rather than trusted. Run it and diff the doc against what it
// prints:
//
//   node tools/protocol-transcript.mjs
//
// NOT part of `npm test`: it reaches the live x402 facilitator and a public
// Base Sepolia RPC. It moves no money -- the mint call it makes is deliberately
// UNPAID, and what it captures is the refusal.
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { contentDigest } from "../src/door/verify.mjs";
import { createServer } from "../src/server.mjs";
import { makeMcpHandler } from "../src/mcp/server.mjs";
import { tokenView } from "../src/mcp/tokenView.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { utcDay } from "../src/mcp/tools/checkin.mjs";
import { makePaymentGateway } from "../src/pay/x402.mjs";
import { makeChainReader } from "../src/chain/read.mjs";
import { LADDER, assertLadderSane } from "../src/mcp/ladder.mjs";

const DOMAIN = "example.com";
const SECRET = "transcript-secret";
const FACILITATOR = "https://x402.org/facilitator";
const CHAIN_ID = 84_532;
const NETWORK = `eip155:${CHAIN_ID}`;
const TREASURY = "0x000000000000000000000000000000000000dEaD";
const CONTRACT = "0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D";
const RPC = process.env.BASE_RPC_URL ?? "https://sepolia.base.org";
const COMPONENTS = ["@authority", "@method", "@path", "signature-agent", "content-digest"];

const dir = mkdtempSync(join(tmpdir(), "mro-transcript-"));
const db = openDb(join(dir, "mirror.db"));
const q = queries(db);
const paid = makePaymentGateway({ facilitatorUrl: FACILITATOR, network: NETWORK, payTo: TREASURY });
const chain = makeChainReader({ rpcUrl: RPC, contract: CONTRACT });
const mcp = makeMcpHandler({
  q, chain, today: utcDay, contract: CONTRACT, chainId: CHAIN_ID,
  challengeSecret: SECRET, domain: DOMAIN, llmsTxt: "", paid,
  // THE REAL CATALOGUE, exactly as main.mjs boots it. This read `{}` until
  // 2026-09-02, which predated the catalogue being wired at all -- and an empty
  // catalogue does not make the capture silent, it makes it LIE: every `upgrade`
  // call refuses `mark-inactive` and `ladder` reports a piece with no Marks in
  // it. The whole worth of this script is that the document it feeds describes
  // what a caller actually meets, so a stub here is worse than no capture.
  // assertLadderSane throws at boot rather than letting a malformed entry be
  // transcribed as though an agent would meet it.
  catalogue: assertLadderSane(LADDER), supplyCap: 10_000,
});
const server = createServer({
  stateDbPath: join(dir, "mirror.db"), domain: DOMAIN, challengeSecret: SECRET,
  tokenView, mcp, allowRegistration: () => true,
});
const base = await new Promise((r) =>
  server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));

const show = (title, obj) => console.log(`\n### ${title}\n` + (typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)));

// --- 1. the unsigned request, and the 401 it earns -------------------------
const cold = await fetch(`${base}/mcp`, { method: "POST" });
show("1. POST /mcp with no signature -> " + cold.status, await cold.json());

// --- 2. the nonce, and registering a key ----------------------------------
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const nonceRes = await fetch(`${base}/keys/nonce`);
const nonceBody = await nonceRes.json();
show("2. GET /keys/nonce -> " + nonceRes.status, nonceBody);

const jwk = publicKey.export({ format: "jwk" });
const proof = edSign(null, Buffer.from(nonceBody.nonce), privateKey).toString("base64url");
const regBody = { jwk, nonce: nonceBody.nonce, proof };
show("3. POST /keys request body", regBody);
const reg = await fetch(`${base}/keys`, { method: "POST", body: JSON.stringify(regBody) });
const regResult = await reg.json();
show("3. POST /keys -> " + reg.status, regResult);

// --- 3. the served directory ----------------------------------------------
const dirRes = await fetch(`${base}/.well-known/http-message-signatures-directory`);
show("4. GET /.well-known/http-message-signatures-directory -> " + dirRes.status
  + " (" + dirRes.headers.get("content-type") + ")", await dirRes.text());

// --- 4. a signed, challenge-answering request ------------------------------
const { challenge } = await (await fetch(`${base}/mcp`, { method: "POST" })).json();
const signer = await signerFromJWK(privateKey.export({ format: "jwk" }));
const messageFor = (body) => ({ method: "POST", url: `https://${DOMAIN}/mcp`,
  headers: { "signature-agent": `"https://${DOMAIN}"`, host: DOMAIN,
    "content-digest": contentDigest(body) } });
const message = messageFor("");
const created = new Date();
const signed = await signatureHeaders(message, signer, {
  created, expires: new Date(created.getTime() + 60_000), components: COMPONENTS });
const answer = createHash("sha256").update(challenge + signer.keyid).digest("hex");
show("5. the headers a signed request carries", {
  ...message.headers, ...signed, challenge, "challenge-response": answer });
console.log("\n(key id / RFC 7638 thumbprint: " + signer.keyid + ")");

async function call(payload) {
  const { challenge: c } = await (await fetch(`${base}/mcp`, { method: "POST" })).json();
  const cr = new Date();
  // Serialised ONCE. The bytes signed must be the bytes sent, or the door
  // refuses with reason "digest".
  const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, ...payload });
  const msg = messageFor(raw);
  const s = await signatureHeaders(msg, signer, {
    created: cr, expires: new Date(cr.getTime() + 60_000), components: COMPONENTS });
  const res = await fetch(`${base}/mcp`, { method: "POST",
    headers: { ...msg.headers, ...s, challenge: c,
      "challenge-response": createHash("sha256").update(c + signer.keyid).digest("hex"),
      "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: raw });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  return { status: res.status, body: JSON.parse((line ?? text).replace(/^data:\s*/, "")) };
}

const listed = await call({ method: "tools/list", params: {} });
show("6. tools/list -> " + listed.status, listed.body.result.tools.map((t) =>
  ({ name: t.name, inputSchema: t.inputSchema })));

const minted = await call({ method: "tools/call",
  params: { name: "mint", arguments: { to: "0x" + "a1".repeat(20) } } });
show("7. tools/call mint, unpaid -> " + minted.status, minted.body);

await new Promise((done) => server.close(done));
