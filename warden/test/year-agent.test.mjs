// One scripted agent's side of the door, driven without a network: the call
// shape it signs, the demand it reads, and what it does with one.
//
// The payment demand below is copied from the recorded fixture in
// mcp.test.mjs -- exactly what @x402/mcp's createPaymentWrapper hands back --
// so nothing here is asserted against a shape this file invented.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureIdentity, readDemand } from "../../client/src/index.mjs";
import { MINT_PRICE } from "../src/pay/x402.mjs";
import { makeAgent, markAmount, MINT_AMOUNT } from "../tools/year/agent.mjs";

const SITE = "https://fast.test";
const ORIGIN = "http://127.0.0.1:4006";
const TREASURY = "0x000000000000000000000000000000000000dEaD";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const OWNER = "0x00000000000000000000000000000000000000A1";

// Never funded and never used against a chain: the only thing it does here is
// sign an EIP-3009 authorisation offline.
const THROWAWAY_KEY = `0x${"11".repeat(32)}`;

/// The demand a paid tool answers with, as the recorded fixture has it.
const demandFor = (amount, tool) => ({
  x402Version: 2,
  error: "Payment required to access this tool",
  resource: { url: `mcp://tool/${tool}`, serviceName: "machine-readable-only" },
  accepts: [{
    scheme: "exact",
    network: "eip155:84532",
    amount,
    asset: USDC,
    payTo: TREASURY,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  }],
});

/// A demand as the tool wrapper returns it: isError, and the body in both places.
const demandResult = (amount, tool) => {
  const demand = demandFor(amount, tool);
  return { structuredContent: demand, content: [{ type: "text", text: JSON.stringify(demand) }], isError: true };
};

const okResult = (value) => ({ structuredContent: value, content: [{ type: "text", text: JSON.stringify(value) }] });

/// A callTool double that answers a scripted queue and records every call.
function recorder(answers) {
  const calls = [];
  return {
    calls,
    callTool: async (opts) => {
      calls.push(opts);
      const answer = answers[calls.length - 1];
      if (!answer) throw new Error(`no scripted answer for call ${calls.length}`);
      return answer;
    },
  };
}

let dir, identity;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "mro-year-agent-"));
  ({ identity } = await ensureIdentity(join(dir, "A1.jwk.json")));
});

after(() => rmSync(dir, { recursive: true, force: true }));

const agentWith = (deps) =>
  makeAgent({ identityPath: join(dir, "A1.jwk.json"), walletKey: THROWAWAY_KEY, site: SITE, origin: ORIGIN }, deps);

test("the agent knows its own key id, and every call carries the cli's door shape", async () => {
  const rec = recorder([okResult({ ok: true, credited: true })]);
  const agent = agentWith({ callTool: rec.callTool });
  assert.equal(agent.keyId, identity.keyId);

  const answer = await agent.beat(7);
  assert.deepEqual(answer, { ok: true, credited: true });
  assert.equal(rec.calls.length, 1);
  const call = rec.calls[0];
  assert.equal(call.origin, ORIGIN);
  assert.equal(call.site, SITE);
  assert.equal(call.signatureAgent, SITE);
  assert.deepEqual(call.privateJwk, identity.privateJwk);
  assert.equal(call.name, "checkin");
  assert.deepEqual(call.arguments, { tokenId: 7 });
  assert.equal(call._meta, undefined);
});

test("register hands the door the origin and the private key, nothing else", async () => {
  const seen = [];
  const agent = agentWith({ registerKey: async (opts) => { seen.push(opts); return { ok: true }; } });
  await agent.register();
  assert.deepEqual(Object.keys(seen[0]).sort(), ["origin", "privateJwk"]);
  assert.equal(seen[0].origin, ORIGIN);
});

test("an unpaid upgrade reads the demand and signs nothing", async () => {
  const rec = recorder([demandResult("5000000", "upgrade")]);
  const agent = agentWith({
    callTool: rec.callTool,
    payFor: async () => { throw new Error("payFor must not be called with pay:false"); },
  });

  const out = await agent.upgrade(7, 3, 0, { pay: false, expectedPayTo: TREASURY });
  assert.equal(out.outcome, "demand-only");
  assert.equal(out.demand.accepts[0].amount, "5000000");
  assert.equal(rec.calls.length, 1);
  assert.deepEqual(rec.calls[0].arguments, { tokenId: 7, upgradeId: 3, variant: 0 });
});

