// The committed .html files must still be what their .md renders to.
//
// WHY THIS IS A TEST AND NOT A CHECKLIST ITEM. The convention here delivers a
// spec, plan or review as BOTH a .md and a rendered .html, because that is what
// the operator reads. A second copy of a document drifts, and nothing could see it:
// docs/plans/2026-09-06-mro-plan7-lineage-echo.html was 381 lines behind its
// markdown -- still quoting a dot count, a byte figure and a gas worst case the
// plan itself had corrected -- and every suite was green. The rule of this
// repository is that all four suites go green before a commit, so this is the
// only place a guard actually runs.
//
// IT IS THE SLOWEST TEST IN THIS SUITE, at roughly a second per document,
// because it shells out to the real renderer for each one rather than
// reimplementing it. A guard that renders differently from the renderer is a
// guard for a document nobody has.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("every committed .html matches its markdown", () => {
  const script = fileURLToPath(new URL("../check-rendered-docs.mjs", import.meta.url));
  // The script exits 1 on drift and 2 when it could not look at all. Both are
  // failures here, and its own stdout names the files, so it is forwarded
  // rather than summarised.
  try {
    execFileSync("node", [script], { encoding: "utf8", stdio: "pipe" });
  } catch (err) {
    assert.fail(`${err.stdout ?? ""}${err.stderr ?? ""}`.trim() || err.message);
  }
});
