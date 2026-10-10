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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { LADDER, assertLadderSane } from "../src/mcp/ladder.mjs";
import { makePaymentGateway } from "../src/pay/x402.mjs";
import { openChain } from "./chain-stub.mjs";
import { payFor, readDemand } from "../../client/src/pay.mjs";

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
    const send = (body, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" });
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
        // THE SHAPE THAT WAS BEING RELEASED. @x402/evm returns exactly this
        // when the receipt wait times out AFTER the transfer was broadcast:
        // `success: false`, and a transaction hash beside it. The money can
        // still land.
        if (settle === "pending") {
          return send({
            success: false,
            errorReason: "settlement_pending",
            errorMessage: "timed out waiting for receipt",
            transaction: SETTLE_TX,
            network: NETWORK,
            payer: PAY_TO,
          });
        }
        // The other one: a MINED transfer whose events did not validate. Also
        // `success: false` with a hash, and also not a decline.
        if (settle === "event-mismatch") {
          return send({
            success: false,
            errorReason: "invalid_exact_evm_transfer_event_mismatch",
            transaction: SETTLE_TX,
            network: NETWORK,
            payer: PAY_TO,
          });
        }
        // A reason this build has never seen, with no hash. `errorReason` is a
        // free string in @x402/core, so this is what a facilitator release or a
        // different implementation looks like from here.
        if (settle === "unknown-reason") {
          return send({
            success: false,
            errorReason: "some_reason_invented_after_this_build",
            transaction: "",
            network: NETWORK,
            payer: PAY_TO,
          });
        }
        // EXPLICIT REFUSALS SENT AS ERRORS. @x402/core throws a SettleError
        // for a non-2xx whose body has `success`, carrying the body's reason
        // and hash. The answer is the same answer; only the envelope differs.
        if (settle === "declined-4xx") {
          return send({ success: false, errorReason: "invalid_exact_evm_payload_authorization_valid_before",
            transaction: "", network: NETWORK, payer: PAY_TO }, 400);
        }
        if (settle === "hash-4xx") {
          return send({ success: false, errorReason: "invalid_exact_evm_transfer_event_mismatch",
            transaction: SETTLE_TX, network: NETWORK, payer: PAY_TO }, 400);
        }
        // THE HASH ALONE HAS TO DECIDE IT. `hash-4xx` above carries a reason
        // that is not on the pre-broadcast allowlist, so it is held on the
        // reason and would stay held with the hash check deleted. This one
        // pairs an ALLOWLISTED reason with a broadcast hash: the only thing
        // standing between it and a released reservation is the hash.
        if (settle === "allowlisted-reason-with-hash-4xx") {
          return send({ success: false, errorReason: "invalid_exact_evm_signature",
            transaction: SETTLE_TX, network: NETWORK, payer: PAY_TO }, 400);
        }
        if (settle === "unknown-4xx") {
          return send({ success: false, errorReason: "some_reason_invented_after_this_build",
            transaction: "", network: NETWORK, payer: PAY_TO }, 400);
        }
        if (settle === "gateway-502") {
          res.writeHead(502, { "content-type": "text/html" });
          return res.end("<html>bad gateway</html>");
        }
        // CDP's own spellings, measured. A bad signature can never have moved
        // money; `invalid_payload` is generic and must stay unknown.
        if (settle === "cdp-bad-signature-4xx") {
          return send({ success: false, errorReason: "invalid_exact_evm_payload_signature",
            transaction: "", network: NETWORK, payer: PAY_TO }, 400);
        }
        if (settle === "cdp-invalid-payload-4xx") {
          return send({ success: false, errorReason: "invalid_payload",
            transaction: "", network: NETWORK, payer: PAY_TO }, 400);
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
    onUnresolved: (payment) => q.holdUnresolvedPayment(payment),
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
    // A throwaway key holding nothing: this facilitator submits nothing. The
    // ADDRESS is returned because it is the payer an unresolved row must
    // store -- the authorisation is the payer's, not the recipient's, and
    // asking USDC about the wrong one answers about the wrong authorisation.
    const walletPrivateKey = generatePrivateKey();
    const meta = await payFor({
      result: demand,
      // `amount` is required by assertExpected since 2026-09-18 (a
      // destination alone left the sum unchecked). Taken from the
      // demand under test, so this stays a settlement test.
      expected: { payTo: PAY_TO, amount: readDemand(demand).accepts[0].amount },
      walletPrivateKey,
    });
    assert.ok(meta, "the first call must produce a payment demand the client can read");

    const result = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: meta } } });
    return { result, q, db, settled: fac.settled(), payer: privateKeyToAccount(walletPrivateKey).address };
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

  // OVER THE WIRE, which is where the receipt has to be. A settled success is a
  // complete MCP tool result, so mcp/server.mjs passes it through untouched and
  // `_meta` stays at the top level -- the address the protocol document tells
  // an agent to read it from. Returning the plain value instead put the whole
  // thing, receipt included, one level down inside structuredContent.
  assert.ok(Array.isArray(result.content), "a settled call answers in MCP's own shape");
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent._meta, undefined, "the receipt is not buried in the value");
  assert.equal(result._meta["x402/payment-response"].transaction, SETTLE_TX, "the receipt the agent was promised");

  const mint = q.getMint(result.structuredContent.tokenId);
  assert.equal(mint.status, "queued", "the Clock writes rows with status 'queued'");
  assert.equal(mint.paymentTx, SETTLE_TX, "the settlement receipt is what proves this row was paid for");

  // AND THE FACTS THE CHAIN WOULD BE ASKED WITH, written at reservation. They
  // are useless on a settled row and indispensable on a held one, and only the
  // handler ever sees the payload they come from.
  assert.match(mint.payTo, /^0x[0-9a-fA-F]{40}$/, "the treasury this service demanded");
  assert.ok(Number(mint.payAmount) > 0, "the amount it demanded");
  assert.ok(mint.validBefore > 0, "and the deadline the authorisation carries");
  assert.ok(mint.reservedBlock > 0, "the head the reservation was made at bounds the log search");
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

