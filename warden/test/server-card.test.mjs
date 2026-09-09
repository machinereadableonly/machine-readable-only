// The MCP discovery card, and the two ways a card rots.
//
// A card is a promise made to a reader who cannot check it: a directory that
// indexes ours will believe whatever it says about the endpoint, the version
// and the protocol. So the promises are pinned here BY VALUE against the
// things they describe, not merely asserted to be well-formed.
//
// MUTATION-CHECKED WHEN WRITTEN, three ways, and each turned exactly the
// intended test red:
//   server.json's version -> 9.9.9        the version guard
//   SERVER_INFO's version -> 2.0.0        the version guard, from the other side
//   the served body doctored in flight    the byte-for-byte guard
// The second of those is the one worth keeping: a card and a server can drift
// apart from EITHER end, and measuring one direction does not license the
// other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../src/server.mjs";
import { SERVER_INFO } from "../src/mcp/server.mjs";

const CARD_PATH = new URL("../../server.json", import.meta.url);
const RAW = readFileSync(CARD_PATH, "utf8");
const CARD = JSON.parse(RAW);

const DOMAIN = "example.com";

async function startServer(overrides = {}) {
  const config = {
    stateDbPath: ":memory:",
    domain: DOMAIN,
    challengeSecret: "s".repeat(32),
    tokenView: () => null,
    mcp: { nodeHandler: (req, res) => { res.writeHead(200); res.end("mcp"); } },
    allowRegistration: () => true,
    contract: "0x00000000000000000000000000000000000C0DE0",
    chainId: 84532,
    serverCard: RAW,
    ...overrides,
  };
  const server = createServer(config);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

// -- the document itself ----------------------------------------------------

test("the card satisfies the registry schema's own constraints", () => {
  // Checked against https://static.modelcontextprotocol.io/schemas/2025-12-11/
  // server.schema.json, read on 2026-09-07. The 2025-09-29 schema was the
  // first one found and is NOT current -- the live registry serves entries
  // stamped 2025-12-11 -- which is why the version is pinned here rather than
  // left to whatever a search turns up next time.
  assert.equal(
    CARD.$schema,
    "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json"
  );
  for (const k of ["name", "description", "version"]) {
    assert.ok(CARD[k], `${k} is required by the schema`);
  }
  assert.match(CARD.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/, "name must be reverse-DNS with one slash");
  assert.ok(CARD.description.length <= 100, `description is ${CARD.description.length} chars, max is 100`);
  assert.equal(CARD.remotes.length, 1);
  assert.equal(CARD.remotes[0].type, "streamable-http");
});

test("the card's version is the version the MCP server actually reports", () => {
  // The card publishes a version to directories that will never call
  // `initialize` to check it. Pinned against SERVER_INFO, which is what the
  // handler passes to McpServer -- so bumping one without the other goes red
  // here rather than shipping a card that quietly describes a different build.
  assert.equal(CARD.version, SERVER_INFO.version);
  // The registry name is namespaced and the MCP name is not, so they cannot be
  // equal; what must hold is that the card's server half names the same thing.
  assert.equal(CARD.name.split("/")[1], SERVER_INFO.name);
});

test("the card points at THIS piece and nowhere else", () => {
  // A card naming another host would hand every agent that reads it to
  // somebody else's server, and nothing in the schema would object.
  assert.equal(CARD.remotes[0].url, "https://machinereadableonly.com/mcp");
  assert.equal(CARD.websiteUrl, "https://machinereadableonly.com/llms.txt");
  assert.ok(CARD.name.startsWith("com.machinereadableonly/"));
});

test("the card names the public repository", () => {
  // INVERTED 2026-09-09, the day C4.4 landed and the repository went public.
  // This test previously asserted `repository` was ABSENT, because publishing
  // one while the repo was private would have pointed every reader at a 404.
  // It is kept as an assertion rather than deleted: the url is a promise to a
  // reader who cannot check it, and it must name the repository the skill
  // install line and the npm provenance also name, or the three disagree.
  assert.ok(CARD.repository, "the repository is public now; the card must name it");
  assert.equal(
    CARD.repository.url,
    "https://github.com/machinereadableonly/machine-readable-only"
  );
  assert.equal(CARD.repository.source, "github");
});

test("the card states the entry condition rather than leaving a client to discover a 401", () => {
  // The endpoint answers 401 to an unsigned request BY DESIGN. A card that
  // advertised a plain streamable-http url and said nothing else would be
  // technically true and practically a trap: the reader would connect, be
  // refused, and have no way to know that was expected.
  const meta = CARD._meta["com.machinereadableonly/entry"];
  assert.ok(meta, "the entry condition must be stated in _meta");
  assert.match(meta.requires, /RFC 9421/);
  assert.equal(meta.docs, "https://machinereadableonly.com/llms.txt");
});

// -- what is actually served ------------------------------------------------

test("every discovery path serves the card, byte for byte", async () => {
  // BY VALUE against server.json, so a served copy can never advertise a stale
  // endpoint or version. Four paths: the three a sibling project MEASURED
  // agents asking for, plus SEP-2127's plural spelling. That SEP was an open
  // PR when this was written and the filename was still moving, so serving one
  // and being right is luck rather than design.
  const { server, base } = await startServer();
  try {
    for (const path of [
      "/.well-known/mcp.json",
      "/.well-known/mcp",
      "/.well-known/mcp/server-card.json",
      "/.well-known/mcp/server-cards.json",
    ]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200, `${path} should serve the card`);
      assert.match(res.headers.get("content-type"), /application\/json/, `${path} content-type`);
      assert.equal(await res.text(), RAW, `${path} differs from server.json`);
    }
  } finally {
    server.close();
  }
});

test("the card is served WITHOUT a signature, like llms.txt", async () => {
  // The whole point. A directory or crawler that indexes cards does not sign,
  // and does not read the body of a 401. If this ever returns 401 the card is
  // invisible to exactly the reader it exists for.
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/.well-known/mcp.json`);
    assert.equal(res.status, 200);
  } finally {
    server.close();
  }
});

test("a Warden with no card 404s the paths rather than throwing", async () => {
  // Same shape as the door and llms.txt: a missing document must not take
  // every request down.
  const { server, base } = await startServer({ serverCard: undefined });
  try {
    const res = await fetch(`${base}/.well-known/mcp.json`);
    assert.equal(res.status, 404);
  } finally {
    server.close();
  }
});

test("/.well-known/x402 is still NOT served", async () => {
  // The inverse rule, and the one that matters more than the card: only
  // advertise a capability you have. The treasury is a placeholder, so a
  // payment manifest would tell an agent it can pay us when it cannot.
  const { server, base } = await startServer();
  try {
    const res = await fetch(`${base}/.well-known/x402`);
    assert.notEqual(res.status, 200, "x402 must not be advertised while the treasury is a placeholder");
  } finally {
    server.close();
  }
});
