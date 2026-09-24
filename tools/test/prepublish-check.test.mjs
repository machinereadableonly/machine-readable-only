// The publish guard, checked against the thing it missed.
//
// On 2026-09-24 a `git add -A` in a worktree tracked `warden/node_modules` --
// a SYMLINK, whose blob is its target: an absolute home path. Two guards were
// meant to stop that and neither did. `.gitignore` said `node_modules/`, which
// matches directories only, so the link was never ignored; and this checker
// read every tracked path with readFileSync, which FOLLOWS a link, so a link
// to a directory threw EISDIR into a bare `catch { continue }`. The guard ran,
// said clean, and had not looked at the one path that carried the leak.
//
// These tests drive the scan against a scratch repository, because the only
// honest proof is a tracked symlink the guard has to find.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanTree } from "../prepublish-check.mjs";

// THE LEAKING TARGET IS BUILT, NOT WRITTEN. A literal absolute home path in
// this file would be a finding in this file -- the guard scans its own tree,
// and the fixture would fail the check it exists to prove.
const HOME_TARGET = ["", "home", "someone", "projects", "mro", "node_modules"].join("/");

/// A throwaway git repository with the given paths staged. Nothing is
/// committed: `git ls-files` reads the index, so staging is all the scan needs
/// and no author identity is involved.
///
/// `core.excludesFile=/dev/null` ON EVERY GIT CALL. A global ignore file is
/// this machine's business and not the fixture's, and one line in it matching
/// `node_modules` would make `git add -A` skip the symlink these tests exist to
/// catch -- leaving a suite that passes because it staged nothing. The guard
/// would then be proven by a repository with no leak in it.
///
/// The directory is removed when the test that made it ends: `mkdtempSync`
/// leaves it behind otherwise, and a run per commit accumulates them in the
/// system temp directory for ever.
function scratchRepo(t, build) {
  const dir = mkdtempSync(join(tmpdir(), "mro-prepublish-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-c", "core.excludesFile=/dev/null", ...args], { cwd: dir });
  git("init", "-q");
  build(dir);
  git("add", "-A");
  return dir;
}

test("a tracked symlink whose target is an absolute home path is flagged", (t) => {
  const dir = scratchRepo(t, (root) => {
    mkdirSync(join(root, "warden"));
    writeFileSync(join(root, "warden/ok.mjs"), "// nothing to see\n");
    symlinkSync(HOME_TARGET, join(root, "warden/node_modules"));
  });

  const { findings, tracked } = scanTree(dir);
  assert.ok(tracked.includes("warden/node_modules"), "the symlink must be tracked, or this proves nothing");
  assert.deepEqual(
    findings.map((f) => `${f.file}: ${f.rule}`),
    ["warden/node_modules: absolute home path"],
  );
});

test("CONTROL: a tracked symlink with a relative target is not flagged", (t) => {
  // Without this, the test above would pass for a checker that flagged every
  // symlink it saw -- which would fail on any legitimate relative link.
  const dir = scratchRepo(t, (root) => {
    mkdirSync(join(root, "warden"));
    mkdirSync(join(root, "shared"));
    writeFileSync(join(root, "shared/keep"), "\n");
    symlinkSync("../shared", join(root, "warden/shared"));
  });

  const { findings, tracked } = scanTree(dir);
  assert.ok(tracked.includes("warden/shared"));
  assert.deepEqual(findings, []);
});

test("CONTROL: an ordinary file is still read, line by line", (t) => {
  // The scan must not have been broken in the course of teaching it about
  // links: an absolute home path inside a FILE is the rule's original case,
  // and the line number is part of the answer.
  const dir = scratchRepo(t, (root) => {
    writeFileSync(join(root, "notes.md"), `first line\nsecond ${HOME_TARGET}/x\n`);
  });

  const { findings } = scanTree(dir);
  assert.deepEqual(findings, [{ file: "notes.md", line: 2, rule: "absolute home path" }]);
});

test("a tracked path that cannot be read is named, never silently skipped", (t) => {
  // A silent skip is what let the symlink through. A path the guard could not
  // read has NOT been checked, so it comes back in `unreadable` for the script
  // to print.
  const dir = scratchRepo(t, (root) => {
    writeFileSync(join(root, "gone.txt"), "staged, then removed\n");
  });
  execFileSync("rm", [join(dir, "gone.txt")]);

  const { unreadable } = scanTree(dir);
  assert.deepEqual(unreadable.map((u) => u.file), ["gone.txt"]);
});
