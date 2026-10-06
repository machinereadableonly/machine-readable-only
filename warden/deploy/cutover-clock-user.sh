#!/usr/bin/env bash
# Move the live Clock and the Warden's mirror onto the Clock's own user
# (Plan E, task 12). Run once, after install-clock-user.sh has passed.
#
#   sudo bash warden/deploy/cutover-clock-user.sh
#   bash warden/deploy/cutover-clock-user.sh --dry-run
#
# RESTARTS EVERY PM2 APP OF THE MAIN USER, not only the Warden: the pm2 daemon
# was started before the main user joined group mro, and only a fresh daemon
# carries the group the Warden needs to open /var/lib/mro/state.db. It refuses
# while pm2 holds a stopped app, because the restart would start it.
#
# Keeps the old state.db in place, untouched, as the way back (DEPLOY.md
# section 12). Prints no secret.
set -euo pipefail

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  *) echo "usage: sudo bash cutover-clock-user.sh [--dry-run]" >&2; exit 2 ;;
esac

WARDEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WARDEN_ENV="$WARDEN/$(printf '.env')"
STATE=/var/lib/mro
NEW_DB="$STATE/state.db"
BANK="$STATE/questions/bank.json"
UNITS=/etc/systemd/system

step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   OK   %s\n' "$1"; }
die()  { printf '   FAIL %s\n' "$1" >&2; exit 1; }

step "0. preconditions"
if [ "$DRY" -eq 1 ]; then
  MAIN_USER="${SUDO_USER:-$USER}"
else
  [ "$(id -u)" -eq 0 ] || die "run with sudo, or pass --dry-run"
  MAIN_USER="${SUDO_USER:-}"
  { [ -n "$MAIN_USER" ] && [ "$MAIN_USER" != root ]; } || die "run with sudo from the main user's own shell"
fi
MAIN_HOME="$(getent passwd "$MAIN_USER" | cut -d: -f6)"
MAIN_UID="$(id -u "$MAIN_USER")"
NODE="$MAIN_HOME/.nvm/versions/node/v24.14.1/bin/node"
PM2_UNIT="$UNITS/pm2-$MAIN_USER.service"
PM2="$(sed -n 's|^ExecStart=\(.*/pm2\) resurrect$|\1|p' "$PM2_UNIT" 2>/dev/null || true)"
# pm2 starts with `#!/usr/bin/env node`, and sudo resets PATH, so it gets the
# PATH its own daemon runs with.
PM2_PATH="$(sed -n 's|^Environment=PATH=||p' "$PM2_UNIT" 2>/dev/null | tail -1 || true)"
as_main() { sudo -u "$MAIN_USER" HOME="$MAIN_HOME" PM2_HOME="$MAIN_HOME/.pm2" PATH="$PM2_PATH" "$@"; }
user_ctl() { sudo -u "$MAIN_USER" XDG_RUNTIME_DIR="/run/user/$MAIN_UID" systemctl --user "$@"; }

[ -f "$UNITS/mro-clock.service" ] && [ -f "$UNITS/mro-clock.timer" ] || die "the system units are not installed: run install-clock-user.sh"
ok "system units installed"
[ -n "$PM2" ] && [ -x "$PM2" ] || die "cannot find pm2 from $PM2_UNIT"
[ -n "$PM2_PATH" ] || die "no Environment=PATH= in $PM2_UNIT, so pm2 cannot find node under sudo"
ok "pm2 at $PM2"
[ -x "$NODE" ] || die "no node at $NODE"

# Restarting pm2 runs `pm2 resurrect`, which starts EVERY app in the saved
# list, stopped ones included. Names only reach the terminal, never settings.
NOT_ONLINE="$(as_main "$PM2" jlist | "$NODE" -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const names = JSON.parse(s).filter((a) => a.pm2_env.status !== "online").map((a) => a.name);
    console.log([...new Set(names)].join(" "));
  });')"
[ -z "$NOT_ONLINE" ] || die "pm2 holds apps that are not running ($NOT_ONLINE); restarting pm2 would START them. Remove them with pm2 delete, then pm2 save, then re-run"
ok "every pm2 app is online, so a restart starts nothing new"

