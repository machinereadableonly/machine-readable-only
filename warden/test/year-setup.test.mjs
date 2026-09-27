// Task 6's setup, judged without a chain: the PM2 process list, the wallet
// maker's refusal to overwrite a key, the funding arithmetic, and the settings
// file setup.sh writes from the old fast one.
//
// Nothing here starts a process, sends a transaction or reads a real key: the
// scripts that can do those are exercised only through `--dry-run` and `bash -n`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AGENTS } from "../tools/year/scenario.mjs";
import { clockFailing, readJsonl, yearPaths } from "../tools/year/runner.mjs";
import { createWallets, WALLET_NAMES, IDENTITY_NAMES } from "../tools/year/wallets.mjs";
import { CLOCK_RESERVE_WEI, fundEth, fundUsdc, gasRecipients, GAS_WEI, MINT_USDC } from "../tools/year/fund.mjs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const WARDEN = join(HERE, "..");
const YEAR = join(WARDEN, "tools", "year");

const tempDir = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const mode = (path) => statSync(path).mode & 0o777;

// ---------------------------------------------------------------- the process list

test("the process list names the four apps of the run", () => {
  const list = require(join(YEAR, "year.config.cjs"));
  assert.deepEqual(
    list.apps.map((a) => a.name),
    ["mro-year-warden", "mro-year-clock", "mro-year-runner", "mro-year-checker"]
  );
});

test("every app carries the live ecosystem's filter_env, plus the names year.conf owns", () => {
  const list = require(join(YEAR, "year.config.cjs"));
  const live = require(join(WARDEN, "ecosystem.config.cjs"));
  const ecosystem = live.apps[0].filter_env;
  assert.ok(Array.isArray(ecosystem) && ecosystem.length > 0);

  for (const app of list.apps) {
    // The ecosystem's list, in its own order, at the front -- not merely present.
    assert.deepEqual(app.filter_env.slice(0, ecosystem.length), ecosystem, `${app.name} ecosystem entries`);
    // And the settings only year.conf may decide. Node lets the ENVIRONMENT beat
    // --env-file, so an inherited one of these would quietly win.
    for (const name of [
      "STATE_DB_PATH", "MRO_DAY_SECONDS", "MRO_CLOCK_OFFSET_SECONDS",
      "MRO_CONTRACT_ADDRESS", "MRO_DOMAIN", "BASE_RPC_URL",
    ]) {
      assert.ok(app.filter_env.includes(name), `${app.name} does not drop an inherited ${name}`);
    }
  }
});

test("the Clock loop is given nothing that year.conf owns", () => {
  const dir = tempDir("mro-year-cfg-");
  const clock = loadConfigWith({ MRO_YEAR_DIR: dir }).apps.find((a) => a.name === "mro-year-clock");
  // It reads the day length out of year.conf itself, and passes that file to the
  // Clock. A copy here would reach the Clock through the environment and beat it.
  assert.deepEqual(Object.keys(clock.env).sort(), ["MRO_YEAR_DIR", "MRO_YEAR_NODE"]);
});

test("the Warden is given only its port", () => {
  const dir = tempDir("mro-year-cfg-");
  const warden = loadConfigWith({ MRO_YEAR_DIR: dir }).apps.find((a) => a.name === "mro-year-warden");
  assert.deepEqual(Object.keys(warden.env), ["PORT"]);
});

test("the year's Warden runs on 4006 from the exported tree, against year.conf", () => {
  const dir = tempDir("mro-year-cfg-");
  const list = loadConfigWith({ MRO_YEAR_DIR: dir });
  const warden = list.apps.find((a) => a.name === "mro-year-warden");
  assert.equal(warden.script, "src/main.mjs");
  assert.equal(warden.cwd, join(dir, "tree", "warden"));
  assert.equal(warden.env.PORT, "4006");
  assert.deepEqual(warden.node_args, [
    "--dns-result-order=ipv4first",
    "--no-network-family-autoselection",
    `--env-file=${join(dir, "year.conf")}`,
  ]);
});

test("the Clock loop runs as bash, out of the exported tree", () => {
  const dir = tempDir("mro-year-cfg-");
  const clock = loadConfigWith({ MRO_YEAR_DIR: dir }).apps.find((a) => a.name === "mro-year-clock");
  assert.equal(clock.interpreter, "bash");
  assert.equal(clock.script, join(dir, "tree", "warden", "tools", "year", "clock-loop.sh"));
});

