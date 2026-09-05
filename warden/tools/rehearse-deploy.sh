#!/usr/bin/env bash
# Rehearse the Warden's REAL startup path against a COPY of production state.
#
# A green suite proves the code against the state the tests build; a deploy runs
# it against the state production has. Every suite in this project opens
# :memory:, so an existing database with migration history is a state the tests
# structurally cannot construct -- which is how an index on a not-yet-added
# column crash-looped this service on 2026-09-05.
#
# Nothing here touches the live database or the live process. The copy gets its
# own directory, its own port and its own configuration built from scratch, so
# no real secret is read.
set -uo pipefail

# Resolved from this script's own location, so the checkout can live anywhere.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
D="$(mktemp -d -t mro-deploy-rehearsal-XXXXXX)"
trap 'rm -rf "$D"' EXIT
PORT="${REHEARSAL_PORT:-4399}"

# The WAL matters: copying only the .db file would replay a database missing
# everything written since the last checkpoint, which is not what production
# would start from.
for f in state.db state.db-wal state.db-shm; do
  [ -f "$REPO/warden/$f" ] && cp "$REPO/warden/$f" "$D/$f"
done
echo "copied production state: $(stat -c %s "$D/state.db") bytes"

CONF="$D/rehearsal.env"
umask 077
cat > "$CONF" <<EOF
MRO_DOMAIN=example.com
CHALLENGE_SECRET=rehearsal-only-not-a-real-secret
BASE_RPC_URL=https://sepolia.base.org
# Only has to be a well-formed address for startup to pass; override when the
# deployed contract moves. Nothing here reads the chain.
MRO_CONTRACT_ADDRESS=${REHEARSAL_CONTRACT:-0xf0Df806ff06ae051756db128Bc9F83CDB425a716}
MRO_CHAIN_ID=84532
TREASURY_ADDRESS=0x000000000000000000000000000000000000dEaD
X402_FACILITATOR_URL=https://x402.org/facilitator
STATE_DB_PATH=$D/state.db
PORT=$PORT
EOF

cd "$REPO/warden" || exit 1
node --env-file="$CONF" src/main.mjs > "$D/out.log" 2>&1 &
PID=$!

# Wait for it to answer, or to die.
UP=0
for _ in $(seq 1 40); do
  if ! kill -0 "$PID" 2>/dev/null; then break; fi
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/llms.txt" 2>/dev/null; then UP=1; break; fi
  sleep 0.25
done

echo "--- startup log ---"
cat "$D/out.log"
echo "-------------------"

if [ "$UP" != "1" ]; then
  echo "RESULT: FAILED to come up against production state"
  kill "$PID" 2>/dev/null
  exit 1
fi

echo "RESULT: came up against a copy of production state"

# The routes this phase changed, exercised for real.
DIRPATH="/.well-known/http-message-signatures-directory"
ETAG="$(curl -fsS -D - -o /dev/null "http://127.0.0.1:$PORT$DIRPATH" | tr -d '\r' | awk 'tolower($1)=="etag:"{print $2}')"
echo "directory ETag: ${ETAG:-<none>}"
CODE="$(curl -fsS -o /dev/null -w '%{http_code}' -H "If-None-Match: $ETAG" "http://127.0.0.1:$PORT$DIRPATH")"
echo "conditional GET: $CODE (expect 304)"
KNOCK="$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/mcp")"
echo "unsigned POST /mcp: $KNOCK (expect 401)"
TOK="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/t/2")"
echo "GET /t/2 off the copied mirror: $TOK (expect 200)"

kill "$PID" 2>/dev/null
wait "$PID" 2>/dev/null

[ "$CODE" = "304" ] && [ "$KNOCK" = "401" ] && [ "$TOK" = "200" ]
