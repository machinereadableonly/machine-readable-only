import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMcpHandler } from "../src/mcp/server.mjs";
import { openChain } from "./chain-stub.mjs";
import { LADDER, ladderSentence } from "../src/mcp/ladder.mjs";
import { envelope } from "./mcp-envelope.mjs";

test("the caller's key id reaches a tool from authInfo, never from an argument", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "real-caller", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const seen = [];
  const { handler } = makeMcpHandler({
    q,
    chain: openChain(),
    contract: "0xcontract",
    onToolCall: (name, ctxKeyId) => seen.push([name, ctxKeyId]),
  });

  const built = envelope({ method: "tools/call",
      // A caller trying to act as somebody else by naming a key id in the
      // arguments. It must have no effect: the tool reads only authInfo.
      params: { name: "checkin", arguments: { tokenId: 1, keyId: "impostor" } },
  });
  const req = new Request("https://example.com/mcp", { method: "POST", headers: built.headers, body: built.raw });

  const res = await handler.fetch(req, {
    authInfo: { token: "n/a", clientId: "real-caller", scopes: [], extra: { keyId: "real-caller" } },
  });

  assert.equal(res.status, 200);
  assert.deepEqual(seen[0], ["checkin", "real-caller"]);
});

test("an unexpected throw from a tool handler never leaks its message to the caller", async () => {
  // A SQLite-shaped failure message carrying a file path, exactly the kind of
  // string createToolError would otherwise hand back verbatim.
  const secretMessage = "unable to open database file: /home/secret/state.db";
  const realQ = queries(openDb(":memory:"));
  const q = {
    ...realQ,
    getToken() {
      throw new Error(secretMessage);
    },
  };

  const { handler } = makeMcpHandler({
    q,
    chain: openChain(),
    contract: "0xcontract",
  });

  const built = envelope({ method: "tools/call",
      params: { name: "status", arguments: { tokenId: 1 } },
  });
  const req = new Request("https://example.com/mcp", { method: "POST", headers: built.headers, body: built.raw });

  const res = await handler.fetch(req, {
    authInfo: { token: "n/a", clientId: "caller", scopes: [], extra: { keyId: "caller" } },
  });

  assert.equal(res.status, 200);
  const bodyText = await res.text();
  // Assert on the whole serialised response, not just one field -- the leak
  // could land in content[].text, structuredContent, or anywhere else.
  assert.ok(!bodyText.includes(secretMessage), "the raw error message must not reach the caller");
  assert.ok(!bodyText.includes("/home/secret/state.db"), "the leaked path must not reach the caller");
  assert.ok(bodyText.includes('"reason":"internal"'), "the caller should see the generic internal refusal");
});

test("CONTROL: a tool that returns normally still delivers its real structured result unchanged", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "real-caller", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const { handler } = makeMcpHandler({
    q,
    chain: openChain(),
    contract: "0xcontract",
  });

  const built = envelope({ method: "tools/call",
      params: { name: "status", arguments: { tokenId: 1 } },
  });
  const req = new Request("https://example.com/mcp", { method: "POST", headers: built.headers, body: built.raw });

  const res = await handler.fetch(req, {
    authInfo: { token: "n/a", clientId: "real-caller", scopes: [], extra: { keyId: "real-caller" } },
  });

  assert.equal(res.status, 200);
  const bodyText = await res.text();
  // The modern leg answers a single request with application/json; the legacy
  // leg wrapped the same message in an SSE `data:` line. Accept either, so
  // this test asserts the RESULT rather than the framing.
  const dataLine = bodyText.split("\n").find((line) => line.startsWith("data: "));
  const payload = JSON.parse(dataLine ? dataLine.slice("data: ".length) : bodyText);

  // The try/catch wrapper must be transparent on the success path: no
  // isError, and the tool's real structured result comes through untouched.
  assert.equal(payload.result.isError, undefined);
  assert.equal(payload.result.structuredContent.tokenId, 1);
  assert.equal(payload.result.structuredContent.owner, "0xabc");
});

/// One JSON-RPC call straight at the handler, with a chosen authInfo. The
/// 2026-07-28 transport answers over SSE, so the message arrives on a `data:`
/// line rather than as the whole body.
async function call(handler, payload, authInfo) {
  const { raw, headers } = envelope(payload);
  const req = new Request("https://example.com/mcp", { method: "POST", headers, body: raw });
  const res = await handler.fetch(req, { authInfo });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice("data: ".length) : text);
}

