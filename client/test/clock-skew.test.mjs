// THE ONE REFUSAL A CLIENT CAN FIX BY BEING TOLD THE TIME.
//
// The door refuses a signature whose `created` is in its future, with no
// tolerance -- web-bot-auth's own rule. A machine whose clock is a minute fast
// is therefore refused every time, and until 2026-09-18 it was refused as
// `signature`, whose published prescription is "check you signed with the
// registered key and the right origin". Nothing in that advice mentions the
// clock, so an agent could follow it forever and never get in.
//
// The door now answers `clock-skew` and hands back its own time. This is the
// other half: the client re-signs against that time, once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDictionary } from "structured-headers";

import { rpc } from "../src/mcp.mjs";
import { generateIdentity } from "../src/keys.mjs";

const ORIGIN = "https://example.com";

/// The `created` parameter of a signature, in milliseconds.
function createdMsOf(headers) {
  const input = headers["Signature-Input"] ?? headers["signature-input"];
  assert.ok(input, "every signed request carries Signature-Input");
  for (const [, value] of parseDictionary(input)) {
    const params = Array.isArray(value) ? value[1] : null;
    const created = params?.get("created");
    if (typeof created === "number") return created * 1000;
  }
  assert.fail("no created parameter");
}

/**
 * A door that refuses the first signed request for clock skew and admits the
 * second, recording what it was sent both times.
 *
 * `serverNow` is deliberately BEHIND the test process's clock, which is the
 * real shape of the problem: the client is fast, the site is right.
 */
function skewedDoor({ serverNow, answerSkew = true }) {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    // The unsigned knock that collects a challenge.
    if (init.method !== "POST" || !init.headers?.["Signature-Input"]) {
      if (!init.headers?.["Signature-Input"]) {
        return new Response(JSON.stringify({ challenge: "c.1.m", expires: "z" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    }
    seen.push(init.headers);
    if (answerSkew === "always" || (seen.length === 1 && answerSkew)) {
      return new Response(
        JSON.stringify({
          reason: "clock-skew",
          challenge: "c.1.m",
          expires: "z",
          serverTime: new Date(serverNow).toISOString(),
        }),
        { status: 401, headers: { "content-type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, seen };
}

/// The client's OWN key generation, not a test-only stand-in: a double that
/// produced a differently-shaped key would prove nothing about the real path.
async function aKey() {
  const { privateJwk } = await generateIdentity();
  return privateJwk;
}

test("a clock-skew refusal is retried once, signed against the SITE's clock", async () => {
  const privateJwk = await aKey();
  // The site is two minutes behind this process, so everything this process
  // signs looks like the future to it.
  const serverNow = Date.now() - 2 * 60_000;
  const { fetchImpl, seen } = skewedDoor({ serverNow });

  const answer = await rpc({
    origin: ORIGIN,
    site: ORIGIN,
    privateJwk,
    signatureAgent: ORIGIN,
    method: "tools/list",
    fetchImpl,
  });

  assert.deepEqual(answer.result, { ok: true }, "the retry must actually get in");
  assert.equal(seen.length, 2, "exactly one retry, never a loop");

  const first = createdMsOf(seen[0]);
  const second = createdMsOf(seen[1]);
  assert.ok(first > serverNow, "the first attempt was stamped in the site's future -- that is the bug");
  assert.ok(
    Math.abs(second - serverNow) < 5_000,
    `the retry must be stamped in the site's present, got ${second - serverNow} ms away`
  );
});

test("a site that answers clock-skew to everything gets two requests, then an error", async () => {
  const privateJwk = await aKey();
  const { fetchImpl, seen } = skewedDoor({ serverNow: Date.now() - 2 * 60_000, answerSkew: "always" });

  await assert.rejects(
    () => rpc({ origin: ORIGIN, site: ORIGIN, privateJwk, signatureAgent: ORIGIN, method: "tools/list", fetchImpl }),
    /clock-skew/,
    "the second refusal is reported, not retried again"
  );
  assert.equal(seen.length, 2, "one retry and no more");
});

test("a clock-skew refusal with NO serverTime is not retried", async () => {
  // Nothing to correct against, so a retry would reproduce the same refusal.
  const privateJwk = await aKey();
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    if (!init.headers?.["Signature-Input"]) {
      return new Response(JSON.stringify({ challenge: "c.1.m", expires: "z" }), { status: 401 });
    }
    seen.push(init.headers);
    return new Response(JSON.stringify({ reason: "clock-skew", challenge: "c.1.m", expires: "z" }), { status: 401 });
  };

  await assert.rejects(
    () => rpc({ origin: ORIGIN, site: ORIGIN, privateJwk, signatureAgent: ORIGIN, method: "tools/list", fetchImpl }),
    /clock-skew/
  );
  assert.equal(seen.length, 1, "no retry without a time to retry against");
});
