#!/usr/bin/env bash
#
# The accelerated year's Clock: the REAL Clock (warden/src/clock/main.mjs), run
# 30 seconds after each 300-second fast day instead of at 00:05 UTC. Run under
# PM2 as mro-year-clock; see year.config.cjs.
#
# ONE LINE PER RUN IN clock.jsonl, CARRYING THE EXIT CODE, because that file is
# how the runner knows the chain is being written at all: three non-zero exits in
# a row pause every agent rather than spending a year of fast days on credits
# nothing will record.
#
# It runs from the EXPORTED copy of HEAD in the data directory, never from the
# live checkout: this Clock holds the fast pair's key and writes the fast
# mirror, and one started in the live tree would be pointed at the live site's.
#
# TEST-ONLY. Base Sepolia, a 300-second day.
set -euo pipefail

DIR="${MRO_YEAR_DIR:-$HOME/.mro-year}"
CONF="$DIR/year.conf"
LOG="$DIR/clock.jsonl"
TREE="$DIR/tree/warden"

for required in "$CONF" "$TREE/src/clock/main.mjs"; do
  if [ ! -e "$required" ]; then
    echo "year-clock: $required is not there. Run setup.sh first." >&2
    exit 1
  fi
done

# The interpreter PM2 was told to use, so the version is pinned in one place.
# Run by hand, fall back to nvm's node and then to whatever is on PATH.
NODE="${MRO_YEAR_NODE:-}"
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$HOME/.nvm/nvm.sh" >/dev/null
  fi
  NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ]; then
  echo "year-clock: no node found. Set MRO_YEAR_NODE to the interpreter to use." >&2
  exit 1
fi

# The day length and the offset come from the settings file the Clock itself
# reads, so the loop cannot drift from the day the contract is counting. Only
# these two names are read, and nothing from that file is ever printed.
#
# awk rather than `sed | head`: under `pipefail` a `head` that closes the pipe
# early makes sed exit 141 and takes the whole script with it.
read_setting() {
  awk -v key="$1" 'index($0, key "=") == 1 { sub(/^[^=]*=/, "", $0); gsub(/[ \t\r"'"'"']/, "", $0); print; exit }' "$CONF"
}
DAY="$(read_setting MRO_DAY_SECONDS)"
OFFSET="$(read_setting MRO_CLOCK_OFFSET_SECONDS)"
: "${DAY:=300}"
: "${OFFSET:=30}"

cd "$TREE"
echo "year-clock: a ${DAY}s day, run at +${OFFSET}s, logging to $LOG"

while true; do
  now="$(date +%s)"
  # THIS period's run when its moment has not passed yet, the next one's
  # otherwise -- the same rule as the runner's nextWakeMs. Starting the loop at
  # +5 s of a fast day used to throw that day's Clock run away and wait 300 s.
  next=$(( (now / DAY) * DAY + OFFSET ))
  if [ "$next" -le "$now" ]; then next=$(( next + DAY )); fi
  sleep $(( next - now ))
  # The fast day that has just closed: the one the run about to start writes.
  day=$(( next / DAY - 1 ))

  code=0
  "$NODE" --dns-result-order=ipv4first --no-network-family-autoselection \
    --env-file="$CONF" src/clock/main.mjs || code=$?

  printf '{"ts":"%s","chainDay":%d,"exit":%d}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$day" "$code" >> "$LOG"
  echo "year-clock: fast day $day exited $code"
done
