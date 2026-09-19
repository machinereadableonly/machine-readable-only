// The CLI binary, driven as a user drives it.
//
// journey.test.mjs proves the library. This proves the thing people actually
// run, which is not the same claim: the first attempt at this test used
// spawnSync and deadlocked, because a synchronous child blocks the very event
// loop the in-process server needs to answer it. Nothing about that failure
// was visible from the library tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
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
import { adaptContext } from "../../warden/src/pay/x402.mjs";
import { loadIdentity } from "../src/keys.mjs";
import { VERSION, PUBLISHED, cronLine, invocation, unpayableMessage, doorMessage, DOOR_REASONS } from "../src/messages.mjs";

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

/// The body of a failed settlement, as seen live on 2026-09-11 from the
/// x402.org testnet facilitator: the demand again, with the reason in `error`.
const SETTLEMENT_FAILED = { ...DEMAND, error: "Payment settlement failed: invalid_exact_evm_transaction_failed" };

let dir, server, endpoint, keyPath, q;

/// An anvil account nobody funds, for the tests that exercise the paid path.
/// IT GOES IN THE ENVIRONMENT, never in argv: `--wallet-key <0x>` was removed
/// on 2026-09-19 because every argument is world-readable in `ps` and in
/// /proc/<pid>/cmdline, and the client's own unpayable message has always said
/// "MRO_WALLET_KEY (never on the command line)". A test that kept passing one
/// on the command line would be publishing the habit the client refuses.
const TEST_WALLET_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

/// The CLI, run to completion. Non-zero exit is returned rather than thrown,
/// because several of these tests are about how it REFUSES.
///
/// `withWallet()` is the same runner with the key in the environment.
async function cli(...args) {
  return cliWithEnv({}, ...args);
}

async function withWallet(...args) {
  return cliWithEnv({ MRO_WALLET_KEY: TEST_WALLET_KEY }, ...args);
}

async function cliWithEnv(env, ...args) {
  try {
    const { stdout, stderr } = await run("node", [CLI, ...args], {
      timeout: 20_000,
      env: { ...process.env, ...env },
    });
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
    // An unpaid call gets the demand. A PAID call gets what @x402/mcp sends
    // when the facilitator cannot settle: createSettlementFailedResult is
    // createPaymentRequiredResult with the reason in `error` -- the same shape,
    // isError included, which is exactly why the client could not tell it from
    // an ordinary demand without looking.
    //
    // The payment is found through the Warden's OWN adaptContext, the accessor
    // the real paid() wrapper uses (it lives at mcpCtx.mcpReq._meta, a level
    // deeper than it looks) -- so this double cannot drift from the real path.
    paid: () => async (_args, ctx) => {
      const paying = adaptContext(ctx?.mcpCtx)._meta?.["x402/payment"];
      const body = paying ? SETTLEMENT_FAILED : DEMAND;
      return {
        structuredContent: body,
        content: [{ type: "text", text: JSON.stringify(body) }],
        isError: true,
      };
    },
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
  // The invocation is whichever form is true TODAY -- see `invocation()`.
  // Pinning the npx form here is what let a line naming an unpublished version
  // ship: the test asserted the shape it wanted rather than one that runs.
  const run = invocation().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(out, new RegExp(`^\\d{1,2} (11|12|13) \\* \\* \\* ${run} beat --site https://example\\.com --token <your token id> >> ~/\\.mro/beat\\.log 2>&1$`, "m"));
  assert.doesNotMatch(out, /^0 12 \* \* \* mro-agent beat/m, "the old unpinned line must be gone");
});

