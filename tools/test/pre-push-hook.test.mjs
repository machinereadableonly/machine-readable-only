// The real pre-push hook, run by a real `git push` into a scratch remote. HOME
// is a fresh directory, so the machine's identity scanner is absent and only
// the pattern guard decides.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const HOME_TARGET = ["", "home", "someone", "projects", "mro"].join("/");

function rig(t) {
  const top = mkdtempSync(join(tmpdir(), "mro-prepush-"));
  t.after(() => rmSync(top, { recursive: true, force: true }));
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: join(top, "home"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  mkdirSync(env.HOME);
  const run = (cwd, ...args) => {
    const r = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=", "-c", "commit.gpgsign=false", ...args],
      { cwd, env, encoding: "utf8" });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  const remote = join(top, "remote.git");
  const work = join(top, "work");
  run(top, "init", "-q", "--bare", remote);
  run(top, "init", "-q", "-b", "main", work);
  mkdirSync(join(work, "tools"));
  mkdirSync(join(work, ".githooks"));
  copyFileSync(join(REPO, "tools/prepublish-check.mjs"), join(work, "tools/prepublish-check.mjs"));
  copyFileSync(join(REPO, ".githooks/pre-push"), join(work, ".githooks/pre-push"));
  writeFileSync(join(work, "notes.md"), "clean\n");
  const git = (...args) => run(work, ...args);
  git("add", "-A");
  git("commit", "-q", "-m", "clean");
  git("remote", "add", "origin", remote);
  git("push", "-q", "--no-verify", "origin", "main");
  git("config", "core.hooksPath", ".githooks");
  return { git, work };
}

test("a branch that is not HEAD is scanned when it is the one pushed", (t) => {
  const { git, work } = rig(t);
  git("checkout", "-q", "-b", "other");
  writeFileSync(join(work, "notes.md"), `clean\n${HOME_TARGET}/x\n`);
  git("commit", "-q", "-am", "leak");
  git("checkout", "-q", "main");

  const push = git("push", "origin", "other");
  assert.notEqual(push.code, 0, push.out);
  assert.match(push.out, /notes\.md:2: absolute home path/);
  assert.match(push.out, /nothing was pushed/);
});

test("CONTROL: a clean branch pushed from another branch goes through", (t) => {
  const { git, work } = rig(t);
  git("checkout", "-q", "-b", "other");
  writeFileSync(join(work, "more.md"), "also clean\n");
  git("add", "-A");
  git("commit", "-q", "-m", "clean too");
  git("checkout", "-q", "main");

  const push = git("push", "origin", "other");
  assert.equal(push.code, 0, push.out);
  assert.match(push.out, /pre-push: clean/);
});

test("a leak pushed as an older commit of the current branch is caught", (t) => {
  const { git, work } = rig(t);
  writeFileSync(join(work, "notes.md"), `clean\n${HOME_TARGET}/x\n`);
  git("commit", "-q", "-am", "leak");
  writeFileSync(join(work, "notes.md"), "clean\n");
  git("commit", "-q", "-am", "unleak");

  const push = git("push", "origin", "HEAD~1:refs/heads/main");
  assert.notEqual(push.code, 0, push.out);
  assert.match(push.out, /notes\.md:2: absolute home path/);
});
