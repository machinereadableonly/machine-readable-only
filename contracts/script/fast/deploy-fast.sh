#!/usr/bin/env bash
#
# Deploy the TEST-ONLY fast-days pair to Base Sepolia and write the ten Marks.
# See docs/plans/2026-09-11-mro-fast-days.md.
#
#   bash script/fast/deploy-fast.sh              # simulate only
#   bash script/fast/deploy-fast.sh --broadcast  # actually send
#
# The pair's Warden is the fast Clock's own key (~/.mro-fast/clock.address),
# never the live Clock's: the fast copy must not be able to touch the real one,
# and the real one must not be able to write here.
#
# THE CHAIN, STATED: Base Sepolia (84532), and DeployFast.s.sol refuses every
# other chain whatever is stated here. This contract must never exist on
# mainnet.
set -euo pipefail

BROADCAST=""
if [ "${1:-}" = "--broadcast" ]; then
  BROADCAST="--broadcast"
elif [ -n "${1:-}" ]; then
  echo "FAIL: unrecognised argument '$1'. Pass --broadcast to send, or nothing to simulate." >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

export EXPECTED_CHAIN_ID=84532
WARDEN_ADDRESS="$(cat "$HOME/.mro-fast/clock.address")"
export WARDEN_ADDRESS
echo "chain   84532 (Base Sepolia)"
echo "warden  $WARDEN_ADDRESS (the fast Clock)"

# shellcheck disable=SC2086
forge script script/fast/DeployFast.s.sol:DeployFast --rpc-url https://sepolia.base.org $BROADCAST
