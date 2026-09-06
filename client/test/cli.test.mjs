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
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
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
import { loadIdentity } from "../src/keys.mjs";
import { VERSION, cronLine, unpayableMessage, doorMessage, DOOR_REASONS } from "../src/messages.mjs";

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

let dir, server, endpoint, keyPath, q;

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
  q = queries(openDb(join(dir, "mirror.db")));

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
    contract: "0x00000000000000000000000000000000000C0DE0", chainId: 84532,
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

test("help names the default site, so the command every document prints has a target", async () => {
  const { code, out } = await cli("help");
  assert.equal(code, 0);
  assert.match(out, /--site <origin>      the site to talk to \(default https:\/\/machinereadableonly\.com\)/);
});

// C3.1. `join` with no --site must get PAST the site check -- the proof is that
// it stops at the next one instead. --to is validated before any network call,
// so this reaches no site at all, which is the point: the old behaviour failed
// here with "--site is required" and the command every served page prints was
// unrunnable.
test("with no --site the default is used, and the run reaches the next check", async () => {
  const { code, out } = await cli("join", "--key", join(dir, "defaulted.json"));
  assert.equal(code, 1);
  assert.match(out, /--to <0xaddress> is required/);
  assert.doesNotMatch(out, /--site is required/);
  assert.doesNotMatch(out, /at .*\.mjs:/, "a usage error must not print a stack");
});

// C3.3. Measured before the fix: `mro-agent mark --site ...` wrote a fresh
// signing key to disk and THEN said the command did not exist.
test("an unknown command creates no key, and says so without a stack", async () => {
  const stray = join(dir, "stray.json");
  const { code, out } = await cli("mark", "--site", `https://${DOMAIN}`, "--key", stray);
  assert.equal(code, 1);
  assert.match(out, /unknown command: mark/);
  assert.equal(loadIdentity(stray), null, "a typo must not mint an identity");
  assert.doesNotMatch(out, /at .*\.mjs:/);
});

test("join registers, lists the tools, and STOPS with what a human must do", async () => {
  const { code, out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", keyPath, "--to", "0x" + "a1".repeat(20), "--cron"
  );
  // C3.2: exit 2, not 0. Nothing was paid, so this run did not succeed.
  assert.equal(code, 2, out);
  assert.match(out, /generated a new identity/);
  assert.match(out, /Back this file up now/, "C3.3: the first run is the only time to say this");
  assert.match(out, /registered with: https:\/\/example\.com/);
  assert.match(out, /"mint"/, "the tool list must reach the operator");
  assert.match(out, /NOTHING WAS PAID/);
  assert.match(out, /MRO_WALLET_KEY \(never on the command line\)/);
  assert.match(out, /--expect-payto/);
  assert.match(out, new RegExp(`payable to ${TREASURY}`));
  // C3.4: the line is still printed for an operator who asked for it, pinned
  // to a version, at a scattered minute, and honest about the missing id.
  assert.match(out, /crontab -e/);
  assert.match(out, new RegExp(`^\\d{1,2} (11|12|13) \\* \\* \\* npx --yes mro-agent@${VERSION.replace(/\./g, "\\.")} beat --site https://example\\.com --token <your token id> >> ~/\\.mro/beat\\.log 2>&1$`, "m"));
  assert.doesNotMatch(out, /^0 12 \* \* \* mro-agent beat/m, "the old unpinned line must be gone");
});

// C3.4, as arithmetic rather than as a regex over a process. The three
// properties that matter are the pin, the scatter, and the real id.
test("the cron line pins a version, scatters the minute, and carries the token id", () => {
  const line = cronLine({ site: "https://example.com", tokenId: 7, version: "9.9.9", minute: 41, hour: 12 });
  assert.equal(line, "41 12 * * * npx --yes mro-agent@9.9.9 beat --site https://example.com --token 7 >> ~/.mro/beat.log 2>&1");

  const hours = new Set(), minutes = new Set();
  for (let i = 0; i < 200; i += 1) {
    const [m, h] = cronLine({ site: "https://example.com", tokenId: 1 }).split(" ");
    minutes.add(m); hours.add(h);
  }
  assert.ok(minutes.size > 20, `the minute must be drawn, not fixed: saw ${minutes.size}`);
  for (const h of hours) assert.ok(["11", "12", "13"].includes(h), `hour out of range: ${h}`);
  assert.match(cronLine({ site: "https://example.com", tokenId: 1 }), new RegExp(`mro-agent@${VERSION.replace(/\./g, "\\.")} `));
});