// A `success: false` IS NOT A DECLINE ON ITS OWN, and this is the finding that
// makes the difference expensive. The installed reference facilitator answers
// `success: false` WITH a broadcast transaction hash on two paths -- the
// receipt wait timing out, and a mined transfer failing event validation -- and
// the transfer can land afterwards in both. Releasing them debited the agent up
// to $1,250.00 for a row that no longer existed, its nonce still claimed.
for (const settle of ["pending", "event-mismatch"]) {
  test(`a settlement refused WITH a transaction hash (${settle}) is held, not released`, async () => {
    const { db, q } = await mintPaying({ settle });

    const row = db.prepare("SELECT tokenId, status, payTo, payAmount, validBefore, reservedBlock FROM mints").get();
    assert.ok(row, "the row must survive: the transfer carries a hash and may be mined");
    assert.equal(row.status, "payment-unresolved");
    assert.deepEqual(q.pendingMints(), [], "and nothing unpaid reaches the chain meanwhile");
    assert.deepEqual(q.unresolvedPayments().map((r) => r.tokenId), [row.tokenId]);

    // EVERYTHING THE CLOCK WILL ASK WITH. Without these the row can only ever
    // be judged by the forgeable question, which the resolver refuses to put.
    assert.match(row.payTo, /^0x[0-9a-fA-F]{40}$/);
    assert.ok(Number(row.payAmount) > 0);
    assert.ok(row.validBefore > 0);
    assert.ok(row.reservedBlock > 0);
  });
}

// AND THE ALLOWLIST DIRECTION. `errorReason` is a free string, so an unknown
// one has two readings and they are not symmetrical: read as a decline it
// releases money that may have moved, read as unknown it costs a night.
test("a refusal this build does not recognise is held rather than released", async () => {
  const { db } = await mintPaying({ settle: "unknown-reason" });
  assert.equal(db.prepare("SELECT status FROM mints").get().status, "payment-unresolved");
});

