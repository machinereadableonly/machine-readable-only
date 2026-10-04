#!/usr/bin/env bash
# Create the Clock's own user and the shared state directory, then prove that
# the main user and the Clock can both write ONE SQLite database in WAL mode.
#
#   sudo bash warden/deploy/create-clock-user.sh <path to node>
#
# Creates (each only if missing): group `mro`, system user `mro-clock`, the
# main user's membership of `mro`, and /var/lib/mro (root:mro, mode 2770).
# The proof writes a fresh test database under /var/lib/mro/spike and leaves
# it there. Exit 0 and PASS, or a FAIL line naming the step.
set -euo pipefail

STATE_DIR=/var/lib/mro
NODE="${1:?usage: sudo bash create-clock-user.sh <path to node>}"

if [ "$(id -u)" -ne 0 ]; then
  echo "FAIL: run with sudo" >&2; exit 2
fi
MAIN_USER="${SUDO_USER:-}"
if [ -z "$MAIN_USER" ] || [ "$MAIN_USER" = root ]; then
  echo "FAIL: run with sudo from the main user's own shell, so SUDO_USER names it" >&2; exit 2
fi
[ -x "$NODE" ] || { echo "FAIL: $NODE is not an executable" >&2; exit 2; }

getent group mro >/dev/null || groupadd --system mro
id mro-clock >/dev/null 2>&1 || useradd --system --gid mro --home-dir "$STATE_DIR" \
  --no-create-home --shell /usr/sbin/nologin mro-clock
id -nG "$MAIN_USER" | tr ' ' '\n' | /bin/grep -qx mro || usermod -aG mro "$MAIN_USER"
install -d -o root -g mro -m 2770 "$STATE_DIR"
install -d -o root -g mro -m 2770 "$STATE_DIR/spike"
echo "ok  group mro, user mro-clock, $MAIN_USER in mro, $STATE_DIR is $(stat -c '%A %U:%G' "$STATE_DIR")"

for u in "$MAIN_USER" mro-clock; do
  sudo -u "$u" test -x "$NODE" || { echo "FAIL: $u cannot run $NODE" >&2; exit 1; }
done

DB="$STATE_DIR/spike/test-$(date +%s).db"

# Opens the database the way warden/src/mirror/db.mjs does (WAL, 5 s busy
# timeout). Modes: create | write <tag> | hold <tag> <awaited-tag> <then-tag>.
# `hold` keeps its connection open until another user's row appears, so the
# side files are shared live, not handed over between sessions.
WORKER='
import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
const [path, mode, tag, awaited, then] = process.argv.slice(1);
const db = new DatabaseSync(path, { timeout: 5000 });
db.exec("PRAGMA journal_mode = WAL");
if (mode === "create") {
  chmodSync(path, 0o660);
  db.exec("CREATE TABLE t (tag TEXT NOT NULL)");
  process.exit(0);
}
const add = (t) => db.prepare("INSERT INTO t (tag) VALUES (?)").run(t);
const has = (t) => db.prepare("SELECT count(*) AS n FROM t WHERE tag = ?").get(t).n === 1;
add(tag);
if (mode === "hold") {
  const until = Date.now() + 15000;
  while (!has(awaited)) {
    if (Date.now() > until) { console.error(`never saw ${awaited}`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 100));
  }
  add(then);
}
db.close();
'

# Each run gets umask 022, the default a systemd or pm2 process has. SQLite
# must still give the side files the database's own mode, 0660.
run() {
  local who="$1"; shift
  sudo -u "$who" bash -c 'umask 022; cd /; n="$0" w="$1"; shift; exec "$n" --no-warnings --input-type=module -e "$w" "$@"' \
    "$NODE" "$WORKER" "$DB" "$@"
}

step() {
  echo "--- $*"
}

fail() {
  echo "FAIL: $*" >&2
  ls -l "$DB"* >&2 || true
  exit 1
}

# Both orders matter: whoever opens first creates -wal and -shm, and the other
# user must then write files it does not own.
hold_and_write() {
  local holder="$1" writer="$2" n="$3"
  run "$holder" hold "$holder-$n" "$writer-$n" "$holder-$n-after" & local pid=$!
  sleep 1
  ls -l "$DB-wal" "$DB-shm" 2>/dev/null | sed 's/^/    /'
  run "$writer" write "$writer-$n" || { kill "$pid" 2>/dev/null; fail "$writer could not write while $holder held the database"; }
  wait "$pid" || fail "$holder did not see $writer's row and write after it"
}

step "1. $MAIN_USER creates the database (mode 0660, WAL)"
run "$MAIN_USER" create || fail "create"
run "$MAIN_USER" write "$MAIN_USER-0" || fail "$MAIN_USER's first write"

step "2. mro-clock writes after $MAIN_USER has closed it"
run mro-clock write mro-clock-0 || fail "mro-clock's write after $MAIN_USER"

step "3. $MAIN_USER holds it open while mro-clock writes"
hold_and_write "$MAIN_USER" mro-clock 1

step "4. mro-clock holds it open while $MAIN_USER writes"
hold_and_write mro-clock "$MAIN_USER" 2

step "5. the result"
CHECK='
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const ok = db.prepare("PRAGMA integrity_check").get().integrity_check;
const n = db.prepare("SELECT count(*) AS n FROM t").get().n;
console.log(`${ok} ${n}`);
'
read -r INTEGRITY ROWS < <(sudo -u mro-clock "$NODE" --no-warnings --input-type=module -e "$CHECK" "$DB") || fail "the final read"
echo "    integrity $INTEGRITY, rows $ROWS (expected 8)"
[ "$INTEGRITY" = ok ] && [ "$ROWS" = 8 ] || fail "integrity $INTEGRITY, rows $ROWS"
for f in "$DB" "$DB-wal" "$DB-shm"; do
  [ -e "$f" ] || continue
  m="$(stat -c '%a %G' "$f")"
  echo "    $(basename "$f")  $m"
  [ "$m" = "660 mro" ] || fail "$f is $m, expected 660 mro"
done

echo
echo "PASS: $MAIN_USER and mro-clock share one WAL database in $STATE_DIR"
