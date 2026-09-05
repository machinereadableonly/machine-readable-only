// WHAT THE MIRROR MAY BELIEVE BEFORE THE MONEY HAS ACTUALLY MOVED.
//
// paid-refusal-settlement.test.mjs covers the direction we fixed on 2026-09-04:
// a post-gate REFUSAL must not be settled. This file covers the other
// direction, which was never covered at all -- a handler that SUCCEEDS commits
// its rows before settlement is even attempted, and nothing ever reads whether
// settlement worked.
//
// The `authorization` flow settles AFTER the handler returns (@x402/core's
// PAYMENT_FLOWS: settleBeforeHandler false, settleAfterHandler true). So
// reading @x402/mcp in order:
//
//     result = await handler(args, context);   <- our rows were written HERE
//     if (result.isError) { ...cancel... }
//     return settlePaymentResult(...)          <- the money moves HERE
//     ...
//     if (!settleResult.success) { createSettlementFailedResult(...) }
//
// createSettlementFailedResult returns an error to the agent. It cannot undo
// what the handler did. So a settle that fails -- a facilitator error, an
// expired authorisation, or an attacker calling EIP-3009
// cancelAuthorization(nonce) during the handler's dozen RPC round trips --
// leaves a fully queued row that the Clock writes on chain that night. A free
// token, repeatably.
//
// These tests drive the REAL mint tool, the REAL gateway, the REAL
// createPaymentWrapper and the REAL exact EVM scheme against a fake
// facilitator. Only the facilitator is fake, because it is the one thing that
// would otherwise move USDC -- and here it is the thing that must be able to
// FAIL on demand, which is exactly what cannot be arranged with real money.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { generatePrivateKey } from "viem/accounts";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { LADDER, assertLadderSane } from "../src/mcp/ladder.mjs";
import { makePaymentGateway } from "../src/pay/x402.mjs";
import { openChain } from "./chain-stub.mjs";
import { payFor } from "../../client/src/pay.mjs";

const NETWORK = "eip155:84532";
const PAY_TO = "0x000000000000000000000000000000000000dEaD";
const TO = "0x1111111111111111111111111111111111111111";
const KEY_ID = "k-settle";
const SETTLE_TX = "0x" + "ab".repeat(32);

/**
 * A facilitator whose /settle outcome the test chooses.
 *
 * `settle: "declined"` is a facilitator saying plainly that the payment did not
 * go through -- what a cancelled or expired EIP-3009 authorisation produces.
 * `settle: "malformed"` is a facilitator answering with something @x402/core
 * cannot parse, which reaches @x402/mcp as a THROWN error rather than a
 * `success: false`. They are different code paths inside the library and the
 * piece must survive both identically, which is why both are driven.
 */
async function fakeFacilitator({ settle = "ok" } = {}) {
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
    req.on("data", () => {});
    req.on("end", () => {
      if (req.url === "/verify") return send({ isValid: true, payer: PAY_TO });
      if (req.url === "/settle") {
        // `transaction` is REQUIRED by @x402/core's settleResponseSchema even
        // on a failure -- omitting it makes the client throw a
        // FacilitatorResponseError instead of reporting a clean decline, which
        // is a DIFFERENT code path. Both are exercised below, on purpose, and
        // they must produce the same outcome for the agent.
        if (settle === "declined") {
          return send({
            success: false,
            errorReason: "invalid_exact_evm_payload_authorization_valid_before",
            transaction: "",
            network: NETWORK,
            payer: PAY_TO,
          });
        }
        // A facilitator that answers with something unparseable: the client
        // throws rather than returning success:false.
        if (settle === "malformed") return send({ nonsense: true });
        return send({ success: true, transaction: SETTLE_TX, network: NETWORK, payer: PAY_TO });
      }
      res.writeHead(404).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    settled: () => calls.filter((u) => u === "/settle").length,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/// The production gateway against the fake. `build` is injected only because
/// initResourceServer refuses a non-https facilitator, which is correct in
/// production and makes a loopback fake unusable.
function gatewayAgainst(facilitatorUrl, q) {
  return makePaymentGateway({
    facilitatorUrl,
    network: NETWORK,
    payTo: PAY_TO,
    onSettled: (nonce, tx) => q.settleByNonce(nonce, tx),
    onUnsettled: (nonce) => q.releaseReservation(nonce),
    alert: () => {},
    build: async () => {
      const server = registerExactEvmScheme(
        new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl })),
        { networks: [NETWORK] }
      );
      await server.initialize();
      return server;
    },
  });
}

