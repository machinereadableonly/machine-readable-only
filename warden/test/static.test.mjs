// The two public documents the piece serves over plain HTTP.
//
// These used to be nginx's job, served from disk with try_files. They moved
// into the Warden on 2026-09-03 for a reason worth recording: nginx runs as
// www-data, the repository lives under a home directory that is mode 0750,
// and www-data cannot traverse it. The template's answer was a copy at
// /srv/mro, which drifts from the repository every time the copy is not
// refreshed. Serving from the process that already owns the content removes
// both the permission problem and the drift.
//
// Both routes are PUBLIC and unsigned on purpose. The door page is what an
// arriving agent reads to learn there IS a door, and llms.txt is the
// instructions; gating either behind the signature check would mean the only
// readers are the ones who already know everything the documents say.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "../src/server.mjs";

const DOOR = "<!doctype html><title>door</title>";
const LLMS = "# what this piece is\n";
const PROTOCOL = "# The raw protocol\n\nSignature, Signature-Input, Signature-Agent, Content-Digest.\n";
const ROBOTS = "User-agent: *\nDisallow:\n";

async function start(overrides = {}) {
  const server = createServer({
    stateDbPath: ":memory:",
    domain: "example.com",
    challengeSecret: "s".repeat(43),
    tokenView: () => null,
    contract: "0x00000000000000000000000000000000000C0DE0", chainId: 84532,
    mcp: { nodeHandler: (req, res) => { res.writeHead(200); res.end("mcp"); } },
    allowRegistration: () => true,
    doorHtml: DOOR,
    llmsTxt: LLMS,
    robotsTxt: ROBOTS,
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("GET / serves the door page as html, unsigned", async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/html/);
    assert.equal(await res.text(), DOOR);
  } finally {
    server.close();
  }
});

test("GET /llms.txt serves the instructions as plain text, unsigned", async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/llms.txt`);
    assert.equal(res.status, 200);
    // text/plain, not markdown: llms.txt is a convention read by machines that
    // fetch it as text, and a markdown content-type makes some clients try to
    // render rather than read it.
    assert.match(res.headers.get("content-type"), /text\/plain/);
    assert.equal(await res.text(), LLMS);
  } finally {
    server.close();
  }
});

test("both documents carry an explicit content-length", async () => {
  // Without one the response is chunked, and a signing client that wants to
  // digest the body has to buffer to find out how much there is.
  const { server, base } = await start();
  try {
    for (const path of ["/", "/llms.txt"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(
        res.headers.get("content-length"),
        String(Buffer.byteLength(path === "/" ? DOOR : LLMS)),
        `content-length on ${path}`
      );
    }
  } finally {
    server.close();
  }
});

test("a non-GET on either document is refused, not served", async () => {
  const { server, base } = await start();
  try {
    for (const path of ["/", "/llms.txt"]) {
      const res = await fetch(`${base}${path}`, { method: "POST" });
      assert.notEqual(res.status, 200, `POST ${path} must not serve the document`);
    }
  } finally {
    server.close();
  }
});

test("the documents are served even when the door would refuse the caller", async () => {
  // The whole point: an unsigned, unknown visitor is exactly who needs to read
  // these. Proven by contrast -- the same unsigned caller is refused at /mcp.
  const { server, base } = await start();
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal((await fetch(`${base}/llms.txt`)).status, 200);
    const gated = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(gated.status, 401, "/mcp must still be gated");
  } finally {
    server.close();
  }
});

test("the two unbuilt documents 404, which is what llms.txt promises", async () => {
  // llms.txt tells every arriving agent that /client.mjs and /skill.md "both
  // 404". nginx used to make that true with try_files =404. Once nginx became
  // a pure proxy these fell through to the door and answered 401, which
  // contradicted the documentation AND was the wrong answer on its own terms:
  // 401 invites a caller to authenticate and try again, and no signature
  // produces a file that does not exist.
  const { server, base } = await start();
  try {
    for (const path of ["/client.mjs", "/skill.md"]) {
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 404, `${path} must 404, not 401`);
    }
  } finally {
    server.close();
  }
});

// -- robots.txt -------------------------------------------------------------
//
// Added 2026-09-16, after an outside-in probe measured /robots.txt answering
// 401 to an unsigned request. The gate bought nothing there: RFC 9309 section
// 2.3.1.3 says that if the status code indicates robots.txt is UNAVAILABLE --
// which every 4xx is -- "the crawler MAY access any resources on the server".
// So a gated robots.txt is not a stricter robots.txt, it is NO robots.txt,
// and it costs us the ability to state any rule at all.
//
// It is public for the same reason the door page, llms.txt and the discovery
// card are: the reader it exists for is the one who has not been admitted.

test("GET /robots.txt serves rules as plain text, unsigned", async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/robots.txt`);
    assert.equal(res.status, 200, "a 4xx here means 'no rules', not 'no crawling'");
    assert.match(res.headers.get("content-type"), /text\/plain/);
    assert.equal(await res.text(), ROBOTS);
    assert.equal(res.headers.get("content-length"), String(Buffer.byteLength(ROBOTS)));
  } finally {
    server.close();
  }
});