test("every app logs into the data directory and is memory-capped", () => {
  const dir = tempDir("mro-year-cfg-");
  for (const app of loadConfigWith({ MRO_YEAR_DIR: dir }).apps) {
    assert.equal(app.error_file, join(dir, "logs", `${app.name}.err.log`), app.name);
    assert.equal(app.out_file, join(dir, "logs", `${app.name}.out.log`), app.name);
    assert.ok(app.max_memory_restart, `${app.name} max_memory_restart`);
    assert.equal(app.exec_mode, "fork", app.name);
  }
});

test("the runner and checker are told everything they read, since the filter drops it", () => {
  const dir = tempDir("mro-year-cfg-");
  const list = loadConfigWith({ MRO_YEAR_DIR: dir });
  for (const name of ["mro-year-runner", "mro-year-checker"]) {
    const app = list.apps.find((a) => a.name === name);
    assert.equal(app.env.MRO_YEAR_DIR, dir, name);
    assert.equal(app.env.MRO_DAY_SECONDS, "300", name);
    // Neither reads year.conf, and the filter drops an inherited endpoint, so the
    // public one is stated. It is what their own code defaults to.
    assert.equal(app.env.BASE_RPC_URL, "https://sepolia.base.org", name);
  }
  // Only the runner spends: the checker is never told where the bank's key is.
  const runner = list.apps.find((a) => a.name === "mro-year-runner");
  const checker = list.apps.find((a) => a.name === "mro-year-checker");
  assert.match(runner.env.MRO_TEST_WALLET_KEY_FILE, /wallet\.key$/);
  assert.equal(checker.env.MRO_TEST_WALLET_KEY_FILE, undefined);
});

test("no home directory is written into the process list", () => {
  const source = readFileSync(join(YEAR, "year.config.cjs"), "utf8");
  assert.ok(!source.includes("/home/"), "a home path in a tracked file");
});

/// require() caches by path, so a second read with a different data directory
/// needs the cache entry dropped.
function loadConfigWith(env) {
  const path = join(YEAR, "year.config.cjs");
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    delete require.cache[require.resolve(path)];
    return require(path);
  } finally {
    for (const key of Object.keys(env)) delete process.env[key];
    Object.assign(process.env, saved);
    delete require.cache[require.resolve(path)];
  }
}

// ---------------------------------------------------------------- the wallets

test("the wallet maker makes a wallet per agent and an identity for the rebind", async () => {
  const paths = yearPaths(tempDir("mro-year-wallets-"));
  const said = [];
  const made = await createWallets({ paths, log: (line) => said.push(line) });

  assert.deepEqual(WALLET_NAMES, AGENTS.map((a) => a.name));
  assert.deepEqual(IDENTITY_NAMES, [...WALLET_NAMES, "A11b"]);
  assert.equal(made.filter((m) => m.created).length, WALLET_NAMES.length);
  for (const name of WALLET_NAMES) {
    assert.equal(mode(paths.wallet(name)), 0o600, `${name} key mode`);
    assert.match(readFileSync(paths.wallet(name), "utf8").trim(), /^0x[0-9a-f]{64}$/);
  }
  for (const name of IDENTITY_NAMES) {
    assert.ok(existsSync(paths.identity(name)), `${name} identity`);
    // An identity key is a private key too: the door knows an agent by it, and a
    // readable one is an agent anybody can impersonate.
    assert.equal(mode(paths.identity(name)), 0o600, `${name} identity mode`);
  }
  assert.equal(mode(paths.dir), 0o700);
  // Addresses are public; a key is not, and nothing printed may carry one.
  for (const line of said) assert.ok(!/0x[0-9a-fA-F]{64}/.test(line), `printed a key-shaped string: ${line}`);
});

test("the wallet maker never overwrites a key that exists", async () => {
  const paths = yearPaths(tempDir("mro-year-wallets-"));
  const said = [];
  await createWallets({ paths, log: (line) => said.push(line) });
  const before = WALLET_NAMES.map((name) => readFileSync(paths.wallet(name), "utf8"));

  const secondRun = [];
  const again = await createWallets({ paths, log: (line) => secondRun.push(line) });
  assert.equal(again.filter((m) => m.created).length, 0);
  assert.deepEqual(WALLET_NAMES.map((name) => readFileSync(paths.wallet(name), "utf8")), before);
  assert.ok(secondRun.some((line) => /kept/.test(line)), "the refusal is said out loud");
});

