#!/usr/bin/env node
// Render a .md to its .html twin through the SHARED renderer, with the markdown
// engine PINNED.
//
//   node tools/render-doc.mjs docs/plans/foo.md ["Optional Page Title"]
//
// WHY THIS EXISTS. The convention renderer is ~/scripts/render-md-to-html.js,
// and its line 34 shells out to `npx --yes marked` with NO VERSION. That is
// harmless for a document a human reads once. It is not harmless here, because
// tools/check-rendered-docs.mjs turns rendered output into a COMMIT GATE: the
// day `marked` ships a release that moves its output by a single character,
// every committed .md/.html pair goes red at once and nothing in this repository
// can be committed until all of them are re-rendered. That is not hypothetical.
// `normalise()` in the guard already carries a scar from exactly this failure:
// two marked versions disagreed about a blank line before </body>.
//
// WHY THE PIN IS HERE AND NOT IN THE SHARED SCRIPT. ~/scripts/render-md-to-html.js
// is outside this repository and is named by five other projects plus the global
// working-style rule. Pinning it would decide their markdown engine for them, to
// fix a problem only this repository has (only this one gates commits on the
// output). So the pin is a devDependency in tools/package.json instead.
//
// HOW A DEVDEPENDENCY PINS A SCRIPT THAT CALLS `npx`. By the child's cwd, and
// this was MEASURED on 2026-09-07 rather than assumed: with a cwd inside tools/,
// `npx --yes marked` resolves tools/node_modules/.bin/marked and never consults
// the registry at all; run from a cwd with no local node_modules it falls
// through to the npx cache or the network. Proven by replacing the local binary
// with a shim and watching which run picked it up. So spawning the shared
// renderer with cwd=tools pins its markdown engine, and as a side effect makes
// the render work offline and on a cold npx cache.
//
// THE GUARD IMPORTS THIS SAME FUNCTION, and that is the whole point. The command
// a human runs to FIX drift and the command the gate runs to DETECT it are one
// code path, so the two can never disagree about which `marked` produced a file.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOLS = dirname(fileURLToPath(import.meta.url));

/// The shared renderer this repository's convention names. Not ours to change.
export const RENDERER = join(process.env.HOME ?? "", "scripts", "render-md-to-html.js");

/// The pinned engine. The version is written down in exactly ONE place,
/// tools/package.json, and read back from there rather than repeated here.
export function pinnedMarked() {
  const pkg = JSON.parse(readFileSync(join(TOOLS, "package.json"), "utf8"));
  const want = pkg.devDependencies?.marked ?? null;
  const installed = join(TOOLS, "node_modules", "marked", "package.json");
  const have = existsSync(installed) ? JSON.parse(readFileSync(installed, "utf8")).version : null;
  return { want, have, bin: join(TOOLS, "node_modules", ".bin", "marked") };
}

/// A pin that is declared but not installed is not a pin, and a render that
/// quietly used some other version is the exact defect this file exists to
/// prevent. So this throws rather than warning.
export function assertPinned() {
  const pin = pinnedMarked();
  if (!pin.want) {
    throw new Error("tools/package.json declares no `marked` devDependency, so the renderer's markdown engine is unpinned.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(pin.want)) {
    throw new Error(`the marked pin must be an exact version, not "${pin.want}" -- a range floats and defeats the point.`);
  }
  if (!existsSync(pin.bin) || pin.have !== pin.want) {
    throw new Error(
      `marked ${pin.want} is not installed in tools/ (found ${pin.have ?? "nothing"}). Run: (cd tools && npm install)`
    );
  }
  return pin;
}

/// Render one markdown file through the shared renderer. The .html lands next to
/// the source, which is what the shared script does and what the convention
/// expects. Returns the output path and whether the renderer's own heading count
/// disagreed (see the note at the call site in check-rendered-docs.mjs).
export function render(mdPath, { title } = {}) {
  if (!existsSync(RENDERER)) {
    throw new Error(`the renderer is not at ${RENDERER}, so nothing could be rendered.`);
  }
  const pin = assertPinned();
  const abs = resolve(mdPath);
  const out = abs.replace(/\.md$/i, "") + ".html";
  let incomplete = false;
  try {
    // cwd is what applies the pin. Do not "simplify" this away.
    execFileSync("node", [RENDERER, abs, ...(title ? [title] : [])], { cwd: TOOLS, stdio: "pipe" });
  } catch (err) {
    if (!existsSync(out)) {
      throw new Error(`${abs} could not be rendered at all: ${err.message}`);
    }
    incomplete = true;
  }
  return { out, incomplete, marked: pin.want };
}

// --- CLI --------------------------------------------------------------------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node tools/render-doc.mjs <file.md> ["Optional Page Title"]');
    process.exit(1);
  }
  try {
    const { out, incomplete, marked } = render(file, { title: process.argv[3] });
    console.log(`wrote ${out} (marked ${marked})`);
    if (incomplete) {
      console.log("note: the renderer's heading count disagreed (a heading inside a fenced code block does that)");
    }
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exit(2);
  }
}
