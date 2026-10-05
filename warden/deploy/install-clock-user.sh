#!/usr/bin/env bash
# Install the Clock as its own system user (Plan E, task 11).
#
#   sudo bash warden/deploy/install-clock-user.sh [--notify <path>]
#   bash warden/deploy/install-clock-user.sh --dry-run
#
# Copies the Clock's code and a Node binary to /opt/mro-clock (root-owned), its
# key and split seed to /etc/mro-clock (readable by mro-clock only), the
# question bank to /var/lib/mro/questions, and installs the system units
# DISABLED. cutover-clock-user.sh enables them.
#
# Re-run it after every Clock code change, and after changing any Warden .env
# key the Clock copies (see deploy/clock-env.mjs). Needs create-clock-user.sh
# first. Prints no secret. It replaces /opt/mro-clock and keeps the one copy
# before it as /opt/mro-clock.prev.
set -euo pipefail

DRY=0
NOTIFY=""
REPLACE_SEED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --notify) NOTIFY="${2:?--notify needs a path}"; shift 2 ;;
    --replace-seed) REPLACE_SEED=1; shift ;;
    *) echo "usage: sudo bash install-clock-user.sh [--notify <path>] [--replace-seed] | --dry-run" >&2; exit 2 ;;
  esac
done

WARDEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_VERSION=v24.14.1
OPT=/opt/mro-clock
ETC=/etc/mro-clock
STATE=/var/lib/mro
BANK_DIR="$STATE/questions"
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
[ -x "$NODE" ] || die "no node $NODE_VERSION at $NODE"
[ -d "$WARDEN/node_modules" ] || die "no $WARDEN/node_modules: run npm ci in warden/"
[ -f "$WARDEN_ENV" ] || die "no Warden .env in $WARDEN"
ok "node $NODE_VERSION, warden/node_modules, the Warden's .env"
case "$NOTIFY" in *[[:space:]\|\&]*) die "the notify path may not contain whitespace, | or &" ;; esac
[ -x "$NOTIFY" ] || die "no executable alert script at $NOTIFY (pass --notify <path>)"
ok "alert script $NOTIFY"

if [ "$DRY" -eq 1 ]; then
  [ -f "$SEED_SRC" ] && ok "split seed found in the home directory" || ok "no split seed in the home directory; the installer needs one there or already in $ETC"
  [ -f "$BANK_SRC" ] && ok "question bank found in the home directory" || ok "no question bank in the home directory; the installer needs one there or already in $BANK_DIR"
  printf '\nWould install: %s, %s, %s, %s/clock.log, /etc/logrotate.d/mro-clock,\n' "$OPT" "$ETC" "$BANK_DIR" "$LOG_DIR"
  printf '              %s/mro-clock.{service,timer} and mro-clock-alert.service (timer DISABLED)\n' "$UNITS"
  exit 0
fi

[ ! -e "$STATE/state.db.run-lock" ] || die "a Clock run lock exists in $STATE: a run is in progress or died; check the log"

step "1. the code, owned by root"
STAGE="$(mktemp -d "$OPT.new.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/warden/node_modules" "$STAGE/bin"
cp -a "$WARDEN/src" "$WARDEN/package.json" "$STAGE/warden/"
cp -a "$WARDEN/node_modules/." "$STAGE/warden/node_modules/"
install -m 755 "$NODE" "$STAGE/bin/node"
chown -R root:root "$STAGE"
chmod -R u+rwX,go+rX,go-w "$STAGE"
if [ -d "$OPT" ]; then
  rm -rf "$OPT.prev"
  mv "$OPT" "$OPT.prev"
fi
mv "$STAGE" "$OPT"
trap - EXIT
ok "$OPT from commit $(sudo -u "$MAIN_USER" git -C "$WARDEN" rev-parse --short HEAD 2>/dev/null || echo unknown)"

step "2. the key and the split seed, readable by mro-clock only"
install -d -o mro-clock -g mro -m 700 "$ETC"
"$NODE" "$WARDEN/deploy/clock-env.mjs" --warden-env "$WARDEN_ENV" --out "$ETC/clock.env"
chown mro-clock:mro "$ETC/clock.env"
chmod 600 "$ETC/clock.env"
if [ -f "$SEED_SRC" ]; then
  # Every day's key derives from the seed, so a stale home copy must never
  # replace the live one on a routine re-install.
  if [ -f "$ETC/split-seed" ] && ! cmp -s "$SEED_SRC" "$ETC/split-seed" && [ "$REPLACE_SEED" -eq 0 ]; then
    die "the split seed in the home directory differs from the installed one; remove one, or pass --replace-seed after a redeploy"
  fi
  install -o mro-clock -g mro -m 600 "$SEED_SRC" "$ETC/split-seed"
  ok "split seed installed"
elif [ -f "$ETC/split-seed" ]; then
  ok "split seed already installed; no home copy to take"
else
  die "no split seed in the home directory or in $ETC"
fi

step "3. the question bank, shared through the mro group"
install -d -o "$MAIN_USER" -g mro -m 2750 "$BANK_DIR"
if [ -f "$BANK_DIR/bank.json" ]; then
  if [ -f "$BANK_SRC" ] && ! cmp -s "$BANK_SRC" "$BANK_DIR/bank.json"; then
    die "the home copy of the question bank differs from $BANK_DIR/bank.json, which the Warden and the Clock read; make them one file"
  fi
  ok "question bank already in $BANK_DIR"
elif [ -f "$BANK_SRC" ]; then
  install -o "$MAIN_USER" -g mro -m 640 "$BANK_SRC" "$BANK_DIR/bank.json"
  ok "question bank copied to $BANK_DIR"
else
  die "no question bank in the home directory or in $BANK_DIR"
fi

step "4. the log"
install -d -o root -g mro -m 2750 "$LOG_DIR"
[ -f "$LOG_DIR/clock.log" ] || install -o mro-clock -g mro -m 640 /dev/null "$LOG_DIR/clock.log"
install -m 644 "$WARDEN/deploy/mro-clock.logrotate" /etc/logrotate.d/mro-clock
# --debug exits 0 even on unknown directives, so its error lines are the check.
ROTATE_CHECK="$(logrotate --debug /etc/logrotate.d/mro-clock 2>&1 || true)"
if /bin/grep -q '^error:' <<<"$ROTATE_CHECK"; then
  bad "logrotate reports errors in /etc/logrotate.d/mro-clock: run logrotate --debug on it"
else
  ok "$LOG_DIR/clock.log, rotated weekly"
fi

step "5. the units, installed DISABLED"
install -m 644 "$WARDEN/deploy/mro-clock.system.service" "$UNITS/mro-clock.service"
install -m 644 "$WARDEN/deploy/mro-clock.system.timer" "$UNITS/mro-clock.timer"
sed -e "s|@MAIN_USER@|$MAIN_USER|" -e "s|@NOTIFY@|$NOTIFY|" \
  "$WARDEN/deploy/mro-clock-alert.service.in" > "$UNITS/mro-clock-alert.service"
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
as mro-clock test -r "$BANK_DIR/bank.json" && ok "mro-clock can read the question bank" || bad "mro-clock cannot read the question bank"
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
