// The deletion script must remove exactly the backups the Clock installer
// refuses on, never print a value, and delete nothing without "delete".
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../deploy/delete-clock-key-backups.sh", import.meta.url));
const INSTALLER = readFileSync(new URL("../deploy/install-clock-user.sh", import.meta.url), "utf8");
const SECRET = "0x" + "ab".repeat(32);

function home() {
  const h = mkdtempSync(join(tmpdir(), "mro-delbak-"));
  mkdirSync(join(h, ".mro-env-backups"));
  mkdirSync(join(h, "backups"));
  const files = {
    keyed1: join(h, ".mro-env-backups", "env.2026-09-03"),
    keyed2: join(h, "backups", "warden-env.bak.1"),
    empty: join(h, "backups", "warden-env.bak.2"),
    clean: join(h, "backups", "other.txt"),
  };
  writeFileSync(files.keyed1, `A=1\nCLOCK_PRIVATE_KEY=${SECRET}\n`);
  writeFileSync(files.keyed2, `CLOCK_PRIVATE_KEY=${SECRET}\nB=2\n`);
  writeFileSync(files.empty, "CLOCK_PRIVATE_KEY=\n");
  writeFileSync(files.clean, "nothing here\n");
  return { h, files };
}

function run(h, args, input) {
  return new Promise((resolve) => {
    const p = spawn("bash", [SCRIPT, ...args], { env: { PATH: process.env.PATH, HOME: h } });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
    p.stdin.end(input ?? "");
  });
}

test("searches with the installer's own pattern", () => {
  assert.ok(INSTALLER.includes("'^CLOCK_PRIVATE_KEY=.'"));
  assert.ok(readFileSync(SCRIPT, "utf8").includes("'^CLOCK_PRIVATE_KEY=.'"));
});

test("a dry run lists the keyed files by name and deletes nothing", async () => {
  const { h, files } = home();
  const r = await run(h, ["--dry-run"]);
  assert.equal(r.code, 0);
  assert.ok(r.out.includes(files.keyed1) && r.out.includes(files.keyed2));
  assert.ok(!r.out.includes(files.empty) && !r.out.includes(files.clean));
  assert.ok(!r.out.includes(SECRET));
  for (const f of Object.values(files)) assert.ok(existsSync(f));
});

test("anything but 'delete' deletes nothing", async () => {
  const { h, files } = home();
  const r = await run(h, [], "yes\n");
  assert.equal(r.code, 1);
  assert.ok(existsSync(files.keyed1) && existsSync(files.keyed2));
});

test("'delete' removes only the keyed files and says none are left", async () => {
  const { h, files } = home();
  const r = await run(h, [], "delete\n");
  assert.equal(r.code, 0, r.out);
  assert.ok(!existsSync(files.keyed1) && !existsSync(files.keyed2));
  assert.ok(existsSync(files.empty) && existsSync(files.clean));
  assert.ok(!r.out.includes(SECRET));
  assert.match(r.out, /no backup holds a Clock key now/);
  assert.match((await run(h, [])).out, /Nothing to delete/);
});
