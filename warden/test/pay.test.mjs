import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptContext, makePaymentGateway, warmUp, MINT_PRICE, MINT_RESOURCE } from "../src/pay/x402.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";
import { openChain, restingChain } from "./chain-stub.mjs";
import { LADDER, assertLadderSane } from "../src/mcp/ladder.mjs";

// A `paid` stub for the success path. It settles synchronously (no gap
// between the pre-check and the write), which is fine for a single call.
const settleNow = (fn) => fn;

/// A `paid` stub that defers the actual settlement by two microtask ticks.
/// This is what makes a genuine race observable: node:sqlite is synchronous,
/// so two `Promise.all`-launched handler calls would otherwise run their
/// pre-check-then-write sequence back to back with no interleaving at all.
/// Delaying past the point where BOTH calls have already cleared their
/// pre-payment gate is what actually exercises the post-settlement re-check.
const settleAfterBothGated = (fn) => async () => {
  await Promise.resolve();
  await Promise.resolve();
  return fn();
};

// THE BUG THIS PREVENTS. @x402/mcp 2.24.0 declares @modelcontextprotocol/sdk
// ^1.12.1, and its wrapper reads the payment as `extra?._meta` -- the v1 shape.
// Under the v2 server, _meta lives at ctx.mcpReq._meta. Without this adapter the
// wrapper finds nothing, decides no payment was made, and answers "payment
// required" forever, INCLUDING to an agent that has just paid.
test("the v2 context is adapted to the shape the payment wrapper reads", () => {
  const v2 = { mcpReq: { id: 1, method: "tools/call", _meta: { "x402/payment": { scheme: "exact" } } } };
  assert.deepEqual(adaptContext(v2)._meta, { "x402/payment": { scheme: "exact" } });
});

test("a context with no _meta adapts to undefined rather than throwing", () => {
  assert.equal(adaptContext({ mcpReq: { id: 1, method: "tools/call" } })._meta, undefined);
  assert.equal(adaptContext(undefined)._meta, undefined);
});

test("an upgrade gate is checked BEFORE payment is requested", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });

  let paymentWasRequested = false;
  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 5: { name: "Halo", price: "$100", minLevel: 100, supply: 1000 } },
    paid: () => { paymentWasRequested = true; throw new Error("payment must not be requested"); },
  });

  // The token is at level 1; Halo needs 100. An agent must never be charged for
  // an upgrade it cannot have.
  const r = await tool.handler({ tokenId: 1, upgradeId: 5 }, { keyId: "k1" });
  assert.equal(paymentWasRequested, false);
  assert.equal(r.reason, "mark-level-too-low");
});

// The static catalogue field is never incremented by anything, so the gate
// has to read the mirror. Seeding a reservation directly (never touching
// mark.sold) is what proves the count is NOT coming from the catalogue.
test("a sold-out mark is refused before payment, counted from the mirror not the catalogue", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  q.insertToken({ tokenId: 2, keyId: "k2", owner: "0xdef", lastDay: 100, mintDay: 100 });
  // Fill the one-unit supply via a DIFFERENT token, and never set mark.sold.
  assert.equal(q.reserveMark(2, 1), true);

  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 1 } },
    paid: () => { throw new Error("payment must not be requested"); },
  });
  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.reason, "mark-sold-out");
});

test("reserveMark returns false on a duplicate and does not throw; a genuine database error still throws", () => {
  const db = openDb(":memory:");
  const q = queries(db);
  assert.equal(q.reserveMark(1, 1), true);
  assert.equal(q.reserveMark(1, 1), false);

  db.exec("DROP TABLE mark_orders");
  assert.throws(() => q.reserveMark(1, 1));
});

test("CONTROL: a legitimate upgrade still succeeds and reserves exactly one row", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: settleNow,
  });
  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.accepted, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mark_orders").get().n, 1);
});

// The token cannot reserve the same mark twice even though BOTH calls pass
// their pre-payment gate -- neither call's pre-check sees the other's write,
// because tokens.marks is only ever flipped later by the Clock, not here.
// The unique index inside the paid callback is what actually stops it.
test("the same token cannot reserve the same mark twice even when both calls pass the pre-check", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const alerts = [];
  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: settleAfterBothGated,
    alert: (msg) => alerts.push(msg),
  });

  const [r1, r2] = await Promise.all([
    tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" }),
    tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" }),
  ]);
  const results = [r1, r2];
  const accepted = results.filter((r) => r.accepted === true);
  const refused = results.filter((r) => r.ok === false);

  assert.equal(accepted.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, "paid-but-unavailable");
  assert.equal(refused[0].detail, "mark-already-applied");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mark_orders WHERE tokenId = 1 AND upgradeId = 1").get().n, 1);
  assert.equal(alerts.length, 1);
});

