// ecosystem.config.cjs must keep the operator's shell secrets out of the Warden.
//
// PM2 copies the environment of whoever ran `pm2 start` into the app, and Node
// lets a variable already in the environment win over --env-file. On
// 2026-09-11 the live Warden was found holding five credentials it never uses,
// inherited that way. `filter_env` is what stops it -- and only in its LIST
// form: `filter_env: true` is a no-op in PM2 7.0.1, because lib/Common.js tests
// `filter_env.length` and a boolean has none. Measured with a throwaway app on
// 2026-09-12: no filter and `true` both let all five through.
//
// So this pins the shape, and replays PM2's own list rule ("drop any variable
// whose name contains an entry") over the exact five names that were found.
//
// MUTATION-CHECKED WHEN WRITTEN: `filter_env: true` turned 3 of these 4 red,
// and a list of only ["CDP_"] turned the credentials test red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const [app] = require("../ecosystem.config.cjs").apps;

// The five credentials found in the live Warden's environment, 2026-09-11.
const INHERITED = [
  "CDP_API_KEY_ID",
  "CDP_API_KEY_SECRET",
  "CLOUDFLARE_API_TOKEN_MRO",
  "GH_TOKEN",
  "GITHUB_TOKEN_MRO",
];

// The operator's personal settings the hub's PM2 audit found still held by the
// live Warden, 2026-09-12. Not credentials, so the first list missed them.
const PERSONAL = ["NTFY_TOPIC", "DEFAULT_TO_ADDRESS"];

// Variables the process genuinely needs from the environment PM2 builds.
const NEEDED = ["PATH", "HOME", "NODE_ENV", "PORT"];

// PM2 7.0.1's list rule (lib/Common.js, filterEnv): a variable survives only
// if its name contains none of the entries.
const survives = (name) => !app.filter_env.some((part) => name.includes(part));

test("filter_env is a non-empty list, because `true` does nothing in PM2 7.0.1", () => {
  assert.ok(
    Array.isArray(app.filter_env),
    `filter_env is ${JSON.stringify(app.filter_env)}, which PM2 7.0.1 ignores`
  );
  assert.ok(app.filter_env.length > 0);
});

test("every credential found in the live Warden is dropped", () => {
  assert.deepEqual(INHERITED.filter(survives), []);
});

test("the operator's personal settings found in the live Warden are dropped", () => {
  assert.deepEqual(PERSONAL.filter(survives), []);
});

test("the variables the process needs still get through", () => {
  assert.deepEqual(NEEDED.filter(survives), NEEDED);
});

test("the configuration still arrives through --env-file, which filter_env does not touch", () => {
  assert.ok(app.node_args.includes("--env-file=.env"), JSON.stringify(app.node_args));
});

// Coinbase's CDP facilitator refuses the key over IPv6 and accepts it over IPv4
// (measured 2026-09-12, three rounds each way). Both flags, or Node still races
// an IPv6 connection.
test("every outgoing connection is pinned to IPv4, with both flags", () => {
  assert.ok(app.node_args.includes("--dns-result-order=ipv4first"), JSON.stringify(app.node_args));
  assert.ok(app.node_args.includes("--no-network-family-autoselection"), JSON.stringify(app.node_args));
});
