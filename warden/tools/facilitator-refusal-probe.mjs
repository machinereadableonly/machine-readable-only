// How does a facilitator say "no" to a settlement?
//
//   MRO_PROBE_KEY_FILE=<wallet key file> node tools/facilitator-refusal-probe.mjs [facilitator url]
//
// For CDP, pinned to IPv4 as the Warden runs, with the key from .env:
//   MRO_PROBE_KEY_FILE=<wallet key file> node --dns-result-order=ipv4first \
//     --no-network-family-autoselection --env-file=.env \
//     tools/facilitator-refusal-probe.mjs https://api.cdp.coinbase.com/platform/v2/x402
//
// Base Sepolia only. Each case is refused before any transfer can happen, so
// nothing moves. It prints what the Warden's own resource server saw: a
// returned settlement, or a thrown error with its status and reason.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { initResourceServer, MINT_PRICE } from "../src/pay/x402.mjs";
import { isCdpFacilitator, makeCdpAuthHeaders } from "../src/pay/cdp.mjs";
import { signAuthorization, paymentMeta, PAYMENT_META_KEY } from "../../client/src/pay.mjs";

const NETWORK = "eip155:84532";
const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const RESOURCE = { url: "mcp://tool/refusal-probe" };

async function payloadFor(requirement, walletPrivateKey, now) {
  const payload = await signAuthorization({ accepted: requirement, walletPrivateKey, now });
  return paymentMeta({ demand: { x402Version: 2, resource: RESOURCE }, accepted: requirement, payload })[PAYMENT_META_KEY];
}

export async function refusalCases({ requirement, walletPrivateKey, now = Math.floor(Date.now() / 1000) }) {
  // A day in the past: validBefore = now - 86400 + window, well before now.
  const expired = await payloadFor(requirement, walletPrivateKey, now - 86_400);

  const bigAsk = { ...requirement, amount: "1000000000000" };
  const overdrawn = await payloadFor(bigAsk, walletPrivateKey, now);

  const tampered = await payloadFor(requirement, walletPrivateKey, now);
  const sig = tampered.payload.signature;
  const flipped = (parseInt(sig.slice(-4, -2), 16) ^ 0xff).toString(16).padStart(2, "0");
  tampered.payload.signature = `${sig.slice(0, -4)}${flipped}${sig.slice(-2)}`;

  return [
    { name: "expired", requirement, payload: expired },
    { name: "overdrawn", requirement: bigAsk, payload: overdrawn },
    { name: "bad-signature", requirement, payload: tampered },
  ];
}

function describe(outcome) {
  if (outcome.threw) {
    const e = outcome.error;
    return { threw: true, name: e?.name ?? null, statusCode: e?.statusCode ?? null,
      errorReason: e?.errorReason ?? null, transaction: e?.transaction || null, message: e?.message ?? null };
  }
  const s = outcome.settlement;
  return { threw: false, success: s?.success ?? null, errorReason: s?.errorReason ?? null,
    transaction: s?.transaction || null };
}

async function main() {
  const facilitatorUrl = process.argv[2] ?? "https://x402.org/facilitator";
  const keyFile = process.env.MRO_PROBE_KEY_FILE;
  if (!keyFile) {
    console.error("set MRO_PROBE_KEY_FILE to a Base Sepolia wallet key file");
    process.exit(2);
  }
  const walletPrivateKey = readFileSync(keyFile, "utf8").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(walletPrivateKey)) {
    console.error(`${keyFile} does not hold a 32-byte hex private key`);
    process.exit(2);
  }

  let createAuthHeaders;
  if (isCdpFacilitator(facilitatorUrl)) {
    const keyId = process.env.CDP_API_KEY_ID;
    const secret = process.env.CDP_API_KEY_SECRET;
    if (!keyId || !secret) {
      console.error("CDP needs CDP_API_KEY_ID and CDP_API_KEY_SECRET (use --env-file=.env)");
      process.exit(2);
    }
    createAuthHeaders = makeCdpAuthHeaders({ keyId, secret, facilitatorUrl });
  }

  // Throws if the facilitator does not offer exact on Base Sepolia. That is a
  // result, not a crash: stop and report it rather than trying another chain.
  const server = await initResourceServer(facilitatorUrl, NETWORK, createAuthHeaders);
  const [requirement] = await server.buildPaymentRequirements({ scheme: "exact", payTo: PAY_TO, price: MINT_PRICE, network: NETWORK });

  console.log(`facilitator : ${facilitatorUrl}`);
  console.log(`payer       : ${privateKeyToAccount(walletPrivateKey).address}`);
  for (const c of await refusalCases({ requirement, walletPrivateKey })) {
    let outcome;
    try {
      outcome = { threw: false, settlement: await server.settlePayment(c.payload, c.requirement) };
    } catch (error) {
      outcome = { threw: true, error };
    }
    console.log(`${c.name.padEnd(13)} ${JSON.stringify(describe(outcome))}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