// C3.2, read as an operator reads it: the numbers in the message are the ones
// the site actually quoted, not a hardcoded copy that can drift from the price.
test("the unpayable message quotes the demand it was given", () => {
  const text = unpayableMessage(DEMAND.accepts[0], "/tmp/k.json");
  assert.match(text, /1000000 base units of USDC/);
  assert.match(text, /on eip155:84532/);
  assert.match(text, new RegExp(`payable to ${TREASURY}`));
  assert.match(text, /identity key is unaffected and is at \/tmp\/k\.json/);
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

test("a signature over the wrong origin is refused at the door, in a sentence", async () => {
  // No --endpoint, so the CLI signs for and dials the local address, whose
  // authority is not the domain the door is configured with.
  const { code, out } = await cli("status", "--site", endpoint, "--key", join(dir, "wrong.json"));
  assert.equal(code, 1);
  // The reason is `directory`, not `signature` and no longer `unknown-key`:
  // signing for the local address makes that address the signature agent, the
  // door goes looking for a JWKS there, and the fetch fails. Until 2026-09-06
  // that failure was reported as `unknown-key` -- which sends an agent to
  // re-derive its thumbprint, the one trap the protocol document warns about --
  // because makeLookup swallowed its own fetch error and answered null. It
  // throws now, and the door tells the two apart. Asserted as measured.
  assert.match(out, /refused at the door \(directory\)/);
  // C3.9. The word alone is a diagnosis the agent cannot act on. This goes
  // through the real refusal path -- breaking the wiring left every direct
  // test of the table green, which is why this assertion exists here.
  assert.match(out, /could not fetch the key directory/);
});

// C3.5. The flag was documented on the served page, parsed without complaint,
// and ignored -- so an agent that asked NOT to be in the public directory was
// put in it anyway, permanently. The assertion that matters is the absence of
// a row: the door refusing the request afterwards is expected, because
// agent.invalid hosts no JWKS.
test("--directory skips registration entirely, so the site stores nothing", async () => {
  const dirKey = join(dir, "own-directory.json");
  const { code, out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--directory", "https://agent.invalid", "--key", dirKey,
    "--to", "0x" + "a1".repeat(20)
  );
  assert.match(out, /using your own directory at: https:\/\/agent\.invalid/);
  assert.match(out, /http-message-signatures-directory/);
  // The CLI's own registration line is `registered with <site>`. Matched with
  // the site on it, because the door's `directory` sentence -- which this run
  // now correctly gets -- contains the words "registered with them".
  assert.doesNotMatch(out, new RegExp(`registered with https://${DOMAIN}`));

  const { keyId } = loadIdentity(dirKey);
  assert.equal(q.getKey(keyId), undefined, "a key the agent chose to host itself must not be stored here");
  assert.equal(code, 1, "the door then refuses, because that directory does not exist");
});

// C3.9. The door answers in its own vocabulary at the exact moment the agent
// cannot go and read what it means.
test("a door refusal is a sentence, not a word", () => {
  assert.match(doorMessage("expired"), /five-second challenge ran out/);
  assert.match(doorMessage("unknown-key"), /mro-agent join/);
  // An unrecognised reason still reaches the operator rather than vanishing.
  assert.match(doorMessage("something-new"), /refused at the door: something-new/);
  assert.match(doorMessage(undefined), /no reason given/);
});

// Read from the SERVICE's own source, not from a list kept here, so a reason
// added at the door with no sentence in the client fails this rather than
// reaching an agent as a bare word. verify.mjs assigns its reason to a local
// and middleware.mjs passes one to challengeBody, so both shapes are scanned.
test("every reason the door can send has a sentence", () => {
  const source = readFileSync(new URL("../../warden/src/door/verify.mjs", import.meta.url), "utf8")
    + readFileSync(new URL("../../warden/src/door/middleware.mjs", import.meta.url), "utf8")
    + readFileSync(new URL("../../warden/src/door/challenge.mjs", import.meta.url), "utf8");

  const reasons = new Set([
    ...[...source.matchAll(/reason = "([a-z-]+)"/g)].map((m) => m[1]),
    ...[...source.matchAll(/reason: *"([a-z-]+)"/g)].map((m) => m[1]),
    ...[...source.matchAll(/challengeBody\([^)]*"([a-z-]+)"\)/g)].map((m) => m[1]),
  ]);
  // Not vacuous: if the extraction stops matching, this fails rather than
  // passing over an empty set -- the exact way this kind of test rots.
  assert.ok(reasons.size >= 5, `expected the door's vocabulary, found ${[...reasons]}`);

  const missing = [...reasons].filter((r) => !DOOR_REASONS[r]);
  assert.deepEqual(missing, [], "the door can send a reason the client cannot explain");
});

// C3.9, the timing. Five seconds is the piece's one theatrical rule.
test("the client reports how long the handshake took, against what it was allowed", async () => {
  const { code, out } = await cli("status", "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath);
  assert.equal(code, 0, out);
  assert.match(out, /answered the door's challenge in \d+ ms \(it allows 5000\)/);
});

// C3.12. The client reached four of the nine tools; `ladder` is the one that
// makes a forfeit legible BEFORE it is taken.
test("ladder is reachable, and rest warns before it returns the sealing call", async () => {
  const l = await cli("ladder", "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath, "--token", "1");
  assert.match(l.out, /ladder:/);

  const r = await cli("rest", "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath, "--token", "1");
  assert.match(r.out, /SEALS the token permanently/);
  assert.match(r.out, /cannot/);
});

test("the three read-only commands still require a token id", async () => {
  for (const command of ["ladder", "rebind", "rest"]) {
    const { code, out } = await cli(command, "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath);
    assert.equal(code, 1);
    assert.match(out, new RegExp(`--token <id> is required for ${command}`));
  }
});
