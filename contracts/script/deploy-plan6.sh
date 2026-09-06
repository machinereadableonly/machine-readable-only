#!/usr/bin/env bash
#
# Deploy the current tree's pair to Base Sepolia and write the ten Marks.
#
#   bash script/deploy-plan6.sh            # simulate only
#   bash script/deploy-plan6.sh --broadcast # actually send
#
# DeployPlan5.s.sol is the right script for this build too: it deploys Renderer
# and MachineReadableOnly and writes the ladder, none of which Plan 6 or C4.10
# changed the shape of. The name is kept so the script that has been run before
# is the script that runs again.
#
# EXPECTED_CHAIN_ID and WARDEN_ADDRESS are supplied HERE rather than added to the
# environment file: the chain guard exists so the operator states the chain for
# each run, and a value that lives in a file is stated once and then forgotten.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# THE CHAIN, STATED. 84532 is Base Sepolia. Base mainnet is 8453 and is not
# something this script may be pointed at by editing one number: the mainnet
# path needs MAINNET_DEPLOYER_KEY and the operator's explicit approval, every time.
export EXPECTED_CHAIN_ID=84532
# The Clock's signer, unchanged since Plan 3. Proven separate from the owner on
# chain in both directions.
export WARDEN_ADDRESS=0xb919443Ecb8B73a6179a523734f2184d26fF4D7A
RPC=https://sepolia.base.org

echo "chain    $(cast chain-id --rpc-url "$RPC")  (expected $EXPECTED_CHAIN_ID)"
echo "warden   $WARDEN_ADDRESS"
echo "mode     ${1:-simulate}"
echo

forge script script/DeployPlan5.s.sol:DeployPlan5 \
  --rpc-url "$RPC" \
  ${1:+--broadcast} \
  -vvv
