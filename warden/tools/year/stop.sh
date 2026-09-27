#!/usr/bin/env bash
#
# Stop the accelerated year and write the report.
#
#   bash tools/year/stop.sh
#
# STOP, NEVER DELETE. `pm2 delete` would take the four apps out of pm2's list
# along with their log paths and restart counts -- the record of how the run
# behaved. Stopped apps can be started again; deleted ones have to be rebuilt
# from this file, and the reason a process died goes with them.
#
# The data directory is left exactly as it is. Nothing here removes a key, a log
# or the mirror: the report is read after the run, and so are the logs.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DIR="${MRO_YEAR_DIR:-$HOME/.mro-year}"
export MRO_YEAR_DIR="$DIR"
CONFIG="$HERE/year.config.cjs"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi

fail() { echo "FAIL: $*" >&2; exit 1; }
command -v node >/dev/null || fail "no node on PATH"
command -v pm2 >/dev/null || fail "no pm2 on PATH"

# The names come from the process list itself, so this file cannot drift from it.
names="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.apps.map((a)=>a.name).join(" "))' "$CONFIG")"

for name in $names; do
  # A name pm2 does not know is not a failure here: stopping a run that is
  # already half stopped must still reach the report.
  pm2 stop "$name" || echo "note: pm2 could not stop $name (it may not be running)"
done

echo "stopped: $names"
node "$HERE/report.mjs"
