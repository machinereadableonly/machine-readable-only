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
      cwd: "~/projects/machine-readable-only/warden",
      interpreter: "~/.nvm/versions/node/v24.14.1/bin/node",
      // HOW THE CONFIGURATION ACTUALLY REACHES THE PROCESS. main.mjs requires
      // seven environment variables by name, and nothing in this repository
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
      node_args: ["--env-file=.env"],
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "512M",
      // No HOST here. main.mjs hardcodes 127.0.0.1 and never reads the
      // environment for it, so a HOST value in this block would be an
      // instruction that does nothing -- and the one a future operator would
      // reach for to try to expose this port, which is the thing this project
      // forbids outright.
      env: { NODE_ENV: "production", PORT: "3006" },
      error_file: "~/logs/mro-warden.err.log",
      out_file: "~/logs/mro-warden.out.log",
    },
  ],
};
