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

// THE SHELL'S SECRETS ARE NOT THESE PROCESSES' BUSINESS, and the list is copied
// from ecosystem.config.cjs verbatim rather than adapted: a filter that drifts
// from the live one is a filter nobody has reviewed. A LIST, never `true` --
// PM2 7.0.1 tests `filter_env.length`, so a boolean does nothing at all. Each
// entry drops any inherited variable whose NAME contains it; the `env` block of
// each app below is untouched by it, which is how these processes get the little
// configuration they do need.
const filterEnv = ["TOKEN", "SECRET", "_KEY", "PASSWORD", "CDP_", "CLOUDFLARE", "NTFY_", "_ADDRESS"];

// What the runner, the checker and the Clock loop need to find their way. The
// Warden reads its whole configuration from --env-file and needs none of it.
// MRO_TEST_WALLET_KEY_FILE is a PATH, not a key: it is stated here because
// filter_env drops any inherited name containing `_KEY`, and the runner must not
// depend on the operator's shell for where the bank is.
const tools = {
  MRO_YEAR_DIR: dir,
  MRO_DAY_SECONDS: "300",
  MRO_TEST_WALLET_KEY_FILE: process.env.MRO_TEST_WALLET_KEY_FILE || join(homedir(), ".mro-test-wallet", "wallet.key"),
  MRO_YEAR_NODE: interpreter,
};

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
      env: tools,
      max_memory_restart: "256M",
    }),
    app("mro-year-runner", {
      script: "tools/year/runner.mjs",
      node_args: IPV4_ONLY,
      env: tools,
      max_memory_restart: "512M",
    }),
    app("mro-year-checker", {
      script: "tools/year/checker.mjs",
      node_args: IPV4_ONLY,
      // The checker spawns `node tools/verify-tokenuri.mjs` to rasterise and
      // decode a QR at a milestone, and a spawned `node` is found on PATH -- which
      // a PM2 daemon started long ago may not have. The interpreter's own
      // directory is put in front of whatever PATH arrives.
      env: { ...tools, PATH: `${dirname(interpreter)}:${process.env.PATH || ""}` },
      max_memory_restart: "512M",
    }),
  ],
};
