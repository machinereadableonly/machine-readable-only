// PM2 process definition. Fork mode, one instance, bound to loopback only:
// public traffic reaches this through nginx, never directly. See
// nginx.conf.example for the reverse proxy that terminates TLS and forwards
// to 127.0.0.1:3006, and DEPLOY.md for the ordered runbook this file is one
// step of.
module.exports = {
  apps: [
    {
      name: "mro-warden",
      script: "src/server.mjs",
      cwd: "~/projects/machine-readable-only/warden",
      interpreter: "~/.nvm/versions/node/v24.14.1/bin/node",
      exec_mode: "fork",
      instances: 1,
      max_memory_restart: "512M",
      env: { NODE_ENV: "production", PORT: "3006", HOST: "127.0.0.1" },
      error_file: "~/logs/mro-warden.err.log",
      out_file: "~/logs/mro-warden.out.log",
    },
  ],
};