test("CONTROL: a legitimate mint still succeeds and writes exactly one token and one mint row", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const tool = makeMintTool({ q, chain: openChain(), paid: settleNow, supplyCap: 10, today: () => 100 });

  const r = await tool.handler({ to: "0x" + "1".repeat(40) }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 1);
});

// Two settlements from the SAME key both pass hasMinted before either has
// written anything -- the unique index on mints.keyId is the only thing that
// actually stops a second mint.
test("two mints from the same key: exactly one succeeds, the second is paid-but-unavailable, and the alert fires", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const alerts = [];
  const tool = makeMintTool({
    q,
    chain: openChain(),
    paid: settleAfterBothGated,
    supplyCap: 10,
    today: () => 100,
    alert: (msg) => alerts.push(msg),
  });

  const to = "0x" + "2".repeat(40);
  const [r1, r2] = await Promise.all([
    tool.handler({ to }, { keyId: "k1" }),
    tool.handler({ to }, { keyId: "k1" }),
  ]);
  const results = [r1, r2];
  const accepted = results.filter((r) => r.ok === true);
  const refused = results.filter((r) => r.ok === false);

  assert.equal(accepted.length, 1);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, "paid-but-unavailable");
  assert.equal(alerts.length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 1);
});

test("upgradeId 8, 0, 32 and 33 are rejected by the schema", () => {
  const tool = makeUpgradeTool({
    q: {},
    chain: openChain(),
    catalogue: {},
    paid: () => { throw new Error("payment must not be requested"); },
  });
  for (const upgradeId of [8, 0, 32, 33]) {
    const result = tool.config.inputSchema.safeParse({ tokenId: 1, upgradeId });
    assert.equal(result.success, false, `upgradeId ${upgradeId} should be rejected`);
  }
});

// The cap is a COUNT, not a constraint: unlike the one-mint-per-key rule there
// is no unique index behind it, so the post-settlement read is the only thing
// between a settled payment and a token the contract would refuse to write.
test("a mint whose supply cap is taken during settlement is paid-but-unavailable, not an over-cap token", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  const alerts = [];

  // The last slot is taken WHILE the payment settles -- exactly the window the
  // pre-payment check cannot see.
  const takeLastSlotMidSettlement = (fn) => async (...args) => {
    q.insertToken({ tokenId: 99, keyId: "someone-else", owner: "0xdef", lastDay: 100, mintDay: 100 });
    return fn(...args);
  };

  const tool = makeMintTool({
    q,
    chain: openChain(),
    paid: takeLastSlotMidSettlement,
    supplyCap: 1,
    today: () => 100,
    alert: (msg) => alerts.push(msg),
  });

  const r = await tool.handler({ to: "0x" + "3".repeat(40) }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "paid-but-unavailable");
  assert.equal(r.detail, "supply-cap-reached");
  // Money changed hands and the agent got nothing: somebody has to see that.
  assert.equal(alerts.length, 1);
  // The over-cap token was never written.
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tokens").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mints").get().n, 0);
});

// A client branching on `result.ok` -- the field every other tool here answers
// with -- read a PAID upgrade success as a failure, because success returned
// only `{ accepted: true }`.
test("a successful upgrade answers ok:true as well as accepted:true", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: settleNow,
  });
  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.equal(r.accepted, true);
  // Every refusal from this tool carries ok:false, so the two are readable the
  // same way: this is the assertion that would catch a success with no `ok`.
  const refused = await tool.handler({ tokenId: 99, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(refused.ok, false);
});

// ---------------------------------------------------------------------------
// The gateway: makePaymentGateway. Every branch is driven through injected
// `build` and `wrapFactory`, so this file never opens a socket. The live
// facilitator is checked separately by tools/x402-live-check.mjs, which is not
// part of the suite -- a unit test that fails when a third party is down is a
// test that teaches everyone to ignore it.
// ---------------------------------------------------------------------------