test("a half-made directory is completed, not refused", async () => {
  const paths = yearPaths(tempDir("mro-year-wallets-"));
  await createWallets({ paths, log: () => {} });
  const keyPath = paths.wallet("A7");
  const kept = readFileSync(keyPath, "utf8");
  writeFileSync(join(paths.dir, "wallets", "A7.key.moved"), kept);
  execFileSync("rm", [keyPath]);

  const made = await createWallets({ paths, log: () => {} });
  assert.deepEqual(made.filter((m) => m.created).map((m) => m.name), ["A7"]);
  assert.notEqual(readFileSync(keyPath, "utf8"), kept);
});

// ---------------------------------------------------------------- the funding

const address = (name) => `0x${name.padStart(40, "0")}`;

/// A chain that answers balances from a table and records every send.
function bankChain({ usdc = {}, eth = {} } = {}) {
  const sent = [];
  return {
    sent,
    usdcBalance: async (a) => usdc[a] ?? 0n,
    ethBalance: async (a) => eth[a] ?? 0n,
    sendUsdc: async (key, to, amount) => {
      sent.push({ asset: "usdc", key, to, amount });
      return { transactionHash: "0xsent" };
    },
    sendEth: async (key, to, wei) => {
      sent.push({ asset: "eth", key, to, wei });
      return { transactionHash: "0xsent" };
    },
  };
}

test("gas goes to every wallet that has a transaction to send, from the table", () => {
  assert.deepEqual(gasRecipients(), ["A10", "A11", "A12"]);
});

test("only the shortfall is sent, and a funded agent is left alone", async () => {
  const chain = bankChain({
    usdc: { [address("bank")]: 30n * MINT_USDC, [address("A1")]: MINT_USDC, [address("A2")]: 400_000n },
  });
  const out = await fundUsdc({
    chain, bank: { key: "0xbank", address: address("bank") },
    names: ["A1", "A2"], addressFor: address, log: () => {},
  });
  assert.deepEqual(chain.sent, [{ asset: "usdc", key: "0xbank", to: address("A2"), amount: 600_000n }]);
  assert.deepEqual(out, { funded: 1, kept: 1, short: 0 });
});

test("an empty bank is reported short and sends nothing", async () => {
  const chain = bankChain({ usdc: { [address("bank")]: 500_000n } });
  const said = [];
  const out = await fundUsdc({
    chain, bank: { key: "0xbank", address: address("bank") },
    names: ["A1"], addressFor: address, log: (line) => said.push(line),
  });
  assert.deepEqual(chain.sent, []);
  assert.deepEqual(out, { funded: 0, kept: 0, short: 1 });
  assert.ok(said.some((line) => /SHORT/.test(line)));
});

test("gas is topped up to the flat amount, and the Clock keeps its reserve", async () => {
  const chain = bankChain({ eth: { [address("clock")]: CLOCK_RESERVE_WEI + 10n * GAS_WEI, [address("A10")]: GAS_WEI } });
  const out = await fundEth({
    chain, bank: { key: "0xclock", address: address("clock") },
    names: ["A10", "A11"], addressFor: address, log: () => {},
  });
  assert.deepEqual(chain.sent, [{ asset: "eth", key: "0xclock", to: address("A11"), wei: GAS_WEI }]);
  assert.deepEqual(out, { funded: 1, kept: 1, short: 0 });

  const poor = bankChain({ eth: { [address("clock")]: GAS_WEI } });
  const short = await fundEth({
    chain: poor, bank: { key: "0xclock", address: address("clock") },
    names: ["A10"], addressFor: address, log: () => {},
  });
  assert.deepEqual(poor.sent, [], "the Clock's own gas is not spent down to nothing");
  assert.equal(short.short, 1);
});

// ---------------------------------------------------------------- the scripts

const SCRIPTS = [
  join(YEAR, "setup.sh"),
  join(YEAR, "start.sh"),
  join(YEAR, "stop.sh"),
  join(YEAR, "clock-loop.sh"),
  // Task 6 changed how this one reads its Warden address, so it is parsed here too.
  join(WARDEN, "..", "contracts", "script", "fast", "deploy-fast.sh"),
];

test("every shell script parses", () => {
  for (const path of SCRIPTS) execFileSync("bash", ["-n", path]);
});