// C3.4, as arithmetic rather than as a regex over a process. The three
// properties that matter are the pin, the scatter, and the real id.
test("the cron line pins a version and UTC, scatters the minute, and carries the token id", () => {
  // BOTH FORMS, because only one of them is live at a time and the dead one is
  // where the bug hid. M7: the published form named a version the registry
  // answers 404 for, every night, into a redirected log.
  const published = cronLine({ site: "https://example.com", tokenId: 7, version: "9.9.9", minute: 41, hour: 12, published: true });
  assert.equal(published, "CRON_TZ=UTC\n41 12 * * * npx --yes mro-agent@9.9.9 beat --site https://example.com --token 7 >> ~/.mro/beat.log 2>&1");

  const unpublished = cronLine({ site: "https://example.com", tokenId: 7, minute: 41, hour: 12, published: false, entry: "/opt/mro/cli.mjs" });
  assert.equal(unpublished, "CRON_TZ=UTC\n41 12 * * * node /opt/mro/cli.mjs beat --site https://example.com --token 7 >> ~/.mro/beat.log 2>&1");

  // And the live default never names npx while the package cannot run.
  const line = cronLine({ site: "https://example.com", tokenId: 7, minute: 41, hour: 12 });
  if (!PUBLISHED) {
    assert.doesNotMatch(line, /npx/, "an unpublished client must not schedule npx");
    assert.match(line, /node \/.*cli\.mjs beat/, "it schedules the file that is actually running");
  }

  // 5.M5. THE ZONE IS THE POINT, not decoration: crontab(5) runs a table in the
  // daemon's LOCAL zone, while the check-in window is a UTC day on chain. On a
  // host observing DST the UTC instant of a local time moves by an hour at the
  // transition, so a job pinned to local noon can land twice in one UTC day and
  // skip the next -- costing the streak this line exists to keep.
  assert.match(line, /^CRON_TZ=UTC\n/);

  const hours = new Set(), minutes = new Set();
  for (let i = 0; i < 200; i += 1) {
    const [m, h] = cronLine({ site: "https://example.com", tokenId: 1 }).split("\n")[1].split(" ");
    minutes.add(m); hours.add(h);
  }
  assert.ok(minutes.size > 20, `the minute must be drawn, not fixed: saw ${minutes.size}`);
  for (const h of hours) assert.ok(["11", "12", "13"].includes(h), `hour out of range: ${h}`);
  assert.match(
    cronLine({ site: "https://example.com", tokenId: 1, published: true }),
    new RegExp(`mro-agent@${VERSION.replace(/\./g, "\\.")} `)
  );
  // And the hour still leaves room for an hour of drift inside the same UTC day.
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
  const { code, out } = await withWallet(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer.json"), "--to", "0x" + "a1".repeat(20),
  );
  assert.equal(code, 1);
  assert.match(out, /an expected payTo address is required/);
});

test("REFUSES to pay when the expected payTo does not match the demand", async () => {
  const { code, out } = await withWallet(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer2.json"), "--to", "0x" + "a1".repeat(20),
    // The amount is named so this stops at the payTo check, which is its
    // subject -- an absent amount is now refused first, and would make this
    // pass for the wrong reason.
    "--expect-payto", "0x" + "b2".repeat(20), "--expect-amount", "1000000"
  );
  assert.equal(code, 1);
  assert.match(out, /refusing to pay: payTo is/);
});

// -- all four payment fields, not two ---------------------------------------
//
// `assertExpected` compares amount, asset and network whenever the caller
// supplies them -- but the CLI only ever built `{ payTo, amount }`, so `asset`
// and `network` were unreachable through the binary at any price. Measured
// 2026-09-18 against the real modules: with only payTo pinned, the client
// signed a transferWithAuthorization for an attacker's ERC-20 on Base MAINNET,
// with a one-year validity window, against a comment calling that window
// "deliberately short". payTo itself was never the hole -- it is mandatory, and
// an absent --expect-payto throws before anything is signed.

test("REFUSES to pay when the expected asset does not match the demand", async () => {
  const { code, out } = await withWallet(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer-asset.json"), "--to", "0x" + "a1".repeat(20),
    "--expect-payto", TREASURY, "--expect-amount", "1000000",
    "--expect-asset", "0x" + "cc".repeat(20)
  );
  assert.equal(code, 1);
  assert.match(out, /refusing to pay: asset is/);
});

test("REFUSES to pay when the expected network does not match the demand", async () => {
  const { code, out } = await withWallet(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer-network.json"), "--to", "0x" + "a1".repeat(20),
    "--expect-payto", TREASURY, "--expect-amount", "1000000",
    "--expect-network", "eip155:1"
  );
  assert.equal(code, 1);
  assert.match(out, /refusing to pay: network is/);
});

