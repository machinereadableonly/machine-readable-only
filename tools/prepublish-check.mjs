// Pre-publish guard. Fails if anything COMMITTED -- a file, a path name, or,
// given a range, a blob in the commits being pushed -- would leak an operator
// identity or a machine-specific path into a public repository.
//
// Deliberately GENERIC: it holds no personal values, so this file is safe to
// publish alongside everything it checks. The private token list lives outside
// the repository and is checked separately by ~/scripts/id-scan.mjs, which the
// pre-push hook runs right after this.
//
// Run: node tools/prepublish-check.mjs [range]   e.g. origin/main..HEAD
// Exit 0 = clean, exit 1 = findings.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// Files that are allowed to contain what would otherwise be a finding, with
// the reason. Keep this list short and justified -- an entry here is a
// decision, not a convenience.
/**
 * Files exempted from ONE NAMED RULE each, with the reason.
 *
 * The value used to be a bare reason string and the check was
 * `ALLOW.has(rel)`, which exempted the file from EVERY rule -- so a fixture
 * allowed for its invented home path was also unchecked for real email
 * addresses and for AI attribution, for as long as it stayed on the list. The
 * value is now `{ rules, why }` and only the named rules are waived.
 *
 * Do NOT add a file here to silence a finding. Reword the file instead. Both
 * entries below exist because scrubbing them would disable the thing they are
 * for.
 */
const ALLOW = new Map([
  [
    "tools/prepublish-check.mjs",
    { rules: ["absolute home path", "email address", "AI attribution"], why: "this file defines the patterns" },
  ],
  [
    "warden/test/mcp.test.mjs",
    {
      rules: ["absolute home path"],
      why:
        "the /home/secret/... path is an invented fixture; the test asserts that " +
        "exact string never reaches a caller, so removing it would remove the test",
    },
  ],
]);

/// Is this file exempt from THIS rule? An entry that names other rules does
/// not help it here, which is the whole point.
function allows(rel, ruleName) {
  const entry = ALLOW.get(rel);
  return Boolean(entry && entry.rules.includes(ruleName));
}

// Vendored third-party sources. Their contributors' addresses are upstream's
// to publish, not ours, and rewriting them would corrupt the dependency.
//
// `docs/reviews/` is skipped for a different reason: a review QUOTES the file
// it found a leak in, so the quote is the evidence. Scrubbing it would delete
// the finding while leaving the recommendation, and a checker that reports
// eight findings on every run is a checker that gets ignored -- which is the
// only way this file can actually fail at its job.
const SKIP_PREFIX = ["contracts/lib/", "docs/reviews/"];