/// A fake resource server. Records what requirements were asked for.
function fakeServer(asked = []) {
  return {
    asked,
    async buildPaymentRequirements(resource) {
      asked.push(resource);
      return [{ scheme: "exact", network: resource.network, amount: "1", payTo: resource.payTo }];
    },
  };
}

/// A wrapFactory that runs the handler instead of demanding payment, and
/// records the context it was handed.
function fakeWrap(seen = []) {
  return (server, { accepts }) => {
    seen.push(accepts);
    return (handler) => (args, ctx) => handler(args, ctx);
  };
}

test("the gateway does not touch the facilitator until the first paid call", async () => {
  let builds = 0;
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xdead",
    build: async () => { builds += 1; return fakeServer(); },
    wrapFactory: fakeWrap(),
  });
  // Constructing it is free. This is the whole reason it is lazy: initialize()
  // is a live HTTP call that throws, and the door must boot without it.
  assert.equal(builds, 0);

  await paid(async () => ({ ok: true }), "$0.10")({}, { mcpCtx: {} });
  assert.equal(builds, 1);
});

test("an unreachable facilitator refuses the call, never throws, and never runs the handler", async () => {
  const alerts = [];
  let handlerRan = false;
  const paid = makePaymentGateway({
    facilitatorUrl: "https://facilitator.invalid.example/",
    network: "eip155:84532",
    payTo: "0xdead",
    alert: (m) => alerts.push(m),
    build: async () => { throw new Error("Failed to initialize: no supported payment kinds"); },
    wrapFactory: fakeWrap(),
  });

  const r = await paid(async () => { handlerRan = true; return { ok: true }; }, "$0.10")({}, { mcpCtx: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "payment-unavailable");
  // The free mint this prevents: the handler is what writes the token row.
  assert.equal(handlerRan, false);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /payment unavailable/);
});

test("a failed build is retried on the next call rather than disabling payment for the process", async () => {
  let builds = 0;
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xdead",
    alert: () => {},
    build: async () => {
      builds += 1;
      if (builds === 1) throw new Error("facilitator down");
      return fakeServer();
    },
    wrapFactory: fakeWrap(),
  });

  const first = await paid(async () => ({ ok: true }), "$0.10")({}, { mcpCtx: {} });
  assert.equal(first.reason, "payment-unavailable");

  // A facilitator down for a minute must not need a process restart.
  const second = await paid(async () => ({ ok: true }), "$0.10")({}, { mcpCtx: {} });
  assert.equal(second.ok, true);
  assert.equal(builds, 2);
});

test("the resource server is built once and the wrapper cached per price", async () => {
  let builds = 0;
  const asked = [];
  const wrapped = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xtreasury",
    build: async () => { builds += 1; return fakeServer(asked); },
    wrapFactory: fakeWrap(wrapped),
  });

  await paid(async () => ({ ok: true }), "$0.10")({}, { mcpCtx: {} });
  await paid(async () => ({ ok: true }), "$0.10")({}, { mcpCtx: {} });
  assert.equal(builds, 1);
  assert.equal(wrapped.length, 1, "the same price must not rebuild its requirements");
});

// THE MONEY BUG THIS PREVENTS. `paid` is shared by mint ($1.00) and upgrade
// (1 to 100,000 USDC). One wrapper holding one price would charge $1.00 for a
// Crown the day the Mark catalogue is wired.
test("two prices produce two sets of requirements, each carrying its own price", async () => {
  const asked = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xtreasury",
    build: async () => fakeServer(asked),
    wrapFactory: fakeWrap(),
  });

  await paid(async () => ({ ok: true }), "$0.10")({}, { mcpCtx: {} });
  await paid(async () => ({ ok: true }), "$5000")({}, { mcpCtx: {} });

  assert.deepEqual(asked.map((a) => a.price), ["$0.10", "$5000"]);
  assert.deepEqual([...new Set(asked.map((a) => a.payTo))], ["0xtreasury"]);
  assert.deepEqual([...new Set(asked.map((a) => a.network))], ["eip155:84532"]);
});

