#!/usr/bin/env bash
#
# Point the Warden at a different deployed contract.
#
#   bash warden/deploy/set-contract-address.sh 0x<address>
#
# Claude cannot edit the environment file -- the rule that keeps secrets out of
# its hands is deliberate and correct -- so a redeploy needs exactly one command
# from the operator. This script reads and rewrites only MRO_CONTRACT_ADDRESS, prints no
# other value, and keeps a timestamped backup of the file beside it.
#
# It does NOT restart the Warden: the restart wants a rehearsal first, and
# rehearsing is Claude's job.
set -euo pipefail

NEW="${1:?usage: set-contract-address.sh 0x<address>}"
if [[ ! "$NEW" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  echo "Not an address: $NEW"
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
FILE="./.env"
[ -f "$FILE" ] || { echo "No environment file at $(pwd)/.env"; exit 1; }

BACKUP="${FILE}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$FILE" "$BACKUP"
chmod 600 "$BACKUP"

if ! grep -q '^MRO_CONTRACT_ADDRESS=' "$FILE"; then
  echo "MRO_CONTRACT_ADDRESS is not in the file. Nothing changed; backup at $BACKUP"
  exit 1
fi

OLD="$(grep '^MRO_CONTRACT_ADDRESS=' "$FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"

# In place, preserving every other line and the file's mode.
tmp="$(mktemp)"
chmod 600 "$tmp"
sed "s|^MRO_CONTRACT_ADDRESS=.*|MRO_CONTRACT_ADDRESS=$NEW|" "$FILE" > "$tmp"
mv "$tmp" "$FILE"
chmod 600 "$FILE"

echo "MRO_CONTRACT_ADDRESS"
echo "  was  $OLD"
echo "  now  $NEW"
echo
echo "Backup: $BACKUP  (delete it once the Warden is confirmed working)"
echo "Nothing else in the file was read or changed. Tell Claude, and it will"
echo "rehearse the start against a copy of production state before restarting."
