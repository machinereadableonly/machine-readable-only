// The installer, the cutover and clock-env.mjs each name the shared paths. If
// they drift, the Warden and the Clock read two different mirrors or banks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLOCK_PATHS, WARDEN_BANK } from "../deploy/clock-env.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const cutover = read("../deploy/cutover-clock-user.sh");
const installer = read("../deploy/install-clock-user.sh");
const assigned = (text, name) => {
  const m = new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(text);
  assert.ok(m, `${name} is assigned`);
  return m[1];
};

test("the cutover points the Warden at the Clock's own database and bank", () => {
  const state = assigned(cutover, "STATE");
  assert.equal(assigned(cutover, "NEW_DB").replace("$STATE", state), CLOCK_PATHS.stateDb);
  assert.equal(assigned(cutover, "BANK").replace("$STATE", state), WARDEN_BANK);
});

test("the installer puts both banks where the Warden and the Clock read them", () => {
  const dir = assigned(installer, "BANK_DIR").replace("$STATE", assigned(installer, "STATE"));
  assert.equal(dir, dirname(WARDEN_BANK));
  assert.equal(dirname(CLOCK_PATHS.bank), assigned(installer, "ETC"));
  assert.match(installer, /"\$ETC\/bank\.json"/);
  assert.equal(dirname(CLOCK_PATHS.ledger), assigned(installer, "LEDGER_DIR"));
  assert.equal(dirname(CLOCK_PATHS.splitSeed), assigned(installer, "ETC"));
  assert.match(installer, /"\$ETC\/split-seed"/);
});

test("pm2's list is saved before the daemon restarts, or apps would be lost", () => {
  const save = cutover.indexOf('"$PM2" save');
  const restart = cutover.indexOf('systemctl restart "pm2-$MAIN_USER"');
  assert.ok(save !== -1 && restart !== -1 && save < restart);
});

test("the cutover refuses the nightly window, an existing target and a run lock", () => {
  assert.match(cutover, /-ge 0030 \] && \[ "\$NOW" -lt 2345/);
  assert.match(cutover, /\[ ! -e "\$NEW_DB" \] \|\| die/);
  assert.match(cutover, /\[ ! -e "\$OLD_DB\.run-lock" \] \|\| die/);
});

test("the Clock timer is enabled only after the Warden answers again", () => {
  const healthy = cutover.indexOf('ok "the Warden answers 200"');
  const enable = cutover.indexOf("systemctl enable --now mro-clock.timer");
  assert.ok(healthy !== -1 && enable !== -1 && healthy < enable);
});

// pm2 resurrect starts every saved app, stopped ones included.
test("the cutover refuses while pm2 holds an app that is not online", () => {
  const check = cutover.indexOf('[ -z "$NOT_ONLINE" ] || die');
  const restart = cutover.indexOf('systemctl restart "pm2-$MAIN_USER"');
  assert.ok(check !== -1 && check < restart);
  assert.match(cutover, /status !== "online"/);
});

test("the old user timer must read 'disabled', not merely 'not enabled'", () => {
  assert.match(cutover, /\[ "\$OLD_TIMER" = disabled \] \|\| die/);
});

test("one real run and the alert both pass before the timer is enabled", () => {
  const run = cutover.indexOf("systemctl start mro-clock.service");
  const alert = cutover.indexOf("systemctl start mro-clock-alert.service");
  const enable = cutover.indexOf("systemctl enable --now mro-clock.timer");
  assert.ok(run !== -1 && alert !== -1 && run < enable && alert < enable);
  assert.match(cutover, /\/bin\/grep -q '\^clock: run finished'/);
});

test("a key appended to a file with no final newline starts its own line", () => {
  assert.match(cutover, /\[ -z "\$\(tail -c1 "\$WARDEN_ENV"\)" \] \|\| echo/);
});

test("the cutover never deletes the old database", () => {
  assert.doesNotMatch(cutover, /\brm\b[^\n]*OLD_DB/);
});

// pm2 is a `#!/usr/bin/env node` script and sudo resets PATH: without its
// daemon's PATH the first pm2 call under sudo cannot find node.
test("pm2 runs under sudo with the PATH its own daemon uses", () => {
  assert.match(cutover, /PM2_PATH="\$\(sed -n 's\|\^Environment=PATH=\|\|p' "\$PM2_UNIT"/);
  assert.match(cutover, /as_main\(\) \{ sudo -u "\$MAIN_USER" [^}]*PATH="\$PM2_PATH" "\$@"; \}/);
});

test("any exit while no Clock timer is enabled says so", () => {
  const disable = cutover.indexOf("user_ctl disable --now mro-clock.timer");
  const trap = cutover.indexOf("trap no_timer_notice EXIT");
  const enable = cutover.indexOf("systemctl enable --now mro-clock.timer");
  const done = cutover.indexOf("CUT_DONE=1");
  assert.ok(disable !== -1 && disable < trap && trap < enable && enable < done);
});