// The amount an agent will sign for comes from the catalogue the contract
// mirrors, so a demand asking for more is refused before anything is signed.
test("a Mark's price is the ladder's, and a demand for any other amount is refused", async () => {
  assert.equal(markAmount(3), "5000000");
  assert.equal(markAmount(7), "1250000000");
  assert.equal(markAmount(2), "0");
  assert.throws(() => markAmount(99), /no Mark 99/);

  const rec = recorder([demandResult("9000000", "upgrade")]);
  const agent = agentWith({ callTool: rec.callTool });
  await assert.rejects(
    () => agent.upgrade(7, 3, 0, { pay: true, expectedPayTo: TREASURY }),
    /amount is 9000000, expected 5000000/
  );
  assert.equal(rec.calls.length, 1);
});

test("an explicit expected amount is what gets pinned", async () => {
  const rec = recorder([demandResult("5000000", "upgrade")]);
  const agent = agentWith({ callTool: rec.callTool });
  await assert.rejects(
    () => agent.upgrade(7, 3, 0, { pay: true, expectedPayTo: TREASURY, expectedAmount: "4000000" }),
    /amount is 5000000, expected 4000000/
  );
});

// One price, in two places: the gateway charges MINT_PRICE and this harness
// signs for MINT_AMOUNT.
test("MINT_AMOUNT is the gateway's own mint price in base units", () => {
  assert.match(MINT_PRICE, /^\$\d+\.\d{2}$/);
  assert.equal(String(Math.round(Number(MINT_PRICE.slice(1)) * 1_000_000)), MINT_AMOUNT);
});

test("a paid upgrade pins the treasury and the ladder's amount, then repeats the call with the authorisation", async () => {
  const rec = recorder([demandResult("5000000", "upgrade"), okResult({ ok: true, accepted: true, upgradeId: 3 })]);
  const seen = [];
  const meta = { "x402/payment": { x402Version: 2, accepted: { amount: "5000000" } } };
  const agent = agentWith({
    callTool: rec.callTool,
    payFor: async (opts) => { seen.push(opts); return meta; },
  });

  const out = await agent.upgrade(7, 3, 0, { pay: true, expectedPayTo: TREASURY });
  assert.equal(out.outcome, "applied-queued");
  assert.deepEqual(out.result, { ok: true, accepted: true, upgradeId: 3 });

  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].expected, { payTo: TREASURY, amount: "5000000" });
  assert.equal(seen[0].walletPrivateKey, THROWAWAY_KEY);
  assert.equal(readDemand(seen[0].result).accepts[0].amount, "5000000");

  assert.equal(rec.calls.length, 2);
  assert.deepEqual(rec.calls[1].arguments, rec.calls[0].arguments);
  assert.deepEqual(rec.calls[1]._meta, meta);
});

test("a paid call answered by another demand is a failed payment, never a success", async () => {
  const rec = recorder([demandResult("5000000", "upgrade"), demandResult("5000000", "upgrade")]);
  const agent = agentWith({ callTool: rec.callTool, payFor: async () => ({ "x402/payment": {} }) });

  const out = await agent.upgrade(7, 3, 0, { pay: true, expectedPayTo: TREASURY });
  assert.equal(out.outcome, "refused");
  assert.equal(out.demand.accepts[0].amount, "5000000");
});

test("a refusal that is not a demand is refused, not reported as applied", async () => {
  const rec = recorder([okResult({ ok: false, reason: "mark-level-too-low" })]);
  const agent = agentWith({ callTool: rec.callTool });
  const out = await agent.upgrade(7, 3, 0, { pay: true, expectedPayTo: TREASURY });
  assert.equal(out.outcome, "refused");
  assert.equal(out.result.reason, "mark-level-too-low");
  assert.equal(out.demand, undefined);
});

