// The accelerated year's four processes, for PM2.
//
//   pm2 start tools/year/year.config.cjs     (start.sh does this, with the gates)
//
// THE FILENAME ENDS IN `.config.cjs` BECAUSE PM2 TREATS ANY OTHER NAME AS A
// SINGLE APP TO RUN, not as a process list -- `pm2 start year.cjs` would try to
// execute this file.
//
// TEST-ONLY, Base Sepolia, a 300-second day. Every app here is a sibling of the
// live `mro-warden`, never a replacement: this one listens on 4006, writes its
// own mirror in the data directory, and runs from an exported copy of HEAD so
// that nothing it writes can land in the live checkout.
const { homedir } = require("os");
const { dirname, join } = require("path");

// Paths are derived, never written down: the data directory from the
// environment (the same default every tool in tools/year uses), and anything
// under the home directory from os.homedir(). This file is in a PUBLIC
// repository and must carry no absolute path.
const dir = process.env.MRO_YEAR_DIR || join(homedir(), ".mro-year");
const tree = join(dir, "tree");
const cwd = join(tree, "warden");
const conf = join(dir, "year.conf");
const logs = join(dir, "logs");

// The version the live ecosystem pins, so the fast Warden and the real one run
// the same interpreter. MRO_YEAR_NODE overrides it for a box where that version
// is not installed.
const NODE_VERSION = "24.14.1";
const interpreter = process.env.MRO_YEAR_NODE || join(homedir(), ".nvm", "versions", "node", `v${NODE_VERSION}`, "bin", "node");

// IPv4 ONLY, for every outgoing connection, exactly as ecosystem.config.cjs
// explains: this box prefers IPv6 and the CDP facilitator refuses our key over
// it. Both flags are needed -- the first orders DNS answers, the second stops
// Node racing an IPv6 connection anyway.
const IPV4_ONLY = ["--dns-result-order=ipv4first", "--no-network-family-autoselection"];

// THE SHELL'S SECRETS ARE NOT THESE PROCESSES' BUSINESS. The live ecosystem's own
// list comes first, READ FROM THAT FILE rather than copied into this one: a
// filter that has drifted from the live one is a filter nobody has reviewed. A
// LIST, never `true` -- PM2 7.0.1 tests `filter_env.length`, so a boolean does
// nothing at all. Each entry drops any inherited variable whose NAME CONTAINS it.
const ECOSYSTEM_FILTER_ENV = require("../../ecosystem.config.cjs").apps[0].filter_env;

// AND THE SETTINGS year.conf OWNS, because the shell BEATS --env-file. Node's own
// rule is that "the value from the environment takes precedence", and PM2 passes
// the whole shell that ran `pm2 start` into every app -- so an operator who had
// exported MRO_CONTRACT_ADDRESS or STATE_DB_PATH for a one-off script would have
// silently pointed the fast Warden at the live pair, or at the live mirror.
// Dropping the names here means year.conf is the only place these can come from.
const CONF_OWNED = [
  "STATE_DB_PATH",
  "MRO_DAY_SECONDS",
  "MRO_CLOCK_OFFSET_SECONDS",
  "MRO_CONTRACT_ADDRESS",
  "MRO_DOMAIN",
  "BASE_RPC_URL",
];

const filterEnv = [...ECOSYSTEM_FILTER_ENV, ...CONF_OWNED];

// Each app's own `env` block is applied AFTER that filter (PM2 7.0.1
// lib/Common.js: `[{}, filterEnv(process.env), app.env]` reduced with
// Object.assign), so what an app is given below is deliberate configuration
// rather than something inherited.
//
// The runner and the checker read no settings file: they are told where the run
// lives, how long a day is, and which endpoint to read. BASE_RPC_URL is the
// PUBLIC Base Sepolia endpoint, which is what their own defaults are too -- the
// Warden and the Clock use whatever year.conf names, and neither of them is this.
const toolsEnv = {
  MRO_YEAR_DIR: dir,
  MRO_DAY_SECONDS: "300",
  BASE_RPC_URL: "https://sepolia.base.org",
};

// The bank's key FILE, a path and not a key. Stated because filter_env drops any
// inherited name containing `_KEY`, and only the runner spends from it.
const runnerEnv = {
  ...toolsEnv,
  MRO_TEST_WALLET_KEY_FILE: process.env.MRO_TEST_WALLET_KEY_FILE || join(homedir(), ".mro-test-wallet", "wallet.key"),
};

// The Clock loop gets NOTHING year.conf owns -- not even the day length, which it
// reads out of that file by name. A copy here would reach the Clock process
// through the environment and beat its --env-file.
const loopEnv = { MRO_YEAR_DIR: dir, MRO_YEAR_NODE: interpreter };

// An explicit restart policy, stated rather than defaulted, for the same reason
// the live ecosystem states one: every process here refuses to start on a
// configuration it cannot trust, and PM2's default is to restart forever. Ten
// tries with backoff, then `errored` and stopped -- a handful of copies of the
// reason in the log instead of thousands.
const restart = { autorestart: true, max_restarts: 10, exp_backoff_restart_delay: 250, min_uptime: "60s" };

const app = (name, over) => ({
  name,
  cwd,
  interpreter,
  exec_mode: "fork",
  instances: 1,
  filter_env: filterEnv,
  error_file: join(logs, `${name}.err.log`),
  out_file: join(logs, `${name}.out.log`),
  ...restart,
  ...over,
});

module.exports = {
  apps: [
    app("mro-year-warden", {
      script: "src/main.mjs",
      // The year's own settings file, outside every repository. NOT
      // --env-file-if-exists: a missing configuration must stop the process,
      // not start it with half its settings.
      node_args: [...IPV4_ONLY, `--env-file=${conf}`],
      // PORT is the one thing the Warden reads from the environment rather than
      // the file, and 4006 is the fast port: 3006 is the live site's.
      env: { PORT: "4006" },
      max_memory_restart: "512M",
    }),
    app("mro-year-clock", {
      // The real Clock, run 30 s after each fast day by a loop rather than by a
      // systemd timer. The loop is bash, so it needs bash as its interpreter --
      // the node path above would refuse it.
      script: join(tree, "warden", "tools", "year", "clock-loop.sh"),
      interpreter: "bash",
      env: loopEnv,
      max_memory_restart: "256M",
    }),
    app("mro-year-runner", {
      script: "tools/year/runner.mjs",
      node_args: IPV4_ONLY,
      env: runnerEnv,
      max_memory_restart: "512M",
    }),
    app("mro-year-checker", {
      script: "tools/year/checker.mjs",
      node_args: IPV4_ONLY,
      // The checker spawns `node tools/verify-tokenuri.mjs` to rasterise and
      // decode a QR at a milestone, and a spawned `node` is found on PATH -- which
      // a PM2 daemon started long ago may not have. The interpreter's own
      // directory is put in front of whatever PATH arrives.
      env: { ...toolsEnv, PATH: `${dirname(interpreter)}:${process.env.PATH || ""}` },
      max_memory_restart: "512M",
    }),
  ],
};