// credits.sigHash is the record of WHICH signed request bought a day, and it
// was set by nobody: checkin wrote `ctx.sigHash ?? ""` into a NOT NULL column
// while the door, which is the only thing that ever holds the signature, threw
// it away. It travels on authInfo.extra, the same channel as the key id, so
// nothing outside our own door can put a value there.
test("the sigHash the door computed reaches the tool through authInfo, and is stored", async () => {
  const db = openDb(":memory:");
  const q = queries(db);
  q.insertToken({ tokenId: 1, keyId: "real-caller", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const { handler } = makeMcpHandler({
    q,
    chain: openChain(),
    contract: "0xcontract",
    today: () => 200,
  });

  const sigHash = "f".repeat(64);
  const body = await call(
    handler,
    { method: "tools/call", params: { name: "checkin", arguments: { tokenId: 1 } } },
    { token: "n/a", clientId: "real-caller", scopes: [], extra: { keyId: "real-caller", sigHash } }
  );

  assert.equal(body.result.structuredContent.accepted, true);
  const row = db.prepare("SELECT sigHash FROM credits WHERE tokenId = 1 AND day = 200").get();
  assert.equal(row.sigHash, sigHash);
  assert.notEqual(row.sigHash, "", "the empty string is the bug this replaces");
});

// The chain id was a literal 8453 sitting beside an address read from the
// environment, so a Warden pointed at a Base Sepolia deployment published a
// mainnet chain id with a testnet address.
test("mro://contract publishes the configured chain id, not a hardcoded mainnet one", async () => {
  const q = queries(openDb(":memory:"));
  const { handler } = makeMcpHandler({
    q,
    chain: openChain(),
    contract: "0xsepolia-contract",
    chainId: 84532,
    llmsTxt: "# machine readable only",
  });

  const body = await call(
    handler,
    { method: "resources/read", params: { uri: "mro://contract" } },
    { token: "n/a", clientId: "caller", scopes: [], extra: { keyId: "caller" } }
  );

  const published = JSON.parse(body.result.contents[0].text);
  assert.deepEqual(published, { address: "0xsepolia-contract", chainId: 84532 });
  assert.notEqual(published.chainId, 8453, "the mainnet id must not survive a testnet configuration");
});

// THE MONEY BUG THIS PINS, and why it needs the official client to catch it.
//
// The paid tools' handlers are wrapped by @x402/mcp, which returns a COMPLETE
// MCP tool result: { structuredContent, content, isError: true }. The generic
// wrapper in server.mjs used to wrap that a second time, which buried isError
// one level down and left the outer result with none at all.
//
// x402MCPClient.extractPaymentRequiredFromResult opens with
// `if (!result.isError) return null`, so a paying agent using the official
// client was told the call SUCCEEDED and never saw the demand. Minting is the
// only way in, so that made the piece unenterable.
//
// Asserted through the LIBRARY's own extractor rather than by reading fields.
// The live check that was meant to prove payment worked used a regex over the
// raw JSON, which passes happily on a double-wrapped payload -- the check was
// looking at bytes instead of at the thing that has to work.
test("a payment demand survives the tool wrapper intact for the official x402 client", async () => {
  const { x402MCPClient } = await import("@x402/mcp");
  const q = queries(openDb(":memory:"));

  // Exactly what @x402/mcp's createPaymentWrapper hands back when a paid tool
  // is called with no payment attached.
  const demand = {
    x402Version: 2,
    error: "Payment required to access this tool",
    resource: { url: "mcp://tool/mint", serviceName: "machine-readable-only" },
    accepts: [{
      scheme: "exact",
      network: "eip155:84532",
      amount: "1000000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x000000000000000000000000000000000000dEaD",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    }],
  };
  const wrapperResult = {
    structuredContent: demand,
    content: [{ type: "text", text: JSON.stringify(demand) }],
    isError: true,
  };

  const { handler } = makeMcpHandler({
    q,
    chain: openChain(),
    contract: "0xcontract",
    supplyCap: 10_000,
    // Stand in for the real gateway at the same seam pay.test.mjs uses: the
    // handler is never called, because an unpaid call is refused before it.
    paid: () => async () => wrapperResult,
  });

  const built = envelope({ method: "tools/call",
      params: { name: "mint", arguments: { to: "0x" + "a1".repeat(20) } },
  });
  const req = new Request("https://example.com/mcp", { method: "POST", headers: built.headers, body: built.raw });

  const res = await handler.fetch(req, {
    authInfo: { token: "n/a", clientId: "payer", scopes: [], extra: { keyId: "payer" } },
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data:"));
  const body = JSON.parse((line ?? text).replace(/^data:\s*/, ""));

  const client = Object.create(x402MCPClient.prototype);
  const found = client.extractPaymentRequiredFromResult(body.result);

  assert.ok(found, "the official x402 client must find a payment demand in the refusal");
  assert.equal(found.accepts[0].amount, "1000000");
  assert.equal(found.accepts[0].payTo, "0x000000000000000000000000000000000000dEaD");
});

// 14.7, THROUGH THE WHOLE PATH. The gateway's own refusals are produced
// OUTSIDE the payment wrapper -- a facilitator that will not build is the
// reachable one, and it is a normal transient -- and they used to come back as
// plain `{ ok: false }` values. mcp/server.mjs then wrapped them without
// `isError`, so a client branching on `isError` alone (which is what
// x402MCPClient does) saw something shaped like a success.
//
// The real gateway is used here, not a stub: a `build` that throws is the only
// thing standing in, because the seam being tested is everything downstream of
// it. Asserted on what an agent actually receives over the wire.
test("a facilitator outage reaches the agent as an ERROR result, not as a success shape", async () => {
  const { makePaymentGateway } = await import("../src/pay/x402.mjs");
  const paid = makePaymentGateway({
    facilitatorUrl: "https://facilitator.invalid.example/",
    network: "eip155:84532",
    payTo: "0x000000000000000000000000000000000000dEaD",
    alert: () => {},
    build: async () => { throw new Error("facilitator down"); },
  });
  const { handler } = makeMcpHandler({
    q: queries(openDb(":memory:")), chain: openChain(), contract: "0xcontract", chainId: 84532, paid,
  });

  const body = await call(handler, {
    method: "tools/call",
    params: { name: "mint", arguments: { to: "0x" + "a1".repeat(20) } },
  }, { token: "n/a", clientId: "k1", scopes: [], extra: { keyId: "k1" } });

  assert.equal(body.result.isError, true, "an agent must be able to tell this apart from a success");
  const refusal = JSON.parse(body.result.content[0].text);
  assert.equal(refusal.reason, "payment-unavailable");
  // And the next step survives: a complete tool result skips the wrapper's own
  // withNext, so the gateway has to apply it.
  assert.equal(typeof refusal.next, "string");
});

// C3.7, THE WIRING rather than the table. Every other test of the next-step
// table calls the helper directly, so removing withNext from the tool wrapper
// left all of them green: the table was proven and its one call site was not.
// This is the test that goes red when the central hook is gone.
test("a refusal that came through the real handler carries its next step", async () => {
  const { handler } = makeMcpHandler({
    q: queries(openDb(":memory:")), chain: openChain(), contract: "0xcontract", chainId: 84532,
  });
  const body = await call(handler, {
    method: "tools/call",
    params: { name: "checkin", arguments: { tokenId: 99 } },
  }, { token: "n/a", clientId: "k1", scopes: [], extra: { keyId: "k1" } });

  const refusal = JSON.parse(body.result.content[0].text);
  assert.equal(refusal.ok, false);
  assert.equal(typeof refusal.next, "string", "the wrapper must add the next step");
  assert.match(refusal.next, /00:05 UTC/);
});

// C3.6. tools/list is the one surface every MCP-speaking agent reads without
// being sent to a page, and it said `upgradeId: integer 1-10` -- ten integers
// and a regex, with the names, the prices and the pairing living only on pages
// the agent may never have opened. Asserted on the SERVED schema, because
// zod's .describe() reaching JSON Schema is the SDK's business, not ours.
test("the served schemas name what their arguments are, and the ladder is generated", async () => {
  const { handler } = makeMcpHandler({
    q: queries(openDb(":memory:")), chain: openChain(), contract: "0xcontract", chainId: 84532,
    catalogue: LADDER,
  });
  const body = await call(handler, { method: "tools/list", params: {} }, null);
  const byName = Object.fromEntries(body.result.tools.map((t) => [t.name, t]));

  const upgradeId = byName.upgrade.inputSchema.properties.upgradeId;
  // GENERATED, not typed: the sentence must equal what the catalogue produces,
  // so a price change moves both or fails here.
  assert.equal(upgradeId.description, ladderSentence(LADDER));
  assert.match(upgradeId.description, /1 hush bought \$1\.00/);
  assert.match(upgradeId.description, /closes the other permanently/);

  assert.match(byName.mint.inputSchema.properties.to.description, /will OWN the token/);
  assert.match(byName.rest.inputSchema.properties.tokenId.description, /seals it forever/);
  assert.match(byName.ladder.inputSchema.properties.tokenId.description, /not only your own/);

  // Every argument of every tool is described. A new one arriving bare is the
  // regression this catches.
  for (const tool of body.result.tools) {
    for (const [arg, schema] of Object.entries(tool.inputSchema.properties ?? {})) {
      assert.equal(typeof schema.description, "string", `${tool.name}.${arg} has no description`);
    }
  }
});

// -- the 2026-07-28 leg, asserted rather than assumed -----------------------
//
// Every request this project made used to take the SDK's LEGACY leg: no
// protocol claim in `_meta` meant the 2025-era compatibility path answered.
// Nothing could see it. `server/discover` returned "method not found" while
// the spec says a server MUST implement it, and no list result carried the
// ttlMs and cacheScope that SEP-2549 requires -- all three contradicted by
// this project's own documents. These tests fail on the legacy leg.

test("server/discover is implemented, and names the revision this server serves", async () => {
  const { handler } = makeMcpHandler({ q: queries(openDb(":memory:")), chain: openChain(), contract: "0xcontract" });
  const body = await call(handler, { method: "server/discover", params: {} }, null);

  assert.equal(body.error, undefined, `server/discover must exist: ${JSON.stringify(body.error)}`);
  assert.ok(body.result.supportedVersions.includes("2026-07-28"));
  assert.equal(body.result.resultType, "complete");
});

// C1.6. The SDK's type having an `instructions` field proves nothing about
// what reaches a caller, and the 2026-07-28 revision has no `initialize`
// result for it to ride on -- it is carried in DiscoverResult, which the spec
// describes as "optional natural-language guidance for LLMs on how to use this
// server effectively". So this asserts the wire, not the option.
test("server/discover carries one sentence of WHAT, not only nine HOWs", async () => {
  const { handler } = makeMcpHandler({ q: queries(openDb(":memory:")), chain: openChain(), contract: "0xcontract" });
  const body = await call(handler, { method: "server/discover", params: {} }, null);

  assert.equal(typeof body.result.instructions, "string", "the SDK must actually emit instructions");
  assert.match(body.result.instructions, /only admits programs/);
  assert.match(body.result.instructions, /mro:\/\/llms\.txt/, "it must point at the one document that explains the piece");
  assert.match(body.result.instructions, /rebind and rest never act/, "the two tools that surprise an agent must be named");
});

test("list and read results carry the cache fields the revision requires", async () => {
  const { handler } = makeMcpHandler({ q: queries(openDb(":memory:")), chain: openChain(), contract: "0xcontract" });

  const tools = await call(handler, { method: "tools/list", params: {} }, null);
  // ttlMs 0 is what an unconfigured server sends: a valid value meaning "do
  // not cache", and wrong for a list that changes only on redeploy.
  assert.ok(tools.result.ttlMs > 0, `tools/list ttlMs was ${tools.result.ttlMs}`);
  assert.equal(tools.result.cacheScope, "private");
  assert.equal(tools.result.resultType, "complete");

  const resources = await call(handler, { method: "resources/list", params: {} }, null);
  assert.ok(resources.result.ttlMs > 0);
  assert.equal(resources.result.cacheScope, "public");
});

test("a request with no protocol claim is refused, not quietly served by an older leg", async () => {
  // The regression this guards. Left at the SDK default, a claim-less request
  // is answered by a compatibility leg that a future release removes in one
  // line -- on a piece meant to run for years.
  const { handler } = makeMcpHandler({ q: queries(openDb(":memory:")), chain: openChain(), contract: "0xcontract" });
  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });

  const res = await handler.fetch(req, { authInfo: null });
  assert.notEqual(res.status, 200, "a legacy-shaped request must not be served");
});
