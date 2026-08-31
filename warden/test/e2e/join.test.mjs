// THE END-TO-END JOIN. Every other test in this suite drives one module with
// its neighbours stubbed. This one starts the real server on an ephemeral port
// and walks the whole journey an agent actually takes:
//
//   1. register a fresh Ed25519 key through POST /keys (nonce first)
//   2. an unsigned POST /mcp gets a 401 carrying the way back in
//   3. the same request, signed and answered, is admitted
//   4. mint, with the facilitator mocked, returns a token id
//   5. checkin credits a day
//   6. GET /t/<id>, unsigned, tells a scanner exactly what `status` tells the
//      agent
//
// Step 6 is the one that would otherwise rot. The QR in every token's artwork
// points at /t/<id>. If a scanner and an agent are ever told two different
// stories about the same token, the artwork is lying. Both answers come from
// tokenView(), and this is the test that holds them together.
//
// Nothing here touches the network, a facilitator, a chain or the QR solver.
// The solve is ten seconds and half a gigabyte; it has no place in a suite
// that has to stay a few seconds long.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign as edSign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { signatureHeaders } from "web-bot-auth";
import { signerFromJWK } from "web-bot-auth/crypto";
import { createServer } from "../../src/server.mjs";
import { makeMcpHandler } from "../../src/mcp/server.mjs";
import { tokenView } from "../../src/mcp/tokenView.mjs";
import { openDb } from "../../src/mirror/db.mjs";
import { queries } from "../../src/mirror/queries.mjs";
import { utcDay } from "../../src/mcp/tools/checkin.mjs";

const DOMAIN = "example.com";
const SECRET = "e2e-secret";
const TO = "0x00000000000000000000000000000000000000a1";

// What a real client signs. The door checks exactly these four components, so
// signing fewer would be refused and signing more would not be read.
const CLIENT_COMPONENTS = ["@authority", "@method", "@path", "signature-agent"];

/**
 * Bring up the whole service the way a deployment does.
 *
 * The mirror is a FILE, not ":memory:", because the router and the MCP tools
 * each open their own connection: createServer opens config.stateDbPath itself
 * and never exposes its handle. Two ":memory:" opens would be two unrelated
 * databases, and a mint made through a tool would be invisible to /t/<id>.
 * A file is also what production has.
 */
