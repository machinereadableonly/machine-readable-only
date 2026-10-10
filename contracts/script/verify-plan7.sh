#!/usr/bin/env bash
#
# Verify the deployed pair on Basescan and Blockscout. Addresses and chain are
# arguments so this is not a script that silently verifies whatever it was last
# pointed at.
#
#   bash script/verify-plan7.sh <renderer> <token> <warden-address> <chain-id>
#
# chain-id is 84532 (Base Sepolia) or 8453 (Base mainnet). ENV_FILE names the
# environment file holding BASESCAN_API_KEY; it defaults to ./.env.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

REN="${1:?renderer address}"
TOK="${2:?token address}"
WARDEN="${3:?warden address}"
CHAIN="${4:?chain id: 84532 (Base Sepolia) or 8453 (Base mainnet)}"
case "$CHAIN" in
  84532) BLOCKSCOUT="https://base-sepolia.blockscout.com/api/" ;;
  8453) BLOCKSCOUT="https://base.blockscout.com/api/" ;;
  *) echo "chain $CHAIN is neither Base Sepolia (84532) nor Base mainnet (8453)" >&2; exit 2 ;;
esac

# Only the two keys this needs are read; the rest of the file never enters this
# process or the verifier's.
read_var() { /bin/grep "^$1=" "${ENV_FILE:-./.env}" | head -1 | cut -d= -f2- | tr -d '"'"'" || true; }
KEY="$(read_var BASESCAN_API_KEY)"
[ -n "$KEY" ] || KEY="$(read_var ETHERSCAN_API_KEY)"
if [ -z "$KEY" ]; then
  echo "No BASESCAN_API_KEY or ETHERSCAN_API_KEY in the environment file."
  echo "Verification needs one; the deployment itself is unaffected."
  exit 2
fi

ARGS="$(cast abi-encode 'constructor(address,address)' "$REN" "$WARDEN")"
FAILED=()

# Each explorer is tried even when an earlier one fails, and every failure is
# named at the end. Blockscout takes no key, but forge insists on one.
verify() {
  local explorer="$1"; shift
  echo
  echo "verifying Renderer $REN on $explorer"
  forge verify-contract "$REN" src/render/Renderer.sol:Renderer --chain "$CHAIN" --watch "$@" \
    || FAILED+=("Renderer on $explorer")
  echo
  echo "verifying MachineReadableOnly $TOK on $explorer"
  forge verify-contract "$TOK" src/MachineReadableOnly.sol:MachineReadableOnly --chain "$CHAIN" --watch \
    --constructor-args "$ARGS" "$@" \
    || FAILED+=("MachineReadableOnly on $explorer")
}

verify Basescan --verifier etherscan --etherscan-api-key "$KEY"
verify Blockscout --verifier blockscout --verifier-url "$BLOCKSCOUT" --etherscan-api-key placeholder

echo
echo "Explorer verification proves the SOURCE. It does not prove the ABI this"
echo "repository carries matches the runtime bytecode -- run"
echo "  cd warden && node tools/check-deployed-abi.mjs $TOK"
echo "for that. Every Mark was once unwritable against a verified contract."

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo >&2
  printf 'FAILED: %s\n' "${FAILED[@]}" >&2
  exit 1
fi
