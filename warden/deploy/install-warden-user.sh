#!/usr/bin/env bash
# Install the Warden as its own system user (D1).
#
#   sudo bash warden/deploy/install-warden-user.sh --commit <sha>
#   bash warden/deploy/install-warden-user.sh --dry-run
#
# Builds the Warden's code at <sha> into /opt/mro-warden (root-owned) with
# build-clock-tree.sh's warden profile, writes /etc/mro-warden/warden.env with
# only the settings the Warden's code reads (deploy/warden-env.mjs), and
# installs mro-warden.service DISABLED. cutover-warden-user.sh moves the live
# Warden off pm2 onto it.
#
# Re-run it after every Warden code change and after changing the Warden's
# .env, then `sudo systemctl restart mro-warden`. It keeps the one code tree
# before it as /opt/mro-warden.prev. Prints no secret.
set -euo pipefail

DRY=0
COMMIT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --commit) COMMIT="${2:?--commit needs a sha}"; shift 2 ;;
    *) echo "usage: sudo bash install-warden-user.sh --commit <sha> | --dry-run" >&2; exit 2 ;;
  esac
done

WARDEN="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$(cd "$WARDEN/.." && pwd)"
NODE_VERSION=v24.14.1
OPT=/opt/mro-warden
ETC=/etc/mro-warden
STATE=/var/lib/mro
DB="$STATE/state.db"
BANK=/etc/mro/bank.json
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
WARDEN_ENV="$WARDEN/$(printf '.env')"
as_main() { if [ "$(id -un)" = "$MAIN_USER" ]; then "$@"; else sudo -u "$MAIN_USER" "$@"; fi; }

getent group mro >/dev/null || die "no group mro: the Clock's own user comes first (DEPLOY.md section 12)"
[ "$(stat -c '%a %U:%G' "$STATE")" = "2770 root:mro" ] || die "$STATE is not 2770 root:mro"
[ -f "$DB" ] || die "no mirror at $DB: the Clock cutover (DEPLOY.md section 12) moves it there first"
ok "group mro, $STATE and the mirror"
if [ -f "$BANK" ]; then
  ok "the question bank at $BANK"
elif [ "$DRY" -eq 1 ]; then
  ok "no question bank at $BANK yet: re-run install-clock-user.sh first, which puts it there"
else
  die "no question bank at $BANK: re-run install-clock-user.sh first, which puts it there"
fi
as_main test -f "$WARDEN_ENV" || die "no Warden .env in $WARDEN"
# The one key read here is a path, not a secret. A different path would switch
# the live Warden onto another database.
DB_NOW="$(as_main /bin/grep -E '^STATE_DB_PATH=' "$WARDEN_ENV" | tail -1 | cut -d= -f2- | tr -d "\"'")"
[ "$DB_NOW" = "$DB" ] || die "the Warden's .env says STATE_DB_PATH=$DB_NOW; the installed Warden uses $DB"
ok "the Warden's .env, on $DB"

if [ "$DRY" -eq 1 ]; then
  [ -x "$NODE" ] && [ -d "$WARDEN/node_modules" ] || die "no node $NODE_VERSION at $NODE, or no warden/node_modules"
  "$NODE" "$WARDEN/deploy/warden-env.mjs" --warden-env "$WARDEN_ENV" --out "$ETC/warden.env" --check \
    || die "the Warden's settings file could not be built from its .env (above)"
  ok "the Warden's settings file builds from its .env"
  printf '\nWould install: user mro-warden, %s, %s/warden.env, %s/warden.log,\n' "$OPT" "$ETC" "$LOG_DIR"
  printf '              /etc/logrotate.d/mro-warden and %s/mro-warden.service (DISABLED)\n' "$UNITS"
  exit 0
fi

