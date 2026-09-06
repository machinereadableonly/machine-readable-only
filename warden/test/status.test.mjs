import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeStatusTool } from "../src/mcp/tools/status.mjs";
import { openChain } from "./chain-stub.mjs";

test("status with a tokenId returns that token's view", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 5, mintDay: 0 });
  const tool = makeStatusTool({ q, chain: openChain() });
  const r = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(r.tokenId, 1);
  assert.equal(r.lastDay, 5);
  assert.equal(r.owner, "0xabc");
});

test("status with an id the CHAIN does not have either is unknown-token", async () => {
  const q = queries(openDb(":memory:"));
  const chain = openChain({ lifecycleOf: async () => ({ exists: false, resting: false, sunset: false, level: 0, lastDay: 0 }) });
  const tool = makeStatusTool({ q, chain });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown-token");
});

// C3.7. A mirror miss is not an absence. This service can be behind the chain
// -- a token minted straight on chain, or one whose reconcile has not run --
// and telling the holder of a real token that it does not exist is the shape
// of bug that makes an agent report the piece as broken and stop.
test("status distinguishes a token the chain HAS from one that does not exist", async () => {
  const q = queries(openDb(":memory:"));
  const tool = makeStatusTool({ q, chain: openChain() });   // stub: the chain has it
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "not-yet-mirrored");
});

test("status refuses rather than guesses when the chain cannot be read", async () => {
  const q = queries(openDb(":memory:"));
  const chain = openChain({ lifecycleOf: async () => null });
  const tool = makeStatusTool({ q, chain });
  const r = await tool.handler({ tokenId: 99 }, { keyId: "k1" });
  assert.equal(r.reason, "chain-unavailable");
});

test("CONTROL: status with no tokenId returns only tokens bound to the caller's key", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 0, mintDay: 0 });
  q.insertToken({ tokenId: 2, keyId: "k2", owner: "0xdef", lastDay: 0, mintDay: 0 });
  const tool = makeStatusTool({ q, chain: openChain() });
  const r = await tool.handler({}, { keyId: "k1" });

  assert.equal(r.ok, true);
  assert.equal(r.tokens.length, 1);
  assert.equal(r.tokens[0].tokenId, 1);
  // The other agent's token must never appear here, whatever its shape --
  // this is the assertion that would catch a status tool leaking another
  // agent's holdings.
  assert.ok(!r.tokens.some((t) => t.tokenId === 2));
});

// ---------------------------------------------------------------------------
// The whole result shape -- test gap 40 / finding 5.M3
// ---------------------------------------------------------------------------

// Every test above checks three or four fields and the caller-scoping rule, so
// a field could be renamed, dropped or silently emptied and nothing here would
// notice. That matters because this result IS the piece's answer to "what is my
// token" -- an agent has no human-facing page to fall back on, and the fields
// are a published contract (spec section 6, and the raw protocol document).
//
// Asserted as an EXACT set rather than a subset. A subset check cannot see a
// field that quietly disappears, and it cannot see a new one appear either --
// and a new field in a published answer is a wire change that belongs in the
// protocol document before it ships.
test("a token view carries exactly the published field set", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const tool = makeStatusTool({
    q,
    chain: openChain(),
    links: { docs: "https://example.com/llms.txt", mcp: "https://example.com/mcp", contract: "0xc0de", chainId: 84532 },
  });

  const view = await tool.handler({ tokenId: 1 }, { keyId: "k1" });

  assert.deepEqual(
    Object.keys(view).sort(),
    [
      "chainId", "children", "contract", "docs", "generation", "heart", "lastDay",
      "late", "level", "marks", "mcp", "nextWindowOpensAt", "onChainBy", "owner",
      "parentId", "pendingOnChain", "resting", "streak", "streakDeadline",
      "tokenId", "whole", "years",
    ],
    "the published shape changed: update the protocol document and llms.txt in the same commit",
  );
});

// The two fields that only exist while a token is waiting. A view of a WRITTEN
// token must not carry them: "on chain by" and "late" are meaningless once it
// is on chain, and an agent branching on their presence would read a settled
// token as still pending.
test("onChainBy and late appear only while the token is not on chain", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 100, mintDay: 100 });
  const tool = makeStatusTool({ q, chain: openChain() });

  const pending = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  assert.equal(pending.pendingOnChain, true);
  assert.equal(typeof pending.onChainBy, "string");
  assert.equal(typeof pending.late, "boolean");

  q.markMintWritten?.(1) ?? q.setTokenWritten?.(1);
  const written = await tool.handler({ tokenId: 1 }, { keyId: "k1" });
  if (written.pendingOnChain === false) {
    assert.equal("onChainBy" in written, false, "a settled token must not carry a deadline to settle");
    assert.equal("late" in written, false);
  }
});

// The two dates an agent schedules its return by. They are the piece's whole
// subject -- when to come back -- and they are DERIVED from lastDay, so an
// off-by-one here breaks a run rather than a display.
test("the window and the deadline are one day apart, and derived from lastDay", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "k1", owner: "0xabc", lastDay: 20_700, mintDay: 20_600 });
  const tool = makeStatusTool({ q, chain: openChain() });

  const view = await tool.handler({ tokenId: 1 }, { keyId: "k1" });

  // The contract's rule is `lastDay < day <= today()`: the window opens at the
  // start of the day AFTER the last credited one, and the run survives only if
  // the credit lands inside that day.
  assert.equal(view.nextWindowOpensAt, new Date(20_701 * 86_400_000).toISOString());
  assert.equal(view.streakDeadline, new Date(20_702 * 86_400_000).toISOString());
  assert.equal(
    Date.parse(view.streakDeadline) - Date.parse(view.nextWindowOpensAt),
    86_400_000,
    "the window is exactly one day wide, as the contract enforces",
  );
});
