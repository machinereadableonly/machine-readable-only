// A maintenance tool acts on the live mirror or on nothing: never a relative
// default that names a stale copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveDbPath } from "../tools/live-db.mjs";

const settings = (text) => {
  const file = join(mkdtempSync(join(tmpdir(), "live-db-")), "settings");
  writeFileSync(file, text);
  return file;
};

test("an absolute path given is used as it is; a relative one is refused", () => {
  assert.equal(liveDbPath("/var/lib/mro/state.db", "/nonexistent"), "/var/lib/mro/state.db");
  assert.throws(() => liveDbPath("state.db", "/nonexistent"), /absolute path/);
});

test("with no path, the Warden's STATE_DB_PATH is used, and only if absolute", () => {
  assert.equal(liveDbPath(undefined, settings("A=1\nSTATE_DB_PATH=\"/var/lib/mro/state.db\"\n")), "/var/lib/mro/state.db");
  assert.throws(() => liveDbPath(undefined, settings("STATE_DB_PATH=./state.db\n")), /not an absolute path/);
  assert.throws(() => liveDbPath(undefined, settings("A=1\n")), /not an absolute path/);
  assert.throws(() => liveDbPath(undefined, "/nonexistent/settings"), /could not be read/);
});
