#!/usr/bin/env bash
# Install the Clock as its own system user (Plan E, task 11).
#
#   sudo bash warden/deploy/install-clock-user.sh --commit <sha> [--notify <path>]
#   bash warden/deploy/install-clock-user.sh --dry-run
#
# Builds the Clock's code at <sha> into /opt/mro-clock (root-owned) with
# build-clock-tree.sh -- a git bundle checked against its hashes, a Node checked
# against its published SHA-256, `npm ci --ignore-scripts` -- and from then on
# runs only that root-owned code. The checkout must be at <sha> and clean, so
# the installer being run is the committed one. Copies its
# key, split seed and own copy of the question bank to /etc/mro-clock (readable
# by mro-clock only), the Warden's copy of the bank to /etc/mro (root-owned,
# read through group mro), makes /var/lib/mro-clock for the Clock's ledger, and
# installs the system units DISABLED.
# cutover-clock-user.sh enables them.
#
# Re-run it after every Clock code change, and after changing any Warden .env
# key the Clock copies (see deploy/clock-env.mjs). Needs create-clock-user.sh
# first. Prints no secret. It replaces /opt/mro-clock and keeps the one copy
# before it as /opt/mro-clock.prev.
#
# The Clock's key lives only in /etc/mro-clock/clock.env: --new-clock-key makes
# it on a first install, --rotate-clock-key replaces it (DEPLOY.md 9b). It
# refuses while a copy of the key or the split seed remains in the main user's
# files.
set -euo pipefail

DRY=0
NOTIFY=""
REPLACE_SEED=0
KEY_FLAG=""
COMMIT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --notify) NOTIFY="${2:?--notify needs a path}"; shift 2 ;;
    --replace-seed) REPLACE_SEED=1; shift ;;
    --new-clock-key) KEY_FLAG=--new-key; shift ;;
    --rotate-clock-key) KEY_FLAG=--rotate-key; shift ;;
    --commit) COMMIT="${2:?--commit needs a sha}"; shift 2 ;;
    *) echo "usage: sudo bash install-clock-user.sh --commit <sha> [--notify <path>] [--replace-seed] [--new-clock-key | --rotate-clock-key] | --dry-run" >&2; exit 2 ;;
  esac
done

WARDEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$WARDEN/.." && pwd)"
NODE_VERSION=v24.14.1
OPT=/opt/mro-clock
ETC=/etc/mro-clock
STATE=/var/lib/mro
BANK_DIR=/etc/mro
OLD_BANK="$STATE/questions/bank.json"
LEDGER_DIR=/var/lib/mro-clock
LOG_DIR=/var/log/mro
UNITS=/etc/systemd/system

fail=0
step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   OK   %s\n' "$1"; }
bad()  { printf '   FAIL %s\n' "$1"; fail=1; }
die()  { printf '   FAIL %s\n' "$1" >&2; exit 1; }

step "0. preconditions"
if [ "$DRY" -eq 1 ]; then
  MAIN_USER="${SUDO_USER:-$USER}"
  ok "dry run: nothing is changed"
else
  [ "$(id -u)" -eq 0 ] || die "run with sudo, or pass --dry-run"
  MAIN_USER="${SUDO_USER:-}"
  { [ -n "$MAIN_USER" ] && [ "$MAIN_USER" != root ]; } || die "run with sudo from the main user's own shell, so SUDO_USER names it"
fi
MAIN_HOME="$(getent passwd "$MAIN_USER" | cut -d: -f6)"
NODE="$MAIN_HOME/.nvm/versions/node/$NODE_VERSION/bin/node"
NOTIFY="${NOTIFY:-$MAIN_HOME/scripts/notify.sh}"
SEED_SRC="$MAIN_HOME/.mro-split/seed"
BANK_SRC="$MAIN_HOME/.mro-questions/bank.json"
WARDEN_ENV="$WARDEN/$(printf '.env')"

