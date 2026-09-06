#!/usr/bin/env bash
#
# Verify the deployed pair on Basescan. Addresses are arguments so this is not
# a script that silently verifies whatever it was last pointed at.
#
#   bash script/verify-plan6.sh <renderer> <token> <warden-address>
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

REN="${1:?renderer address}"
TOK="${2:?token address}"
WARDEN="${3:?warden address}"
CHAIN=84532

KEY="${BASESCAN_API_KEY:-${ETHERSCAN_API_KEY:-}}"
if [ -z "$KEY" ]; then
  echo "No BASESCAN_API_KEY or ETHERSCAN_API_KEY in the environment file."
  echo "Verification needs one; the deployment itself is unaffected."
  exit 2
fi

echo "verifying Renderer $REN"
forge verify-contract "$REN" src/render/Renderer.sol:Renderer \
  --chain "$CHAIN" --etherscan-api-key "$KEY" --watch || true

echo
echo "verifying MachineReadableOnly $TOK"
forge verify-contract "$TOK" src/MachineReadableOnly.sol:MachineReadableOnly \
  --chain "$CHAIN" --etherscan-api-key "$KEY" --watch \
  --constructor-args "$(cast abi-encode 'constructor(address,address)' "$REN" "$WARDEN")" || true
