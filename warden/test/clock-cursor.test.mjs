// The reconcile cursor and the run's exit code.
//
// Test gaps 29 and 30. These three functions lived inside src/clock/main.mjs,
// which no test may import -- loading it opens the mirror, reads a private key
// out of the environment and talks to a chain, all as module-load side effects.
// So they were the only Clock logic with zero coverage of any kind, and they
// are where two review findings live: 4.L4 (an unreadable cursor treated as a
// first run) and 4.M3 (the cursor advanced past a read that never happened).
//
// They now live in src/clock/cursor.mjs as pure functions main.mjs imports.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readCursor, writeCursor, nextCursor, exitCodeFor } from "../src/clock/cursor.mjs";

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "mro-cursor-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// readCursor
// ---------------------------------------------------------------------------

test("a missing cursor is the ordinary first run, not an error", () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.equal(readCursor(join(dir, "nothing-here")), null);
  } finally {
    cleanup();
  }
});

test("an empty cursor file is also a first run", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "cursor");
    writeFileSync(path, "   \n");
    assert.equal(readCursor(path), null);
  } finally {
    cleanup();
  }
});

test("a cursor is read back as a BigInt block number", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "cursor");
    writeCursor(path, 46_119_616n);
    assert.equal(readCursor(path), 46_119_616n);
  } finally {
    cleanup();
  }
});

// 4.L4. A CORRUPT CURSOR IS NOT A FIRST RUN. Treating it as one means
// reconciling from the deploy block every night against a unit with
// TimeoutStartSec=600: the unit is killed, the cursor is never written, and it
// repeats identically forever with nothing in the log naming a cursor. A
// permanent silent stall dressed as a fresh start.
test("a corrupt cursor throws rather than silently re-reading the whole chain", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "cursor");
    writeFileSync(path, "not-a-block-number");
    assert.throws(() => readCursor(path), /is not a block number/);
  } finally {
    cleanup();
  }
});

test("the corruption message quotes what it found, but not without bound", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "cursor");
    writeFileSync(path, "x".repeat(5000));
    assert.throws(() => readCursor(path), (err) => {
      assert.match(err.message, /is not a block number/);
      // An operator needs to see WHAT was in the file; a journal does not need
      // five kilobytes of it.
      assert.ok(err.message.length < 200, `the message is ${err.message.length} bytes`);
      return true;
    });
  } finally {
    cleanup();
  }
});

test("a cursor that cannot be READ throws, and says so as a read failure", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "cursor");
    writeFileSync(path, "100");
    chmodSync(path, 0o000);

    // Running as root defeats file permissions, so the test would silently
    // assert nothing. Skip rather than pass.
    let readable = true;
    try { readCursor(path); } catch { readable = false; }
    if (readable) return;

    assert.throws(() => readCursor(path), /could not read the reconcile cursor/);
  } finally {
    cleanup();
  }
});

test("writeCursor creates the directory it needs", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "nested", "deeper", "cursor");
    writeCursor(path, 42n);
    assert.equal(readCursor(path), 42n);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// nextCursor -- 4.M3
// ---------------------------------------------------------------------------

test("a completed reconcile advances the cursor to the block it reached", () => {
  assert.equal(nextCursor({ reconciled: { from: 1n, to: 500n } }), 500n);
});

// The case that matters. A reconcile that threw leaves `reconciled` null, and
// advancing anyway would skip every block it never read -- and Rested,
// Transfer and Rebound reach the mirror ONLY through reconcile, so a skipped
// window means a token its owner sealed keeps telling /t/<id> it is alive,
// permanently, with nothing to notice.
test("a reconcile that never ran does NOT advance the cursor", () => {
  assert.equal(nextCursor({ reconciled: null }), null);
  assert.equal(nextCursor({}), null);
  assert.equal(nextCursor(undefined), null);
});

test("a reconcile with no `to` does not advance it either", () => {
  assert.equal(nextCursor({ reconciled: { from: 1n } }), null);
});

// An ABORTED run still advances, and that is deliberate. Since 4.L9 the run
// reconciles even when a write phase aborted: the abort is about WRITING, and
// the reconcile is a read that ran to the head regardless. Refusing here would
// re-read the same window every night for as long as the piece stayed paused.
test("an aborted run still advances the cursor, because its reconcile still ran", () => {
  assert.equal(nextCursor({ aborted: "EnforcedPause", reconciled: { from: 1n, to: 900n } }), 900n);
});

test("a short window still advances -- there was nothing in it to miss", () => {
  // `from > head` returns { to: head, pages: 0, applied: null }: the chain has
  // produced nothing new since last night. Refusing to advance would be
  // harmless but would also never converge on a quiet chain.
  assert.equal(nextCursor({ reconciled: { from: 901n, to: 900n, pages: 0, applied: null } }), 900n);
});

// ---------------------------------------------------------------------------
// exitCodeFor -- 4.L4's sibling: what systemd is told
// ---------------------------------------------------------------------------

test("a clean run exits zero", () => {
  assert.equal(exitCodeFor({ stuck: [], stuckCredits: [], aborted: null }), 0);
});

test("an aborted run exits non-zero", () => {
  assert.equal(exitCodeFor({ stuck: [], stuckCredits: [], aborted: "EnforcedPause" }), 1);
});

// A token whose agent paid and has no artwork. The gap named this case
// specifically, because it is the one where somebody is out of pocket.
test("a stuck mint alone fails the run", () => {
  assert.equal(exitCodeFor({ stuck: [{ tokenId: 7 }], stuckCredits: [], aborted: null }), 1);
});

test("a condemned credit alone fails the run", () => {
  // It used to exit ZERO: `dropped` was logged per entry as "stays queued",
  // which reads exactly like the ordinary poison-row path, and systemd
  // recorded success. A token's record IS the artwork.
  assert.equal(exitCodeFor({ stuck: [], stuckCredits: [{ tokenId: 7, day: 20_700 }], aborted: null }), 1);
});

test("a summary that is missing its arrays does not crash the exit path", () => {
  // A run that threw before filling the summary must still produce an exit
  // code. Reading `.length` off undefined here would turn a bad night into an
  // unhandled rejection inside the reporting itself.
  assert.equal(exitCodeFor({}), 0);
  assert.equal(exitCodeFor(null), 1);
});

// A stopped run stopping on GAS is not a failure: it did what it should, and
// tomorrow's run writes the same rows with the same day numbers.
test("stopping on gas is a success, because tomorrow writes the same rows", () => {
  assert.equal(
    exitCodeFor({ stuck: [], stuckCredits: [], aborted: null, gasStopped: true }),
    0,
  );
});
