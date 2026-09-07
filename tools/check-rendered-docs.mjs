#!/usr/bin/env node
// Every committed .html must be what its .md renders to, today.
//
//   node tools/check-rendered-docs.mjs          # check, exit 1 on drift
//   node tools/check-rendered-docs.mjs --list   # just name the pairs it checks
//
// WHY THIS EXISTS. The convention here is that a spec, plan or review doc is
// delivered as BOTH a .md and a rendered .html, because the operator reads the HTML. So
// the HTML is a second copy of the document, and a second copy drifts: on
// 2026-09-06 docs/plans/2026-09-06-mro-plan7-lineage-echo.html was 381 lines
// behind its markdown, still quoting a dot count, a byte figure and a gas worst
// case that the plan itself had already corrected. Nothing could see that,
// because nothing compared the two.
//
// It re-renders each .md through THE SAME renderer the convention names
// (~/scripts/render-md-to-html.js) into a scratch directory, and diffs the
// result against the committed .html. It never writes inside the repository.
//
// TWO EXCLUSIONS, AND ONLY TWO:
//
//   <title>   the renderer takes an optional page title as argv[3], so a file
//             rendered with one and re-rendered without it differs on that line
//             alone. That is a caller's choice, not drift in the document.
//   trailing  blank lines at the very end of the file, which an editor adds or
//   blanks    strips without changing a rendered word.
//
// THAT SCOPE IS MEASURED, NOT ASSUMED. On 2026-09-06 this was run over every
// tracked .md/.html pair in the repository: with those two exclusions exactly
// one file had substantive drift, the plan named above. So the guard is silent
// across the existing repo and would still have caught the one real failure.
//
// A MISSING RENDERER IS A FAILURE, NOT A SKIP. If the renderer cannot run, this
// exits non-zero and says so. A guard that quietly passes when it could not
// look is the shape of defect this repository has already shipped once.
//
// THE MARKDOWN ENGINE IS PINNED, and it has to be, because this guard gates
// every commit in the repository. The shared renderer calls `npx --yes marked`
// with no version, so without a pin an ordinary upstream release that moves the
// output by one character turns all of these pairs red at once and blocks
// committing until every file is re-rendered. tools/render-doc.mjs applies the
// pin and explains how; this file goes through it rather than spawning the
// renderer itself, so the command that DETECTS drift and the command a human
// runs to FIX it are the same code path.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, assertPinned, RENDERER } from "./render-doc.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");

/// The two exclusions, and nothing else.
///
/// The blank-line one is where `marked` versions differ: today's ends the body
/// with `</p>\n` and the one most of these files were rendered under ended it
/// `</p>\n\n`. That is one blank line before `</body>` and it is not a word of
/// the document, so it is normalised on BOTH sides rather than re-rendering
/// twenty-four files to chase it.
///
/// KEEP THIS EVEN THOUGH THE ENGINE IS NOW PINNED. It absorbs the files already
/// committed under the older engine, and it is the evidence for why the pin
/// exists: this is what one ordinary `marked` release did to these documents.
function normalise(html) {
  return html
    .replace(/^\s*<title>[\s\S]*?<\/title>\s*$/m, "<title>IGNORED</title>")
    .replace(/\s+<\/body>/, "\n</body>")
    .replace(/\s+$/, "");
}

/// Every tracked .md that has a tracked .html beside it.
function pairs() {
  const tracked = new Set(
    execFileSync("git", ["-C", REPO, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean)
  );
  return [...tracked]
    .filter((p) => p.endsWith(".md") && tracked.has(p.replace(/\.md$/, ".html")))
    .sort();
}

function main() {
  const list = pairs();
  if (process.argv.includes("--list")) {
    for (const p of list) console.log(p);
    return 0;
  }
  if (!existsSync(RENDERER)) {
    console.error(`FAIL: the renderer is not at ${RENDERER}, so nothing could be checked.`);
    return 2;
  }
  // An unpinned or uninstalled engine is a failure for the same reason a missing
  // renderer is: the comparison would be against an output nobody can reproduce.
  let pin;
  try {
    pin = assertPinned();
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    return 2;
  }
  if (list.length === 0) {
    console.error("FAIL: no .md/.html pairs found -- this guard is looking at nothing.");
    return 2;
  }

  const work = mkdtempSync(join(tmpdir(), "mro-rendered-"));
  const drifted = [];
  const incomplete = [];
  try {
    for (const md of list) {
      const scratch = join(work, basename(md));
      const out = scratch.replace(/\.md$/, ".html");
      copyFileSync(join(REPO, md), scratch);
      // A NON-ZERO EXIT IS NOT ON ITS OWN A FAILURE HERE, and that is a
      // measured exception rather than a shrug. The renderer's completeness
      // guard counts `^#{2,3} ` in the markdown against `<h2|h3` in the output,
      // and a heading INSIDE a fenced code block is counted on the markdown
      // side only. docs/plans/2026-08-27-mro-phase0-rendering-spike.md quotes a
      // CLAUDE.md template in a ```markdown fence and so trips it every time,
      // on text that renders perfectly. The false positive lands identically on
      // both sides of the comparison below, so it cannot hide drift.
      //
      // WHAT IS STILL A HARD FAILURE: no output file at all. That is the
      // renderer genuinely not running, and it must never read as "these
      // documents are fine". render() raises for that case and only that case.
      try {
        if (render(scratch).incomplete) incomplete.push(md);
      } catch (err) {
        console.error(`FAIL: ${md} could not be rendered at all: ${err.message}`);
        return 2;
      }
      const fresh = normalise(readFileSync(out, "utf8"));
      const committed = normalise(readFileSync(join(REPO, md.replace(/\.md$/, ".html")), "utf8"));
      if (fresh !== committed) drifted.push(md);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  if (incomplete.length > 0) {
    // Reported, never fatal: see the note above the render call.
    console.log(`note: the renderer's heading count disagreed on ${incomplete.join(", ")} (fenced headings); compared anyway`);
  }
  if (drifted.length === 0) {
    console.log(`ok: ${list.length} rendered documents match their markdown (marked ${pin.want})`);
    return 0;
  }
  console.error(`FAIL: ${drifted.length} of ${list.length} rendered documents are stale:`);
  for (const md of drifted) {
    // Name the PINNED re-render command, not the bare shared script. Rendering
    // by hand through `npx marked` would one day produce a file this guard still
    // rejects, and the fix instruction must not be able to lead there.
    console.error(`  ${md.replace(/\.md$/, ".html")}  -- re-render it: node tools/render-doc.mjs ${md}`);
  }
  return 1;
}

process.exit(main());
