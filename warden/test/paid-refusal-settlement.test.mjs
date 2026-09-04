// WHAT HAPPENS TO THE MONEY WHEN A PAID TOOL REFUSES AFTER THE GATE.
//
// Every other test of `paid-but-unavailable` drives a `paid` stub, so it can
// prove the tool RETURNS the refusal and can prove nothing at all about
// whether the agent was charged for it. That question belongs to @x402/mcp,
// and it is decided by one field.
//
// The flow matters. @x402/evm's `exact` scheme defaults to the `authorization`
// payment flow (paymentFlows.eip3009.default), and @x402/core's PAYMENT_FLOWS
// table gives that flow `settleBeforeHandler: false, settleAfterHandler: true`
// -- the payment is VERIFIED before the handler runs and SETTLED after it
// returns. So at the moment one of our post-gate refusals is produced, nothing
// has moved yet, and @x402/mcp decides what to do next by reading
// `result.isError`:
//
//     if (result.isError) { ...cancel... }
//     return settlePaymentResult(...)      // otherwise: take the money
//
// These tests drive the REAL createPaymentWrapper, the REAL x402ResourceServer
// and the REAL registered `exact` EVM scheme against a fake facilitator that
// records whether /settle was ever called. Only the facilitator is fake,
// because it is the one thing that would otherwise move USDC.
//
// Confirmed with real money on Base Sepolia, 2026-09-03: the same refusal
// settled 1 USDC before cancelSettlementOnRefusal existed (tx 0x019854ce...)
// and 0 USDC after it, with the successful-mint control still settling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaymentWrapper } from "@x402/mcp";
import { generatePrivateKey } from "viem/accounts";
import { makePaymentGateway } from "../src/pay/x402.mjs";
import { payFor } from "../../client/src/pay.mjs";

const NETWORK = "eip155:84532";
const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const PRICE = "$1.00";

/// A refusal in the shape both paid tools return from inside `paid()`: a plain
/// value, exactly like every other refusal this service produces.
const REFUSAL = { ok: false, reason: "paid-but-unavailable", detail: "already-minted" };

/**
 * A facilitator that answers correctly and records what it was asked to do.
 *
 * It never touches a chain: /settle returns a plausible receipt without
 * submitting anything. What is being measured is WHETHER it is called.
 */
async function fakeFacilitator() {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url);
    const send = (body) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/supported") {
      return send({ kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }] });
    }
    // Both POST bodies are drained; neither is inspected, because the scheme
    // built them and this test is not re-testing x402's own encoding.
    req.on("data", () => {});
    req.on("end", () => {
      if (req.url === "/verify") return send({ isValid: true, payer: PAY_TO });
      if (req.url === "/settle") {
        return send({ success: true, transaction: "0x" + "11".repeat(32), network: NETWORK, payer: PAY_TO });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    settled: () => calls.filter((u) => u === "/settle").length,
    verified: () => calls.filter((u) => u === "/verify").length,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/// The real resource server, pointed at the fake facilitator.
async function resourceServerAt(facilitatorUrl) {
  const server = registerExactEvmScheme(
    new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })),
    { networks: [NETWORK] }
  );
  await server.initialize();
  return server;
}

/**
 * The production gateway, pointed at the fake facilitator.
 *
 * `build` is injected for ONE reason: makePaymentGateway's own
 * initResourceServer refuses a non-https facilitator, which is correct in
 * production and makes a loopback fake unusable. Everything it builds --
 * the resource server, the scheme registration, createPaymentWrapper, and
 * cancelSettlementOnRefusal -- is the production article.
 */
function gatewayAgainst(facilitatorUrl) {
  return makePaymentGateway({
    facilitatorUrl,
    network: NETWORK,
    payTo: PAY_TO,
    alert: () => {},
    build: () => resourceServerAt(facilitatorUrl),
  });
}

/**
 * Pay for one call and report what the facilitator was asked to do.
 *
 * `wrapWith` receives the fake's url and returns the wrapped handler to drive,
 * so a test can go through our gateway or straight at @x402/mcp's wrapper.
 */
async function callAndPay(wrapWith) {
  const fac = await fakeFacilitator();
  try {
    const wrapped = await wrapWith(fac.url);

    // First call: no payment, so this is the demand.
    const demand = await wrapped({}, { mcpCtx: { mcpReq: { _meta: undefined } } });
    const meta = await payFor({
      result: demand,
      expected: { payTo: PAY_TO },
      // A throwaway key holding nothing: this facilitator never submits what
      // it signs.
      walletPrivateKey: generatePrivateKey(),
    });
    assert.ok(meta, "the first call must produce a payment demand the client can read");

    // Second call: the same call again, now carrying the authorisation.
    const result = await wrapped({}, { mcpCtx: { mcpReq: { _meta: meta } } });
    return { result, settled: fac.settled(), verified: fac.verified() };
  } finally {
    await fac.close();
  }
}

const throughGateway = (handler) => async (url) =>
  gatewayAgainst(url)(handler, PRICE, { tool: "mint", description: "test" });

test("CONTROL: a paid tool that succeeds settles the payment", async () => {
  const { result, settled, verified } = await callAndPay(throughGateway(async () => ({ ok: true, tokenId: 3 })));
  assert.equal(verified, 1);
  assert.equal(settled, 1, "a successful paid call must take the money");
  // The wrapper hands a plain handler value straight back and attaches the
  // receipt to `_meta`; it is warden/src/mcp/server.mjs that turns it into a
  // tool result afterwards. So this asserts on the value, not on MCP shape.
  assert.equal(result.ok, true);
  assert.equal(result._meta["x402/payment-response"].success, true);
});

// THE GUARD. Reverting cancelSettlementOnRefusal turns this red: the refusal
// is delivered either way, and only the settlement count says which build the
// agent is talking to.
test("a post-gate refusal is NOT settled: the agent keeps its money", async () => {
  const { result, settled, verified } = await callAndPay(throughGateway(async () => REFUSAL));
  assert.equal(verified, 1, "the payment is still verified -- the agent proved it could pay");
  assert.equal(settled, 0, "nothing was submitted, so nothing was taken");
  // The refusal survives the conversion intact, and reaches the agent as a
  // complete MCP tool result rather than a plain value.
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, REFUSAL);
  assert.deepEqual(JSON.parse(result.content[0].text), REFUSAL);
});

// WHY THE CONVERSION EXISTS AT ALL, pinned against the library rather than
// against our own code. Hand @x402/mcp the same refusal as a plain value --
// which is what both tools return, and what reached it before 2026-09-03 --
// and it settles. If a future @x402/mcp stops doing this, this test goes red
// and the conversion can be reconsidered rather than carried forever.
test("the same refusal WITHOUT isError is settled by @x402/mcp: this is what is being prevented", async () => {
  const { settled } = await callAndPay(async (url) => {
    const server = await resourceServerAt(url);
    const accepts = await server.buildPaymentRequirements({ scheme: "exact", payTo: PAY_TO, price: PRICE, network: NETWORK });
    const wrap = createPaymentWrapper(server, { accepts, resource: { url: "mcp://tool/mint" } });
    // No adaptContext here: this drives @x402/mcp directly, so the context is
    // the v1 shape its wrapper reads.
    const raw = wrap(async () => REFUSAL);
    return (args, ctx) => raw(args, { _meta: ctx.mcpCtx.mcpReq._meta });
  });
  assert.equal(settled, 1, "a plain { ok: false } carries no isError, so x402 takes the money");
});
