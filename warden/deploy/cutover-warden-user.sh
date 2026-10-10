#!/usr/bin/env bash
# Move the live Warden off the main user's pm2 onto its own user (D1). Run once,
# after install-warden-user.sh has passed.
#
#   sudo bash warden/deploy/cutover-warden-user.sh
#   bash warden/deploy/cutover-warden-user.sh --dry-run
#
# Stops the pm2 Warden, starts mro-warden.service, and checks it answers. On any
# failure it stops the service and starts the pm2 Warden again, so the site is
# down for seconds, never left down. Only when the service answers is pm2's copy
# deleted and the unit enabled. Prints no secret.
set -euo pipefail

DRY=0
case "${1:-}" in
  --dry-run) DRY=1 ;;
  "") ;;
  *) echo "usage: sudo bash cutover-warden-user.sh [--dry-run]" >&2; exit 2 ;;
esac

UNITS=/etc/systemd/system
PROBE=http://127.0.0.1:3006/llms.txt

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
PM2_UNIT="$UNITS/pm2-$MAIN_USER.service"
PM2="$(sed -n 's|^ExecStart=\(.*/pm2\) resurrect$|\1|p' "$PM2_UNIT" 2>/dev/null || true)"
PM2_PATH="$(sed -n 's|^Environment=PATH=||p' "$PM2_UNIT" 2>/dev/null | tail -1 || true)"
as_main() {
  if [ "$(id -un)" = "$MAIN_USER" ]; then HOME="$MAIN_HOME" PM2_HOME="$MAIN_HOME/.pm2" PATH="$PM2_PATH" "$@"
  else sudo -u "$MAIN_USER" HOME="$MAIN_HOME" PM2_HOME="$MAIN_HOME/.pm2" PATH="$PM2_PATH" "$@"; fi
}

if [ "$DRY" -eq 0 ]; then
  [ -f "$UNITS/mro-warden.service" ] || die "mro-warden.service is not installed: run install-warden-user.sh"
  ok "mro-warden.service installed"
fi
[ -n "$PM2" ] && [ -x "$PM2" ] || die "cannot find pm2 from $PM2_UNIT"
[ -n "$PM2_PATH" ] || die "no Environment=PATH= in $PM2_UNIT, so pm2 cannot find node"
STATUS="$(as_main "$PM2" jlist | as_main node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const app = JSON.parse(s).find((a) => a.name === "mro-warden");
    console.log(app ? app.pm2_env.status : "absent");
  });')"
[ "$STATUS" = online ] || die "the pm2 Warden is '$STATUS', not online; nothing to cut over from"
ok "the pm2 Warden is online"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$PROBE" || true)"
[ "$CODE" = 200 ] || die "the Warden answers $CODE on $PROBE before the cutover; fix that first"
ok "the Warden answers 200 now"

if [ "$DRY" -eq 1 ]; then
  printf '\nWould: pm2 stop mro-warden; systemctl start mro-warden; wait for 200 on %s;\n' "$PROBE"
  printf '       then systemctl enable mro-warden, pm2 delete mro-warden, pm2 save.\n'
  printf '       On failure: systemctl stop mro-warden, pm2 start mro-warden.\n'
  exit 0
fi

back_to_pm2() {
  systemctl stop mro-warden.service || true
  as_main "$PM2" start mro-warden >/dev/null || true
  die "$1. The pm2 Warden is started again; read /var/log/mro/warden.log"
}

step "1. hand over"
as_main "$PM2" stop mro-warden >/dev/null
ok "the pm2 Warden is stopped"
systemctl start mro-warden.service || back_to_pm2 "mro-warden.service did not start"
CODE=000
for _ in $(seq 1 30); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$PROBE" || true)"
  [ "$CODE" = 200 ] && break
  sleep 1
done
[ "$CODE" = 200 ] || back_to_pm2 "the service answers $CODE on $PROBE"
PID="$(systemctl show -p MainPID --value mro-warden.service)"
[ "$(ps -o user= -p "$PID" | tr -d ' ')" = mro-warden ] || back_to_pm2 "the service's process is not running as mro-warden"
ok "mro-warden.service answers 200, pid $PID, as mro-warden"

step "2. make it stick"
systemctl enable mro-warden.service >/dev/null 2>&1
[ "$(systemctl is-enabled mro-warden.service)" = enabled ] || die "the unit did not enable; it is running, but would not start at boot"
as_main "$PM2" delete mro-warden >/dev/null
as_main "$PM2" save >/dev/null
ok "unit enabled; pm2 no longer holds a Warden, so a reboot starts one copy only"

echo
echo "PASS: the Warden runs as mro-warden. Its log is /var/log/mro/warden.log."
echo "Code or settings change: re-run install-warden-user.sh, then sudo systemctl restart mro-warden."