[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "pass --commit <the full 40-character sha you reviewed>"
[ "$(as_main /usr/bin/git -C "$REPO" rev-parse HEAD)" = "$COMMIT" ] || die "the checkout is not at $COMMIT"
[ -z "$(as_main /usr/bin/git -C "$REPO" status --porcelain --untracked-files=no)" ] || die "the checkout has uncommitted changes"
ok "the checkout is clean at $COMMIT"

step "1. the user"
getent group mro-warden >/dev/null || groupadd --system mro-warden
id mro-warden >/dev/null 2>&1 || useradd --system --gid mro --home-dir "$STATE" --no-create-home --shell /usr/sbin/nologin mro-warden
id -nG mro-warden | tr ' ' '\n' | /bin/grep -qx mro-warden || usermod -aG mro-warden mro-warden
ok "mro-warden, primary group mro, and its own group mro-warden"

step "2. the code, owned by root"
STAGE="$OPT.new.$$"
trap 'rm -rf "$STAGE"' EXIT
bash "$WARDEN/deploy/build-clock-tree.sh" "$REPO" "$COMMIT" "$STAGE" "$NODE_VERSION" "sudo -u $MAIN_USER" warden \
  || die "the code could not be built (above)"
chown -R root:root "$STAGE"
chmod -R u+rwX,go+rX,go-w "$STAGE"
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

step "3. the settings, readable by mro-warden only, owned by root"
install -d -o root -g mro-warden -m 750 "$ETC"
# Read as the main user, so root never follows a link planted in its checkout.
SRC_TMP="$(mktemp "$ETC/source.XXXXXX")"
trap 'rm -f "$SRC_TMP"' EXIT
chmod 600 "$SRC_TMP"
as_main cat "$WARDEN_ENV" > "$SRC_TMP"
# From the root-owned tree, with its own node: root runs no code the main user can write.
"$OPT/bin/node" "$OPT/warden/deploy/warden-env.mjs" --warden-env "$SRC_TMP" --out "$ETC/warden.env" \
  || die "the Warden's settings file could not be built (above)"
rm -f "$SRC_TMP"
trap - EXIT
chown root:mro-warden "$ETC/warden.env"
chmod 640 "$ETC/warden.env"
ok "$ETC/warden.env"

step "4. the log"
install -d -o root -g mro -m 2750 "$LOG_DIR"
[ -f "$LOG_DIR/warden.log" ] || install -o mro-warden -g mro -m 640 /dev/null "$LOG_DIR/warden.log"
install -m 644 "$OPT/warden/deploy/mro-warden.logrotate" /etc/logrotate.d/mro-warden
ROTATE_CHECK="$(logrotate --debug /etc/logrotate.d/mro-warden 2>&1 || true)"
if /bin/grep -q '^error:' <<<"$ROTATE_CHECK"; then
  bad "logrotate reports errors in /etc/logrotate.d/mro-warden: run logrotate --debug on it"
else
  ok "$LOG_DIR/warden.log, rotated weekly"
fi

step "5. the unit, installed DISABLED"
install -m 644 "$OPT/warden/deploy/mro-warden.system.service" "$UNITS/mro-warden.service"
systemctl daemon-reload
if systemd-analyze verify "$UNITS/mro-warden.service"; then ok "unit verified"; else bad "systemd-analyze rejects the unit"; fi
ok "unit is $(systemctl is-enabled mro-warden.service 2>/dev/null || true), $(systemctl is-active mro-warden.service 2>/dev/null || true)"

step "6. checks"
as() { sudo -u "$1" "${@:2}"; }
as mro-warden test -r "$ETC/warden.env" && ok "mro-warden can read its settings" || bad "mro-warden cannot read $ETC/warden.env"
as mro-warden test -r "$BANK" && ok "mro-warden can read the question bank" || bad "mro-warden cannot read $BANK"
as mro-warden test -w "$DB" && ok "mro-warden can write the mirror" || bad "mro-warden cannot write $DB"
as mro-warden test -r "$WARDEN_ENV" && bad "mro-warden CAN read the main user's .env" || ok "mro-warden cannot read the main user's .env"
as mro-warden test -r /etc/mro-clock/clock.env && bad "mro-warden CAN read the Clock's settings" || ok "mro-warden cannot read the Clock's settings"
as mro-warden test -r /etc/mro-clock/split-seed && bad "mro-warden CAN read the split seed" || ok "mro-warden cannot read the split seed"
as "$MAIN_USER" test -r "$ETC/warden.env" && bad "$MAIN_USER CAN read $ETC/warden.env" || ok "$MAIN_USER cannot read the Warden's settings"
as "$MAIN_USER" test -w "$OPT/warden/src/main.mjs" && bad "$MAIN_USER CAN change the Warden's code" || ok "$MAIN_USER cannot change the Warden's code"
# server.mjs and the solver are loaded, not main.mjs, which binds the port.
if as mro-warden "$OPT/bin/node" --input-type=module -e \
  "await import('$OPT/warden/src/server.mjs'); await import('$OPT/tools/robust-solve.mjs');"; then
  ok "the installed code and the solver load as mro-warden"
else
  bad "the installed code does not load as mro-warden"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS: the Warden is installed under mro-warden, unit disabled. Next: cutover-warden-user.sh"
else
  echo "FAIL: see the lines above"
  exit 1
fi