test("an empty accepts list refuses rather than reaching createPaymentWrapper, which throws on it", async () => {
  let handlerRan = false;
  const alerts = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:8453",
    payTo: "0xdead",
    alert: (m) => alerts.push(m),
    build: async () => ({ buildPaymentRequirements: async () => [] }),
    wrapFactory: () => { throw new Error("wrapFactory must not be reached"); },
  });

  const r = await paid(async () => { handlerRan = true; }, "$0.10")({}, { mcpCtx: {} });
  assert.equal(r.reason, "payment-unavailable");
  assert.equal(handlerRan, false);
  assert.match(alerts[0], /no payment requirements for \$0\.10 on eip155:8453/);
});

// A missing price is a WIRING error. It must never fall back to a default:
// a default price is how the wrong amount gets charged in silence.
test("a missing or malformed price refuses without contacting the facilitator", async () => {
  let builds = 0;
  const alerts = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xdead",
    alert: (m) => alerts.push(m),
    build: async () => { builds += 1; return fakeServer(); },
    wrapFactory: fakeWrap(),
  });

  for (const price of [undefined, null, "", "free", "0.10", 0.1, "$"]) {
    const r = await paid(async () => ({ ok: true }), price)({}, { mcpCtx: {} });
    assert.equal(r.reason, "payment-unavailable", `price ${JSON.stringify(price)} must refuse`);
    assert.equal(r.detail, "no-price");
  }
  assert.equal(builds, 0, "a wiring error must not be sent to a third party");
  assert.equal(alerts.length, 7);
});

test("the handler is invoked with the ADAPTED v2 context, not the raw tool context", async () => {
  let seenCtx;
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xdead",
    build: async () => fakeServer(),
    wrapFactory: fakeWrap(),
  });

  const meta = { "x402/payment": { scheme: "exact" } };
  await paid(async (_args, ctx) => { seenCtx = ctx; return { ok: true }; }, "$0.10")(
    {},
    { mcpCtx: { mcpReq: { id: 1, method: "tools/call", _meta: meta } } }
  );
  assert.deepEqual(seenCtx._meta, meta);
});

test("warmUp reports readiness and never rejects when the facilitator is down", async () => {
  const alerts = [];
  const down = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xdead",
    build: async () => { throw new Error("facilitator down"); },
    wrapFactory: fakeWrap(),
  });
  assert.equal(await warmUp(down, "$0.10", (m) => alerts.push(m)), false);
  assert.match(alerts[0], /payment is not ready/);

  const up = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xdead",
    build: async () => fakeServer(),
    wrapFactory: fakeWrap(),
  });
  assert.equal(await warmUp(up, "$0.10", () => {}), true);
});

test("mint asks for exactly the price its own description quotes", async () => {
  const q = queries(openDb(":memory:"));
  let askedPrice;
  const tool = makeMintTool({
    q,
    chain: openChain(),
    paid: (fn, price) => { askedPrice = price; return fn; },
    supplyCap: 10,
    today: () => 100,
  });
  await tool.handler({ to: "0x" + "4".repeat(40) }, { keyId: "k1" });
  assert.equal(askedPrice, MINT_PRICE);
  assert.ok(tool.config.description.includes(MINT_PRICE));
});

test("upgrade asks for the MARK's price, not the mint price", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  let askedPrice;
  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: (fn, price) => { askedPrice = price; return fn; },
  });
  const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.equal(askedPrice, "$1");
  assert.notEqual(askedPrice, MINT_PRICE);
});

// A catalogue wired later without prices must fail loudly, not sell a 100,000
// USDC Mark for whatever the shared wrapper happened to hold.
test("a catalogue entry with no usable price refuses before any payment is requested", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const alerts = [];
  for (const price of [undefined, 1, "1 USDC", ""]) {
    const tool = makeUpgradeTool({
      q,
      chain: openChain(),
      catalogue: { 1: { name: "Vein", price, minLevel: 1, supply: 10 } },
      paid: () => { throw new Error("payment must not be requested"); },
      alert: (m) => alerts.push(m),
    });
    const r = await tool.handler({ tokenId: 1, upgradeId: 1 }, { keyId: "k1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "mark-inactive");
    assert.equal(r.detail, "no-price");
  }
  assert.equal(alerts.length, 4);
});

// @x402/mcp falls back to the literal string "paid_tool" when no resource url
// is given, so both paid tools would demand payment for `mcp://tool/paid_tool`
// -- an agent about to spend 100,000 USDC on a Singularity told only that it is
// paying for "a paid tool". Seen in the live journey check before it was fixed.
test("each paid tool names itself in the payment demand", async () => {
  const configs = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xtreasury",
    build: async () => fakeServer(),
    wrapFactory: (server, config) => {
      configs.push(config);
      return (handler) => (args, ctx) => handler(args, ctx);
    },
  });

  await paid(async () => ({ ok: true }), "$0.10", { tool: "mint", description: "Mint a token" })({}, { mcpCtx: {} });
  await paid(async () => ({ ok: true }), "$5000", { tool: "upgrade", description: "Apply the Crown Mark" })({}, { mcpCtx: {} });

  assert.deepEqual(configs.map((c) => c.resource.url), ["mcp://tool/mint", "mcp://tool/upgrade"]);
  assert.deepEqual(configs.map((c) => c.resource.description), ["Mint a token", "Apply the Crown Mark"]);
  for (const c of configs) assert.equal(c.resource.serviceName, "machine-readable-only");
});

