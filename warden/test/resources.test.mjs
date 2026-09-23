// What `mro://contract` publishes about the five finisher Marks.
//
// THE RULING THIS PINS (2026-09-23). The catalogue resource serves the WHOLE
// ladder, and since the finisher Marks landed that includes ids 11-15. They are
// kept there on purpose: they exist on chain, `upgradeOf` answers for them, and
// an agent weighing up a year of daily returns should be able to read that the
// first token to finish takes an Apex and that there is only one. Hiding a
// thing the chain will tell anyone is not a simplification, it is a Warden that
// disagrees with its own contract.
//
// What that costs is a NEW WAY TO MISREAD THE PAGE: a row in a catalogue beside
// nine priced rows looks buyable. So the two facts that make it unbuyable are
// asserted on the SERVED bytes rather than on the catalogue object -- a price
// that is absent, and an `upgrade` tool whose argument will not accept the id.
// If either ever stops being true, this resource is selling something that
// cannot be sold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/mirror/db.mjs";
import { queries } from "../src/mirror/queries.mjs";
import { makeMcpHandler } from "../src/mcp/server.mjs";
import { openChain } from "./chain-stub.mjs";
import { LADDER, FINISHER_IDS } from "../src/mcp/ladder.mjs";
import { envelope } from "./mcp-envelope.mjs";

/// One JSON-RPC call straight at the handler. The 2026-07-28 transport answers
/// over SSE, so the message arrives on a `data:` line rather than as the body.
async function call(handler, payload) {
  const { raw, headers } = envelope(payload);
  const req = new Request("https://example.com/mcp", { method: "POST", headers, body: raw });
  const res = await handler.fetch(req, {
    authInfo: { token: "n/a", clientId: "caller", scopes: [], extra: { keyId: "caller" } },
  });
  const text = await res.text();
  const line = text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line ? line.slice("data: ".length) : text);
}

function handler() {
  return makeMcpHandler({
    q: queries(openDb(":memory:")),
    chain: openChain(),
    contract: "0xcontract",
    chainId: 84532,
    llmsTxt: "# machine readable only",
    catalogue: LADDER,
  }).handler;
}

async function servedCatalogue() {
  const body = await call(handler(), { method: "resources/read", params: { uri: "mro://contract" } });
  return JSON.parse(body.result.contents[0].text).catalogue;
}

test("mro://contract serves the five finisher Marks, and serves them as given", async () => {
  const catalogue = await servedCatalogue();
  for (const id of FINISHER_IDS) {
    const row = catalogue[id];
    assert.ok(row, `mark ${id} is missing from the served catalogue`);
    assert.equal(row.route, "finisher", `mark ${id} is served under the wrong route`);
    // JSON drops an undefined value, so the served row carries no `price` key at
    // all -- which is the honest shape for a Mark that has no price. `route`
    // says what it is; `priceUsdc6` is the number the chain publishes.
    assert.equal(row.price, undefined, `mark ${id} is served with a price`);
    assert.equal(row.priceUsdc6, 0, `mark ${id} is served priced on chain`);
    assert.equal(row.needsWhole, true, `mark ${id} must be served as whole-only`);
  }
  assert.deepEqual(FINISHER_IDS.map((id) => catalogue[id].name),
    ["Aorta", "Chamber", "Valve", "Atrium", "Apex"]);
  assert.deepEqual(FINISHER_IDS.map((id) => catalogue[id].supply),
    [null, 50, 10, 3, 1], "Aorta's Infinity serialises to null; the four caps survive JSON");
});

test("the five pairs are still served beside them, priced", async () => {
  // The control. Every assertion above is about something being ABSENT, and a
  // catalogue that failed to serve at all would satisfy all of them.
  const catalogue = await servedCatalogue();
  assert.equal(catalogue[1].name, "Hush");
  assert.equal(catalogue[1].price, "$1.00");
  assert.equal(catalogue[7].price, "$1250.00");
});

test("no finisher id is accepted by the upgrade tool's argument", async () => {
  const body = await call(handler(), { method: "tools/list", params: {} });
  const byName = Object.fromEntries(body.result.tools.map((t) => [t.name, t]));
  const upgradeId = byName.upgrade.inputSchema.properties.upgradeId;

  assert.equal(upgradeId.maximum, 10, "the served bound is what refuses a finisher id");
  for (const id of FINISHER_IDS) {
    assert.ok(id > upgradeId.maximum, `mark ${id} is inside the range an agent may ask for`);
  }
  // And the schema says so in words as well, for an agent that reads the
  // description and never validates against the bound.
  assert.ok(upgradeId.description.includes("cannot be requested"),
    "the argument must say why a finisher id is refused");
});