test("robots.txt is served even when the door would refuse the caller", async () => {
  // Proven by contrast, like the documents above: the same unsigned caller
  // that reads the rules is refused at /mcp.
  const { server, base } = await start();
  try {
    assert.equal((await fetch(`${base}/robots.txt`)).status, 200);
    const gated = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(gated.status, 401, "/mcp must still be gated");
  } finally {
    server.close();
  }
});

test("a Warden built without robots.txt 404s it rather than throwing", async () => {
  const { server, base } = await start({ robotsTxt: undefined });
  try {
    assert.equal((await fetch(`${base}/robots.txt`)).status, 404);
  } finally {
    server.close();
  }
});

// THE GUARD THAT MATTERS. A robots.txt is a list of urls written for a reader
// who will not check them, which is the same shape as the `/skill.md` promise
// this project shipped broken for weeks: llms.txt committed that the url would
// never move while the server answered 404 to it. Both halves were tested; the
// JOIN between them was not.
//
// So this reads the REAL file off disk and follows every path it names,
// exactly as a crawler would. An Allow: line pointing at nothing is the same
// defect wearing different clothes.
test("every path the real robots.txt names is actually served", async () => {
  const real = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  // `/t/` needs a token view to serve anything: the default helper answers
  // null for every id, and a 404 from that would be this test failing on its
  // own fixture rather than on the rules it is meant to check.
  // Two fixtures the default helper does not supply, both needed because the
  // rules name their paths: a token view for `/t/`, and a discovery card for
  // `/.well-known/`. Without them this test would fail on its own setup
  // rather than on the rules -- which is how it failed when first written.
  const { server, base } = await start({
    robotsTxt: real,
    tokenView: () => ({ tokenId: 1, level: 1 }),
    serverCard: JSON.stringify({ name: "com.machinereadableonly/machine-readable-only" }),
  });
  try {
    const allowed = real
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^allow:/i.test(line))
      .map((line) => line.slice(line.indexOf(":") + 1).trim())
      .filter(Boolean);

    assert.ok(allowed.length > 0, "a robots.txt that allows nothing explicitly states nothing");

    for (const path of allowed) {
      // A trailing slash in a robots rule is a PREFIX, not a fetchable url:
      // `/t/` matches `/t/1`. Follow a real member of the prefix instead, or
      // the test asserts against a path no agent would ever request.
      const probe = path === "/t/" ? "/t/1" : path === "/.well-known/" ? "/.well-known/mcp.json" : path;
      const res = await fetch(`${base}${probe}`);
      // 404 is the failure. 401 is fine and expected for /mcp: gated is not
      // the same as absent, and robots rules describe what may be CRAWLED,
      // not what may be entered without signing.
      assert.notEqual(res.status, 404, `robots.txt allows ${path}, which does not exist`);
    }
  } finally {
    server.close();
  }
});

test("robots.txt advertises no sitemap, because none is served", async () => {
  // The project's standing rule, stated in server.mjs beside /.well-known/x402
  // and proven there: only advertise a capability we HAVE. A Sitemap: line
  // pointing at a 401 or a 404 is the x402 mistake in a different file.
  const real = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
  assert.doesNotMatch(real, /^\s*sitemap:/im, "no sitemap is served, so none may be named");
});

test("an unknown path is still gated, not 404d", async () => {
  // The 404s above are for two SPECIFICALLY documented paths. Everything else
  // keeps answering 401, so the door does not become a map of what exists.
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/some/unknown/path`);
    assert.equal(res.status, 401);
  } finally {
    server.close();
  }
});

test("a Warden built without the documents still starts and 404s them", async () => {
  // main.mjs reads both off disk. If a future refactor stops passing them, the
  // service must degrade to a 404 rather than crash on every request to /.
  const { server, base } = await start({ doorHtml: undefined, llmsTxt: undefined });
  try {
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/llms.txt`)).status, 404);
  } finally {
    server.close();
  }
});

