// D1: the Warden as its own system user. The unit must start the same program
// pm2 starts, with the same interpreter flags, and none of the main user's files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const unit = read("../deploy/mro-warden.system.service");
const installer = read("../deploy/install-warden-user.sh");
const cutover = read("../deploy/cutover-warden-user.sh");
const builder = read("../deploy/build-clock-tree.sh");
const [app] = createRequire(import.meta.url)("../ecosystem.config.cjs").apps;

const line = (key) => unit.split("\n").find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

test("it runs as mro-warden, from the root-owned tree, with its own settings file", () => {
  assert.equal(line("User"), "mro-warden");
  assert.equal(line("Group"), "mro");
  assert.equal(line("WorkingDirectory"), "/opt/mro-warden/warden");
  assert.ok(line("ExecStart").startsWith("/opt/mro-warden/bin/node "));
  assert.ok(line("ExecStart").endsWith(" --env-file=/etc/mro-warden/warden.env src/main.mjs"));
});

test("the interpreter flags and the port are pm2's own", () => {
  for (const flag of app.node_args.filter((f) => !f.startsWith("--env-file"))) assert.ok(line("ExecStart").includes(flag), flag);
  assert.ok(line("Environment").includes(`PORT=${app.env.PORT}`));
  assert.ok(line("Environment").includes("NODE_ENV=production"));
});

test("it cannot see the main user's home, and writes only the shared mirror", () => {
  assert.equal(line("ProtectHome"), "true");
  assert.equal(line("ProtectSystem"), "strict");
  assert.equal(line("ReadWritePaths"), "/var/lib/mro");
  assert.equal(line("NoNewPrivileges"), "true");
  assert.equal(line("CapabilityBoundingSet"), "");
});

test("the installer builds from a clean commit and checks what each user can reach", () => {
  assert.ok(installer.includes("pass --commit <the full 40-character sha"));
  assert.ok(installer.includes("the checkout has uncommitted changes"));
  assert.ok(installer.includes('build-clock-tree.sh" "$REPO" "$COMMIT" "$STAGE" "$NODE_VERSION" "sudo -u $MAIN_USER" warden'));
  assert.ok(installer.includes("mro-warden CAN read the main user's"));
  assert.ok(installer.includes("mro-warden CAN read the split seed"));
  assert.ok(installer.includes("$MAIN_USER CAN read $ETC/warden"));
  assert.ok(installer.includes("the installed Warden uses $DB"), "never switches the live database");
});

test("the warden profile carries everything the Warden reads outside warden/src", () => {
  for (const path of ["warden/public", "tools", "server.json", "docs/2026-09-01-mro-raw-protocol.md", "skills/machine-readable-only"]) {
    assert.ok(builder.includes(path), path);
  }
  assert.match(builder, /cd "\$DEST\/tools" && .*npm ci --ignore-scripts/);
});

test("the cutover falls back to pm2 on any failure, and deletes pm2's copy only after a 200", () => {
  assert.match(cutover, /back_to_pm2\(\) \{\n\s*systemctl stop mro-warden\.service/);
  assert.ok(cutover.indexOf('"$PM2" delete mro-warden') > cutover.indexOf('[ "$CODE" = 200 ] || back_to_pm2'));
  assert.ok(cutover.includes("is not running as mro-warden"));
});
