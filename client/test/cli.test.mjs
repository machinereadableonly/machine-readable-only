// The CLI binary, driven as a user drives it.
//
// journey.test.mjs proves the library. This proves the thing people actually
// run, which is not the same claim: the first attempt at this test used
// spawnSync and deadlocked, because a synchronous child blocks the very event
// loop the in-process server needs to answer it. Nothing about that failure
// was visible from the library tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer } from "../../warden/src/server.mjs";
import { makeMcpHandler } from "../../warden/src/mcp/server.mjs";
import { tokenView } from "../../warden/src/mcp/tokenView.mjs";
import { openDb } from "../../warden/src/mirror/db.mjs";
import { queries } from "../../warden/src/mirror/queries.mjs";
import { utcDay } from "../../warden/src/mcp/tools/checkin.mjs";
import { openChain } from "../../warden/test/chain-stub.mjs";

const run = promisify(execFile);
const CLI = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const DOMAIN = "example.com";
const SECRET = "cli-test-secret";
const TREASURY = "0x000000000000000000000000000000000000dEaD";

const DEMAND = {
  x402Version: 2,
  error: "Payment required to access this tool",
  resource: { url: "mcp://tool/mint" },
  accepts: [{
    scheme: "exact", network: "eip155:84532", amount: "1000000",
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    payTo: TREASURY, maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
  }],
};

let dir, server, endpoint, keyPath;

/// The CLI, run to completion. Non-zero exit is returned rather than thrown,
/// because several of these tests are about how it REFUSES.
async function cli(...args) {
  try {
    const { stdout, stderr } = await run("node", [CLI, ...args], { timeout: 20_000 });
    return { code: 0, out: stdout + stderr };
  } catch (err) {
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "mro-cli-"));
  keyPath = join(dir, "identity.jwk.json");
  const q = queries(openDb(join(dir, "mirror.db")));

  const mcp = makeMcpHandler({
    q, chain: openChain(), today: utcDay,
    contract: "0xcontract", chainId: 84532,
    challengeSecret: SECRET, domain: DOMAIN, llmsTxt: "",
    catalogue: {}, supplyCap: 10_000,
    paid: () => async () => ({
      structuredContent: DEMAND,
      content: [{ type: "text", text: JSON.stringify(DEMAND) }],
      isError: true,
    }),
  });

  server = createServer({
    stateDbPath: join(dir, "mirror.db"), domain: DOMAIN,
    challengeSecret: SECRET, tokenView, mcp, allowRegistration: () => true,
  });
  endpoint = await new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${server.address().port}`)));
});

after(async () => {
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

test("help needs no network, no key and no arguments", async () => {
  const { code, out } = await cli("help");
  assert.equal(code, 0);
  assert.match(out, /mro-agent whoami/);
  assert.match(out, /--expect-payto/);
});

test("whoami says what to do rather than failing, when there is no identity yet", async () => {
  const { code, out } = await cli("whoami", "--key", join(dir, "absent.json"));
  assert.equal(code, 0);
  assert.match(out, /no identity at/);
});

test("a missing --site is refused with a message, not a stack trace", async () => {
  const { code, out } = await cli("status", "--key", keyPath);
  assert.equal(code, 1);
  assert.match(out, /--site is required/);
  assert.doesNotMatch(out, /at .*\.mjs:/, "a usage error must not print a stack");
});

test("join registers, lists the tools, and reports the payment demand", async () => {
  const { code, out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", keyPath, "--to", "0x" + "a1".repeat(20), "--cron"
  );
  assert.equal(code, 0, out);
  assert.match(out, /generated a new identity/);
  assert.match(out, /registered with: https:\/\/example\.com/);
  assert.match(out, /"mint"/, "the tool list must reach the operator");
  // No wallet key was given, so nothing was signed and the demand is reported.
  assert.match(out, /Payment required/);
  assert.match(out, /0 12 \* \* \* mro-agent beat/, "--cron prints the line rather than installing it");
});

test("the identity join created is reusable, and whoami now names it", async () => {
  const { code, out } = await cli("whoami", "--key", keyPath);
  assert.equal(code, 0);
  assert.match(out, /key id: [A-Za-z0-9_-]{43}/);
});

test("status works with the identity join left behind", async () => {
  const { code, out } = await cli("status", "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath);
  assert.equal(code, 0, out);
  assert.match(out, /"ok": true/);
});

// The cold readers' finding, enforced where it is easiest to get wrong: at the
// command line, in a hurry, with a wallet key in the environment.
test("REFUSES to pay when a wallet key is given but no expected payTo is", async () => {
  const { code, out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer.json"), "--to", "0x" + "a1".repeat(20),
    "--wallet-key", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  );
  assert.equal(code, 1);
  assert.match(out, /an expected payTo address is required/);
});

test("REFUSES to pay when the expected payTo does not match the demand", async () => {
  const { code, out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer2.json"), "--to", "0x" + "a1".repeat(20),
    "--wallet-key", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "--expect-payto", "0x" + "b2".repeat(20)
  );
  assert.equal(code, 1);
  assert.match(out, /refusing to pay: payTo is/);
});

test("a signature over the wrong origin is refused at the door", async () => {
  // No --endpoint, so the CLI signs for and dials the local address, whose
  // authority is not the domain the door is configured with.
  const { code, out } = await cli("status", "--site", endpoint, "--key", join(dir, "wrong.json"));
  assert.equal(code, 1);
  assert.match(out, /refused at the door/);
});