// THE STATUS CODE IS AN ENVELOPE, NOT AN ANSWER. x402.org refuses with a 200
// and CDP -- the mainnet facilitator -- refuses the same payment with a 400,
// which @x402/core throws as a SettleError carrying that same body. Judging the
// throw as unknown held every plain CDP refusal until the next 00:05 UTC.
test("an explicit refusal sent as a non-2xx is released, like the same refusal sent as a 200", async () => {
  const { db, settled } = await mintPaying({ settle: "declined-4xx" });
  assert.equal(settled, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0, "a plain no frees the key at once");
});

// CDP spells a bad signature its own way, and a signature that does not recover
// can never have moved money.
test("CDP's own bad-signature refusal is released too", async () => {
  const { db } = await mintPaying({ settle: "cdp-bad-signature-4xx" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
});

for (const settle of ["hash-4xx", "unknown-4xx", "gateway-502", "cdp-invalid-payload-4xx"]) {
  test(`a non-2xx that is not a plain refusal (${settle}) is held`, async () => {
    const { db } = await mintPaying({ settle });
    assert.equal(db.prepare("SELECT status FROM mints").get().status, "payment-unresolved");
  });
}

// AND THE HASH ON ITS OWN, which is what none of the cases above actually test.
// Every held non-2xx up there carries a reason that is not on the pre-broadcast
// allowlist, so each is held on the REASON -- delete the hash check in
// `isDeclined` and they all stay green. A facilitator can send both: a
// recognised pre-broadcast reason beside a transaction it did broadcast. The
// hash wins, because a hash means the transfer exists and the money can still
// move, whatever reason came with it.
test("an allowlisted refusal that nonetheless carries a transaction hash is held", async () => {
  const { result, db, q } = await mintPaying({ settle: "allowlisted-reason-with-hash-4xx" });

  const row = db.prepare("SELECT tokenId, status FROM mints").get();
  assert.ok(row, "the row must survive: a broadcast transfer can still land");
  assert.equal(row.status, "payment-unresolved", "the hash decides it, not the reason");
  assert.deepEqual(q.unresolvedPayments().map((r) => r.tokenId), [row.tokenId]);
  assert.deepEqual(q.pendingMints(), [], "and nothing unpaid reaches the chain meanwhile");

  // AND THE AGENT IS TOLD NOT TO PAY AGAIN, which is the whole point of the
  // distinction: a released reservation invites the one retry that can debit a
  // payer twice for a transfer that is already on chain.
  assert.equal(result.structuredContent.reason, "payment-unresolved");
  assert.equal(result.structuredContent.transaction, SETTLE_TX, "and given the hash to look up itself");
});

test("CONTROL: an unresolved answer with no hash carries none", async () => {
  const { result } = await mintPaying({ settle: "unknown-4xx" });
  assert.equal(result.structuredContent.reason, "payment-unresolved");
  assert.equal("transaction" in result.structuredContent, false);
});

// THE OTHER FAILURE PATH, AND IT IS NOT THE SAME FAILURE. A facilitator that
// answers with something @x402/core cannot parse makes settlePaymentResult
// THROW rather than return success:false -- and a throw is also what a timeout
// or a dropped response looks like, by which time the EIP-3009 transfer may
// ALREADY BE MINED. The library reports both through
// createSettlementFailedResult and fires no hook either way, so until
// 2026-09-18 this service read "unknown" as "did not happen" and DELETED the
// reservation: the agent was debited up to $1,250.00, its row vanished, its
// authorisation stayed spent, and one log line was the only trace.
//
// This test asserted that deletion was correct. It now asserts the opposite,
// which is the whole fix: money whose fate is unknown is HELD.
test("a settlement whose outcome is UNKNOWN holds the reservation for a human", async () => {
  const { db, q, payer } = await mintPaying({ settle: "malformed" });

  const row = db.prepare("SELECT tokenId, status, payer, asset FROM mints").get();
  assert.ok(row, "the row must survive: the transfer may already be on chain");
  assert.equal(row.status, "payment-unresolved", "and it must sit in a state the Clock will not write");
  assert.deepEqual(q.pendingMints(), [], "so no unpaid mint reaches the chain");
  assert.equal(q.hasMinted(KEY_ID), true, "the key's one paid mint stays taken while its money is in doubt");
  assert.deepEqual(
    q.unresolvedPayments().map((r) => r.tokenId),
    [row.tokenId],
    "and it is reported, because silence is how the money was lost"
  );

  // The two facts the Clock needs to ASK THE CHAIN whether this authorisation
  // was used. Without them the row can only ever wait for a human.
  assert.equal(row.payer.toLowerCase(), payer.toLowerCase(), "the payer signed the authorisation");
  assert.match(row.asset, /^0x[0-9a-fA-F]{40}$/, "the token contract the authorisation spends");

  // THE SWEEP MUST NOT UNDO THIS. Leaving the row 'awaiting-payment' would
  // have delayed the same deletion by ten minutes, not prevented it.
  q.sweepExpiredReservations(Date.now() + 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 1, "the expiry sweep leaves it alone");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 1, "and its token row with it");
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
      // `amount` is required by assertExpected since 2026-09-18 (a
      // destination alone left the sum unchecked). Taken from the
      // demand under test, so this stays a settlement test.
      expected: { payTo: PAY_TO, amount: readDemand(demand).accepts[0].amount },
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
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result._meta["x402/payment-response"].transaction, SETTLE_TX, "the receipt reaches the agent");
  assert.deepEqual(q.pendingMarkOrders().map(({ tokenId, upgradeId, variant }) => ({ tokenId, upgradeId, variant })), [{ tokenId: 1, upgradeId: 3, variant: 0 }]);
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

  // AND THE SWEEP HOLDS IT RATHER THAN DELETING IT. A row only survives its
  // window when the process stopped between the handler and the settlement
  // answer, which is exactly when the transfer may already be mined -- so the
  // sweep hands it to the Clock instead of throwing it away. `before` is passed
  // explicitly rather than waiting out the real ten minutes.
  const swept = q.sweepExpiredReservations(Date.now() + 1);
  assert.deepEqual(swept.mints.map((r) => r.tokenId), [9]);
  assert.deepEqual(swept.marks, []);
  assert.equal(db.prepare("SELECT status FROM mints WHERE tokenId = 9").get().status, "payment-unresolved");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 1, "the token row stays with it");
  assert.deepEqual(q.pendingMints(), [], "and it is still nothing the Clock will write");
  assert.deepEqual(
    q.unresolvedPayments().map((r) => r.tokenId),
    [9],
    "the Clock is the one that decides it, against the chain"
  );
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

// THE SWEEP RAN AFTER THE CHECK IT EXISTS TO PROTECT. `hasMinted` counts any
// row for the key, so a key holding its own orphan was refused before it could
// reach the sweep -- and it could not trigger the sweep itself. It waited on
// some stranger's paid call. The sweep runs first now, so a key's own retry is
// what moves its orphan into the state the Clock decides.
test("a key's own retry sweeps its own orphaned reservation", async () => {
  const fac = await fakeFacilitator({ settle: "ok" });
  try {
    const db = openDb(":memory:");
    const q = queries(db);
    q.transact(() => {
      q.insertMint({ tokenId: 9, toAddress: TO, keyId: KEY_ID, payNonce: "0x" + "ef".repeat(32) });
      q.insertToken({ tokenId: 9, keyId: KEY_ID, owner: TO, lastDay: 20_700, mintDay: 20_700 });
      q.setTokenAwaitingPayment(9);
    });
    db.prepare("UPDATE mints SET reservedAt = ? WHERE tokenId = 9").run(Date.now() - 20 * 60 * 1000);

    const said = [];
    const tool = makeMintTool({
      q, chain: openChain(), paid: gatewayAgainst(fac.url, q),
      today: () => 20_700, alert: (m) => said.push(m),
    });
    const again = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: undefined } } });

    assert.equal(
      db.prepare("SELECT status FROM mints WHERE tokenId = 9").get().status,
      "payment-unresolved",
      "the caller's own orphan is moved by its own call"
    );
    assert.match(said.join(" "), /HELD for the Clock to resolve/);
    // AND IT IS STILL REFUSED: the money is in doubt, so selling this key a
    // second token would be the loss the hold exists to prevent. It is told
    // the payment is held, which carries "do not pay again", not
    // `already-minted`.
    assert.equal(again.ok, false);
    assert.equal(again.reason, "payment-unresolved");
  } finally {
    await fac.close();
  }
});

