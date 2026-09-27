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

# ------------------------------------------------------- nothing may be up already
#
# PM2's own list is read into a variable and parsed by node -- a `pm2 jlist | grep`
# would make the gate a pipeline, whose exit status is the last command's, and
# would leave the whole process list on disk.
#
# ANY mro-year-* app that already EXISTS is refused, stopped ones included.
# `pm2 start` on an app pm2 already knows restarts the OLD definition and never
# re-reads this file, so a changed year.config.cjs would silently not take effect.
# Deleting and starting again is the only way to be sure the run is the one this
# file describes -- which is also what the live Warden's own runbook says.
jlist="$(pm2 jlist 2>/dev/null || true)"
existing="$(node -e '
  let list = [];
  try { list = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { list = []; }
  process.stdout.write(list.filter((a) => a.name?.startsWith("mro-year-")).map((a) => `${a.name}(${a.pm2_env?.status})`).join(" "));
' <<< "$jlist")"
if [ -n "$existing" ]; then
  echo "FAIL: pm2 already holds this run's apps: $existing" >&2
  echo "      Stop them with stop.sh (it also writes the report), then:" >&2
  echo "      pm2 delete mro-year-warden mro-year-clock mro-year-runner mro-year-checker" >&2
  exit 1
fi

# The fast Warden's own port. The OLD mro-fast-warden binds the same 4006, and it
# is only `stopped` -- a pm2 resurrect or a hand restart would have it listening.
# Asked by CONNECTING, not by reading a tool's output: a listener is a listener
# whoever owns it, and ss/lsof output would have to be piped to be parsed.
if node -e '
  const net = require("net");
  const s = net.connect(4006, "127.0.0.1");
  s.on("connect", () => { s.destroy(); process.exit(0); });
  s.on("error", () => process.exit(1));
  s.setTimeout(2000, () => { s.destroy(); process.exit(1); });
'; then
  fail "something is already listening on 127.0.0.1:4006. The old mro-fast-warden is the likely owner -- stop it first."
fi

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

names="$(node -e 'const c=require(process.argv[1]);process.stdout.write(c.apps.map((a)=>a.name).join(" "))' "$CONFIG")"

# ONE LINE PER APP: "<name> <status> <restart_time>", read out of pm2's own list
# and never written to disk.
read_states() {
  local list
  list="$(pm2 jlist 2>/dev/null || true)"
  # $names is deliberately unquoted: each name is its own argument to node.
  # shellcheck disable=SC2086
  node -e '
    let list = [];
    try { list = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { process.exit(1); }
    for (const name of process.argv.slice(1)) {
      const app = list.find((a) => a.name === name);
      const status = app ? String(app.pm2_env?.status) : "missing";
      const restarts = app ? String(app.pm2_env?.restart_time ?? "?") : "-";
      console.log(`${name} ${status} ${restarts}`);
    }
  ' $names <<< "$list"
}

# WHAT PM2 SAYS IT DID IS NOT WHAT IT DID, AND `online` A SECOND AFTER STARTING
# MEANS ALMOST NOTHING. Every process here refuses to start on a configuration it
# cannot trust, and PM2 restarts a refusal ten times before giving up -- so the
# list shows `online` while the app is in fact on its fourth attempt. The check
# is: wait for the boot checks to have run, then require `online` with ZERO
# restarts, and require the same answer again a few seconds later.
echo "waiting 15s for the boot checks"
sleep 15
first="$(read_states)"
sleep 5
second="$(read_states)"

echo "processes:"
echo "$first"
if [ "$first" != "$second" ]; then
  echo "the second read disagreed with the first:" >&2
  echo "$second" >&2
  fail "a process is restarting. Read $LOGS and pm2 logs, then stop.sh."
fi
while read -r name status restarts; do
  [ -n "$name" ] || continue
  if [ "$status" != "online" ] || [ "$restarts" != "0" ]; then
    echo "  $name is $status after $restarts restart(s)" >&2
    failed=1
  fi
done <<< "$first"
[ "$failed" = 0 ] || fail "not every process is online and unrestarted. Read $LOGS and pm2 logs, then stop.sh."

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
