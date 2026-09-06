#!/usr/bin/env bash
# Rehearse the REAL startup path against a COPY of production state.
#
# WHY THIS EXISTS. On 2026-09-05 a change with 394 passing tests took the live
# Warden down in a crash loop, because every suite opens `:memory:` and the one
# ordering that mattered -- a schema statement referencing a column migrate()
# adds -- is unreachable from a fresh database. A test suite proves the code
# against the state the TESTS build; a deploy runs it against the state
# PRODUCTION has. This closes that gap for a few seconds' work.
#
# It is also the only way to exercise the boot-time checks added on 2026-09-06:
# the chain id read against the live RPC, and the EIP-55 form of
# TREASURY_ADDRESS. Both refuse to start, and both are invisible to every test.
#
# SECRETS. The rehearsal environment is assembled OUTSIDE the git worktree, at
# mode 600, and deleted on exit -- the 2026-09-03 leak was a backup written
# beside the file it backed up, inside the repository, that `git add -A` then
# swept in. Nothing here prints a value: the only output is the service's own
# log lines.
#
# Usage:  bash warden/tools/rehearse-start.sh [seconds]
set -uo pipefail

SECONDS_TO_RUN="${1:-20}"
WARDEN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$WARDEN_DIR/.env"
LIVE_DB="$WARDEN_DIR/state.db"

BACKUP_DIR="$HOME/backups"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mro-rehearse.XXXXXX")"
chmod 700 "$WORK"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

if [ ! -f "$ENV_FILE" ]; then
  echo "rehearse: no environment file at <warden>/.env -- nothing to rehearse" >&2
  exit 2
fi

# 1. BACK UP FIRST, ALWAYS. This is what made the 2026-09-05 recovery cheap.
mkdir -p "$BACKUP_DIR"
if [ -f "$LIVE_DB" ]; then
  cp "$LIVE_DB" "$BACKUP_DIR/state.db.$STAMP"
  chmod 600 "$BACKUP_DIR/state.db.$STAMP"
  echo "rehearse: backed up state.db to ~/backups/state.db.$STAMP"
else
  echo "rehearse: no state.db yet -- rehearsing against an empty mirror" >&2
fi

# 2. A COPY of production state, including the WAL: without it the copy is the
#    last checkpoint rather than what the service is actually running on.
COPY_DB="$WORK/state.db"
if [ -f "$LIVE_DB" ]; then
  cp "$LIVE_DB" "$COPY_DB"
  [ -f "$LIVE_DB-wal" ] && cp "$LIVE_DB-wal" "$COPY_DB-wal"
  [ -f "$LIVE_DB-shm" ] && cp "$LIVE_DB-shm" "$COPY_DB-shm"
fi

# 3. The rehearsal environment: the real one, with the two settings that must
#    NOT point at production replaced. Both are removed and re-appended rather
#    than relying on which of a duplicate key or a shell variable wins -- that
#    precedence is a detail of the runtime, and a rehearsal that silently ran
#    against the live database or the live port would be worse than none.
REHEARSAL_ENV="$WORK/env"
grep -v -E '^[[:space:]]*(STATE_DB_PATH|PORT)=' "$ENV_FILE" > "$REHEARSAL_ENV"
chmod 600 "$REHEARSAL_ENV"
{
  echo "STATE_DB_PATH=$COPY_DB"
  echo "PORT=3916"
} >> "$REHEARSAL_ENV"

# Prove the substitution took, without printing anything from the file.
if ! grep -q "^STATE_DB_PATH=$COPY_DB$" "$REHEARSAL_ENV"; then
  echo "rehearse: could not point the copy at the scratch database -- refusing to run" >&2
  exit 2
fi
if grep -c -E '^[[:space:]]*STATE_DB_PATH=' "$REHEARSAL_ENV" | grep -qv '^1$'; then
  echo "rehearse: more than one STATE_DB_PATH survived -- refusing to run" >&2
  exit 2
fi

echo "rehearse: starting the real main.mjs against the copy, on port 3916, for ${SECONDS_TO_RUN}s"
echo "--- service output ---"

# 4. Run the REAL entrypoint. Not a test harness, not a subset: the same file
#    PM2 runs, reading the same configuration, against a copy of the same data.
NODE_BIN="$HOME/.nvm/versions/node/v24.14.1/bin/node"
[ -x "$NODE_BIN" ] || NODE_BIN="$(command -v node)"

cd "$WARDEN_DIR"
timeout --preserve-status -s TERM "$SECONDS_TO_RUN" \
  "$NODE_BIN" --env-file="$REHEARSAL_ENV" src/main.mjs 2>&1 | sed 's/^/  /'
STATUS="${PIPESTATUS[0]}"

echo "--- end of service output ---"

# A clean rehearsal is one that was still running when the timer fired. Any
# other exit means the process gave up on its own, which is exactly the
# crash-loop this script exists to catch BEFORE a restart.
if [ "$STATUS" -eq 143 ] || [ "$STATUS" -eq 0 ]; then
  echo "rehearse: PASS -- it started and was still up when the timer stopped it"
  exit 0
fi

echo "rehearse: FAIL -- the service exited on its own with status $STATUS" >&2
echo "rehearse: do NOT restart production until that is understood" >&2
exit 1
