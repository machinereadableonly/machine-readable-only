#!/usr/bin/env bash
#
# Record the block a contract was deployed in, for ONE chain, in the Clock's
# DEPLOY_BLOCK map -- keeping every other chain's entry.
#
#   bash contracts/script/set-deploy-block.sh <chain-id> <deploy-block> [file]
#
# The file defaults to warden/src/clock/reconcile.mjs. adopt-deployment.sh calls
# this; warden/test/set-deploy-block.test.mjs runs it against scratch copies.
#
# WHY A SEPARATE STEP. adopt-deployment.sh used to rewrite the map with a
# pattern that matched `{ 84532: ... }` and nothing else, so a MAINNET adoption
# would have failed at exactly the step that stops the Clock mis-running
# (found 2026-09-15). The Clock refuses to start without a deploy block for its
# chain, so a wrong or missing entry stops the Clock rather than mis-running it.
set -euo pipefail

CHAIN="${1:-}"
BLOCK="${2:-}"
FILE="${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/warden/src/clock/reconcile.mjs}"

case "$CHAIN" in
  ''|*[!0-9]*) echo "FAIL: chain id '$CHAIN' is not a plain number" >&2; exit 1 ;;
esac
case "$BLOCK" in
  ''|*[!0-9]*) echo "FAIL: deploy block '$BLOCK' is not a plain number (no separators)" >&2; exit 1 ;;
esac
if [ ! -f "$FILE" ]; then
  echo "FAIL: $FILE does not exist" >&2
  exit 1
fi

# ONE LINE, EXACTLY ONE. The edits below are line-scoped; a map spread over
# several lines, or two maps, is a shape this does not know how to edit safely.
LINE_RE='^export const DEPLOY_BLOCK = \{ .* \};$'
count=$(/bin/grep -c -E "$LINE_RE" "$FILE" || true)
if [ "$count" != "1" ]; then
  echo "FAIL: $FILE has $count one-line DEPLOY_BLOCK maps; expected exactly 1 -- edit it by hand" >&2
  exit 1
fi

# Grouped the way the file already writes numbers: 51340945 -> 51_340_945.
GROUPED=$(echo "$BLOCK" | sed -E ':a;s/([0-9])([0-9]{3})(_|$)/\1_\2\3/;ta')

# ANCHORED ON THE COLON. "84532" begins with "8453", so the key is matched as
# "<space or brace><id>:" -- neither id can ever match inside the other.
if /bin/grep -q -E "^export const DEPLOY_BLOCK = \{.*[{ ]${CHAIN}: [0-9_]+n" "$FILE"; then
  sed -i -E "/^export const DEPLOY_BLOCK = /s/([{ ])${CHAIN}: [0-9_]+n/\\1${CHAIN}: ${GROUPED}n/" "$FILE"
else
  sed -i -E "/^export const DEPLOY_BLOCK = /s/ \};\$/, ${CHAIN}: ${GROUPED}n };/" "$FILE"
fi

# ASSERTED, NOT ASSUMED: `sed -i` succeeds when its pattern matches nothing.
if ! /bin/grep -q -E "^export const DEPLOY_BLOCK = \{.*[{ ]${CHAIN}: ${GROUPED}n[ ,]" "$FILE"; then
  echo "FAIL: DEPLOY_BLOCK[$CHAIN] was not set to $GROUPED in $FILE -- edit it by hand" >&2
  exit 1
fi
/bin/grep -n "^export const DEPLOY_BLOCK" "$FILE"