function startJourney() {
  const dir = mkdtempSync(join(tmpdir(), "mro-e2e-"));
  const stateDbPath = join(dir, "mirror.db");

  const db = openDb(stateDbPath);
  const q = queries(db);
  const paidCalls = [];
  const alerts = [];
  // A CLOCK THE JOURNEY CAN ADVANCE. The contract mints with lastDay = today
  // and batchCheckIn reverts on day <= lastDay, so a real agent's first
  // check-in is the day AFTER it minted. Journeying entirely inside one UTC
  // day would test a sequence the chain refuses -- and this test asserted
  // exactly that until 2026-08-30.
  const clock = { offset: 0 };

  const mcp = makeMcpHandler({
    q,
    // The facilitator, mocked at exactly the seam makePaid() occupies: paid()
    // takes a handler and returns a callable. Passing the handler straight
    // through settles nothing and reaches no network, while still proving the
    // tool runs its work INSIDE the payment wrapper rather than beside it.
    paid: (handler) => (args, ctx) => {
      paidCalls.push(args);
      return handler(args, ctx);
    },
    supplyCap: 5555,
    today: () => utcDay() + clock.offset,
    catalogue: { 1: { name: "Vein", price: "$1", minLevel: 1, supply: 10 } },
    // A null from the chain means "could not be reached", which checkin treats
    // as a refusal. Our caller is the bound key, so this is never consulted.
    chain: { boundKeyOf: async () => null },
    contract: "0xcontract",
    llmsTxt: "# machine readable only",
    challengeSecret: SECRET,
    domain: DOMAIN,
    alert: (message) => alerts.push(message),
  });

  const server = createServer({
    stateDbPath,
    domain: DOMAIN,
    challengeSecret: SECRET,
    // THE SHARED VIEW. The same function the status tool calls.
    tokenView,
    mcp,
    allowRegistration: () => true,
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${port}`,
        paidCalls,
        alerts,
        clock,
        // The same handle the tools write through, so an assertion can read
        // the row a tool claims to have written rather than only its answer.
        db,
        q,
        /// Close everything this journey opened: the listener, the second
        /// database handle, and the temp directory. A test that leaves a
        /// listener behind holds the whole suite open.
        async stop() {
          await new Promise((done) => server.close(done));
          db.close();
          rmSync(dir, { recursive: true, force: true });
        },
      });
    });
  });
}

/// Register a fresh key through the real endpoints: a nonce this server minted,
/// signed with the private half, spent on use.
async function registerKey(base) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });

  const nonceRes = await fetch(`${base}/keys/nonce`);
  assert.equal(nonceRes.status, 200);
  const { nonce } = await nonceRes.json();

  const proof = edSign(null, Buffer.from(nonce), privateKey).toString("base64url");
  const res = await fetch(`${base}/keys`, {
    method: "POST",
    body: JSON.stringify({ jwk: publicJwk, nonce, proof }),
  });
  const body = await res.json();
  assert.equal(res.status, 201, `registration failed: ${JSON.stringify(body)}`);
  return { privateJwk, keyId: body.keyId, nonce };
}

/// The signature headers a client mints for one request. The URL signed is the
/// CONFIGURED domain, not the loopback address the socket goes to: the door
/// pins @authority to its own domain, which is what a client behind nginx sees.
async function signHeaders(privateJwk, path) {
  const signer = await signerFromJWK(privateJwk);
  const message = {
    method: "POST",
    url: `https://${DOMAIN}${path}`,
    headers: { "signature-agent": `"https://${DOMAIN}"`, host: DOMAIN },
  };
  const created = new Date();
  const headers = await signatureHeaders(message, signer, {
    created,
    expires: new Date(created.getTime() + 60_000),
    components: CLIENT_COMPONENTS,
  });
  return { headers: { ...message.headers, ...headers }, keyId: signer.keyid };
}

const answerFor = (challenge, keyId) => createHash("sha256").update(challenge + keyId).digest("hex");

/// One JSON-RPC call over the real door: ask for a challenge, sign, answer,
/// send. A challenge is burned on use, so every call mints its own.
async function callMcp(base, privateJwk, payload) {
  const challengeRes = await fetch(`${base}/mcp`, { method: "POST" });
  assert.equal(challengeRes.status, 401);
  const { challenge } = await challengeRes.json();

  const { headers, keyId } = await signHeaders(privateJwk, "/mcp");
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: {
      ...headers,
      challenge,
      "challenge-response": answerFor(challenge, keyId),
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...payload }),
  });
  const text = await res.text();
  // `sent` carries the exact headers this call signed with, so a test can
  // reproduce what the door hashed rather than trusting a copy of it.
  return { status: res.status, text, sent: headers, body: res.status === 200 ? parseRpc(text) : undefined };
}

/// A header by name, case-blind, the way the door reads them.
const sentHeader = (headers, name) =>
  headers[Object.keys(headers).find((k) => k.toLowerCase() === name)];

/// The 2026-07-28 transport answers over SSE, so the JSON-RPC message arrives
/// on a `data:` line rather than as the whole body.
function parseRpc(text) {
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice("data: ".length) : text);
}

/// The structured result of a tools/call, refusing to guess when the call
/// itself failed -- a JSON-RPC error would otherwise read as an empty result.
function toolResult(body) {
  assert.equal(body.error, undefined, `JSON-RPC error: ${JSON.stringify(body.error)}`);
  assert.equal(body.result.isError, undefined, `tool refused: ${JSON.stringify(body.result)}`);
  return body.result.structuredContent;
}

