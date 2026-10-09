// The system units ARE the separation between the Clock and the main user, so
// each line that makes it is pinned here: nothing else would notice one going.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLOCK_PATHS } from "../deploy/clock-env.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const service = read("../deploy/mro-clock.system.service");
const timer = read("../deploy/mro-clock.system.timer");
const userTimer = read("../deploy/mro-clock.timer");
const alert = read("../deploy/mro-clock-alert.service.in");
const rotate = read("../deploy/mro-clock.logrotate");
const installer = read("../deploy/install-clock-user.sh");

/// Directive values, comments dropped.
const values = (unit, key) =>
  unit.split("\n").filter((l) => l.startsWith(`${key}=`)).map((l) => l.slice(key.length + 1));
const one = (unit, key) => {
  const v = values(unit, key);
  assert.equal(v.length, 1, `${key} appears once`);
  return v[0];
};

test("the Clock runs as its own user, never the main one", () => {
  assert.equal(one(service, "User"), "mro-clock");
  assert.equal(one(service, "Group"), "mro");
});

test("it reads its environment from the root-held file, through node", () => {
  assert.match(one(service, "ExecStart"), /^\/opt\/mro-clock\/bin\/node --env-file=\/etc\/mro-clock\/clock\.env src\/clock\/main\.mjs$/);
  assert.equal(one(service, "WorkingDirectory"), "/opt/mro-clock/warden");
  assert.deepEqual(values(service, "EnvironmentFile"), [], "systemd would show the key in `systemctl show`");
});

test("it can write the shared state directory and its own ledger, and nothing else", () => {
  assert.equal(one(service, "ProtectSystem"), "strict");
  assert.equal(one(service, "ProtectHome"), "true");
  assert.equal(one(service, "ReadWritePaths"), "/var/lib/mro /var/lib/mro-clock");
  assert.ok(CLOCK_PATHS.stateDb.startsWith("/var/lib/mro/"));
  assert.ok(CLOCK_PATHS.ledger.startsWith("/var/lib/mro-clock/"));
  assert.ok(CLOCK_PATHS.bank.startsWith("/etc/mro-clock/"), "the Clock's bank is out of the main user's reach");
});

test("files it creates stay inside the mro group", () => {
  assert.equal(one(service, "UMask"), "0007");
});

test("a failed night calls the alert unit", () => {
  assert.equal(one(service, "OnFailure"), "mro-clock-alert.service");
  assert.match(one(alert, "ExecStart"), /^@NOTIFY@ "MRO Clock failed" ".+" high$/);
  assert.equal(one(alert, "User"), "@MAIN_USER@");
});

test("the system timer fires exactly when the user timer did", () => {
  for (const key of ["OnCalendar", "Persistent", "RandomizedDelaySec"]) {
    assert.equal(one(timer, key), one(userTimer, key), key);
  }
});

test("its log is the one logrotate rotates, and rotation keeps the file", () => {
  const out = one(service, "StandardOutput");
  assert.equal(out, "append:/var/log/mro/clock.log");
  assert.equal(one(service, "StandardError"), out);
  assert.match(rotate, /^\/var\/log\/mro\/clock\.log \{/m);
  assert.match(rotate, /^\s*copytruncate$/m);
  assert.doesNotMatch(rotate, /^\s*su\s/m, "mro-clock cannot create files in the 2750 log directory");
});

test("a differing split seed is refused unless replacing it is asked for", () => {
  assert.match(installer, /! cmp -s "\$SEED_SRC" "\$ETC\/split-seed" && \[ "\$REPLACE_SEED" -eq 0 \]; then\n\s*die /);
});

test("the logrotate check reads error lines, since --debug exits 0 on them", () => {
  assert.match(installer, /\/bin\/grep -q '\^error:' <<<"\$ROTATE_CHECK"/);
});

// The repository is public: a username or home path here would leak, and the
// installer fills the template from SUDO_USER instead.
test("no tracked unit names a user's home", () => {
  for (const text of [service, timer, alert, rotate]) {
    assert.doesNotMatch(text, /\/home\/|%h/);
  }
});

test("the installer installs the timer DISABLED", () => {
  assert.doesNotMatch(installer, /systemctl\s+(enable|start)\b[^\n]*mro-clock\.timer/);
});