getent group mro >/dev/null || die "no group mro: run deploy/create-clock-user.sh first"
id mro-clock >/dev/null 2>&1 || die "no user mro-clock: run deploy/create-clock-user.sh first"
id -nG "$MAIN_USER" | tr ' ' '\n' | /bin/grep -qx mro || die "$MAIN_USER is not in group mro"
[ "$(stat -c '%a %U:%G' "$STATE")" = "2770 root:mro" ] || die "$STATE is not 2770 root:mro"
ok "group mro, user mro-clock, $MAIN_USER in mro, $STATE 2770 root:mro"
[ -f "$WARDEN_ENV" ] || die "no Warden .env in $WARDEN"
ok "the Warden's .env"
# It is substituted into a unit file by sed: % is a systemd specifier, and
# | & \ are sed's own.
case "$NOTIFY" in *[[:space:]\|\&%\\]*) die "the notify path may not contain whitespace, |, &, % or \\" ;; esac
[ -x "$NOTIFY" ] || die "no executable alert script at $NOTIFY (pass --notify <path>)"
ok "alert script $NOTIFY"
# Run as the main user: directly in a dry run, which already is it.
as_main() { if [ "$(id -un)" = "$MAIN_USER" ]; then "$@"; else sudo -u "$MAIN_USER" "$@"; fi; }
# Searched as the main user, whose files these are; names only, never content.
LEFT="$(as_main /bin/grep -rlE '^CLOCK_PRIVATE_KEY=.' "$MAIN_HOME/.mro-env-backups" "$MAIN_HOME/backups" 2>/dev/null || true)"
[ -z "$LEFT" ] || die "a copy of the Clock key remains in: $(echo $LEFT); remove it (the key lives only in /etc/mro-clock)"
ok "no copy of the Clock key in the env backups"

if [ "$DRY" -eq 1 ]; then
  # The dry run is the main user's own, so it may use the main user's node.
  [ -x "$NODE" ] && [ -d "$WARDEN/node_modules" ] || die "no node $NODE_VERSION at $NODE, or no warden/node_modules"
  "$NODE" "$WARDEN/deploy/clock-env.mjs" --warden-env "$WARDEN_ENV" --out "$ETC/clock.env" --check \
    || die "the Clock's env file could not be built from the Warden's .env (above)"
  ok "the Clock's env file builds from the Warden's .env"
  [ -f "$SEED_SRC" ] && ok "split seed found in the home directory" || ok "no split seed in the home directory; the installer needs one there or already in $ETC"
  [ -f "$BANK_SRC" ] && ok "question bank found in the home directory" || ok "no question bank in the home directory; the installer needs one there, in $OLD_BANK or in $BANK_DIR"
  printf '\nWould install: %s, %s, %s, %s, %s/clock.log, /etc/logrotate.d/mro-clock,\n' "$OPT" "$ETC" "$BANK_DIR" "$LEDGER_DIR" "$LOG_DIR"
  printf '              %s/mro-clock.{service,timer} and mro-clock-alert.service (timer DISABLED)\n' "$UNITS"
  exit 0
fi

# The scripts root is running must be the committed ones at <sha>.
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "pass --commit <the full 40-character sha you reviewed>"
[ "$(as_main /usr/bin/git -C "$REPO" rev-parse HEAD)" = "$COMMIT" ] || die "the checkout is not at $COMMIT"
[ -z "$(as_main /usr/bin/git -C "$REPO" status --porcelain --untracked-files=no)" ] || die "the checkout has uncommitted changes"
ok "the checkout is clean at $COMMIT"

[ ! -e "$STATE/state.db.run-lock" ] || die "a Clock run lock exists in $STATE: a run is in progress or died; check the log"
# The lock only sees a run already going; step 1 swaps the code a timer run
# could be about to load. With the timer stopped (DEPLOY.md 9b) no run can start.
if systemctl is-active --quiet mro-clock.timer; then
  NOW="$(date -u +%H%M)"
  { [ "$NOW" -ge 0030 ] && [ "$NOW" -lt 2345 ]; } || die "it is $(date -u +%H:%M) UTC; run between 00:30 and 23:45 so the nightly run cannot start mid-install, or stop the timer first"
  [ "$KEY_FLAG" != --rotate-key ] || die "stop the Clock timer before rotating its key (DEPLOY.md 9b, step 1)"
fi

step "1. the code, owned by root"
STAGE="$OPT.new.$$"
trap 'rm -rf "$STAGE"' EXIT
bash "$WARDEN/deploy/build-clock-tree.sh" "$REPO" "$COMMIT" "$STAGE" "$NODE_VERSION" "sudo -u $MAIN_USER" \
  || die "the code could not be built (above)"
chown -R root:root "$STAGE"
chmod -R u+rwX,go+rX,go-w "$STAGE"
# Disarmed BEFORE the swap: the trap must never delete the tree just moved into place.
trap - EXIT
if [ -d "$OPT" ]; then
  rm -rf "$OPT.prev"
  mv "$OPT" "$OPT.prev"
fi
if ! mv "$STAGE" "$OPT"; then
  [ -d "$OPT.prev" ] && mv "$OPT.prev" "$OPT"
  rm -rf "$STAGE"
  die "could not move the new code into $OPT; the previous code is back in place"
fi
ok "$OPT from commit $COMMIT, node $NODE_VERSION from nodejs.org"

