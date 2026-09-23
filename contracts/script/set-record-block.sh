#!/usr/bin/env bash
#
# Rewrite the deploy block and date on CLAUDE.md's live-deployment line.
#
#   bash contracts/script/set-record-block.sh <deploy-block> <YYYY-MM-DD> [file]
#
# The file defaults to CLAUDE.md. adopt-deployment.sh calls this; the test is
# warden/test/set-record-block.test.mjs, which runs it against scratch copies.
#
# WHY IT EXISTS. adopt-deployment.sh rewrote the ADDRESSES in CLAUDE.md but not
# the block and date printed under them, so the 2026-09-22 redeploy left the
# 2026-09-11 pair's block beside the new address. Nothing failed; the record was
# simply wrong until someone read it against the chain (found 2026-09-23).
set -euo pipefail

BLOCK="${1:-}"
DAY="${2:-}"
FILE="${3:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/CLAUDE.md}"

case "$BLOCK" in
  ''|*[!0-9]*) echo "FAIL: deploy block '$BLOCK' is not a plain number (no separators)" >&2; exit 1 ;;
esac
if ! [[ "$DAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  echo "FAIL: date '$DAY' is not YYYY-MM-DD" >&2
  exit 1
fi
if [ ! -f "$FILE" ]; then
  echo "FAIL: $FILE does not exist" >&2
  exit 1
fi

# ONE LINE, EXACTLY ONE -- the same rule adopt-deployment.sh applies to the
# addresses. A second line of this shape is a historical record, and rewriting
# it would state that an old deploy happened at the new block.
LINE_RE='^      block [0-9,]+, [0-9]{4}-[0-9]{2}-[0-9]{2}, '
count=$(/bin/grep -c -E "$LINE_RE" "$FILE" || true)
if [ "$count" != "1" ]; then
  echo "FAIL: $FILE has $count deploy-block lines; expected exactly 1 -- edit it by hand" >&2
  exit 1
fi

# Grouped the way the line already writes numbers: 47161021 -> 47,161,021.
GROUPED=$(echo "$BLOCK" | sed -E ':a;s/([0-9])([0-9]{3})(,|$)/\1,\2\3/;ta')

sed -i -E "s/^(      block )[0-9,]+, [0-9]{4}-[0-9]{2}-[0-9]{2}, /\\1${GROUPED}, ${DAY}, /" "$FILE"

# ASSERTED, NOT ASSUMED: `sed -i` succeeds when its pattern matches nothing.
if ! /bin/grep -q -E "^      block ${GROUPED}, ${DAY}, " "$FILE"; then
  echo "FAIL: the deploy-block line in $FILE was not set to ${GROUPED}, ${DAY} -- edit it by hand" >&2
  exit 1
fi
/bin/grep -n -E "^      block " "$FILE"
