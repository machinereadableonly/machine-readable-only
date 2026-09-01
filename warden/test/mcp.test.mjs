import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMcpHandler } from "../src/mcp/server.mjs";
import { openChain } from "./chain-stub.mjs";

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

  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      // A caller trying to act as somebody else by naming a key id in the
      // arguments. It must have no effect: the tool reads only authInfo.
      params: { name: "checkin", arguments: { tokenId: 1, keyId: "impostor" } },
    }),
  });

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

  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "status", arguments: { tokenId: 1 } },
    }),
  });

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

  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "status", arguments: { tokenId: 1 } },
    }),
  });

  const res = await handler.fetch(req, {
    authInfo: { token: "n/a", clientId: "real-caller", scopes: [], extra: { keyId: "real-caller" } },
  });

  assert.equal(res.status, 200);
  const bodyText = await res.text();
  const dataLine = bodyText.split("\n").find((line) => line.startsWith("data: "));
  const payload = JSON.parse(dataLine.slice("data: ".length));

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
  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...payload }),
  });
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

  const req = new Request("https://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "mint", arguments: { to: "0x" + "a1".repeat(20) } },
    }),
  });

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