/**
 * Mint once, through the whole real payment round trip.
 *
 * Two calls, as a paying agent actually makes them: the first carries no
 * payment and produces the demand, the second carries the signed authorisation.
 */
async function mintPaying({ settle }) {
  const fac = await fakeFacilitator({ settle });
  try {
    const db = openDb(":memory:");
    const q = queries(db);
    const tool = makeMintTool({
      q,
      chain: openChain(),
      paid: gatewayAgainst(fac.url, q),
      supplyCap: 100,
      today: () => 20_700,
      alert: () => {},
    });

    const demand = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: undefined } } });
    const meta = await payFor({
      result: demand,
      expected: { payTo: PAY_TO },
      // A throwaway key holding nothing: this facilitator submits nothing.
      walletPrivateKey: generatePrivateKey(),
    });
    assert.ok(meta, "the first call must produce a payment demand the client can read");

    const result = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: meta } } });
    return { result, q, db, settled: fac.settled() };
  } finally {
    await fac.close();
  }
}

// THE CONTROL. A settlement that works must leave exactly the state it always
// has: a row the Clock will write, and now the receipt that proves it was paid
// for.
test("CONTROL: a settled mint is queued for the Clock and carries its receipt", async () => {
  const { result, q, settled } = await mintPaying({ settle: "ok" });
  assert.equal(settled, 1, "a successful mint must take the money");
  assert.equal(result.ok, true);

  const mint = q.getMint(result.tokenId);
  assert.equal(mint.status, "queued", "the Clock writes rows with status 'queued'");
  assert.equal(mint.paymentTx, SETTLE_TX, "the settlement receipt is what proves this row was paid for");
});

// THE DEFECT. Settlement fails, and today the row is queued anyway: the Clock
// mints this token on chain tonight and nobody paid for it.
test("a mint whose settlement FAILS is never written on chain", async () => {
  const { db, q, settled } = await mintPaying({ settle: "declined" });
  assert.equal(settled, 1, "settlement was attempted -- that is not what is being tested");

  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0, "the reservation is released");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0, "and its token row goes with it");
  assert.deepEqual(q.pendingMints(), [], "so the Clock has nothing to write for an unpaid mint");
  assert.deepEqual(q.stuckMints(), [], "and nothing is reported as stuck -- it was unpaid, not broken");
});

// THE OTHER FAILURE PATH. A facilitator that answers with something @x402/core
// cannot parse makes settlePaymentResult THROW rather than return
// success:false, and the two are handled by different lines of the library. An
// agent must not be able to tell them apart, and neither must the Clock.
test("a settlement that THROWS releases the reservation too", async () => {
  const { db, q } = await mintPaying({ settle: "malformed" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
  assert.deepEqual(q.pendingMints(), []);
  assert.equal(q.hasMinted(KEY_ID), false);
});

// THE SAME PROPERTY FOR `upgrade`, which is where the money actually is: a
// Vessel is $1,250.00 against a mint's single dollar, and a Mark's effect is
// PERMANENT on chain -- taking one side of an exclusive pair forecloses the
// other forever. An unpaid Mark applied by the Clock could not be undone.
async function upgradePaying({ settle }) {
  const fac = await fakeFacilitator({ settle });
  try {
    const db = openDb(":memory:");
    const q = queries(db);
    q.insertToken({ tokenId: 1, keyId: KEY_ID, owner: TO, lastDay: 20_700, mintDay: 20_400 });
    db.exec("UPDATE tokens SET level = 40, streak = 40, bestRun = 40 WHERE tokenId = 1");
    const tool = makeUpgradeTool({
      q,
      chain: openChain({ boundTo: KEY_ID }),
      catalogue: assertLadderSane(LADDER),
      paid: gatewayAgainst(fac.url, q),
      alert: () => {},
    });

    // Static, id 3: level 30, $5.00 -- a bought Mark this token qualifies for.
    const args = { tokenId: 1, upgradeId: 3, variant: 0 };
    const demand = await tool.handler(args, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: undefined } } });
    const meta = await payFor({
      result: demand,
      expected: { payTo: PAY_TO },
      walletPrivateKey: generatePrivateKey(),
    });
    assert.ok(meta, "the first call must produce a payment demand");
    const result = await tool.handler(args, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: meta } } });
    return { result, q, db };
  } finally {
    await fac.close();
  }
}