step "2. the key and the split seed, readable by mro-clock only, owned by root"
# Group mro-clock holds only the Clock: group mro is shared with the main user.
# Root owns the files, so the Clock can read its key but never rewrite it.
getent group mro-clock >/dev/null || groupadd --system mro-clock
id -nG mro-clock | tr ' ' '\n' | /bin/grep -qx mro-clock || usermod -aG mro-clock mro-clock
install -d -o root -g mro-clock -m 750 "$ETC"
# From the root-owned tree, with its own node: root runs no code the main user can write.
"$OPT/bin/node" "$OPT/warden/deploy/clock-env.mjs" --warden-env "$WARDEN_ENV" --out "$ETC/clock.env" $KEY_FLAG
chown root:mro-clock "$ETC/clock.env"
chmod 640 "$ETC/clock.env"
# The home copy is taken once -- on a first install, or with --replace-seed after
# a redeploy -- and is refused on any other run: it is the one secret that
# gives away every future day's answer rule. Read as the main user, so root
# never follows a link planted there.
if as_main test -e "$SEED_SRC"; then
  if [ -f "$ETC/split-seed" ] && [ "$REPLACE_SEED" -eq 0 ]; then
    die "a copy of the split seed remains at $SEED_SRC; the installed one is in $ETC. Remove the home copy (or pass --replace-seed after a redeploy)"
  fi
  SEED_NEW="$(mktemp "$ETC/split-seed.new.XXXXXX")"
  as_main cat "$SEED_SRC" > "$SEED_NEW"
  install -o root -g mro-clock -m 640 "$SEED_NEW" "$ETC/split-seed"
  rm -f "$SEED_NEW"
  ok "split seed installed. NOW remove $SEED_SRC: the next install refuses while it exists"
elif [ -f "$ETC/split-seed" ]; then
  chown root:mro-clock "$ETC/split-seed"
  chmod 640 "$ETC/split-seed"
  ok "split seed installed; no home copy"
else
  die "no split seed in the home directory or in $ETC"
fi

step "3. the question bank: the Warden's copy read through group mro, and the Clock's own"
# Both source files sit where the main user can write, so they are READ AS THE
# MAIN USER: root never follows a link the main user planted, and nothing root
# alone can read ends up in a file group mro can read.
read_as_main() { sudo -u "$MAIN_USER" cat "$1"; }
install -d -o root -g root -m 755 "$BANK_DIR"
BANK_NEW="$(mktemp "$BANK_DIR/bank.new.XXXXXX")"
trap 'rm -f "$BANK_NEW"' EXIT
# The home copy is the source of an update; the one in service is the floor.
if sudo -u "$MAIN_USER" test -f "$BANK_SRC" && read_as_main "$BANK_SRC" > "$BANK_NEW"; then
  ok "question bank taken from the home directory"
elif [ -f "$BANK_DIR/bank.json" ]; then
  cat "$BANK_DIR/bank.json" > "$BANK_NEW"
  ok "question bank already in $BANK_DIR"
elif sudo -u "$MAIN_USER" test -f "$OLD_BANK" && read_as_main "$OLD_BANK" > "$BANK_NEW"; then
  ok "question bank taken from $OLD_BANK"
else
  die "no question bank in the home directory, $BANK_DIR or $OLD_BANK"
fi
# APPEND-ONLY, checked by the root-owned code: a question already asked may never
# change, or recorded answers would fill different squares.
if [ -f "$BANK_DIR/bank.json" ] && ! cmp -s "$BANK_DIR/bank.json" "$BANK_NEW"; then
  "$OPT/bin/node" --input-type=module -e '
    import { readFileSync } from "node:fs";
    const { appendOnlyProblem } = await import(process.argv[1]);
    const read = (p) => JSON.parse(readFileSync(p, "utf8"));
    const problem = appendOnlyProblem(read(process.argv[2]), read(process.argv[3]));
    if (problem) { console.error(problem); process.exit(1); }' \
    "$OPT/warden/src/mcp/question.mjs" "$BANK_DIR/bank.json" "$BANK_NEW" \
    || die "the new question bank is not an append to the one in service (above)"
  ok "the new question bank only adds questions"
fi
install -o root -g mro -m 640 "$BANK_NEW" "$BANK_DIR/bank.json"
# The Clock reveals question text from its own copy, which the main user
# cannot reach; the two are compared in step 6.
install -o root -g mro-clock -m 640 "$BANK_NEW" "$ETC/bank.json"
rm -f "$BANK_NEW"
trap - EXIT
ok "the Warden's bank in $BANK_DIR and the Clock's own copy in $ETC"

step "3b. the Clock's ledger directory, writable by mro-clock only"
install -d -o mro-clock -g mro -m 700 "$LEDGER_DIR"
ok "$LEDGER_DIR"


