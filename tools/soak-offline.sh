#!/usr/bin/env bash
# Drives tools/soak-offline.mjs in small batches, each its own capped process.
# See the header of that file for why the batching is not optional.
set -uo pipefail
cd "$(dirname "$0")"
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh"

BATCH=${BATCH:-10}
FAILED=0

run() {   # run <label> <total> <extra args...>
  local label=$1 total=$2; shift 2
  echo "=== $label: $total cases, $BATCH per process ==="
  for ((i = 0; i < total; i += BATCH)); do
    "$HOME/scripts/safe-build.sh" node soak-offline.mjs --from "$i" --count "$BATCH" "$@" \
      | /bin/grep -E "^ *[0-9]+ " || FAILED=1
  done
}

TOTAL=$(node -e 'import("./state-matrix.mjs").then(m=>console.log(m.decodeCases().length))')
EXTREME=$(node -e 'import("./state-matrix.mjs").then(m=>console.log(m.decodeExtremes().length))')

run "every ink x every ring count, one size" "$TOTAL"
run "the extremes, every size in DECODE_SIZES" "$EXTREME" --extremes
CROSS=$(node -e 'import("./state-matrix.mjs").then(m=>console.log(m.crossCases().length))')
# Five per process is one token id per process, so each solves one bitmap.
BATCH=5 run "state x bitmap, third-party sizes" "$CROSS" --cross

[ "$FAILED" -eq 0 ] && echo "OK: every state decoded to its own url" || echo "FAIL: see above"
exit "$FAILED"