// A `node -e '...'` block inside a shell script is JavaScript that no linter
// sees: `bash -n` parses the quotes and says nothing about what is between them.
// A shell comment written into one of these blocks -- which is exactly what a
// `# shellcheck disable` line did during this task -- makes the program a syntax
// error, and the only symptom is the guard it implements silently answering "no"
// at the moment it matters.
test("every node program embedded in a shell script is valid JavaScript", () => {
  const checked = [];
  for (const path of SCRIPTS) {
    for (const [index, program] of embeddedNodePrograms(readFileSync(path, "utf8")).entries()) {
      const file = join(tempDir("mro-year-js-"), `embedded-${index}.js`);
      writeFileSync(file, program);
      execFileSync("node", ["--check", file]);
      checked.push(`${path}#${index}`);
    }
  }
  // If the extraction ever stops finding them, the check above passes vacuously.
  assert.ok(checked.length >= 3, `expected the scripts' node programs, found ${checked.length}`);
});

/// Each `node -e '<program>'` block: from the opening quote to the next line
/// whose first character is that quote.
function embeddedNodePrograms(source) {
  const programs = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/node -e '$/.test(lines[i].trimEnd())) continue;
    const end = lines.findIndex((line, j) => j > i && line.trim().startsWith("'"));
    if (end > i) programs.push(lines.slice(i + 1, end).join("\n"));
  }
  return programs;
}

test("no home directory is written into a shell script", () => {
  for (const path of SCRIPTS) {
    assert.ok(!readFileSync(path, "utf8").includes("/home/"), `${path} carries a home path`);
  }
});

