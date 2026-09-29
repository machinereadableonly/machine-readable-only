// The Clock's run lock, and the corpse it used to be blocked by.
//
// A bare `wx` file says a run holds the lock and nothing more, so an OOM kill
// or a power loss left a file that halted every later run until a human deleted
// it. After 30 days that is queued paid mints refused as StaleDay and a
// heartbeat that stopped, and the only signal is a non-zero exit.
//
// The lock lives in src/clock/lock.mjs rather than main.mjs for the reason
// cursor.mjs does: no test may import main.mjs, which opens the mirror, reads a
// private key and talks to a chain as module-load side effects.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { currentBootId, lockOwner, releaseLock, takeLock } from "../src/clock/lock.mjs";

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "mro-lock-"));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const owner = (pid, bootId) => ({ pid, bootId });
const alive = () => true;
const dead = () => false;

test("an unheld lock is taken, and it names the process and the boot", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    takeLock(path, owner(4242, "boot-a"), { isAlive: alive });
    const held = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(held.pid, 4242);
    assert.equal(held.bootId, "boot-a");
  } finally {
    cleanup();
  }
});

test("a lock held by a LIVE process on this boot is refused", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    takeLock(path, owner(4242, "boot-a"), { isAlive: alive });
    assert.throws(
      () => takeLock(path, owner(9999, "boot-a"), { isAlive: alive }),
      /another clock run/
    );
  } finally {
    cleanup();
  }
});

// THE CORPSE. The run that wrote this was SIGKILLed, so nothing released it.
test("a lock whose process is gone is reclaimed rather than halting the night", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    takeLock(path, owner(4242, "boot-a"), { isAlive: alive });
    takeLock(path, owner(9999, "boot-a"), { isAlive: dead });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, 9999);
  } finally {
    cleanup();
  }
});

// A POWER LOSS leaves a lock whose pid may well be live again under a different
// program, so the pid alone cannot answer. The boot id can: nothing from the
// previous boot is running.
test("a lock from a previous boot is reclaimed even when its pid is alive now", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    takeLock(path, owner(4242, "boot-a"), { isAlive: alive });
    takeLock(path, owner(9999, "boot-b"), { isAlive: alive });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).bootId, "boot-b");
  } finally {
    cleanup();
  }
});

// A lock this code did not write says nothing about who holds it, so it is
// refused -- including the empty file the old `wx` lock left behind.
test("a lock with no owner in it is refused, and the message says how to clear it", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    writeFileSync(path, "");
    assert.throws(() => takeLock(path, owner(1, "boot-a"), { isAlive: dead }), (err) => {
      assert.match(err.message, /names no run/);
      assert.match(err.message, /delete/);
      return true;
    });
  } finally {
    cleanup();
  }
});

test("releasing removes the lock this process holds", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    takeLock(path, owner(4242, "boot-a"), { isAlive: alive });
    releaseLock(path, owner(4242, "boot-a"));
    assert.equal(existsSync(path), false);
  } finally {
    cleanup();
  }
});

// THE RACE THE OWNERSHIP CHECK EXISTS FOR: a run that was REFUSED the lock must
// not delete it on the way out, which would hand the guard to nobody.
test("releasing does NOT remove a lock somebody else holds", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    takeLock(path, owner(4242, "boot-a"), { isAlive: alive });
    releaseLock(path, owner(9999, "boot-a"));
    assert.equal(existsSync(path), true);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, 4242);
  } finally {
    cleanup();
  }
});

test("releasing a lock that is already gone is not an error", () => {
  const { dir, cleanup } = tempDir();
  try {
    releaseLock(join(dir, "never-existed"), owner(1, "boot-a"));
  } finally {
    cleanup();
  }
});

// The boot id is read from the kernel, and a box without it must still lock:
// the pid liveness check stands on its own.
test("a missing boot id file reads as null rather than throwing", () => {
  const { dir, cleanup } = tempDir();
  try {
    assert.equal(currentBootId(join(dir, "no-such-boot-id")), null);
    const o = lockOwner(join(dir, "no-such-boot-id"));
    assert.equal(o.pid, process.pid);
    assert.equal(o.bootId, null);
  } finally {
    cleanup();
  }
});

test("with no boot id on either side, a dead pid is still reclaimed", () => {
  const { dir, cleanup } = tempDir();
  try {
    const path = join(dir, "run-lock");
    takeLock(path, owner(4242, null), { isAlive: alive });
    takeLock(path, owner(9999, null), { isAlive: dead });
    assert.equal(JSON.parse(readFileSync(path, "utf8")).pid, 9999);
  } finally {
    cleanup();
  }
});
