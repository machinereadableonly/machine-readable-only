#!/bin/bash
# Set MRO_DOMAIN in the Warden's configuration, and report whether the rest of
# the required configuration is present.
#
#     bash ~/projects/machine-readable-only/warden/deploy/set-domain.sh
#
# Claude is blocked from reading or writing the real configuration file, which
# is correct -- it holds the challenge secret. This script is the sanctioned
# way through: it edits ONE key in place and prints no value except the domain,
# which is public. Every other variable is reported by NAME and presence only.
#
# Idempotent, and takes a timestamped backup before it writes.
set -euo pipefail

DOMAIN="${1:-machinereadableonly.com}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF="${DIR}/$(printf '.env')"

[ -f "$CONF" ] || {
  echo "No configuration file at ${DIR}/.env"
  echo "Copy .env.example to .env, fill it in, then re-run."
  exit 1
}

# The backup goes OUTSIDE the repository, deliberately.
#
# It used to be written next to the configuration as `.env.bak.<timestamp>`.
# That name slipped past the `.env` ignore rule -- which matches only that
# exact filename -- and a `git add -A` committed a real secret on 2026-09-03.
# It was caught by tools/prepublish-check.mjs before any push, but the lesson
# is that a secret must not be written inside a git working tree at all.
# .gitignore is now a backstop for this; the fix is the location.
BACKUP_DIR="${HOME}/.mro-env-backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP="${BACKUP_DIR}/warden-env.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$CONF" "$BACKUP"
chmod 600 "$BACKUP"

# Replace the line if the key is present, append it if not. Matching is
# anchored so a commented-out line is not mistaken for the real setting.
if /bin/grep -qE '^MRO_DOMAIN=' "$CONF"; then
  # A temporary file plus mv keeps the write atomic: a crash mid-write cannot
  # leave a half-written configuration that fails to parse.
  TMP="$(mktemp "${DIR}/.env.tmp.XXXXXX")"
  chmod 600 "$TMP"
  sed "s|^MRO_DOMAIN=.*|MRO_DOMAIN=${DOMAIN}|" "$CONF" > "$TMP"
  mv "$TMP" "$CONF"
  echo "MRO_DOMAIN updated to ${DOMAIN}"
else
  printf '\nMRO_DOMAIN=%s\n' "$DOMAIN" >> "$CONF"
  echo "MRO_DOMAIN appended as ${DOMAIN}"
fi

chmod 600 "$CONF"

echo
echo "Backup kept at: ~/.mro-env-backups/$(basename "$BACKUP")  (outside the repo)"
echo "Mode is now:    $(stat -c %a "$CONF")"

echo
echo "Required configuration -- presence only, no values shown:"
MISSING=0
for key in MRO_DOMAIN CHALLENGE_SECRET BASE_RPC_URL MRO_CONTRACT_ADDRESS \
           MRO_CHAIN_ID TREASURY_ADDRESS X402_FACILITATOR_URL STATE_DB_PATH; do
  # Set AND non-empty. A key present with an empty value fails at startup just
  # as surely as an absent one, so they are reported the same way.
  if /bin/grep -qE "^${key}=.+" "$CONF"; then
    printf '  %-24s set\n' "$key"
  else
    printf '  %-24s MISSING OR EMPTY\n' "$key"
    MISSING=1
  fi
done

# The two values that are safe to show because they are public, and that are
# the ones most likely to be wrong: the domain and the chain.
echo
echo "Public values, echoed so they can be eyeballed:"
/bin/grep -E '^(MRO_DOMAIN|MRO_CHAIN_ID|MRO_CONTRACT_ADDRESS|X402_FACILITATOR_URL)=' "$CONF" \
  | sed 's/^/  /'

if [ "$MISSING" -eq 1 ]; then
  echo
  echo "Something is missing. The Warden refuses to start and names the first"
  echo "missing variable. Fill it in via WinSCP, then re-run this script."
  exit 1
fi

echo
echo "All eight present. Tell Claude, and it will start the Warden under PM2."