test("REFUSES to pay with no expected amount at all", async () => {
  // The amount was optional, and the instruction printed at the moment of
  // payment asked only for --expect-payto -- so the documented flow left the
  // sum unchecked. A demand for any amount, payable to the right treasury, was
  // signed without complaint.
  const { code, out } = await withWallet(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer-noamount.json"), "--to", "0x" + "a1".repeat(20),
    "--expect-payto", TREASURY
  );
  assert.equal(code, 1);
  assert.match(out, /an expected amount is required/);
});

test("the instructions name every flag the client needs to pay", async () => {
  // The promise and the prescription have to agree: the text asserted the
  // client "refuses to pay any other address, amount or asset" while telling
  // the operator to pass one flag.
  const { out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer-instructions.json"), "--to", "0x" + "a1".repeat(20)
  );
  for (const flag of ["--expect-payto", "--expect-amount", "--expect-asset", "--expect-network"]) {
    assert.ok(out.includes(flag), `the payment instructions never mention ${flag}: ${out}`);
  }
});

// 2026-09-11, the first paid mint through the persistent test wallet. The
// testnet facilitator failed to settle; the site answered the PAID call with a
// payment demand carrying the reason, as @x402/mcp does; and this client
// printed it and EXITED 0. A cron job, or an agent reading the exit status,
// saw a mint that never happened.
test("a payment that fails to settle exits non-zero and says nothing was minted", async () => {
  const { code, out } = await withWallet(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "payer3.json"), "--to", "0x" + "a1".repeat(20),
    "--expect-payto", TREASURY, "--expect-amount", "1000000"
  );
  assert.equal(code, 2, `a failed payment must not look like success: ${out}`);
  assert.match(out, /Payment settlement failed: invalid_exact_evm_transaction_failed/);
  assert.match(out, /NOTHING WAS MINTED/);
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

// 5.M6, THROUGH THE REAL BINARY. Every command printed its refusal and returned
// normally, so the process exited 0: `beat` on an already-credited day, on a
// token bound to another key, on a paused contract, on an unreachable RPC. This
// client's own documented deployment is a cron job, and cron reports failure by
// exit status -- so an agent whose streak was quietly breaking looked healthy to
// every supervisor watching it. `beat` is the command a participant runs 365
// times.
test("a tool REFUSAL exits non-zero, so a cron job can see it", async () => {
  // A token this key is not bound to: refused `unknown-token` by the mirror,
  // which is a refusal and not a crash.
  const { code, out } = await cli(
    "beat", "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath, "--token", "424242"
  );
  assert.equal(code, 2, `a refusal must not look like success: ${out}`);
  assert.match(out, /"ok": false/);
  // 2 and not 1: a thrown error already exits 1, and "the site refused this" is
  // a different thing from "the client could not run".
  const broken = await cli("beat", "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath);
  assert.equal(broken.code, 1, "a missing argument is still the client's own failure");
});

// The control: a successful call still exits 0, or the exit code says nothing.
test("CONTROL: a successful call still exits 0", async () => {
  const { code } = await cli("status", "--site", `https://${DOMAIN}`, "--endpoint", endpoint, "--key", keyPath);
  assert.equal(code, 0);
});

// THE PACKAGE MUST CARRY THE LICENCE IT DECLARES.
//
// package.json said "license": "MIT" while `files` listed only src and
// README.md, so `npm publish` would have shipped a package claiming MIT with
// no licence text in it -- the one document the MIT licence itself requires to
// be included ("The above copyright notice and this permission notice shall be
// included in all copies"). Found by the 2026-09-17 review.
test("the published package includes the licence it declares", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.license, "MIT");
  assert.ok(pkg.files.includes("LICENSE"), "npm ships only what `files` lists");

  const text = await readFile(new URL("../LICENSE", import.meta.url), "utf8");
  assert.match(text, /MIT License/);
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/, "the whole licence, not a reference to one");
});

// -- a private key must never travel in argv --------------------------------

