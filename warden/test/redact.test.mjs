// 16.10. Nothing the Clock logs may carry the RPC endpoint's credential.
//
// The finding this closes named the wrong function and proposed the wrong fix,
// so this suite is built the other way round: it asks REAL viem errors, from
// REAL failing http requests, whether the credential survives -- rather than
// asserting against a hand-written string that only says what we already
// believe. A hand-built "viem-shaped" object would have passed against
// `err.shortMessage` and told us nothing, which is exactly the blindness
// recorded in [[stubs-hide-interface-drift]].
//
// The canary is a path segment shaped like an Alchemy key, because that is the
// shape `contracts/.env.example:33` recommends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

import { redactUrls, safeErrorText } from "../src/clock/redact.mjs";

const CANARY = "LEAKCANARY0123456789abcdef";

/// A server that answers every request the same way, on a free port.
async function serverThat(handler) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

/// The error a real viem call throws against `url`.
async function viemErrorFrom(url) {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(url, { retryCount: 0, timeout: 500 }),
  });
  try {
    await client.getBlockNumber();
  } catch (err) {
    return err;
  }
  throw new Error("expected the rpc call to fail, and it did not");
}

// ---------------------------------------------------------------------------
// redactUrls
// ---------------------------------------------------------------------------

test("a credential in the path is replaced, and the host is kept", () => {
  const out = redactUrls(`URL: https://base-mainnet.g.alchemy.com/v2/${CANARY}`);
  assert.equal(out, "URL: https://base-mainnet.g.alchemy.com/<redacted>");
});

test("a credential in the query string goes too", () => {
  const out = redactUrls(`https://rpc.example.com/?apiKey=${CANARY}`);
  assert.ok(!out.includes(CANARY));
  assert.equal(out, "https://rpc.example.com/<redacted>");
});

test("a credential in the authority goes, because URL.host excludes userinfo", () => {
  const out = redactUrls(`https://user:${CANARY}@rpc.example.com/v2`);
  assert.ok(!out.includes(CANARY));
  assert.equal(out, "https://rpc.example.com/<redacted>");
});

test("an endpoint with nothing after the host reads exactly as written", () => {
  // The endpoint in use today. Redacting a url that carries no credential would
  // make every ordinary outage harder to read for no gain.
  assert.equal(redactUrls("could not reach https://sepolia.base.org"), "could not reach https://sepolia.base.org");
});

test("every url in the text is redacted, not just the first", () => {
  const out = redactUrls(`a https://one.example.com/v2/${CANARY} b http://two.example.com/v2/${CANARY} c`);
  assert.equal(out.match(/<redacted>/g).length, 2);
  assert.ok(!out.includes(CANARY));
});

test("text with no url is untouched", () => {
  const text = "clock: token 7 day 20702 was refused (reverted-on-simulate) and needs a human";
  assert.equal(redactUrls(text), text);
});

test("something url-shaped that will not parse is dropped whole", () => {
  // No host to preserve, so preserving nothing is the only safe answer.
  assert.equal(redactUrls("see http://:::/x"), "see <redacted-url>");
});

// ---------------------------------------------------------------------------
// safeErrorText, against genuine viem errors
// ---------------------------------------------------------------------------

test("a connection refused error does not carry the credential", async () => {
  // Port 9 is discard: reliably nothing listening, and instant.
  const err = await viemErrorFrom(`http://127.0.0.1:9/v2/${CANARY}`);
  assert.ok(err.message.includes(CANARY), "precondition: viem's raw message DOES leak it");
  assert.ok(!safeErrorText(err).includes(CANARY));
});

test("an http error from the provider does not carry the credential", async () => {
  // What an expired or revoked key actually returns.
  const s = await serverThat((_req, res) => {
    res.writeHead(401, { "content-type": "text/plain" });
    res.end("Must be authenticated!");
  });
  try {
    const err = await viemErrorFrom(`http://127.0.0.1:${s.port}/v2/${CANARY}`);
    assert.ok(err.message.includes(CANARY), "precondition: viem's raw message DOES leak it");
    assert.ok(!safeErrorText(err).includes(CANARY));
  } finally {
    await s.close();
  }
});

test("a json-rpc error object does not carry the credential", async () => {
  const s = await serverThat((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "header not found" } }));
  });
  try {
    const err = await viemErrorFrom(`http://127.0.0.1:${s.port}/v2/${CANARY}`);
    assert.ok(err.message.includes(CANARY), "precondition: viem's raw message DOES leak it");
    assert.ok(!safeErrorText(err).includes(CANARY));
  } finally {
    await s.close();
  }
});

test("a timeout does not carry the credential", async () => {
  const s = await serverThat(() => { /* never respond */ });
  try {
    const err = await viemErrorFrom(`http://127.0.0.1:${s.port}/v2/${CANARY}`);
    assert.ok(err.message.includes(CANARY), "precondition: viem's raw message DOES leak it");
    assert.ok(!safeErrorText(err).includes(CANARY));
  } finally {
    await s.close();
  }
});

test("the failure is still diagnosable: the cause and the host survive", async () => {
  const err = await viemErrorFrom(`http://127.0.0.1:9/v2/${CANARY}`);
  const text = safeErrorText(err);
  assert.match(text, /HTTP request failed/);
  assert.ok(text.length > 0 && text.length <= 300);
});

test("a plain Error carrying a url is redacted too, not only a viem one", () => {
  // shortMessage is absent here, so this exercises the message fallback --
  // the half a fix aimed only at viem's shape would leave open.
  const err = new Error(`could not reach https://rpc.example.com/v2/${CANARY}`);
  assert.ok(!safeErrorText(err).includes(CANARY));
});

test("a non-Error value does not throw and does not leak", () => {
  assert.equal(safeErrorText(`https://rpc.example.com/v2/${CANARY}`), "https://rpc.example.com/<redacted>");
  assert.equal(safeErrorText(undefined), "undefined");
});

test("a very long provider error cannot flood an appended log", () => {
  const err = new Error("x".repeat(5000));
  assert.equal(safeErrorText(err).length, 300);
});
