#!/usr/bin/env bash
#
# Verify the deployed pair on Basescan. Addresses are arguments so this is not
# a script that silently verifies whatever it was last pointed at.
#
#   bash script/verify-plan7.sh <renderer> <token> <warden-address>
#
# Identical in shape to verify-plan6.sh: Plan 7 changed neither contract's
# constructor, so the encoded arguments are the same two addresses.
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
# THE CHAIN, STATED, in the script that talks to the explorer as well as in the
# one that deploys. 84532 is Base Sepolia.
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

echo
echo "Basescan verification proves the SOURCE. It does not prove the ABI this"
echo "repository carries matches the runtime bytecode -- run"
echo "  cd warden && node tools/check-deployed-abi.mjs $TOK"
echo "for that. Every Mark was once unwritable against a verified contract."
