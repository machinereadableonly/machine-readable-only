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
import { createServer } from "../src/server.mjs";

const DOOR = "<!doctype html><title>door</title>";
const LLMS = "# what this piece is\n";

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