test("CONTROL: a settled Mark is queued for the Clock and carries its receipt", async () => {
  const { result, q, db } = await upgradePaying({ settle: "ok" });
  assert.equal(result.ok, true);
  assert.deepEqual(q.pendingMarkOrders().map((o) => ({ ...o })), [{ tokenId: 1, upgradeId: 3, variant: 0 }]);
  assert.equal(db.prepare("SELECT paymentTx FROM mark_orders").get().paymentTx, SETTLE_TX);
});

test("a Mark whose settlement FAILS is never applied on chain, and the Mark stays buyable", async () => {
  const { q, db } = await upgradePaying({ settle: "declined" });
  assert.deepEqual(q.pendingMarkOrders(), [], "the Clock must not apply a Mark nobody paid for");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mark_orders").get().n, 0);
  // And the exclusion it would have caused is gone with it: Beat, the earned
  // partner of Static, must still be reachable. A reservation left behind here
  // would have forfeited the other side of the pair for a payment that never
  // happened -- permanently, once the Clock wrote it.
  assert.equal(q.reservedMask(1), 0, "nothing is reserved, so nothing is excluded");
});

// THE BACKSTOP, tested on its own because the release above is what normally
// happens and would hide it. If the process dies between the handler and the
// settle, or the release itself throws, the row survives -- and it must STILL
// be unwritable, because 'awaiting-payment' is not a status the Clock reads.
// This is the property that makes the whole design safe rather than merely
// tidy: the Clock never has to know about payment at all.
test("a reservation left behind by a crash is still unwritable, however complete it looks", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.transact(() => {
    q.insertMint({ tokenId: 9, toAddress: TO, keyId: KEY_ID, payNonce: "0xdead" });
    q.insertToken({ tokenId: 9, keyId: KEY_ID, owner: TO, lastDay: 20_700, mintDay: 20_700 });
    q.setTokenAwaitingPayment(9);
  });
  // Everything else about this row is ready: the artwork is solved, so the only
  // thing keeping it off the chain is that nobody paid. Without this line the
  // assertion would pass for the wrong reason.
  q.completeSolve(9, "00ff");

  assert.deepEqual(q.pendingMints(), [], "an unsettled reservation is invisible to the Clock");
  assert.deepEqual(q.stuckMints(), []);

  // And the sweep is what eventually clears it. `before` is passed explicitly
  // rather than waiting out the real ten minutes.
  assert.deepEqual(q.dropExpiredReservations(Date.now() + 1), { mints: 1, marks: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 0, "the token row goes too");
});

// The other half of the same defect, and the one that turns a bug into a
// permanent lockout. `mints` has a UNIQUE index on keyId, so a row left behind
// by a failed settlement means this key can NEVER mint again -- it would be
// refused `already-minted` forever, for a token it does not have and did not
// pay for.
test("a key whose settlement FAILED can mint again", async () => {
  const { q } = await mintPaying({ settle: "declined" });
  assert.equal(q.hasMinted(KEY_ID), false, "a reservation nobody paid for must not consume the one mint per key");
});
