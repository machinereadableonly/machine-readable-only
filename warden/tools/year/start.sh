#!/usr/bin/env bash
#
# Start the accelerated year: the four processes, behind the four test suites.
#
#   bash tools/year/start.sh
#
# THE SUITES ARE A GATE, NOT A REPORT. A 38-hour run is only worth starting on
# code that passes, and the one thing this run cannot do is go back and live the
# year again. Each suite is run on its own and its exit status read on its own --
# never piped into anything, because a pipeline's status is the last command's and
# that is how a red guard got through once before.
#
# TEST-ONLY. Base Sepolia, a 300-second day, port 4006.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

DIR="${MRO_YEAR_DIR:-$HOME/.mro-year}"
export MRO_YEAR_DIR="$DIR"
LOGS="$DIR/logs"
CONF="$DIR/year.conf"
CONFIG="$HERE/year.config.cjs"

mkdir -p "$LOGS"
export PATH="$HOME/.foundry/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi

fail() { echo "FAIL: $*" >&2; exit 1; }

command -v node >/dev/null || fail "no node on PATH"
command -v pm2 >/dev/null || fail "no pm2 on PATH"

# ------------------------------------------------------------ setup must be done
for required in "$CONF" "$DIR/contract.address" "$DIR/treasury.address" "$DIR/tree/warden/src/main.mjs"; do
  [ -e "$required" ] || fail "$required is not there. Run setup.sh first."
done
if /bin/grep -q "^MRO_CONTRACT_ADDRESS=pending-deploy" "$CONF"; then
  fail "$CONF still says pending-deploy: setup.sh has not deployed the pair yet"
fi
for name in A1 A2 A3 A4 A5 A6 A7 A8 A9 A10 A11 A12; do
  [ -f "$DIR/wallets/$name.key" ] || fail "no wallet for $name. Run wallets.mjs first."
  [ -f "$DIR/identities/$name.jwk.json" ] || fail "no identity for $name. Run wallets.mjs first."
done
[ -f "$DIR/identities/A11b.jwk.json" ] || fail "no rebind identity A11b. Run wallets.mjs first."

# The stack runs the EXPORT of HEAD, so a working tree with edits in it is not
# what is about to run, and the suites below test the working tree.
dirty="$(git -C "$REPO" status --porcelain 2>/dev/null | wc -l || true)"
if [ "$dirty" -gt 0 ]; then
  echo "note: $dirty uncommitted changes in the checkout. The run uses the export of HEAD in $DIR/tree."
fi
head_now="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || true)"
head_run=""
if [ -f "$DIR/tree.head" ]; then head_run="$(tr -d " \t\r\n" < "$DIR/tree.head")"; fi
if [ -n "$head_now" ] && [ "$head_now" != "$head_run" ]; then
  echo "note: $DIR/tree was exported from ${head_run:-an unrecorded commit}, and HEAD is now $head_now."
  echo "      Run setup.sh again to re-export before starting, or the suites below test code the run will not use."
fi

# ------------------------------------------------------------ the four suites
failed=0
run_suite() {
  local name="$1" dir="$2"
  shift 2
  local log="$LOGS/suite-$name.log"
  if ( cd "$REPO/$dir" && "$@" ) > "$log" 2>&1; then
    echo "  ok   $name"
  else
    echo "  FAIL $name -- see $log"
    tail -20 "$log"
    failed=1
  fi
}

echo "suites:"
run_suite contracts contracts forge test
run_suite warden warden npm test
run_suite tools tools npm test
run_suite client client npm test
[ "$failed" = 0 ] || fail "the suites are not green. Nothing was started."

# ------------------------------------------------------------ start, then read back
pm2 start "$CONFIG"

# WHAT PM2 SAYS IT DID IS NOT WHAT IT DID. The names and their statuses are read
# back out of pm2's own list: a missing app, or one that started and exited, must
# stop this here rather than at the first empty log tomorrow.
names="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.apps.map((a)=>a.name).join(" "))' "$CONFIG")"
jlist="$LOGS/pm2-jlist.json"
pm2 jlist > "$jlist"

echo "processes:"
for name in $names; do
  status="$(node -e '
    const list = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const app = list.find((a) => a.name === process.argv[2]);
    process.stdout.write(app ? String(app.pm2_env.status) : "missing");
  ' "$jlist" "$name")"
  echo "  $name $status"
  [ "$status" = "online" ] || failed=1
done
[ "$failed" = 0 ] || fail "not every process is online. Read $LOGS and pm2 logs, then stop.sh."

# ------------------------------------------------------------ the first pass
# The runner does a pass as soon as it starts, so the first line arrives in
# seconds. Waiting for it here means the operator sees the run working rather
# than being told it was started.
echo "waiting for the runner's first line in $DIR/runner.jsonl"
for _ in $(seq 1 30); do
  if [ -s "$DIR/runner.jsonl" ]; then break; fi
  sleep 3
done
if [ -s "$DIR/runner.jsonl" ]; then
  tail -5 "$DIR/runner.jsonl"
else
  echo "no runner line yet. Read $LOGS/mro-year-runner.err.log before leaving it running."
fi

echo
echo "running. stop.sh stops the four and writes the report."
