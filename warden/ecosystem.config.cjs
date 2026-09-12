// Paths are derived, never hardcoded: cwd from this file's own location, and
// anything under the home directory from os.homedir(), so the repository can
// be cloned anywhere and this file needs no editing.
const { homedir } = require("os");

// PM2 process definition. Fork mode, one instance, bound to loopback only:
// public traffic reaches this through nginx, never directly. See
// nginx.conf.example for the reverse proxy that terminates TLS and forwards
// to 127.0.0.1:3006, and DEPLOY.md for the ordered runbook this file is one
// step of.
module.exports = {
  apps: [
    {
      name: "mro-warden",
      script: "src/main.mjs",
      cwd: __dirname,
      interpreter: homedir() + "/.nvm/versions/node/v24.14.1/bin/node",
      // HOW THE CONFIGURATION ACTUALLY REACHES THE PROCESS. main.mjs requires
      // eight environment variables by name, and nothing in this repository
      // loaded them: `env` below supplies NODE_ENV and PORT, and none of the
      // seven, so without this the Warden refused to start -- loudly, but it
      // refused.
      // `node_args` is PM2's key for interpreter arguments (verified against
      // the installed PM2 7.0.1's own lib/API/schema.json, where
      // interpreter_args is an alias of it), and the flag below is stable in
      // this pinned Node 24.14.1 (verified with `node --help`).
      //
      // The path is relative to `cwd` above, so it is this directory's own
      // environment file. NOT the --env-file-if-exists variant: a missing
      // configuration file must stop the process, not start it with half its
      // settings.
      //
      // IPv4 ONLY, for every outgoing connection. This box prefers IPv6, and
      // Coinbase's CDP facilitator refuses our key over IPv6 while accepting it
      // over IPv4 -- measured 2026-09-12, three rounds each way, 401 against
      // 200 (the key's IP allowlist holds the IPv4 address). BOTH flags are
      // needed: the first orders DNS answers, the second stops Node racing an
      // IPv6 connection anyway. Pinned for the whole process rather than per
      // call, so the facilitator, the RPC and anything added later all leave
      // from the one address an allowlist knows.
      node_args: [
        "--dns-result-order=ipv4first",
        "--no-network-family-autoselection",
        "--env-file=.env",
      ],
      // THE SHELL'S SECRETS ARE NOT THIS PROCESS'S BUSINESS. PM2 copies the whole
      // environment of whoever ran `pm2 start` into the app, and every session
      // shell on this box loads the operator's infra secrets file -- so the
      // Warden was holding a Cloudflare token, two GitHub tokens and the CDP
      // key, none of which it reads from there. Worse, Node lets the
      // ENVIRONMENT win over --env-file ("the value from the environment takes
      // precedence", Node 24 docs), so a stale CDP key in the shell would
      // silently override a corrected one in the file above.
      //
      // A LIST, NEVER `true`. PM2's docs say `filter_env: true` drops every
      // inherited variable. In the installed PM2 7.0.1 it does nothing:
      // lib/Common.js tests `filter_env.length`, and a boolean has none.
      // Measured 2026-09-12 with a throwaway app -- no filter and `true` both
      // passed all five names through, this list passed none. Each entry drops
      // any variable whose NAME contains it. The Warden's real configuration
      // arrives through --env-file above, which this does not touch.
      //
      // Not only credentials. The operator's personal settings are no business
      // of this process either, and a credential-shaped list misses them: on
      // 2026-09-12 the hub's PM2 audit found the live Warden still holding the
      // operator's alert topic (NTFY_TOPIC -- an ntfy topic has no password, so
      // its name IS the access) and personal mailbox (DEFAULT_TO_ADDRESS).
      // Nothing in this repository reads either. `_ADDRESS` drops the whole
      // family; the Warden's own addresses come from --env-file, untouched.
      filter_env: ["TOKEN", "SECRET", "_KEY", "PASSWORD", "CDP_", "CLOUDFLARE", "NTFY_", "_ADDRESS"],
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "512M",
      // No HOST here. main.mjs hardcodes 127.0.0.1 and never reads the
      // environment for it, so a HOST value in this block would be an
      // instruction that does nothing -- and the one a future operator would
      // reach for to try to expose this port, which is the thing this project
      // forbids outright.
      env: { NODE_ENV: "production", PORT: "3006" },
      error_file: homedir() + "/logs/mro-warden.err.log",
      out_file: homedir() + "/logs/mro-warden.out.log",
    },
  ],
};
