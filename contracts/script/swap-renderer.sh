#!/usr/bin/env bash
# Deploy a new Renderer on BASE SEPOLIA and point the live token contract at it.
#
#   bash contracts/script/swap-renderer.sh <token>              # simulate only
#   bash contracts/script/swap-renderer.sh <token> --broadcast  # send
#
# The chain is STATED here and checked on chain by MroScript.guardChain, the
# same two-statement rule every deploy script in this project follows. This
# script is Sepolia-only by construction; a mainnet swap is an operator
# approval gate and gets its own deliberate run.
#
# After a broadcast, in order:
#   1. verify the new renderer on Basescan (printed below)
#   2. bash contracts/script/adopt-deployment.sh <new-renderer> <token> <token's deploy block>
#      -- the token did not move, so its deploy block does not either.
set -euo pipefail

TOKEN="${1:?token address}"
BROADCAST=""
if [ "${2:-}" = "--broadcast" ]; then
  BROADCAST="--broadcast"
elif [ -n "${2:-}" ]; then
  echo "FAIL: unrecognised argument '$2'. Pass --broadcast to send, or nothing to simulate." >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"
set -a
. ./.env
set +a
export EXPECTED_CHAIN_ID=84532
RPC=https://sepolia.base.org

echo "chain    $(cast chain-id --rpc-url "$RPC")  (expected $EXPECTED_CHAIN_ID)"
echo "token    $TOKEN"
echo "mode     ${BROADCAST:-simulate}"
echo

forge script script/SwapRenderer.s.sol:SwapRenderer \
  --sig "run(address)" "$TOKEN" \
  --rpc-url "$RPC" \
  $BROADCAST \
  -vvv

if [ -n "$BROADCAST" ]; then
  echo
  echo "Verify the new renderer (no constructor arguments):"
  echo "  forge verify-contract <new-renderer> src/render/Renderer.sol:Renderer --chain 84532 --watch"
fi
