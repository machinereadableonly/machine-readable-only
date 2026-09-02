// The two scope claims the agent-facing pages make, pinned so they stay true.
//
// docs/2026-09-01-mro-raw-protocol.md section 6 tells a reader that the
// identity key never signs a transaction, and that a payment authorises
// exactly one transfer with no allowance left behind. Both are true today.
// Neither is enforced by anything, which is what these tests are for: a claim
// made to an agent that is deciding whether to trust us is not documentation,
// it is a promise, and a promise nothing checks drifts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeRestTool } from "../src/mcp/tools/rest.mjs";
import { makeRebindTool } from "../src/mcp/tools/rebind.mjs";
import { makePaymentGateway } from "../src/pay/x402.mjs";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/// Every .mjs under src/, with its path relative to src/.
function sourceFiles(dir = SRC, prefix = "") {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, rel));
    else if (name.endsWith(".mjs")) out.push({ rel, full });
  }
  return out;
}

// CLAIM 1: "The agent's identity key signs HTTP request signatures only. It
// never signs a transaction and cannot move funds."
//
// The half of that claim which is ours to keep is that this service cannot
// sign a transaction AT ALL -- not for the agent, not for anyone. The Clock is
// a separate process with the only key in the repository, so the boundary is
// real, and it is a boundary a refactor could quietly erase by importing a
// wallet client into a tool "just to check something".
test("nothing outside the Clock can sign a transaction", () => {
  // Primitives that would mean this process can produce a signed transaction.
  // `privateKey` catches a key arriving by any name; the viem/ethers entry
  // points catch a signer being constructed.
  const signing = /privateKeyToAccount|createWalletClient|signTransaction|sendRawTransaction|new Wallet\(|Wallet\.fromPhrase/;

  const offenders = sourceFiles()
    .filter((f) => !f.rel.startsWith("clock/"))
    .filter((f) => signing.test(readFileSync(f.full, "utf8")))
    .map((f) => f.rel);

  assert.deepEqual(offenders, [], `signing capability outside src/clock/: ${offenders.join(", ")}`);
});

// The Warden is the internet-facing process. It reads the same config file the
// Clock does, so the key is briefly in its environment; main.mjs drops it
// before anything else runs, so a crash dump or a debug route cannot hand out
// the key that can mint every token in the collection.
//
// Asserted as SOURCE rather than by booting main.mjs, which would bind a port
// and need a full environment. The delete is one line and its absence is the
// whole failure.
test("the Warden drops the Clock's key from its own environment at startup", () => {
  const main = readFileSync(join(SRC, "main.mjs"), "utf8");
  assert.match(main, /delete process\.env\.CLOCK_PRIVATE_KEY;/);
});

// CLAIM 2: "rebind and rest return the call the token OWNER's wallet must
// sign. The Warden never submits it."
//
// These are the only two tools that produce a chain call for the caller, and
// the reason they are safe to expose is that they produce a DESCRIPTION, not
// an action. A future version that helpfully submitted the call would break
// the claim without breaking any other test.
test("the owner-signed tools return an unsigned call and take no action", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });

  for (const make of [makeRestTool, makeRebindTool]) {
    const tool = make({ q, contract: "0xcontract" });
    const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });

    assert.equal(r.ok, true);
    // A description of a call: where, what, with which arguments.
    assert.equal(r.contract, "0xcontract");
    assert.equal(typeof r.function, "string");
    assert.ok(Array.isArray(r.args));
    // And nothing that would indicate it was sent. A transaction hash here
    // would mean the Warden had submitted on the owner's behalf.
    for (const sent of ["txHash", "transactionHash", "hash", "receipt", "signature"]) {
      assert.equal(r[sent], undefined, `${tool.name} must not report a submitted transaction (${sent})`);
    }
  }
});

// CLAIM 3: "The payment authorises exactly one transfer... no approval or
// allowance is required."
//
// That is a property of the x402 exact scheme over EIP-3009, not something we
// implement -- so what this pins is that we ASK for that scheme, at the price
// the tool actually charges, to the configured treasury. A demand built with a
// different scheme, or at a price the caller supplied, would break the claim.
//
// The facilitator is stubbed: this is about the requirements we ask to be
// built, and the live equivalent is warden/tools/x402-live-check.mjs.
test("a payment demand is a one-shot exact transfer, at the tool's own price", async () => {
  const asked = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xtreasury",
    build: async () => ({
      buildPaymentRequirements: async (req) => {
        asked.push(req);
        return [{ scheme: req.scheme, network: req.network, payTo: req.payTo, amount: "1000000" }];
      },
    }),
    wrapFactory: () => (handler) => handler,
  });

  await paid(async () => ({ ok: true }), "$1.00", { tool: "mint" })({}, { mcpCtx: {} });

  assert.equal(asked.length, 1);
  // "exact" is the scheme that means EIP-3009 transferWithAuthorization: one
  // transfer, one amount, one recipient, no allowance. Any other scheme would
  // make the document's promise false.
  assert.equal(asked[0].scheme, "exact");
  assert.equal(asked[0].price, "$1.00");
  assert.equal(asked[0].payTo, "0xtreasury");
  assert.equal(asked[0].network, "eip155:84532");
});

// The same gateway serves mint at 1 USDC and the Marks at up to 100,000, so
// "exactly one transfer" is only honest if the amount is the one that tool
// charges. Two prices must produce two demands, never one reused.
test("each price builds its own demand, so no tool can be charged another's amount", async () => {
  const asked = [];
  const paid = makePaymentGateway({
    facilitatorUrl: "https://example.invalid/",
    network: "eip155:84532",
    payTo: "0xtreasury",
    build: async () => ({
      buildPaymentRequirements: async (req) => {
        asked.push(req.price);
        return [{ scheme: "exact", amount: "1" }];
      },
    }),
    wrapFactory: () => (handler) => handler,
  });

  await paid(async () => ({ ok: true }), "$1.00", { tool: "mint" })({}, { mcpCtx: {} });
  await paid(async () => ({ ok: true }), "$1250", { tool: "upgrade" })({}, { mcpCtx: {} });

  assert.deepEqual(asked, ["$1.00", "$1250"]);
});