// WHAT THE AGENT IS TOLD WHEN NOBODY KNOWS. The state above is right and the
// answer was not: @x402/mcp's own settlement-failed demand reached the agent,
// and a client reading it reported that nothing was minted and the reservation
// released -- both false, and an invitation to pay a second time for a payment
// that may already have moved.
test("an agent whose payment outcome is unknown is told so, and told not to pay again", async () => {
  const { result } = await mintPaying({ settle: "malformed" });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.reason, "payment-unresolved");
  const next = result.structuredContent.next;
  assert.match(next, /outcome is not known yet/);
  assert.match(next, /HOLDING your reservation/);
  assert.match(next, /Do not pay again/);
  // The checker runs once a night, so the honest answer is not always "tonight".
  assert.match(next, /The site checks the chain at the next 00:05 UTC/);
  assert.match(next, /waits one more night/);
  assert.match(next, /your token is minted then/);
  assert.doesNotMatch(JSON.stringify(result), /released its reservation/);
});

test("a Mark whose payment outcome is unknown says Mark, not token", async () => {
  const { result } = await upgradePaying({ settle: "malformed" });
  assert.equal(result.structuredContent.reason, "payment-unresolved");
  assert.match(result.structuredContent.next, /your Mark is applied then/);
  assert.match(result.structuredContent.next, /waits one more night/);
  assert.doesNotMatch(result.structuredContent.next, /token is minted/);
});

