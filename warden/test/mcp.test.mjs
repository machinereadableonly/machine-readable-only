import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMcpHandler } from "../src/mcp/server.mjs";

test("the caller's key id reaches a tool from authInfo, never from an argument", async () => {
  const q = queries(openDb(":memory:"));
  q.insertToken({ tokenId: 1, keyId: "real-caller", owner: "0xabc", lastDay: 100, mintDay: 100 });

  const seen = [];
  const { handler } = makeMcpHandler({
    q,
    chain: { boundKeyOf: async () => null },
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
    chain: { boundKeyOf: async () => null },
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
    chain: { boundKeyOf: async () => null },
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
    chain: { boundKeyOf: async () => null },
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
    chain: { boundKeyOf: async () => null },
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
