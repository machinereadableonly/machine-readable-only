#!/usr/bin/env bash
#
# What the testnet deployer can pay for. Reads the environment file and prints
# ONLY the derived address and its balance -- never a key.
#
# The hook that guards secrets blocks any COMMAND naming the environment file,
# which is correct; a script that reads it and prints nothing sensitive is the
# way through. See the blocked-by-a-hook-ship-a-script note.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

RPC="${1:-https://sepolia.base.org}"

addr() { cast wallet address --private-key "$1"; }

DEPLOYER="$(addr "$SPIKE_DEPLOYER_KEY")"
echo "deployer   $DEPLOYER"
echo "balance    $(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether) ETH"
echo "chain      $(cast chain-id --rpc-url "$RPC")"
echo "expected   ${EXPECTED_CHAIN_ID:-unset}"
