// One Clock at a time, and how the lock of a run that died is reclaimed.
//
// `Type=oneshot` stops systemd starting a second copy of the timer's own run,
// but says nothing about a rehearsal tool an operator starts by hand -- and two
// signers on one account build two transactions on the same nonce, the second
// of which is simply lost.
//
// The lock NAMES ITS RUN because the alternative was a corpse: a SIGKILL (the
// unit's MemoryMax, an OOM, a power loss) leaves the file behind, and a lock
// nobody can prove is dead halts every later run until a human deletes it.
// After 30 days that is paid mints refused as StaleDay and a stopped heartbeat.
//
// Kept out of main.mjs so it can be tested at all: no test may import main.mjs,
// which opens the mirror, reads a private key and talks to a chain as
// module-load side effects. Same reason cursor.mjs is its own file.
import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

const BOOT_ID_PATH = "/proc/sys/kernel/random/boot_id";

/// The kernel's id for this boot, or null where it cannot be read. Null is not
/// a failure: the pid liveness check below stands on its own.
export function currentBootId(path = BOOT_ID_PATH) {
  try {
    return readFileSync(path, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/// When a process started, in clock ticks since boot (/proc/<pid>/stat field
/// 22), or null where it cannot be read. With the boot id it names one process,
/// where a pid alone can be reused.
export function processStart(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

export function lockOwner(bootIdPath = BOOT_ID_PATH) {
  return { pid: process.pid, bootId: currentBootId(bootIdPath), start: processStart(process.pid) };
}

/// Signal 0 asks whether a pid exists without touching it. EPERM means it
/// exists and belongs to somebody else, which is still alive.
function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function readHolder(path) {
  try {
    const holder = JSON.parse(readFileSync(path, "utf8"));
    return Number.isInteger(holder?.pid) ? holder : null;
  } catch {
    return null;
  }
}

function claim(path, owner) {
  writeFileSync(path, JSON.stringify(owner), { flag: "wx" });
}

/**
 * Take the run lock, reclaiming it from a run that cannot still be holding it.
 *
 * Reclaimed when the boot id differs -- nothing from a previous boot is
 * running, whatever its pid says today -- or when the pid is gone. Anything
 * else is refused, including a lock whose contents name no run: that is the
 * bare `wx` file the old lock left, and guessing about it is how one guard
 * becomes the race it exists to prevent.
 */
export function takeLock(path, owner, { isAlive = processIsAlive, startOf = processStart } = {}) {
  try {
    claim(path, owner);
    return;
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }

  const holder = readHolder(path);
  if (!holder) {
    throw new Error(
      `the run lock at ${path} names no run, so it cannot be told from a live one. ` +
        "If no run is actually in progress, delete it and start again."
    );
  }
  const rebooted = holder.bootId && owner.bootId && holder.bootId !== owner.bootId;
  // A start time that cannot be read is unknown, not different: fail closed.
  const now = holder.start != null ? startOf(holder.pid) : null;
  const reused = now != null && now !== holder.start;
  if (!rebooted && !reused && isAlive(holder.pid)) {
    throw new Error(
      `another clock run (pid ${holder.pid}) holds ${path}. Only one may write at a time: ` +
        "two signers on one account build two transactions on the same nonce."
    );
  }

  // MOVED ASIDE, then checked, never deleted blind: another run may have
  // reclaimed the same dead lock since it was read, and the file at `path` is
  // then that run's live lock. Anything but the dead holder goes back.
  const aside = `${path}.reclaim.${owner.pid}`;
  try {
    renameSync(path, aside);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const moved = readHolder(aside);
  if (moved && (moved.pid !== holder.pid || moved.bootId !== holder.bootId)) {
    try {
      linkSync(aside, path);
    } catch {
      /* a third run already holds it: still not ours */
    }
    unlinkSync(aside);
    throw new Error(`the run lock at ${path} was taken by another run while this one reclaimed it`);
  }
  if (moved) unlinkSync(aside);
  try {
    claim(path, owner);
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
    // Another run reclaimed it in the same moment. It holds the lock, not us.
    throw new Error(`the run lock at ${path} was taken by another run while this one reclaimed it`);
  }
}

/// Release only OUR lock. A run that was refused the lock releasing it on the
/// way out would delete the lock of the run that legitimately holds it.
export function releaseLock(path, owner) {
  const holder = readHolder(path);
  if (!holder || holder.pid !== owner.pid || holder.bootId !== owner.bootId) return;
  try {
    unlinkSync(path);
  } catch {
    /* already gone: nothing to release */
  }
}