# The old database is wherever the Warden's .env points today. Read that one
# key only; its value is a path, not a secret.
OLD_DB_REL="$(/bin/grep -E '^STATE_DB_PATH=' "$WARDEN_ENV" | tail -1 | cut -d= -f2- | tr -d "\"'")"
[ -n "$OLD_DB_REL" ] || die "no STATE_DB_PATH in the Warden's .env"
case "$OLD_DB_REL" in /*) OLD_DB="$OLD_DB_REL" ;; *) OLD_DB="$WARDEN/$OLD_DB_REL" ;; esac
[ "$OLD_DB" != "$NEW_DB" ] || die "the Warden already uses $NEW_DB: the cutover has been done"
[ -f "$OLD_DB" ] || die "no database at $OLD_DB"
[ ! -e "$NEW_DB" ] || die "$NEW_DB already exists; move it aside before re-running"
[ ! -e "$OLD_DB.run-lock" ] || die "a Clock run lock exists at $OLD_DB.run-lock: a run is in progress or died; check the log"
ok "old database $OLD_DB, no run lock"

NOW="$(date -u +%H%M)"
{ [ "$NOW" -ge 0030 ] && [ "$NOW" -lt 2345 ]; } || die "it is $(date -u +%H:%M) UTC; run between 00:30 and 23:45 so no nightly run is cut in half"
ok "outside the nightly window"

if [ "$DRY" -eq 1 ]; then
  printf '\nWould: pm2 save; disable the user Clock timer; stop mro-warden; copy %s to %s;\n' "$OLD_DB" "$NEW_DB"
  printf '       set STATE_DB_PATH and MRO_QUESTION_BANK in the Warden'"'"'s .env (backed up first);\n'
  printf '       restart pm2-%s (ALL pm2 apps); check the Warden; run the Clock once as mro-clock;\n' "$MAIN_USER"
  printf '       send one test alert; enable the system Clock timer.\n'
  exit 0
fi

step "1. stop the old Clock and the Warden"
as_main "$PM2" save >/dev/null
ok "pm2 process list saved"
user_ctl disable --now mro-clock.timer >/dev/null
# is-enabled exits non-zero for a disabled unit, so read its word instead: an
# empty answer means the user manager was never reached.
OLD_TIMER="$(user_ctl is-enabled mro-clock.timer 2>/dev/null || true)"
[ "$OLD_TIMER" = disabled ] || die "the user Clock timer is '$OLD_TIMER', not disabled; two Clocks would sign at 00:05"
ok "user Clock timer disabled"
# From here until step 7 no Clock timer is enabled; any exit, die or set -e,
# must say so.
CUT_DONE=0
no_timer_notice() {
  [ "$CUT_DONE" = 1 ] && return
  printf '\n   NEITHER Clock timer is enabled: nothing runs at 00:05 UTC until one is.\n' >&2
  printf '   Finish the cutover, or take the way back in DEPLOY.md section 12.\n' >&2
}
trap no_timer_notice EXIT
as_main "$PM2" stop mro-warden >/dev/null
ok "mro-warden stopped"

step "2. copy the mirror"
# VACUUM INTO writes one consistent file, whatever is still in the old -wal.
COPY='
import { DatabaseSync } from "node:sqlite";
const [from, to] = process.argv.slice(1);
// Read-write, so a -wal left by a Warden that did not close cleanly is recovered.
const src = new DatabaseSync(from);
src.prepare("VACUUM INTO ?").run(to);
const dst = new DatabaseSync(to, { readOnly: true });
const ok = dst.prepare("PRAGMA integrity_check").get().integrity_check;
const tables = src.prepare("SELECT name FROM sqlite_schema WHERE type = '"'"'table'"'"' AND name NOT LIKE '"'"'sqlite_%'"'"'").all();
for (const { name } of tables) {
  const q = `SELECT count(*) AS n FROM "${name}"`;
  const a = src.prepare(q).get().n, b = dst.prepare(q).get().n;
  if (a !== b) { console.error(`${name}: ${a} rows, copied ${b}`); process.exit(1); }
}
console.log(`${ok}, ${tables.length} tables, row counts equal`);
'
RESULT="$(as_main "$NODE" --no-warnings --input-type=module -e "$COPY" "$OLD_DB" "$NEW_DB")" || die "the copy failed; the Warden is stopped and still points at $OLD_DB: pm2 start mro-warden"
case "$RESULT" in ok,*) ok "$NEW_DB: $RESULT" ;; *) die "integrity check: $RESULT" ;; esac
chgrp mro "$NEW_DB"
chmod 660 "$NEW_DB"
if [ -f "$OLD_DB.reconcile-cursor" ]; then
  install -o "$MAIN_USER" -g mro -m 660 "$OLD_DB.reconcile-cursor" "$NEW_DB.reconcile-cursor"
  ok "reconcile cursor copied"
fi

step "3. point the Warden at the shared files"
BACKUP_DIR="$MAIN_HOME/.mro-env-backups"
as_main install -d -m 700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/warden-env.$(date -u +%Y%m%dT%H%M%SZ)"
as_main cp -p "$WARDEN_ENV" "$BACKUP"
set_key() {
  local key="$1" value="$2" tmp
  tmp="$(as_main mktemp "$WARDEN/.env.tmp.XXXXXX")"
  as_main chmod 600 "$tmp"
  # The temporary file holds the whole .env, key included: never leave it behind.
  if /bin/grep -qE "^$key=" "$WARDEN_ENV"; then
    sed "s|^$key=.*|$key=$value|" "$WARDEN_ENV" | as_main tee "$tmp" >/dev/null \
      || { as_main rm -f "$tmp"; die "could not write $key into the Warden's .env"; }
  else
    # A file without a final newline would glue the new key onto its last line.
    { cat "$WARDEN_ENV"; [ -z "$(tail -c1 "$WARDEN_ENV")" ] || echo; printf '%s=%s\n' "$key" "$value"; } \
      | as_main tee "$tmp" >/dev/null \
      || { as_main rm -f "$tmp"; die "could not write $key into the Warden's .env"; }
  fi
  as_main mv "$tmp" "$WARDEN_ENV" || { as_main rm -f "$tmp"; die "could not replace the Warden's .env"; }
}
set_key STATE_DB_PATH "$NEW_DB"
set_key MRO_QUESTION_BANK "$BANK"
ok "STATE_DB_PATH=$NEW_DB and MRO_QUESTION_BANK=$BANK (backup: ~/.mro-env-backups/$(basename "$BACKUP"))"

step "4. restart pm2 so the Warden carries group mro (every pm2 app restarts)"
systemctl restart "pm2-$MAIN_USER"
for _ in $(seq 1 30); do
  PID="$(as_main "$PM2" pid mro-warden 2>/dev/null | tail -1)"
  [ -n "$PID" ] && [ "$PID" != 0 ] && break
  sleep 1
done
{ [ -n "${PID:-}" ] && [ "$PID" != 0 ]; } || die "mro-warden did not come back; read: pm2 logs mro-warden"
ps -o supgrp= -p "$PID" | tr ',' '\n' | /bin/grep -qx mro || die "mro-warden (pid $PID) is running without group mro"
ok "mro-warden is pid $PID, in group mro"
CODE=000
for _ in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3006/llms.txt || true)"
  [ "$CODE" = 200 ] && break
  sleep 1
done
[ "$CODE" = 200 ] || die "the Warden answers $CODE on /llms.txt; read: pm2 logs mro-warden"
ok "the Warden answers 200"

step "5. one real Clock run, inside its sandbox, now"
# Mid-day this writes only what is already due (queued mints, reconcile): the
# day's check-ins wait for the day to close.
LOG=/var/log/mro/clock.log
BEFORE="$(wc -l < "$LOG")"
systemctl start mro-clock.service || die "the run under mro-clock failed; read $LOG, then DEPLOY.md section 12, the way back"
tail -n +"$((BEFORE + 1))" "$LOG" | /bin/grep -q '^clock: run finished' || die "the run left no 'run finished' line in $LOG"
ok "the Clock ran as mro-clock and finished"

step "6. the failure alert"
echo "   A test push titled 'MRO Clock failed' is sent now. It is this test."
systemctl start mro-clock-alert.service || die "the alert unit failed; read: journalctl -u mro-clock-alert"
ok "alert sent"

step "7. the nightly timer"
systemctl enable --now mro-clock.timer >/dev/null 2>&1
[ "$(systemctl is-enabled mro-clock.timer 2>/dev/null || true)" = enabled ] || die "the system Clock timer did not enable"
CUT_DONE=1
ok "system timer $(systemctl is-enabled mro-clock.timer), next run $(systemctl show mro-clock.timer -p NextElapseUSecRealtime --value)"
as_main test -r /etc/mro-clock/clock.env && die "$MAIN_USER CAN read the Clock's env file" || ok "$MAIN_USER cannot read the Clock's env file"

echo
echo "PASS: the Clock runs as mro-clock, nightly at 00:05 UTC."
echo "After the first night passes:"
echo "  - remove the CLOCK_PRIVATE_KEY line from the Warden's .env;"
echo "  - the old $OLD_DB and the home copies of the split seed and question bank"
echo "    are no longer read; delete them only once the operator approves."
