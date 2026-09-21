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

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((f) => !SKIP_PREFIX.some((p) => f.startsWith(p)));

const findings = [];
// Counted, not reported line by line. A PENDING-BEFORE-MAINNET marker is not a
// leak and does not block publishing the repository -- it blocks INVITING an
// agent, because SKILL.md is the only out-of-band source for the treasury it
// would pay. So it is a notice with a count, and the hard gate is the launch
// checklist plus tools/test/skill-doc.test.mjs.
let pending = 0;

for (const rel of tracked) {
  let text;
  try {
    text = readFileSync(new URL(rel, new URL(root, "file://")), "utf8");
  } catch {
    continue; // binary or unreadable: nothing to match
  }
  if (text.includes("\0")) continue;

  text.split("\n").forEach((line, i) => {
    if (line.includes("PENDING-BEFORE-MAINNET")) pending += 1;
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

if (pending > 0) {
  console.error(
    `prepublish-check: notice -- ${pending} PENDING-BEFORE-MAINNET marker(s) still unfilled. ` +
      "Not a leak and not a blocker for the repository, but no agent may be invited until " +
      "SKILL.md carries the real treasury, contract, package and repository."
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
