#!/usr/bin/env bash
# Deploy a new Renderer and prepare the Safe transaction that points the token
# at it. The deploy needs no owner power; setRenderer is the Safe's to sign.
#
#   bash contracts/script/swap-renderer.sh <token> <safe> <chain-id>              # simulate only
#   bash contracts/script/swap-renderer.sh <token> <safe> <chain-id> --broadcast  # deploy, then prepare
#
# chain-id is 84532 (Base Sepolia) or 8453 (Base mainnet, real funds: operator
# approval). After a broadcast, in order:
#   1. sign and execute the printed Safe file at app.safe.global, checking the hashes on each device
#   2. cast call <token> "renderer()(address)" --rpc-url <rpc>    -- must print the new renderer
#   3. forge verify-contract <new-renderer> src/render/Renderer.sol:Renderer --chain <chain-id> --watch
#   4. bash contracts/script/adopt-deployment.sh --chain <chain-id> <new-renderer> <token> <token's deploy block>
#      -- the token did not move, so its deploy block does not either.
set -euo pipefail

TOKEN="${1:?token address}"
SAFE="${2:?the Safe that owns the token}"
CHAIN="${3:?chain id: 84532 (Base Sepolia) or 8453 (Base mainnet)}"
BROADCAST=""
if [ "${4:-}" = "--broadcast" ]; then
  BROADCAST="--broadcast"
elif [ -n "${4:-}" ]; then
  echo "FAIL: unrecognised argument '$4'. Pass --broadcast to send, or nothing to simulate." >&2
  exit 1
fi
case "$CHAIN" in
  84532) RPC=https://sepolia.base.org ;;
  8453) RPC=https://mainnet.base.org ;;
  *) echo "FAIL: chain $CHAIN is neither Base Sepolia (84532) nor Base mainnet (8453)" >&2; exit 2 ;;
esac

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true

# Refused before anything is deployed: a renderer nobody can point at is waste.
# safe-tx.mjs refuses a non-EIP-55 address, so catch one here, first.
for a in "$TOKEN" "$SAFE"; do
  if [ "$(cast to-check-sum-address "$a" 2>/dev/null)" != "$a" ]; then
    echo "FAIL: $a is not an EIP-55 checksummed address" >&2
    exit 2
  fi
done
OWNER="$(cast call "$TOKEN" "owner()(address)" --rpc-url "$RPC")"
if [ "$OWNER" != "$SAFE" ]; then
  echo "FAIL: the token's owner is $OWNER, not the Safe $SAFE." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a
export EXPECTED_CHAIN_ID="$CHAIN"

echo "chain    $(cast chain-id --rpc-url "$RPC")  (expected $EXPECTED_CHAIN_ID)"
echo "token    $TOKEN"
echo "owner    $SAFE"
echo "mode     ${BROADCAST:-simulate}"
echo

OUT="$(forge script script/DeployRenderer.s.sol:DeployRenderer --sig "run(address)" "$TOKEN" --rpc-url "$RPC" $BROADCAST -vvv)"
echo "$OUT"
if [ -z "$BROADCAST" ]; then
  exit 0
fi

NEXT="$(printf '%s\n' "$OUT" | sed -n 's/^ *renderer \(0x[0-9a-fA-F]\{40\}\)$/\1/p' | tail -1)"
if [ -z "$NEXT" ] || [ "$(cast code "$NEXT" --rpc-url "$RPC")" = "0x" ]; then
  echo "FAIL: could not find the new renderer's address with code on chain in forge's output." >&2
  exit 1
fi

echo
( cd ../warden && node tools/safe-tx.mjs set-renderer "$NEXT" --contract "$TOKEN" --safe "$SAFE" --rpc "$RPC" )
