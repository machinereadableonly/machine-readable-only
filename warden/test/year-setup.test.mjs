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
import { yearPaths } from "../tools/year/runner.mjs";
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

test("every app carries the live ecosystem's filter_env, verbatim", () => {
  const list = require(join(YEAR, "year.config.cjs"));
  const live = require(join(WARDEN, "ecosystem.config.cjs"));
  const expected = live.apps[0].filter_env;
  assert.ok(Array.isArray(expected) && expected.length > 0);
  for (const app of list.apps) assert.deepEqual(app.filter_env, expected, `${app.name} filter_env`);
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

test("the runner and checker are told the data directory and the day length", () => {
  const dir = tempDir("mro-year-cfg-");
  const list = loadConfigWith({ MRO_YEAR_DIR: dir });
  for (const name of ["mro-year-runner", "mro-year-checker", "mro-year-clock"]) {
    const app = list.apps.find((a) => a.name === name);
    assert.equal(app.env.MRO_YEAR_DIR, dir, name);
    assert.equal(app.env.MRO_DAY_SECONDS, "300", name);
  }
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
  for (const name of IDENTITY_NAMES) assert.ok(existsSync(paths.identity(name)), `${name} identity`);
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

const SCRIPTS = ["setup.sh", "start.sh", "stop.sh", "clock-loop.sh"];

test("every shell script parses", () => {
  for (const name of SCRIPTS) execFileSync("bash", ["-n", join(YEAR, name)]);
});

test("no home directory is written into a shell script", () => {
  for (const name of SCRIPTS) {
    const source = readFileSync(join(YEAR, name), "utf8");
    assert.ok(!source.includes("/home/"), `${name} carries a home path`);
  }
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