// Test gap 24 / finding 3.M3. The 401 is the piece's opening sentence to an
// agent that has read nothing, and it names two urls: `docs` and `mcp`. Nothing
// asserted either one could be FETCHED.
//
// The two halves were pinned in two files that never meet -- e2e/join.test.mjs
// asserts the 401 carries the fields, static.test.mjs asserts llms.txt is
// served -- and a test on each side of a gap does not close the gap. That is
// exactly how `client` came to advertise /client.mjs for weeks while the server
// answered 404 to it: both halves were tested, the JOIN between them was not.
//
// This follows the advertised url the way an arriving agent would: reads it out
// of the refusal, and fetches it.
test("every url the 401 advertises can actually be fetched", async () => {
  // Wired with the protocol document because the 401 names it: this test is
  // the guard that would have caught `client`, so it must be run against a
  // Warden that serves everything the body promises.
  const { server, base } = await start({ protocolMd: PROTOCOL });
  try {
    // An unsigned POST is the arrival every agent makes first.
    const refusal = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(refusal.status, 401);
    const body = await refusal.json();

    // The body names public urls on the configured domain; this test server
    // answers on a loopback port, so follow the PATH each one names.
    const docs = await fetch(`${base}${new URL(body.docs).pathname}`);
    assert.equal(docs.status, 200, `the 401 advertises ${body.docs}, which does not serve`);
    assert.equal(await docs.text(), LLMS, "and it serves the instructions, not something else");

    // `mcp` is the other advertised url. It must not 404 -- it is gated, which
    // is a different thing, and the 401 it answers is the door working.
    const mcp = await fetch(`${base}${new URL(body.mcp).pathname}`, { method: "POST", body: "{}" });
    assert.notEqual(mcp.status, 404, `the 401 advertises ${body.mcp}, which does not exist`);

    // And the guard that would have caught `client`: every url in the body is
    // checked, so a field added later cannot quietly point at nothing.
    const protocol = await fetch(`${base}${new URL(body.protocol).pathname}`);
    assert.equal(protocol.status, 200, `the 401 advertises ${body.protocol}, which does not serve`);
    assert.equal(await protocol.text(), PROTOCOL, "and it serves the protocol, not something else");

    const advertised = Object.entries(body).filter(([, v]) => typeof v === "string" && v.startsWith("http"));
    assert.deepEqual(
      advertised.map(([k]) => k).sort(),
      ["docs", "mcp", "protocol"],
      "a new url appeared in the 401: add it to this test or it is unverified",
    );
  } finally {
    server.close();
  }
});

// -----------------------------------------------------------------------
// THE ONLY DOCUMENT THAT NAMES THE HTTP HEADERS
//
// Hand-signing is the only way in today -- the client is unpublished -- and
// the document that actually names the six header fields (the raw protocol)
// was neither linked from llms.txt nor served anywhere. An agent that could
// not use the client had to guess the wire format, or find a file in a git
// repository. Found by the 2026-09-17 review.
// -----------------------------------------------------------------------

test("GET /protocol serves the raw protocol document, unsigned", async () => {
  const { server, base } = await start({ protocolMd: "# The raw protocol\nSignature-Input: ..." });
  try {
    const res = await fetch(`${base}/protocol`);
    assert.equal(res.status, 200, "an agent that cannot be admitted yet is exactly who needs this");
    assert.match(res.headers.get("content-type"), /text\/markdown|text\/plain/);
    assert.match(await res.text(), /The raw protocol/);
  } finally {
    server.close();
  }
});

test("a Warden wired without the protocol document 404s it rather than throwing", async () => {
  const { server, base } = await start({ protocolMd: undefined });
  try {
    assert.equal((await fetch(`${base}/protocol`)).status, 404);
    assert.equal((await fetch(`${base}/`)).status, 200, "and the door still stands");
  } finally {
    server.close();
  }
});

test("every 401 points at the protocol document by url", async () => {
  // The body already carries `mcp` and `docs`. `protocol` is the third thing a
  // hand-signing agent needs and the one it could not find: llms.txt describes
  // the journey, this names the fields.
  const { server, base } = await start({ protocolMd: "# The raw protocol" });
  try {
    const res = await fetch(`${base}/mcp`, { method: "POST" });
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.protocol, "https://example.com/protocol");
    assert.ok(body.challenge && body.mcp && body.docs, "and the rest of the invitation is unchanged");
  } finally {
    server.close();
  }
});

// -----------------------------------------------------------------------
// ORIGIN, FOR THE ONE CALLER THAT SENDS ONE
//
// The MCP endpoint never looked at `Origin`. The SDK's own `allowedOrigins`
// is DEPRECATED -- "Use external middleware for origin validation instead" --
// so this is that middleware, in the one layer we own.
//
// An agent sends no Origin header at all, so nothing an agent does changes.
// What changes is a browser page on somebody else's site being able to aim a
// request at /mcp with a viewer's credentials attached. There is no path to
// exploit that while the door stands, and the door is not the only thing that
// should have to stand.
// -----------------------------------------------------------------------

test("a request from another site's Origin is refused before the door", async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).reason, "origin");
  } finally {
    server.close();
  }
});

test("an agent, which sends no Origin at all, is unaffected", async () => {
  // THE CONTROL, and the one that matters: every real caller is here. It still
  // gets the door's 401 with a challenge -- refused by the door, on its own
  // terms, not by this check.
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
    assert.equal(res.status, 401);
    assert.ok((await res.json()).challenge);
  } finally {
    server.close();
  }
});

test("our own Origin is allowed through to the door", async () => {
  const { server, base } = await start();
  try {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { origin: "https://example.com" },
      body: "{}",
    });
    assert.equal(res.status, 401, "the door refuses it, the origin check does not");
  } finally {
    server.close();
  }
});