test("two Marks sharing a price still get their own demand, because the description differs", async () => {
  const configs = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xtreasury",
    build: async () => fakeServer(),
    wrapFactory: (server, config) => {
      configs.push(config);
      return (handler) => (args, ctx) => handler(args, ctx);
    },
  });
  const call = (description) =>
    paid(async () => ({ ok: true }), "$100", { tool: "upgrade", description })({}, { mcpCtx: {} });

  await call("Apply the Halo Mark to token 1");
  await call("Apply the Halo Mark to token 2");
  await call("Apply the Halo Mark to token 1");

  // Three calls, two distinct demands: the cache key is the whole triple, so a
  // second token does not inherit the first one's demand.
  assert.equal(configs.length, 2);
});

test("the mint tool passes its own name and mint description through to the demand", async () => {
  const q = queries(openDb(":memory:"));
  let opts;
  const tool = makeMintTool({
    q,
    chain: openChain(),
    paid: (fn, _price, o) => { opts = o; return fn; },
    supplyCap: 10,
    today: () => 100,
  });
  await tool.handler({ to: "0x" + "5".repeat(40) }, { keyId: "k1" });
  assert.equal(opts.tool, "mint");
  assert.match(opts.description, /Machine Readable Only/);
});

test("the upgrade tool names the Mark and the token in its demand", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 7, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  let opts;
  const tool = makeUpgradeTool({
    q,
    chain: openChain(),
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    paid: (fn, _price, o) => { opts = o; return fn; },
  });
  await tool.handler({ tokenId: 7, upgradeId: 1 }, { keyId: "k1" });
  assert.equal(opts.tool, "upgrade");
  assert.equal(opts.description, "Apply the Vein Mark to token 7");
});

// The facilitator is told what every agent must pay and is trusted to report
// that a payment settled. Over plain HTTP a network attacker could rewrite the
// treasury in a demand, or forge a settlement.
test("a non-https facilitator is refused rather than used", async () => {
  const alerts = [];
  for (const url of ["http://x402.org/facilitator", "ftp://x402.org/", "x402.org/facilitator"]) {
    const paid = makePaymentGateway({
      facilitatorUrl: url,
      network: "eip155:84532",
      payTo: "0xdead",
      alert: (m) => alerts.push(m),
    });
    const r = await paid(async () => ({ ok: true }), "$0.10", MINT_RESOURCE)({}, { mcpCtx: {} });
    assert.equal(r.reason, "payment-unavailable");
  }
  assert.equal(alerts.length, 3);
  for (const a of alerts) assert.match(a, /must be https/);
});

test("the warm-up builds the same cache entry the mint tool will use", async () => {
  let builds = 0;
  const wrapped = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xtreasury",
    build: async () => { builds += 1; return fakeServer(); },
    wrapFactory: fakeWrap(wrapped),
  });

  assert.equal(await warmUp(paid, MINT_PRICE, () => {}), true);
  const q = queries(openDb(":memory:"));
  const tool = makeMintTool({ q, chain: openChain(), paid, supplyCap: 10, today: () => 100 });
  await tool.handler({ to: "0x" + "6".repeat(40) }, { keyId: "k1" });

  assert.equal(builds, 1);
  // One wrapper, not two: warming up under a different name would leave the
  // first paying agent waiting on a second round trip anyway.
  assert.equal(wrapped.length, 1);
});

