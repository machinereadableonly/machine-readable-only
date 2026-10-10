// The seed config check decides whether the installer may start the unit. A
// real token with a bad day must stop it: starting it would check token 1 in
// for real, before its day, and that cannot be undone.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const CHECK = fileURLToPath(new URL("../deploy/seed-config-check.sh", import.meta.url));
const installer = readFileSync(new URL("../deploy/install-seed-agent.sh", import.meta.url), "utf8");

async function check(lines) {
  const env = join(mkdtempSync(join(tmpdir(), "mro-seedcfg-")), "seed.env");
  writeFileSync(env, lines.join("\n") + "\n");
  try {
    const { stdout } = await run("bash", [CHECK, env]);
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.code, out: err.stdout ?? "" };
  }
}

test("a rehearsal token with the rehearsal day may start", async () => {
  const r = await check(["MRO_SEED_TOKEN=999999", "MRO_SEED_NOT_BEFORE=2000-01-01"]);
  assert.equal(r.code, 0, r.out);
});

test("a real token with a real day may start", async () => {
  const r = await check(["MRO_SEED_TOKEN=1", "MRO_SEED_NOT_BEFORE=2027-03-02"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /token 1 checks in from 2027-03-02 \(UTC\)/);
});

test("a real token with a missing, empty, rehearsal or malformed day may NOT start", async () => {
  const days = [null, "", "2000-01-01", "2027-02-30", "0050-01-01", "2027-3-2", "tomorrow"];
  for (const day of days) {
    const lines = ["MRO_SEED_TOKEN=1"];
    if (day !== null) lines.push(`MRO_SEED_NOT_BEFORE=${day}`);
    const r = await check(lines);
    assert.equal(r.code, 1, `${JSON.stringify(day)}: ${r.out}`);
    assert.match(r.out, /FAIL .*opening day \+ 1/);
  }
});

test("a missing or malformed token may NOT start", async () => {
  for (const token of [null, "", "one", "0"]) {
    const lines = ["MRO_SEED_NOT_BEFORE=2027-03-02"];
    if (token !== null) lines.unshift(`MRO_SEED_TOKEN=${token}`);
    const r = await check(lines);
    assert.equal(r.code, 1, `${JSON.stringify(token)}: ${r.out}`);
    assert.match(r.out, /FAIL MRO_SEED_TOKEN/);
  }
});

test("the installer starts the unit only when the check passed", () => {
  assert.equal(installer.match(/systemctl --user start mro-seed\.service/g)?.length, 1);
  assert.match(installer, /if \[ "\$START_SAFE" = 1 \]; then\n(\s+#[^\n]*\n)*\s+systemctl --user reset-failed mro-seed\.service[^\n]*\n\s+systemctl --user start mro-seed\.service/);
  assert.match(installer, /seed-config-check\.sh" "\$ENV_FILE"/);
});

test("the installer and the check agree on the rehearsal values", () => {
  const check = readFileSync(CHECK, "utf8");
  for (const name of ["REHEARSAL_TOKEN", "REHEARSAL_NOT_BEFORE"]) {
    const pick = (s) => s.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1];
    assert.ok(pick(installer), `${name} in the installer`);
    assert.equal(pick(check), pick(installer), name);
  }
});
