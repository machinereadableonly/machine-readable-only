#!/usr/bin/env bash
# Prove the chain guard refuses a wrong EXPECTED_CHAIN_ID and permits a right
# one, against a REAL chain (a local anvil), not a unit test of the expression.
set -uo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
# Resolved from this script's own location so the checkout can live anywhere.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

PORT=8599
anvil --port "$PORT" --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null' EXIT
for _ in $(seq 1 40); do
  cast block-number --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1 && break
  sleep 0.25
done

CHAIN="$(cast chain-id --rpc-url http://127.0.0.1:$PORT)"
echo "anvil chain id: $CHAIN"

# anvil's published default account 0. A publicly documented test key.
export SPIKE_DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
export WARDEN_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8

run() { # $1 = EXPECTED_CHAIN_ID
  EXPECTED_CHAIN_ID="$1" forge script script/DeployPlan1.s.sol:DeployPlan1 \
    --rpc-url "http://127.0.0.1:$PORT" --broadcast 2>&1
}

PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "  PASS  $1"; }
bad(){ FAIL=$((FAIL+1)); echo "  FAIL  $1"; }

echo "== a WRONG chain id must refuse =="
OUT="$(run 8453)"
if echo "$OUT" | grep -q "EXPECTED_CHAIN_ID does not match"; then
  ok "refused with the right message"
else
  bad "did not refuse; output was:"; echo "$OUT" | tail -20
fi
if echo "$OUT" | grep -qE '^(Deployer|Contract Address)'; then
  bad "it broadcast anyway"
else
  ok "nothing was broadcast"
fi

echo "== a MISSING chain id must refuse too =="
OUT="$(env -u EXPECTED_CHAIN_ID forge script script/DeployPlan1.s.sol:DeployPlan1 \
        --rpc-url "http://127.0.0.1:$PORT" 2>&1)"
if echo "$OUT" | grep -qiE 'EXPECTED_CHAIN_ID|environment variable'; then
  ok "an unstated chain is refused, not defaulted"
else
  bad "a missing EXPECTED_CHAIN_ID did not stop it"; echo "$OUT" | tail -10
fi

echo "== the RIGHT chain id must run =="
OUT="$(run "$CHAIN")"
if echo "$OUT" | grep -qiE 'ONCHAIN EXECUTION COMPLETE|Total Paid'; then
  ok "deployed against the stated chain"
else
  bad "the correct chain id did not deploy; output was:"; echo "$OUT" | tail -25
fi

echo ""
echo "PASS $PASS   FAIL $FAIL"
[ "$FAIL" -eq 0 ]
