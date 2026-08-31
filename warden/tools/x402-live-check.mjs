// Checks the payment gateway against the REAL facilitator.
//
// Deliberately NOT part of `npm test`. The unit suite must stay offline and
// fast: a test that fails when a third party is down is a test everyone learns
// to ignore. This is the other half -- the part that can only be answered by
// asking the live service.
//
//   node tools/x402-live-check.mjs [facilitatorUrl] [chainId] [payTo]
//
// Defaults are the testnet ones. Exits non-zero on any failed assertion.
import assert from "node:assert/strict";
import { makePaymentGateway, MINT_PRICE } from "../src/pay/x402.mjs";

const [, , urlArg, chainArg, payToArg] = process.argv;
const facilitatorUrl = urlArg ?? "https://x402.org/facilitator";
const chainId = Number(chainArg ?? 84_532);
const payTo = payToArg ?? "0x000000000000000000000000000000000000dEaD";
const network = `eip155:${chainId}`;

// Circle's own published addresses (developers.circle.com, checked 2026-08-31).
// The scheme resolves "$0.10" to an asset on its own; this is what says the
// asset it picked is the real USDC and not something that merely looks like it.
const USDC = {
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

console.log(`facilitator: ${facilitatorUrl}\nnetwork:     ${network}\npayTo:       ${payTo}\n`);

const paid = makePaymentGateway({ facilitatorUrl, network, payTo });

// paid.prepare builds the requirements without running a tool call.
const started = Date.now();
const wrap = await paid.prepare(MINT_PRICE);
console.log(`initialize + buildPaymentRequirements: ${Date.now() - started} ms`);
assert.equal(typeof wrap, "function", "createPaymentWrapper must return a wrapper");

// Read the requirements back the same way the gateway did, to print and check them.
const { x402ResourceServer, HTTPFacilitatorClient } = await import("@x402/core/server");
const { registerExactEvmScheme } = await import("@x402/evm/exact/server");
const server = registerExactEvmScheme(
  new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })),
  { networks: [network] }
);
await server.initialize();
const accepts = await server.buildPaymentRequirements({
  scheme: "exact",
  payTo,
  price: MINT_PRICE,
  network,
});
console.log("\naccepts:", JSON.stringify(accepts, null, 1));

const row = accepts[0];
assert.equal(accepts.length, 1);
assert.equal(row.scheme, "exact");
assert.equal(row.network, network);
assert.equal(row.payTo, payTo, "the treasury must be exactly what was configured");
// $0.10 of a 6-decimal token. Getting this wrong by a factor of ten is the
// single most expensive silent error this file can catch.
assert.equal(row.amount, "100000", "$0.10 must be 100000 units of a 6-decimal USDC");
if (USDC[chainId]) {
  assert.equal(row.asset.toLowerCase(), USDC[chainId].toLowerCase(), "asset must be Circle's USDC");
}

console.log(`\nOK: ${MINT_PRICE} = ${row.amount} units of ${row.asset} to ${row.payTo} on ${row.network}`);
