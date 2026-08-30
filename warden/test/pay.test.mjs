import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptContext } from "../src/pay/x402.mjs";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeUpgradeTool } from "../src/mcp/tools/upgrade.mjs";
import { makeMintTool } from "../src/mcp/tools/mint.mjs";

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
    catalogue: { 5: { name: "Halo", minLevel: 100, supply: 1000 } },
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
    catalogue: { 1: { name: "Vein", minLevel: 1, supply: 1 } },
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
    catalogue: { 1: { name: "Vein", minLevel: 1, supply: 10 } },
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
    catalogue: { 1: { name: "Vein", minLevel: 1, supply: 10 } },
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
  const tool = makeMintTool({ q, paid: settleNow, supplyCap: 10, today: () => 100 });

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
    catalogue: {},
    paid: () => { throw new Error("payment must not be requested"); },
  });
  for (const upgradeId of [8, 0, 32, 33]) {
    const result = tool.config.inputSchema.safeParse({ tokenId: 1, upgradeId });
    assert.equal(result.success, false, `upgradeId ${upgradeId} should be rejected`);
  }
});
