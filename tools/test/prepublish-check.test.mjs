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

/// A throwaway git repository with the given paths COMMITTED. The scan reads
/// HEAD's blobs, so staging alone would give it nothing to read. The author is
/// a bare name with an EMPTY email, set per call: no machine identity is
/// involved, and no address of any kind appears here -- the identity scanner
/// flags every address it sees, reserved ones included, and a fixture that
/// trips the push guard is a fixture that teaches people to override it.
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
  const git = gitIn(dir);
  git("init", "-q");
  build(dir);
  commitAll(dir, "fixture");
  return dir;
}

const gitIn = (dir) => (...args) =>
  execFileSync("git", [
    "-c", "core.excludesFile=/dev/null",
    "-c", "user.name=fixture", "-c", "user.email=",
    "-c", "commit.gpgsign=false",
    ...args,
  ], { cwd: dir });

function commitAll(dir, message) {
  const git = gitIn(dir);
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", message);
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

// THE WORKING TREE IS NOT WHAT A PUSH PUBLISHES. A leak committed and then
// cleaned on disk -- but never re-committed -- read clean to a scan of the
// files, while the push carried the leak.
test("a leak that is committed but cleaned on disk is still flagged", (t) => {
  const dir = scratchRepo(t, (root) => {
    writeFileSync(join(root, "notes.md"), `${HOME_TARGET}/x\n`);
  });
  writeFileSync(join(dir, "notes.md"), "clean now, but only on disk\n");

  const { findings } = scanTree(dir);
  assert.deepEqual(findings, [{ file: "notes.md", line: 1, rule: "absolute home path" }]);
});

// THE 2026-09-21 SHAPE. A tracked path NAME is published exactly as content is.
test("a tracked path whose NAME carries a mangled home path is flagged", (t) => {
  const mangled = ["", "home", "someone", "projects", "mro"].join("-");
  const dir = scratchRepo(t, (root) => {
    mkdirSync(join(root, mangled));
    writeFileSync(join(root, mangled, "notes.md"), "nothing inside\n");
  });

  const { findings } = scanTree(dir);
  assert.deepEqual(
    findings.map((f) => [f.file, f.line, f.rule, f.pathName]),
    [[`${mangled}/notes.md`, 0, "mangled home path", true]],
  );
});

test("CONTROL: an ordinary path name is not flagged", (t) => {
  const dir = scratchRepo(t, (root) => {
    mkdirSync(join(root, "home-page"));
    writeFileSync(join(root, "home-page", "notes.md"), "nothing inside\n");
  });
  assert.deepEqual(scanTree(dir).findings, []);
});

// A LEAK ADDED IN ONE COMMIT AND REMOVED IN THE NEXT is gone from HEAD but is
// in the history a push publishes. Given the range, the scan reads it.
test("a leak added and removed inside the pushed range is flagged, and only with the range", (t) => {
  const dir = scratchRepo(t, (root) => {
    writeFileSync(join(root, "notes.md"), "clean\n");
  });
  const base = gitIn(dir)("rev-parse", "HEAD").toString().trim();
  writeFileSync(join(dir, "notes.md"), `clean\n${HOME_TARGET}/x\n`);
  commitAll(dir, "leak");
  writeFileSync(join(dir, "notes.md"), "clean\n");
  commitAll(dir, "unleak");

  assert.deepEqual(scanTree(dir).findings, [], "HEAD alone is clean -- which is exactly the hole");
  const range = `${base}..HEAD`;
  assert.deepEqual(scanTree(dir, { range }).findings, [
    { file: "notes.md", line: 2, rule: "absolute home path", history: range },
  ]);
});
