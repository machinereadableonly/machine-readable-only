#!/usr/bin/env bash
#
# Deploy the current tree's pair to Base Sepolia and write the ten Marks.
#
#   bash script/deploy-plan7.sh             # simulate only
#   bash script/deploy-plan7.sh --broadcast # actually send
#
# WHAT PLAN 7 CHANGED, AND WHY THIS DEPLOY IS STILL THE SAME THREE STEPS.
# Lineage added `echo` to TokenView, `echoOf(uint256)` to read it alone, and the
# write inside `seed`. It added no constructor argument, no owner dial and no
# new post-deploy step, so the deployment itself is what it was for Plan 5 and
# Plan 6: Renderer, then MachineReadableOnly(renderer, warden), then the ten
# Mark records.
#
# SO THIS RUNS DeployPlan5.s.sol, exactly as deploy-plan6.sh does, and for the
# same reason: the script that has been run before is the script that runs
# again. A copy under a new name would be a second thing to keep in step and
# would have never been executed -- which is precisely how DeployPlan5.s.sol
# came to fail on its first real run, after the simulation passed.
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

# THE ABI PIN, RUN BEFORE THE DEPLOY RATHER THAN AFTER IT.
#
# warden/test/abi.test.mjs compares warden/src/clock/abi.mjs against
# contracts/out, and SKIPS when contracts/out is absent -- which it is on any
# clean checkout, because it is gitignored. A guard that skips is not a guard,
# and the Warden's decoder now depends on that file being fresh: chain/read.mjs
# decodes `viewOf` by name through it, and chain/preflight.mjs refuses to boot
# when the decode fails. So the build happens here, and the pin is then run
# against a directory that is guaranteed to exist.
#
# It runs BEFORE the deploy because the ABI has to describe the contract that is
# about to be deployed. Finding the drift afterwards means finding it with a
# permanent address already on chain.
echo "building, so the ABI pin has something to compare against"
forge build

ARTIFACT=out/MachineReadableOnly.sol/MachineReadableOnly.json
if [ ! -f "$ARTIFACT" ]; then
  echo "FAIL: $ARTIFACT is missing after forge build -- the ABI pin would skip, not pass" >&2
  exit 1
fi

# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
echo "pinning warden/src/clock/abi.mjs against the freshly compiled artifact"
( cd ../warden && node --test test/abi.test.mjs )

echo
echo "chain    $(cast chain-id --rpc-url "$RPC")  (expected $EXPECTED_CHAIN_ID)"
echo "warden   $WARDEN_ADDRESS"
echo "mode     ${1:-simulate}"
echo

forge script script/DeployPlan5.s.sol:DeployPlan5 \
  --rpc-url "$RPC" \
  ${1:+--broadcast} \
  -vvv

echo
echo "Next, in order:"
echo "  1. bash script/verify-plan7.sh <renderer> <token> $WARDEN_ADDRESS"
echo "  2. cd warden && node tools/check-deployed-abi.mjs <token>"
echo "  3. cd warden && node tools/read-ladder.mjs <token>"
echo "  4. bash contracts/script/adopt-deployment.sh <renderer> <token> <deploy-block>"
