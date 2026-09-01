// Pre-publish guard. Fails if anything in the tracked tree would leak an
// operator identity or a machine-specific path into a public repository.
//
// Deliberately GENERIC: it holds no personal values, so this file is safe to
// publish alongside everything it checks. The private token list lives outside
// the repository and is checked separately, by hand, before publishing.
//
// Run: node tools/prepublish-check.mjs
// Exit 0 = clean, exit 1 = findings.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;

// Files that are allowed to contain what would otherwise be a finding, with
// the reason. Keep this list short and justified -- an entry here is a
// decision, not a convenience.
const ALLOW = new Map([
  ["tools/prepublish-check.mjs", "this file defines the patterns"],
  [
    "warden/test/mcp.test.mjs",
    "the /home/secret/... path is an invented fixture; the test asserts that " +
      "exact string never reaches a caller, so removing it would remove the test",
  ],
]);

// Vendored third-party sources. Their contributors' addresses are upstream's
// to publish, not ours, and rewriting them would corrupt the dependency.
const SKIP_PREFIX = ["contracts/lib/"];

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
];

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP_PREFIX.some((p) => f.startsWith(p)));

const findings = [];

for (const rel of tracked) {
  let text;
  try {
    text = readFileSync(new URL(rel, new URL(root, "file://")), "utf8");
  } catch {
    continue; // binary or unreadable: nothing to match
  }
  if (text.includes("\0")) continue;

  text.split("\n").forEach((line, i) => {
    for (const rule of RULES) {
      const m = line.match(rule.re);
      if (!m) continue;
      if (rule.ok && rule.ok(m[0])) continue;
      if (ALLOW.has(rel)) continue;
      findings.push({ file: rel, line: i + 1, rule: rule.name });
    }
  });
}

// Author identity across the whole history. A personal mailbox in an author
// field is not fixed by editing files -- it needs a history rewrite.
const authors = new Set(
  execFileSync("git", ["log", "--all", "--format=%ae%n%ce"], { cwd: root, encoding: "utf8" })
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

if (findings.length === 0 && badAuthors.length === 0) {
  console.log(`prepublish-check: clean (${tracked.length} tracked files, ${authors.size} identity)`);
  process.exit(0);
}

for (const f of findings) console.error(`${f.file}:${f.line}: ${f.rule}`);
if (badAuthors.length) {
  // Print the count, never the address: this output lands in logs and
  // transcripts.
  console.error(`git history: ${badAuthors.length} author/committer identity not in noreply form`);
}
console.error(`prepublish-check: ${findings.length + badAuthors.length} finding(s)`);
process.exit(1);
