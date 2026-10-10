#!/usr/bin/env bash
# Checks the seed agent's runtime config. Exit 0 means the installer may start
# the unit; exit 1 means starting it could check a real token in before its day.
#
#   bash warden/deploy/seed-config-check.sh <env file>
set -uo pipefail

ENV_FILE="${1:?usage: seed-config-check.sh <env file>}"
REHEARSAL_TOKEN=999999
REHEARSAL_NOT_BEFORE=2000-01-01

safe=0
ok()  { printf '   OK   %s\n' "$1"; }
bad() { printf '   FAIL %s\n' "$1"; safe=1; }
value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

TOKEN="$(value MRO_SEED_TOKEN)"
DAY="$(value MRO_SEED_NOT_BEFORE)"

# The same shape the client accepts, then a real calendar day.
real_day() {
    [[ "$1" =~ ^[12][0-9]{3}-[0-9]{2}-[0-9]{2}$ ]] && [ "$(date -u -d "$1" +%F 2>/dev/null)" = "$1" ]
}

if ! [[ "$TOKEN" =~ ^[1-9][0-9]*$ ]]; then
    bad "MRO_SEED_TOKEN is '$TOKEN' in $ENV_FILE: it must be a token id"
elif [ "$TOKEN" = "$REHEARSAL_TOKEN" ]; then
    if [ "$DAY" = "$REHEARSAL_NOT_BEFORE" ]; then
        ok "rehearsal token $TOKEN, rehearsal day $DAY"
    else
        bad "MRO_SEED_NOT_BEFORE is '$DAY' for the rehearsal token: expected $REHEARSAL_NOT_BEFORE"
    fi
elif [ "$DAY" = "$REHEARSAL_NOT_BEFORE" ] || ! real_day "$DAY"; then
    bad "MRO_SEED_NOT_BEFORE is '$DAY' for real token $TOKEN: set it to opening day + 1 (DEPLOY.md 9c)"
else
    ok "token $TOKEN checks in from $DAY (UTC)"
fi

exit "$safe"