step "4. the log"
install -d -o root -g mro -m 2750 "$LOG_DIR"
[ -f "$LOG_DIR/clock.log" ] || install -o mro-clock -g mro -m 640 /dev/null "$LOG_DIR/clock.log"
install -m 644 "$OPT/warden/deploy/mro-clock.logrotate" /etc/logrotate.d/mro-clock
# --debug exits 0 even on unknown directives, so its error lines are the check.
ROTATE_CHECK="$(logrotate --debug /etc/logrotate.d/mro-clock 2>&1 || true)"
if /bin/grep -q '^error:' <<<"$ROTATE_CHECK"; then
  bad "logrotate reports errors in /etc/logrotate.d/mro-clock: run logrotate --debug on it"
else
  ok "$LOG_DIR/clock.log, rotated weekly"
fi

step "5. the units, installed DISABLED"
install -m 644 "$OPT/warden/deploy/mro-clock.system.service" "$UNITS/mro-clock.service"
install -m 644 "$OPT/warden/deploy/mro-clock.system.timer" "$UNITS/mro-clock.timer"
sed -e "s|@MAIN_USER@|$MAIN_USER|" -e "s|@NOTIFY@|$NOTIFY|" \
  "$OPT/warden/deploy/mro-clock-alert.service.in" > "$UNITS/mro-clock-alert.service"
chmod 644 "$UNITS/mro-clock-alert.service"
systemctl daemon-reload
if systemd-analyze verify "$UNITS/mro-clock.service" "$UNITS/mro-clock.timer" "$UNITS/mro-clock-alert.service"; then
  ok "units verified"
else
  bad "systemd-analyze rejects a unit"
fi
ok "timer is $(systemctl is-enabled mro-clock.timer 2>/dev/null || true)"

step "6. checks"
as() { sudo -u "$1" "${@:2}"; }
as mro-clock test -r "$ETC/clock.env" && ok "mro-clock can read its env file" || bad "mro-clock cannot read $ETC/clock.env"
as mro-clock test -r "$ETC/split-seed" && ok "mro-clock can read the split seed" || bad "mro-clock cannot read the split seed"
as mro-clock test -r "$ETC/bank.json" && ok "mro-clock can read its question bank" || bad "mro-clock cannot read $ETC/bank.json"
cmp -s "$BANK_DIR/bank.json" "$ETC/bank.json" && ok "the Warden's and the Clock's question banks are identical" || bad "the Warden's and the Clock's question banks differ"
as "$MAIN_USER" test -r "$BANK_DIR/bank.json" && ok "$MAIN_USER can read the Warden's question bank" || bad "$MAIN_USER cannot read $BANK_DIR/bank.json"
as "$MAIN_USER" test -w "$BANK_DIR/bank.json" && bad "$MAIN_USER CAN change the Warden's question bank" || ok "$MAIN_USER cannot change the Warden's question bank"
if as "$MAIN_USER" /bin/grep -qx "MRO_QUESTION_BANK=$BANK_DIR/bank.json" "$WARDEN_ENV"; then
  ok "the Warden reads $BANK_DIR/bank.json"
else
  bad "the Warden's settings do not set MRO_QUESTION_BANK=$BANK_DIR/bank.json; set it and restart the Warden"
fi
as mro-clock test -w "$LEDGER_DIR" && ok "mro-clock can write its ledger directory" || bad "mro-clock cannot write $LEDGER_DIR"
as "$MAIN_USER" test -w "$LEDGER_DIR" && bad "$MAIN_USER CAN write the Clock's ledger directory" || ok "$MAIN_USER cannot write the Clock's ledger directory"
as "$MAIN_USER" test -r "$ETC/clock.env" && bad "$MAIN_USER CAN read $ETC/clock.env" || ok "$MAIN_USER cannot read the Clock's env file"
as "$MAIN_USER" test -r "$ETC/split-seed" && bad "$MAIN_USER CAN read the installed split seed" || ok "$MAIN_USER cannot read the installed split seed"
as "$MAIN_USER" test -w "$OPT/warden/src/clock/main.mjs" && bad "$MAIN_USER CAN change the Clock's code" || ok "$MAIN_USER cannot change the Clock's code"
# run.mjs and db.mjs are pure factories; main.mjs is not imported, because it
# opens the database and talks to the chain on load.
if as mro-clock "$OPT/bin/node" --input-type=module -e \
  "await import('$OPT/warden/src/clock/run.mjs'); await import('$OPT/warden/src/mirror/db.mjs');"; then
  ok "the installed code loads as mro-clock"
else
  bad "the installed code does not load as mro-clock"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS: the Clock is installed under mro-clock, timer disabled. Next: cutover-clock-user.sh"
else
  echo "FAIL: see the lines above"
  exit 1
fi