test("the whole join: register, refused, admitted, mint, check in, and scanned", async (t) => {
  const journey = await startJourney();
  const { base, paidCalls, alerts } = journey;
  let privateJwk;
  let keyId;
  let tokenId;

  try {
    await t.test("1. a fresh key registers through POST /keys with a minted nonce", async () => {
      const registered = await registerKey(base);
      privateJwk = registered.privateJwk;
      keyId = registered.keyId;
      assert.equal(typeof keyId, "string");

      // The nonce was spent. A second registration on the same nonce is the
      // replay this endpoint exists to refuse.
      const { publicKey, privateKey } = generateKeyPairSync("ed25519");
      const replay = await fetch(`${base}/keys`, {
        method: "POST",
        body: JSON.stringify({
          jwk: publicKey.export({ format: "jwk" }),
          nonce: registered.nonce,
          proof: edSign(null, Buffer.from(registered.nonce), privateKey).toString("base64url"),
        }),
      });
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).reason, "nonce");
    });

    await t.test("2. an unsigned POST /mcp is refused with everything needed to come back", async () => {
      const res = await fetch(`${base}/mcp`, { method: "POST" });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.deepEqual(Object.keys(body).sort(), ["challenge", "client", "docs", "expires", "mcp"]);
      assert.equal(body.mcp, `https://${DOMAIN}/mcp`);
      assert.equal(body.docs, `https://${DOMAIN}/llms.txt`);
      assert.equal(body.client, `https://${DOMAIN}/client.mjs`);
      assert.ok(Date.parse(body.expires) > 0);
    });

    await t.test("3. the same request, signed and answered, is admitted", async () => {
      const { status, body } = await callMcp(base, privateJwk, { method: "tools/list", params: {} });
      assert.notEqual(status, 401);
      assert.equal(status, 200);
      const names = body.result.tools.map((tool) => tool.name).sort();
      // The tools an agent's whole life here depends on. `mint` is listed
      // FIRST in this assertion for a reason: a tool that exists in the tree
      // but is never registered is unreachable, and only a test that lists
      // the live surface catches that.
      for (const name of ["mint", "checkin", "status", "upgrade", "challenge", "rebind", "rest", "seed"]) {
        assert.ok(names.includes(name), `tools/list is missing ${name}: ${names.join(", ")}`);
      }
    });

    await t.test("4. mint returns a token id, with the facilitator mocked", async () => {
      const { status, body } = await callMcp(base, privateJwk, {
        method: "tools/call",
        params: { name: "mint", arguments: { to: TO } },
      });
      assert.equal(status, 200);
      const result = toolResult(body);
      assert.equal(result.ok, true, `mint refused: ${JSON.stringify(result)}`);
      assert.equal(typeof result.tokenId, "number");
      assert.equal(result.to, TO);
      // The identity the door verified, not one the caller named.
      assert.equal(result.agentKeyId, keyId);
      assert.equal(result.txStatus, "queued");
      // The work happened inside the payment wrapper.
      assert.equal(paidCalls.length, 1);
      tokenId = result.tokenId;
    });

    await t.test("5. checkin is refused on the mint day and credits the day after", async () => {
      // THE MINT DAY IS NOT A CHECK-IN. The contract mints with
      // lastDay = today (MachineReadableOnly.sol:249) and batchCheckIn reverts
      // DayNotAdvanced on day <= lastDay (:314), so crediting today here would
      // put the mirror a level ahead of a chain write that will revert. The
      // unique (tokenId, day) index cannot catch this: on mint day it is empty.
      const sameDay = await callMcp(base, privateJwk, {
        method: "tools/call",
        params: { name: "checkin", arguments: { tokenId } },
      });
      const refused = toolResult(sameDay.body);
      assert.equal(refused.accepted, false, "a mint-day check-in must be refused");
      assert.equal(refused.reason, "already-credited-today");

      // Nothing moved, and nothing was written.
      const untouched = journey.q.getToken(tokenId);
      assert.equal(untouched.level, 1);
      assert.equal(untouched.streak, 1);
      assert.equal(untouched.lastDay, utcDay());
      assert.equal(
        journey.db.prepare("SELECT COUNT(*) AS n FROM credits WHERE tokenId = ?").get(tokenId).n,
        0,
        "a refused day must leave no credit row"
      );

      // A day passes. This is the first day an agent can actually claim.
      journey.clock.offset = 1;
      const firstDay = utcDay() + 1;

      const { status, body, sent } = await callMcp(base, privateJwk, {
        method: "tools/call",
        params: { name: "checkin", arguments: { tokenId } },
      });
      assert.equal(status, 200);
      const result = toolResult(body);
      assert.equal(result.accepted, true, `checkin refused: ${JSON.stringify(result)}`);
      assert.equal(result.creditedDay, firstDay);
      assert.equal(result.streak, 2, "the day after the mint day continues the streak");

      // THE CREDIT NAMES THE REQUEST THAT BOUGHT IT. credits.sigHash was
      // written by nobody -- `ctx.sigHash ?? ""` into a NOT NULL column --
      // because the door held the signature and the tool asked for it and
      // nothing joined them. It is the SHA-256 of the Signature header this
      // client actually sent, recomputed here from the header itself rather
      // than from a copy of the rule.
      const stored = journey.db
        .prepare("SELECT sigHash FROM credits WHERE tokenId = ? AND day = ?")
        .get(tokenId, firstDay);
      const expected = createHash("sha256").update(sentHeader(sent, "signature"), "utf8").digest("hex");
      assert.equal(stored.sigHash.length, 64);
      assert.notEqual(stored.sigHash, "", "the empty string is the bug this replaces");
      assert.equal(stored.sigHash, expected);

      // THE MIRROR ADVANCED, not just the credits table. It is the source of
      // truth for the tools, so a token that never grows here never grows at
      // all: /t/<id> and `status` reported level 1 forever, and upgrade's and
      // seed's gates judged a value nothing moved.
      const token = journey.q.getToken(tokenId);
      assert.equal(token.level, 2, "the mint left level 1; one credited day makes it 2");
      assert.equal(token.lastDay, firstDay);
      assert.equal(result.level, token.level);
      assert.equal(result.streak, token.streak);

      // The credit is a fact in the mirror, not just a hopeful answer: a
      // second call the same day is refused, now by the day guard (lastDay has
      // advanced to today) rather than by the unique index. The index is still
      // what decides a genuine race, which tools.test.mjs drives with 100
      // simultaneous calls.
      const again = await callMcp(base, privateJwk, {
        method: "tools/call",
        params: { name: "checkin", arguments: { tokenId } },
      });
      const repeat = toolResult(again.body);
      assert.equal(repeat.accepted, false);
      assert.equal(repeat.reason, "already-credited-today");
    });

    await t.test("6. GET /t/<id>, unsigned, tells a scanner what `status` tells the agent", async () => {
      // No signature, no challenge: this is a phone camera following the QR.
      const scanned = await fetch(`${base}/t/${tokenId}`);
      assert.equal(scanned.status, 200);
      const view = await scanned.json();

      const { body } = await callMcp(base, privateJwk, {
        method: "tools/call",
        params: { name: "status", arguments: { tokenId } },
      });
      const reported = toolResult(body);

      // The three fields the artwork itself draws. If these ever disagree the
      // QR is pointing at a different story than the token tells.
      assert.equal(view.level, reported.level);
      assert.equal(view.streak, reported.streak);
      assert.equal(view.heart, reported.heart);
      // Not vacuous: the fields have real values, so an all-undefined pair
      // cannot pass the comparison above.
      assert.equal(typeof view.level, "number");
      assert.equal(view.heart, `${Math.min(view.level, 365)}/365`);
      assert.equal(view.tokenId, tokenId);
      assert.equal(view.owner, TO);
      // Not level 1: both audiences are told the day that was credited in
      // step 5, which is the whole reason the mirror has to advance.
      assert.equal(view.level, 2);
      assert.equal(view.heart, "2/365");

      // Whole objects, not just the three fields: any future field must be
      // told the same way to both audiences.
      assert.deepEqual(view, reported);

      // An unknown token is a 404 to a scanner, never a 200 with an empty body.
      const miss = await fetch(`${base}/t/${tokenId + 999}`);
      assert.equal(miss.status, 404);
    });

    // Nothing in this journey should have needed the paid-but-unavailable
    // alarm. If it fired, an agent paid for something it did not get.
    assert.deepEqual(alerts, []);
  } finally {
    await journey.stop();
  }

  // The listener is gone, not merely asked to go.
  assert.equal(journey.server.listening, false);
});