test("a wallet key file anybody can read is refused, and names the fix", async () => {
  const path = join(dir, "loose-wallet.key");
  writeFileSync(path, TEST_WALLET_KEY);
  chmodSync(path, 0o644);

  const { code, out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "wkf1.json"), "--to", "0x" + "a1".repeat(20),
    "--wallet-key-file", path,
    "--expect-payto", TREASURY, "--expect-amount", "1000000"
  );
  assert.equal(code, 1);
  assert.match(out, /readable by others/);
  assert.match(out, /chmod 600/, "the message must carry the remedy");
});

test("a wallet key file only its owner can read is used", async () => {
  const path = join(dir, "tight-wallet.key");
  writeFileSync(path, TEST_WALLET_KEY, { mode: 0o600 });
  chmodSync(path, 0o600);

  // THE CONTROL for the test above: same flag, same key, tight mode. It gets
  // as far as paying -- which this fake facilitator then declines -- so the
  // key was read and used rather than refused.
  const { out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "wkf2.json"), "--to", "0x" + "a1".repeat(20),
    "--wallet-key-file", path,
    "--expect-payto", TREASURY, "--expect-amount", "1000000"
  );
  assert.doesNotMatch(out, /readable by others/);
  assert.match(out, /paying|payment|refusing to pay/i, "the key was read and the paid path entered");
});

test("a file that does not hold a private key is refused", async () => {
  const path = join(dir, "not-a-key");
  writeFileSync(path, "hello", { mode: 0o600 });
  chmodSync(path, 0o600);
  const { code, out } = await cli(
    "join", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", join(dir, "wkf3.json"), "--to", "0x" + "a1".repeat(20),
    "--wallet-key-file", path, "--expect-payto", TREASURY, "--expect-amount", "1000000"
  );
  assert.equal(code, 1);
  assert.match(out, /does not hold a 32-byte hex private key/);
});

test("the help no longer advertises a key on the command line", async () => {
  const { out } = await cli("--help");
  assert.doesNotMatch(out, /--wallet-key </, "a flag that takes a key in argv must not be offered");
  assert.match(out, /--wallet-key-file/);
});

// -- the chain you expected, checked before anything is done ----------------

test("a chain that is not the one you expected stops the run", async () => {
  // llms.txt has always said to hard-fail on a mismatch rather than adapt.
  // Until 2026-09-19 the client could not express the expectation at all.
  const { code, out } = await cli(
    "status", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", keyPath, "--expect-chain", "1"
  );
  assert.equal(code, 1);
  assert.match(out, /refusing to continue/);
  assert.match(out, /84532/, "it must say what the site actually is");
  assert.match(out, /expected 1/);
});

test("a contract that is not the one you expected stops the run", async () => {
  const { code, out } = await cli(
    "status", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", keyPath, "--expect-contract", "0x" + "ff".repeat(20)
  );
  assert.equal(code, 1);
  assert.match(out, /refusing to continue/);
});

test("CONTROL: the chain and contract you DID expect pass straight through", async () => {
  const { code, out } = await cli(
    "status", "--site", `https://${DOMAIN}`, "--endpoint", endpoint,
    "--key", keyPath, "--expect-chain", "84532", "--expect-contract", "0xcontract"
  );
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /refusing to continue/);
});

test("the README never tells a reader to npx a package that is a placeholder", async () => {
  // The install block said `npx mro-agent help` while the Status section two
  // screens down said the published package is a placeholder that prints a
  // notice and exits. This file ships AS THE NPM PAGE, so the contradiction
  // was published on the very page the instruction fails from.
  //
  // Tied to PUBLISHED rather than to a date: when the real client is
  // published, this test stops applying by itself.
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  if (PUBLISHED) return;
  const instructions = readme.split("\n").filter((l) => /^\s+(npx|mro-agent)\s/.test(l));
  const npxLines = instructions.filter((l) => l.includes("npx mro-agent"));
  assert.deepEqual(npxLines, [], "an unpublished client must not be invoked with npx in its own README");
  assert.match(readme, /node src\/cli\.mjs/, "and it must say how to run what actually exists");
});