// The hold itself can fail -- a full disk, a locked database -- and that is the
// one moment the agent most needs the true answer. The alert already says a
// human must check it; the agent must not be told anything different.
test("when even the hold fails, the answer is still unresolved, never released", async () => {
  const fac = await fakeFacilitator({ settle: "malformed" });
  try {
    const db = openDb(":memory:");
    const q = queries(db);
    const gateway = makePaymentGateway({
      facilitatorUrl: fac.url, network: NETWORK, payTo: PAY_TO,
      onSettled: (n, tx) => q.settleByNonce(n, tx),
      onUnsettled: (n) => q.releaseReservation(n),
      onUnresolved: () => { throw new Error("disk full"); },
      alert: () => {},
      build: async () => {
        const server = registerExactEvmScheme(
          new x402ResourceServer(new HTTPFacilitatorClient({ url: fac.url })), { networks: [NETWORK] });
        await server.initialize();
        return server;
      },
    });
    const tool = makeMintTool({ q, chain: openChain(), paid: gateway, supplyCap: 100, today: () => 20_700, alert: () => {} });
    const demand = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: undefined } } });
    const meta = await payFor({ result: demand, expected: { payTo: PAY_TO, amount: readDemand(demand).accepts[0].amount },
      walletPrivateKey: generatePrivateKey() });
    const result = await tool.handler({ to: TO }, { keyId: KEY_ID, mcpCtx: { mcpReq: { _meta: meta } } });
    assert.equal(result.structuredContent.reason, "payment-unresolved");
  } finally {
    await fac.close();
  }
});