// THE ONE LINE THE RUNNER READS FROM ANOTHER PROCESS. `clockFailing` pauses every
// agent on three non-zero exits in a row, so the loop's JSON line and the
// runner's reader have to agree about the field -- and they are in different
// languages, which no unit test of either can catch. The loop is run for real
// against a one-second day and a node that always fails.
test("the Clock loop's line is the line clockFailing reads", () => {
  const dir = tempDir("mro-year-loop-");
  mkdirSync(join(dir, "tree", "warden", "src", "clock"), { recursive: true });
  writeFileSync(join(dir, "tree", "warden", "src", "clock", "main.mjs"), "// a stand-in for the real Clock\n");
  writeFileSync(join(dir, "year.conf"), "MRO_DAY_SECONDS=1\nMRO_CLOCK_OFFSET_SECONDS=0\n", { mode: 0o600 });
  const fakeNode = join(dir, "fails.sh");
  writeFileSync(fakeNode, "#!/usr/bin/env bash\nexit 3\n", { mode: 0o755 });

  // `timeout` stops it; the loop never exits on its own, which is the point of it.
  // Exit 124 is timeout's own "I killed it", and that is the expected end.
  try {
    execFileSync("timeout", ["5", "bash", join(YEAR, "clock-loop.sh")], {
      env: { ...process.env, MRO_YEAR_DIR: dir, MRO_YEAR_NODE: fakeNode },
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (err) {
    assert.equal(err.status, 124, `the loop exited on its own: ${err.stderr}`);
  }

  const lines = readJsonl(join(dir, "clock.jsonl"));
  assert.ok(lines.length >= 3, `expected at least three runs in five seconds, got ${lines.length}`);
  for (const line of lines) {
    assert.equal(line.exit, 3, "the exit code is not the one the run answered");
    assert.ok(Number.isInteger(line.chainDay), "chainDay is not a whole fast day");
    assert.match(line.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  }
  // The runner's own reader, unchanged, over the loop's own output.
  assert.equal(clockFailing(lines), true);
});

/// A settings file shaped like the old fast one, with values nothing may print.
const FAKE_CONF = [
  "MRO_DOMAIN=old.test",
  "CHALLENGE_SECRET=squirrel-supreme",
  "BASE_RPC_URL=https://sepolia.base.org",
  "MRO_CONTRACT_ADDRESS=0x00000000000000000000000000000000000000ff",
  "MRO_CHAIN_ID=84532",
  "TREASURY_ADDRESS=0x000000000000000000000000000000000000dEaD",
  "X402_FACILITATOR_URL=https://x402.org/facilitator",
  "STATE_DB_PATH=/somewhere/else/state.db",
  "PORT=4006",
  "MRO_DAY_SECONDS=86400",
  "CLOCK_ADDRESS=0x00000000000000000000000000000000000c10c4",
  `CLOCK_PRIVATE_KEY=0x${"ab".repeat(32)}`,
  "",
].join("\n");

function dryRun(dir, conf) {
  return execFileSync("bash", [join(YEAR, "setup.sh"), "--dry-run"], {
    encoding: "utf8",
    env: { ...process.env, MRO_YEAR_DIR: dir, MRO_FAST_CONF: conf },
    // A refusal's own message belongs in the thrown error, not in the suite's output.
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/// The export stage is the one thing a unit test has no business doing: it
/// copies HEAD. A tree that is already there is skipped, so put one there.
function stubTree(dir) {
  for (const pkg of ["warden", "client", "tools"]) mkdirSync(join(dir, "tree", pkg, "src"), { recursive: true });
  // The recorded commit is what makes the stage skippable: a tree from an older
  // commit is re-exported over, deliberately.
  writeFileSync(join(dir, "tree.head"), execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }));
}

test("the year's settings come from the old fast ones, with six values replaced", () => {
  const dir = tempDir("mro-year-setup-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);

  dryRun(dir, conf);
  const written = readFileSync(join(dir, "year.conf"), "utf8");
  const value = (key) => written.split("\n").find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

  assert.equal(value("MRO_DOMAIN"), "fast.test");
  assert.equal(value("PORT"), "4006");
  assert.equal(value("MRO_DAY_SECONDS"), "300");
  assert.equal(value("MRO_CLOCK_OFFSET_SECONDS"), "30");
  assert.equal(value("STATE_DB_PATH"), join(dir, "state.db"));
  assert.equal(value("MRO_CONTRACT_ADDRESS"), "pending-deploy");
  // Everything else is carried across untouched, secrets included.
  assert.equal(value("CHALLENGE_SECRET"), "squirrel-supreme");
  assert.equal(value("CLOCK_PRIVATE_KEY"), `0x${"ab".repeat(32)}`);
  assert.equal(value("X402_FACILITATOR_URL"), "https://x402.org/facilitator");
  assert.equal(value("MRO_CHAIN_ID"), "84532");
  assert.equal(mode(join(dir, "year.conf")), 0o600);
  assert.equal(mode(dir), 0o700);
});

test("setup prints nothing out of the settings file", () => {
  const dir = tempDir("mro-year-setup-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);

  const said = dryRun(dir, conf);
  assert.ok(!said.includes("squirrel-supreme"), "printed the challenge secret");
  assert.ok(!/0x[0-9a-fA-F]{64}/.test(said), "printed a key-shaped string");
});

test("the treasury address is written where the runner reads it", () => {
  const dir = tempDir("mro-year-setup-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);

  dryRun(dir, conf);
  assert.equal(
    readFileSync(join(dir, "treasury.address"), "utf8").trim(),
    "0x000000000000000000000000000000000000dEaD"
  );
});

test("a second setup changes nothing and still succeeds", () => {
  const dir = tempDir("mro-year-setup-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);

  dryRun(dir, conf);
  const first = readFileSync(join(dir, "year.conf"), "utf8");
  const said = dryRun(dir, conf);
  assert.equal(readFileSync(join(dir, "year.conf"), "utf8"), first);
  assert.ok(/skip/i.test(said), "a stage already done says so");
});

test("setup refuses when the old fast settings are not there", () => {
  const dir = tempDir("mro-year-setup-");
  stubTree(dir);
  assert.throws(() => dryRun(dir, join(dir, "absent.conf")), /absent.conf/);
});

test("a tree from another commit is re-exported, not accepted", () => {
  const dir = tempDir("mro-year-setup-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);
  writeFileSync(join(dir, "tree.head"), `${"0".repeat(40)}\n`);

  const said = dryRun(dir, conf);
  assert.match(said, /re-exported/);
  assert.ok(existsSync(join(dir, "tree", "warden", "src", "main.mjs")), "the export did not land");
  assert.equal(
    readFileSync(join(dir, "tree.head"), "utf8").trim(),
    execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
  );
});

test("start refuses before setup has run, without starting anything", () => {
  const dir = tempDir("mro-year-start-");
  assert.throws(
    () =>
      execFileSync("bash", [join(YEAR, "start.sh")], {
        encoding: "utf8",
        env: { ...process.env, MRO_YEAR_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      }),
    /year.conf is not there/
  );
});

/// Everything start.sh checks for before it looks at pm2 or the port, so the
/// refusals under test are the ones being aimed at.
function stubReadyDir() {
  const dir = tempDir("mro-year-ready-");
  stubTree(dir);
  mkdirSync(join(dir, "tree", "warden", "src"), { recursive: true });
  writeFileSync(join(dir, "tree", "warden", "src", "main.mjs"), "// a stand-in\n");
  writeFileSync(join(dir, "year.conf"), `${FAKE_CONF}\nMRO_CONTRACT_ADDRESS=0x${"a1".repeat(20)}\n`, { mode: 0o600 });
  writeFileSync(join(dir, "contract.address"), `0x${"a1".repeat(20)}\n`);
  writeFileSync(join(dir, "treasury.address"), "0x000000000000000000000000000000000000dEaD\n");
  mkdirSync(join(dir, "wallets"), { recursive: true });
  mkdirSync(join(dir, "identities"), { recursive: true });
  for (const name of [...WALLET_NAMES, "A11b"]) {
    if (name !== "A11b") writeFileSync(join(dir, "wallets", `${name}.key`), "", { mode: 0o600 });
    writeFileSync(join(dir, "identities", `${name}.jwk.json`), "{}", { mode: 0o600 });
  }
  return dir;
}

// THE OLD mro-fast-warden BINDS THE SAME 4006 and is only `stopped`, so a pm2
// resurrect would have it listening while this run's Warden tried to start. The
// guard asks by connecting, and it runs BEFORE the suites -- so this test reaches
// a refusal without ever starting a process or running a suite.
test("start refuses while something is listening on 4006", async () => {
  const { createServer, connect } = await import("node:net");
  const dir = stubReadyDir();

  const listening = await new Promise((resolve) => {
    const server = createServer();
    server.on("error", () => resolve(null));
    server.listen(4006, "127.0.0.1", () => resolve(server));
  });
  // Nothing of ours could bind it: either somebody else has (which is the
  // condition under test anyway) or the box refused, and then there is nothing to
  // test against.
  if (!listening) {
    const busy = await new Promise((resolve) => {
      const s = connect(4006, "127.0.0.1");
      s.on("connect", () => { s.destroy(); resolve(true); });
      s.on("error", () => resolve(false));
    });
    if (!busy) return;
  }
  try {
    assert.throws(
      () =>
        execFileSync("bash", [join(YEAR, "start.sh")], {
          encoding: "utf8",
          env: { ...process.env, MRO_YEAR_DIR: dir },
          stdio: ["ignore", "pipe", "pipe"],
        }),
      // Either refusal is correct and both come before the suites: the port, or
      // pm2 already holding this run's apps (true while the year is running).
      /4006|pm2 already holds/
    );
  } finally {
    listening?.close();
  }
});

test("a rebuilt settings file takes its pair back from contract.address", () => {
  const dir = tempDir("mro-year-setup-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);
  // The record of which pair this data directory belongs to, as a real run leaves it.
  const pair = `0x${"a1".repeat(20)}`;
  writeFileSync(join(dir, "contract.address"), `${pair}\n`);

  const said = dryRun(dir, conf);
  const written = readFileSync(join(dir, "year.conf"), "utf8");
  assert.ok(!written.includes("pending-deploy"), "the sentinel survived a known pair");
  assert.ok(written.includes(`MRO_CONTRACT_ADDRESS=${pair}`));
  // And it got there without asking a chain: `cast code` on that address would
  // answer 0x and the script would have failed.
  assert.match(said, /would read back cast code/);
});

test("a value carrying & or | is written literally, not as a substitution", () => {
  // sed reads `&` as the whole match and `|` as its own delimiter. The data
  // directory is the value most likely to carry either, so it carries both here.
  const dir = tempDir("mro-year-a&b|c-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);

  dryRun(dir, conf);
  const written = readFileSync(join(dir, "year.conf"), "utf8");
  assert.ok(written.includes(`STATE_DB_PATH=${join(dir, "state.db")}`), written);
});

test("a dry run neither deploys nor writes a contract address", () => {
  const dir = tempDir("mro-year-setup-");
  const conf = join(dir, "fast.conf");
  writeFileSync(conf, FAKE_CONF, { mode: 0o600 });
  stubTree(dir);

  const said = dryRun(dir, conf);
  assert.ok(!existsSync(join(dir, "contract.address")), "a dry run deployed something");
  assert.ok(!existsSync(join(dir, "state.db.reconcile-cursor")), "a dry run wrote a cursor");
  assert.ok(/would/i.test(said), "a dry run says what it would do");
});
