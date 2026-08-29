#!/usr/bin/env bash
# Regenerates contracts/script/SpikeBitmaps.sol, ONE TOKEN PER PROCESS.
#
#   bash tools/spike-bitmaps.sh [domain] [count]
#
# Why per-process: choosing a token's code now renders and decodes it in five
# states at ten raster sizes (tools/robust-solve.mjs). resvg's raster buffers are
# NATIVE memory, so --max-old-space-size does not bound them -- measured
# 2026-08-29, a 27-token run in one process sat at 2.0 GB and throttled against
# the safe-build cap without finishing. Process exit is what frees them. Same
# reasoning, and the same shape, as tools/soak-offline.sh.
#
# The solved rows are kept at tools/out/spike-rows.jsonl (gitignored) rather than
# in a temp file that is deleted on exit. Solving 27 tokens takes about eight
# minutes; assembling them takes a second. When assembly fails, the rows must
# still be there, or a one-line bug costs the whole eight minutes again -- which
# is exactly what happened the first time this ran.
set -uo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh"

DOMAIN=${1:-example.com}
COUNT=${2:-27}
ROWS=tools/out/spike-rows.jsonl
mkdir -p tools/out

# --resume picks up where a previous run stopped, so an interrupted solve does
# not start from token 1 again.
if [ "${3:-}" = "--resume" ] && [ -f "$ROWS" ]; then
  DONE=$(wc -l < "$ROWS")
  echo "resuming: $DONE rows already solved"
else
  : > "$ROWS"
  DONE=0
fi

echo "solving $COUNT bitmaps for $DOMAIN, one process each"
for ((id = DONE + 1; id <= COUNT; id++)); do
  # safe-build.sh prints its banner (MemoryHigh, cmd, ...) on STDOUT, not stderr,
  # so the row must be sieved out by shape or the JSONL is a mix of both. Same
  # trap as `forge ... --json` printing "No files changed" ahead of the JSON.
  if ! "$HOME/scripts/safe-build.sh" node tools/spike-bitmaps.mjs --row "$id" "$DOMAIN" \
       | /bin/grep '^{' >> "$ROWS"; then
    echo "FAILED on token $id -- rows so far are in $ROWS; re-run with --resume" >&2
    exit 1
  fi
done

# Stderr is NOT filtered here. The first version piped it through grep and a
# failing assemble reported nothing at all.
"$HOME/scripts/safe-build.sh" node tools/spike-bitmaps.mjs --assemble "$ROWS" "$DOMAIN"