const RULES = [
  {
    name: "absolute home path",
    // Any /home/<user>/... or /Users/<user>/... reveals the operator's account
    // name and the machine layout. Use ~ in docs, %h in systemd units, and
    // derive paths from import.meta.url or os.homedir() in code.
    re: /\/(?:home|Users)\/[A-Za-z0-9._-]+\//,
  },
  {
    name: "email address",
    // Package metadata should use the registry's noreply form; anything else
    // belongs in configuration read at runtime, never in a tracked file.
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    // example.com and example.org are RFC 2606 reserved and cannot resolve.
    ok: (m) => /@example\.(com|org|net)$/.test(m) || /noreply/i.test(m),
  },
  {
    name: "AI attribution",
    // The commit-hygiene rule forbids these in messages; they must not appear
    // in tracked content either.
    re: /co-authored-by:.*(anthropic|claude)|generated with \[?claude/i,
  },
  {
    name: "session scratchpad path",
    // ADDED 2026-09-21, after one reached the public repository. A scratchpad
    // path lives under the per-user claude directory in tmp and continues
    // `-home-<user>-<project>/<session>/scratchpad`, so it carries the
    // username MANGLED and the "absolute home path" rule above cannot see it.
    // Two separate shapes, two separate rules.
    //
    // The shape is DESCRIBED rather than written out: a literal example here
    // would be matched and mangled by the history scrub that removes real
    // ones, which is exactly what happened to the first draft of this comment.
    //
    // Nothing tracked should ever name one: exploratory output belongs in the
    // gitignored tools/out, and a tool that writes there reads the directory
    // from MRO_SHEET_OUT or defaults to "out".
    re: /\/tmp\/claude-[A-Za-z0-9._-]*\//,
  },
  {
    name: "mangled home path",
    // The same username in the form a path-mangled directory uses, wherever it
    // appears -- not only under /tmp.
    re: /-home-[a-z0-9_]+-[a-z0-9-]+/i,
  },
  {
    name: "session or task id",
    // A bare uuid is fine; one sitting next to a session or scratchpad word is
    // a transcript artifact that identifies a machine and a moment.
    re: /(?:session|task|scratchpad)[^\n]{0,40}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  },
  {
    name: "AI session link",
    // Distinct from the attribution trailer: a link to a conversation.
    re: /claude\.ai\/(?:code|chat)\/|noreply@anthropic\.com/i,
  },
];

/// Every rule applied to one line of one tracked path. `extra` rides on each
/// finding: `{ pathName: true }` for a match in the path itself, `{ history }`
/// for a blob that is in the pushed commits but no longer in HEAD.
function scanLine(rel, line, lineNo, findings, extra = {}) {
  for (const rule of RULES) {
    const m = line.match(rule.re);
    if (!m) continue;
    if (rule.ok && rule.ok(m[0])) continue;
    // THE EXEMPTION IS PER RULE, not per file. `ALLOW.has(rel)` exempted a
    // file from EVERY rule -- so a fixture allowed for its invented home
    // path was also unchecked for real email addresses and for AI
    // attribution, silently, for as long as it stayed on the list. Each
    // entry now names the rule it was granted, and anything else in that
    // file is still a finding.
    if (allows(rel, rule.name)) continue;
    findings.push({ file: rel, line: lineNo, rule: rule.name, ...extra });
  }
}

const skipped = (rel) => SKIP_PREFIX.some((p) => rel.startsWith(p));

/// Run git in `root` and return stdout as a Buffer. maxBuffer is raised
/// because `cat-file --batch` returns every committed file at once.
const git = (root, args, input) =>
  execFileSync("git", args, { cwd: root, input, maxBuffer: 1 << 30 });

/**
 * Read many objects in ONE `git cat-file --batch` call and return a Map of
 * sha -> Buffer. An object git cannot find is left out, and the caller names it.
 */
function readBlobs(root, shas) {
  const out = new Map();
  if (shas.length === 0) return out;
  const buf = git(root, ["cat-file", "--batch"], shas.join("\n") + "\n");
  let at = 0;
  while (at < buf.length) {
    const eol = buf.indexOf(0x0a, at);
    const [sha, type, size] = buf.subarray(at, eol).toString("utf8").split(" ");
    at = eol + 1;
    if (type === "missing") continue;
    const n = Number(size);
    out.set(sha, buf.subarray(at, at + n));
    at += n + 1; // the content, then the newline git puts after it
  }
  return out;
}

/// Every rule over one blob's text, line by line. Binary blobs are skipped.
function scanBlob(rel, content, findings, extra, onLine) {
  if (content.includes(0)) return; // binary: nothing to match
  content.toString("utf8").split("\n").forEach((line, i) => {
    onLine?.(line);
    scanLine(rel, line, i + 1, findings, extra);
  });
}

/**
 * Scan what is COMMITTED, never the working tree.
 *
 * WHY COMMITTED. This runs from the pre-push hook, and a push publishes
 * commits, not the files on disk. Reading the working tree let two shapes
 * through: a leak committed and then cleaned on disk but not re-committed
 * (the scan saw the clean file, the push carried the leak), and a symlink,
 * whose committed blob IS its target string but which readFileSync followed
 * (the 2026-09-24 leak). Reading blobs from git answers both: a symlink's blob
 * is scanned as the text it is, and nothing is read through a link.
 *
 * PATH NAMES ARE SCANNED TOO. The 2026-09-21 leak was a session scratchpad
 * path, and a tracked path name is published exactly as its content is. A
 * match in a name comes back with `pathName: true` and line 0.
 *
 * `range` (e.g. `origin/main..HEAD`) adds every blob the pushed commits carry
 * that HEAD no longer does. A leak added in one commit and removed in the next
 * is not in HEAD, but it IS in the history the push publishes. Those findings
 * carry `history: range`.
 *
 * Exported so it can be driven against a scratch repository by a test. The
 * repository is the default, and running this file as a script scans it.
 *
 * Returns `{ tracked, findings, pending, unreadable }`.
 */
export function scanTree(root = REPO_ROOT, { range = null } = {}) {
  // `mode type sha<TAB>path`, NUL-separated so no path can break the parse.
  const entries = git(root, ["ls-tree", "-r", "-z", "HEAD"])
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((rec) => {
      const tab = rec.indexOf("\t");
      const [mode, type, sha] = rec.slice(0, tab).split(" ");
      return { mode, type, sha, path: rec.slice(tab + 1) };
    })
    .filter((e) => !skipped(e.path));
  const tracked = entries.map((e) => e.path);

  const findings = [];
  // Counted, not reported line by line. A PENDING-BEFORE-MAINNET marker is not
  // a leak and does not block publishing the repository -- it blocks INVITING
  // an agent, because SKILL.md is the only out-of-band source for the treasury
  // it would pay. So it is a notice with a count, and the hard gate is the
  // launch checklist plus tools/test/skill-doc.test.mjs.
  let pending = 0;
  // Objects git could not produce. NAMED rather than skipped: a guard that
  // cannot read a path has not checked it.
  const unreadable = [];

  for (const e of entries) scanLine(e.path, e.path, 0, findings, { pathName: true });

  // A gitlink (submodule) is a commit id, with no content of its own here.
  const blobs = entries.filter((e) => e.type === "blob");
  const contents = readBlobs(root, blobs.map((e) => e.sha));
  for (const e of blobs) {
    const content = contents.get(e.sha);
    if (!content) { unreadable.push({ file: e.path, why: "missing object" }); continue; }
    scanBlob(e.path, content, findings, {}, (line) => {
      if (line.includes("PENDING-BEFORE-MAINNET")) pending += 1;
    });
  }

  if (range) {
    // `sha path` for every object the range introduces; commits have no path.
    const inHead = new Set(blobs.map((e) => e.sha));
    const seen = new Map();
    for (const line of git(root, ["rev-list", "--objects", range]).toString("utf8").split("\n")) {
      const space = line.indexOf(" ");
      if (space < 0) continue;
      const sha = line.slice(0, space);
      const path = line.slice(space + 1);
      if (!inHead.has(sha) && !seen.has(sha) && !skipped(path)) seen.set(sha, path);
    }
    // Trees are in that list too: ask git which of the objects are blobs.
    const types = seen.size
      ? git(root, ["cat-file", "--batch-check"], [...seen.keys()].join("\n") + "\n").toString("utf8")
      : "";
    const historyBlobs = types
      .split("\n")
      .map((l) => l.split(" "))
      .filter(([, type]) => type === "blob")
      .map(([sha]) => ({ sha, path: seen.get(sha) }));
    const old = readBlobs(root, historyBlobs.map((b) => b.sha));
    for (const b of historyBlobs) {
      scanLine(b.path, b.path, 0, findings, { pathName: true, history: range });
      const content = old.get(b.sha);
      if (!content) { unreadable.push({ file: b.path, why: "missing object" }); continue; }
      scanBlob(b.path, content, findings, { history: range });
    }
  }

  return { tracked, findings, pending, unreadable };
}

/// The whole check, as the script runs it. Reports to the console and answers
/// with the exit code: 0 clean, 1 findings.
function main() {
  // The pre-push hook passes the range being pushed; run by hand, HEAD alone.
  const range = process.argv[2] ?? null;
  const { tracked, findings, pending, unreadable } = scanTree(REPO_ROOT, { range });

  // Author identity across the whole history. A personal mailbox in an author
  // field is not fixed by editing files -- it needs a history rewrite.
  const authors = new Set(
    execFileSync("git", ["log", "--all", "--format=%ae%n%ce"], { cwd: REPO_ROOT, encoding: "utf8" })
      .split("\n")
      .filter(Boolean),
  );
  const badAuthors = [...authors].filter((a) => !a.endsWith("users.noreply.github.com"));

  // A GitHub noreply address takes one of two documented forms and BOTH carry
  // the account username: "ID+USERNAME@users.noreply.github.com" (accounts after
  // 2017-07-18) and "USERNAME@users.noreply.github.com" (older accounts). There
  // is no documented ID-only form. So publishing under a personal account always
  // exposes the username in every commit -- which is expected, because the
  // account name is in the repository URL too. This is a notice, not a failure:
  // it is only a problem if the repository is meant to be unattributable.
  const carriesUsername = [...authors].filter((a) => a.includes("+") || !/^\d/.test(a));
  if (carriesUsername.length) {
    console.log(
      `prepublish-check: notice -- ${carriesUsername.length} commit identity carries the ` +
        `account username (expected when publishing under that account; the URL shows it too)`,
    );
  }

  // NAMED, NOT SILENT. Every object is read from git, so nothing is expected
  // here; a path listed has NOT been checked, so it is printed even though it
  // is not itself a finding.
  for (const u of unreadable) {
    console.error(`prepublish-check: notice -- ${u.file} could not be read (${u.why}); it was NOT checked`);
  }

  if (pending > 0) {
    console.error(
      `prepublish-check: notice -- ${pending} PENDING-BEFORE-MAINNET marker(s) still unfilled. ` +
        "Not a leak and not a blocker for the repository, but no agent may be invited until " +
        "SKILL.md carries the real treasury, contract, package and repository."
    );
  }

  if (findings.length === 0 && badAuthors.length === 0) {
    console.log(`prepublish-check: clean (${tracked.length} tracked files, ${authors.size} identity)`);
    return 0;
  }

  for (const f of findings) {
    const where = f.pathName ? "(path name)" : f.line;
    const when = f.history ? ` [in the history of ${f.history}, gone from HEAD]` : "";
    console.error(`${f.file}:${where}: ${f.rule}${when}`);
  }
  if (badAuthors.length) {
    // Print the count, never the address: this output lands in logs and
    // transcripts.
    console.error(`git history: ${badAuthors.length} author/committer identity not in noreply form`);
  }
  console.error(`prepublish-check: ${findings.length + badAuthors.length} finding(s)`);
  return 1;
}

// Run the check when this file IS the command, and stay quiet when it is
// imported -- a test drives `scanTree` against a scratch repository, and a
// module that scanned and called process.exit on import would end that test
// process instead.
//
// `import.meta.main` is the documented entry-point test (Node >= 24.2 / 22.18;
// this package requires 24). It is compared against FALSE, not to true: a Node
// that does not have it leaves this undefined, and the check must run then.
// A guard that silently does not run is worse than no guard -- that is how the
// symlink above got published -- so the unknown case is the checking case.
if (import.meta.main !== false) {
  process.exit(main());
}