// The real library, not a double: what payFor produces has to be what the
// second call can carry, or the whole paid path is only ever proven against a
// shape this file wrote.
test("the REAL payFor signs the recorded demand and the second call carries its meta", async () => {
  const rec = recorder([demandResult("5000000", "upgrade"), okResult({ ok: true, accepted: true })]);
  const agent = agentWith({ callTool: rec.callTool });

  const out = await agent.upgrade(7, 3, 0, { pay: true, expectedPayTo: TREASURY });
  assert.equal(out.outcome, "applied-queued");

  const payment = rec.calls[1]._meta["x402/payment"];
  assert.equal(payment.accepted.amount, "5000000");
  assert.equal(payment.accepted.payTo, TREASURY);
  assert.match(payment.payload.signature, /^0x[0-9a-f]{130}$/);
  assert.equal(payment.payload.authorization.to, TREASURY);
  assert.equal(payment.payload.authorization.value, "5000000");
});

test("a mint pins one USDC and the treasury it was given, and returns the token", async () => {
  const rec = recorder([demandResult(MINT_AMOUNT, "mint"), okResult({ ok: true, tokenId: 4 })]);
  const seen = [];
  const agent = agentWith({ callTool: rec.callTool, payFor: async (o) => { seen.push(o); return { "x402/payment": {} }; } });

  const result = await agent.mint(OWNER, TREASURY);
  assert.deepEqual(result, { ok: true, tokenId: 4 });
  assert.deepEqual(seen[0].expected, { payTo: TREASURY, amount: MINT_AMOUNT });
  assert.deepEqual(rec.calls[0].arguments, { to: OWNER });
});

// The amount is pinned from outside the response, so a demand for more than a
// mint costs is refused before anything is signed.
test("a mint demand for more than one USDC is refused by the real payFor", async () => {
  const rec = recorder([demandResult("2000000", "mint")]);
  const agent = agentWith({ callTool: rec.callTool });
  await assert.rejects(() => agent.mint(OWNER, TREASURY), /amount is 2000000, expected 1000000/);
  assert.equal(rec.calls.length, 1);
});

test("a mint the Warden refuses without a demand is returned as it came", async () => {
  const rec = recorder([okResult({ ok: false, reason: "already-minted" })]);
  const agent = agentWith({ callTool: rec.callTool });
  assert.deepEqual(await agent.mint(OWNER, TREASURY), { ok: false, reason: "already-minted" });
  assert.equal(rec.calls.length, 1);
});

test("a paid mint answered by another demand is a failed payment", async () => {
  const rec = recorder([demandResult(MINT_AMOUNT, "mint"), demandResult(MINT_AMOUNT, "mint")]);
  const agent = agentWith({ callTool: rec.callTool, payFor: async () => ({ "x402/payment": {} }) });
  const result = await agent.mint(OWNER, TREASURY);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "payment-failed");
});

test("seed asks for a child on the parent, free", async () => {
  const rec = recorder([okResult({ ok: true, childId: 13 })]);
  const agent = agentWith({ callTool: rec.callTool });
  assert.deepEqual(await agent.seed(1, OWNER), { ok: true, childId: 13 });
  assert.equal(rec.calls[0].name, "seed");
  assert.deepEqual(rec.calls[0].arguments, { parentId: 1, to: OWNER });
});

// rebind and rest return a call for the OWNER's wallet; this client never
// sends one, so the agent hands the call object straight back.
test("an owner call is fetched through the door and handed back unchanged", async () => {
  const call = { ok: true, contract: "0xc0", function: "rebind", args: [7, `0x${"ab".repeat(32)}`] };
  const rec = recorder([okResult(call)]);
  const agent = agentWith({ callTool: rec.callTool });
  assert.deepEqual(await agent.ownerCallFor("rebind", 7), call);
  assert.equal(rec.calls[0].name, "rebind");
  assert.deepEqual(rec.calls[0].arguments, { tokenId: 7 });
});

test("an identity that is not there is a refusal, not a silently new key", () => {
  assert.throws(
    () => makeAgent({ identityPath: join(dir, "missing.jwk.json"), walletKey: THROWAWAY_KEY, site: SITE, origin: ORIGIN }),
    /no identity/
  );
});
