// The installer, the cutover and clock-env.mjs each name the shared paths. If
// they drift, the Warden and the Clock read two different mirrors or banks.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLOCK_PATHS } from "../deploy/clock-env.mjs";

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
  assert.equal(assigned(cutover, "BANK").replace("$STATE", state), CLOCK_PATHS.bank);
});

test("the installer puts the bank where clock-env.mjs says the Clock reads it", () => {
  const dir = assigned(installer, "BANK_DIR").replace("$STATE", assigned(installer, "STATE"));
  assert.equal(dir, dirname(CLOCK_PATHS.bank));
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

test("the cutover never deletes the old database", () => {
  assert.doesNotMatch(cutover, /\brm\b[^\n]*OLD_DB/);
});