// --- the free route: four of the ten Marks are earned, not bought -----------

// A free Mark must never reach the payment wrapper at all. `paid` throws if it
// is touched, which is the same idiom the pre-payment gate tests above use.
const paidMustNotBeCalled = () => { throw new Error("payment must not be requested"); };

/// A token bound to k1 at a given level and run of days.
function tokenAt({ level, streak }) {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  q.creditDay(1, 100, level, streak);
  return q;
}

test("an earned Mark is applied with no payment wrapper at all", async () => {
  const q = tokenAt({ level: 10, streak: 7 });         // Ache's gate is a run of 7
  const tool = makeUpgradeTool({
    q, chain: openChain(), catalogue: assertLadderSane(LADDER), paid: paidMustNotBeCalled,
  });

  const r = await tool.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.equal(r.upgradeId, 2);
  assert.equal(r.appliedBy, "the next Clock run");
  assert.equal(q.markSold(2), 1, "the reservation reached the mirror");
});

test("an earned Mark whose run is short is refused, and still costs nothing", async () => {
  const q = tokenAt({ level: 10, streak: 6 });         // one day short of Ache
  const tool = makeUpgradeTool({
    q, chain: openChain(), catalogue: assertLadderSane(LADDER), paid: paidMustNotBeCalled,
  });

  const r = await tool.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "mark-needs-streak");
  assert.equal(q.markSold(2), 0);
});

// THE REGRESSION THIS PINS. The free route must sit BEFORE the price guard.
// Placed after it, every earned Mark is refused mark-inactive / no-price,
// because an earned Mark has no price by definition. The alert assertion is
// what tells the two apart: the guard alerts, the free route does not.
test("an earned Mark is not mistaken for a catalogue entry with a missing price", async () => {
  const q = tokenAt({ level: 40, streak: 30 });        // Beat's gate
  const alerts = [];
  const tool = makeUpgradeTool({
    q, chain: openChain(), catalogue: assertLadderSane(LADDER),
    paid: paidMustNotBeCalled, alert: (m) => alerts.push(m),
  });

  const r = await tool.handler({ tokenId: 1, upgradeId: 4 }, { keyId: "k1" });
  assert.equal(r.ok, true);
  assert.deepEqual(alerts, [], "a free Mark must not alert about a missing price");
});

test("taking the same free Mark twice is refused by the mirror, not by money", async () => {
  const q = tokenAt({ level: 10, streak: 7 });
  const tool = makeUpgradeTool({
    q, chain: openChain(), catalogue: assertLadderSane(LADDER), paid: paidMustNotBeCalled,
  });

  assert.equal((await tool.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" })).ok, true);
  const again = await tool.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" });
  assert.equal(again.ok, false);
  assert.equal(again.reason, "mark-already-applied");
  assert.equal(q.markSold(2), 1, "the second call reserved nothing");
});

// The free route still reads the chain once. applyMark carries whenNotPaused
// and notSunset and reverts Resting(id), and `resting` is set by the token
// OWNER calling rest() directly, so this mirror can never learn it without
// asking -- free or not.
test("a free Mark is still refused when the chain refuses the write", async () => {
  const q = tokenAt({ level: 10, streak: 7 });
  const tool = makeUpgradeTool({
    q, chain: restingChain(), catalogue: assertLadderSane(LADDER), paid: paidMustNotBeCalled,
  });

  const r = await tool.handler({ tokenId: 1, upgradeId: 2 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "resting");
  assert.equal(q.markSold(2), 0, "nothing was reserved");
});

// THE CONTROL. Without it, every test above passes for a tool that has
// accidentally made ALL Marks free -- including the $1,250.00 one.
test("a bought Mark still goes through the payment wrapper, at its own price", async () => {
  const q = tokenAt({ level: 40, streak: 40 });
  let charged = null;
  const paid = (fn, price, meta) => { charged = { price, meta }; return fn; };
  const tool = makeUpgradeTool({
    q, chain: openChain(), catalogue: assertLadderSane(LADDER), paid,
  });

  const r = await tool.handler({ tokenId: 1, upgradeId: 3 }, { keyId: "k1" });   // Static
  assert.equal(r.ok, true);
  assert.equal(charged.price, "$5.00");
  assert.equal(charged.meta.description, "Apply the Static Mark to token 1");
});
