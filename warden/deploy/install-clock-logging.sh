#!/usr/bin/env bash
#
# Install the Clock's log hardening: 16.10.
#
# Three things the repository cannot do for itself:
#   1. write ~/logs/mro-clock-logrotate.conf, which must hold an ABSOLUTE path
#      (logrotate expands neither ~ nor %h) and therefore cannot be tracked --
#      tools/prepublish-check.mjs fails on a home path in a tracked file;
#   2. reload the systemd user manager so the edited unit takes effect;
#   3. prove UMask= and the sandboxed logrotate actually work here rather than
#      assuming they do -- this project has already been bitten once by a unit
#      directive that cannot work unprivileged (ProtectKernelModules, 623f9a5),
#      and systemd fails the WHOLE unit at 218/CAPABILITIES rather than
#      degrading, so an unverified directive is a broken timer.
#
# It does NOT run the Clock: every check below is a probe, so nothing here
# touches the chain, spends gas, or writes to the mirror.
#
# Safe to re-run. Nothing is destructive.
set -euo pipefail

REPO_WARDEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT_SRC="$REPO_WARDEN/deploy/mro-clock.service"
TEMPLATE="$REPO_WARDEN/deploy/mro-clock-logrotate.conf.example"
UNIT_DST="$HOME/.config/systemd/user/mro-clock.service"
LOG_DIR="$HOME/logs"
LOG="$LOG_DIR/mro-clock.log"
CONF="$LOG_DIR/mro-clock-logrotate.conf"

fail=0
step() { printf '\n== %s\n' "$1"; }
ok()   { printf '   OK   %s\n' "$1"; }
bad()  { printf '   FAIL %s\n' "$1"; fail=1; }

step "1. the rotation config"
mkdir -p "$LOG_DIR"
sed "s#__LOG_DIR__#$LOG_DIR#" "$TEMPLATE" > "$CONF"
chmod 600 "$CONF"
ok "wrote $CONF"

step "2. the existing log is owner-only"
# UMask covers a log that does not exist yet; this covers the one that does.
if [ -f "$LOG" ]; then
  chmod 600 "$LOG"
  ok "$LOG is now mode $(stat -c%a "$LOG")"
else
  ok "no log yet; UMask will create it 0600"
fi
for f in "$LOG".*; do
  [ -e "$f" ] || continue
  chmod 600 "$f"
  ok "$(basename "$f") is now mode $(stat -c%a "$f")"
done

step "3. install the unit and reload"
mkdir -p "$(dirname "$UNIT_DST")"
cp "$UNIT_SRC" "$UNIT_DST"
systemctl --user daemon-reload
ok "unit installed and daemon reloaded"
if systemd-analyze --user verify "$UNIT_DST" 2>&1 | grep -q .; then
  systemd-analyze --user verify "$UNIT_DST" || true
  bad "systemd-analyze verify had something to say (above)"
else
  ok "systemd-analyze verify is clean"
fi

step "4. PROVE UMask=0077 works in a user unit here"
probe="$LOG_DIR/.umask-probe.$$"
rm -f "$probe"
systemd-run --user --quiet --wait --collect \
  -p UMask=0077 -p ProtectSystem=strict -p ProtectHome=read-only \
  -p ReadWritePaths="$LOG_DIR" \
  /bin/sh -c "echo probe > $probe"
if [ -f "$probe" ] && [ "$(stat -c%a "$probe")" = "600" ]; then
  ok "a file created under the unit's UMask is mode 600"
else
  bad "expected mode 600, got $(stat -c%a "$probe" 2>/dev/null || echo 'no file')"
fi
rm -f "$probe"

step "5. PROVE logrotate runs inside the unit's sandbox"
# The same directives the real unit applies, so a seccomp or ProtectSystem
# problem shows up here rather than at 00:05 in a journal nobody is watching.
if systemd-run --user --quiet --wait --collect \
     -p ProtectSystem=strict -p ProtectHome=read-only -p NoNewPrivileges=true \
     -p ReadWritePaths="$LOG_DIR" -p SystemCallFilter='~@module' \
     /usr/sbin/logrotate --state "$LOG_DIR/mro-logrotate.status" "$CONF"; then
  ok "logrotate ran clean under the unit's restrictions"
else
  bad "logrotate failed inside the sandbox (the unit tolerates this -- the '-' prefix -- but then nothing rotates)"
fi

step "6. the timer is still armed"
systemctl --user list-timers mro-clock.timer --no-pager || true

printf '\n'
if [ "$fail" = 0 ]; then
  echo "ALL CHECKS PASSED. Nothing was run against the chain."
else
  echo "SOMETHING FAILED ABOVE -- tell Claude what it said before the next 00:05."
  exit 1
fi
