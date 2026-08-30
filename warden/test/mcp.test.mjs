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
