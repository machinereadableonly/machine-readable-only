#!/usr/bin/env bash
# The end-to-end check: deploy to a local chain, then read every token's
# tokenURI back over RPC, decode the SVG out of it and put ZXing on the image.
#
# A forge test cannot do this. It never crosses the RPC boundary, so it cannot
# show that a node returns the call at all, and it cannot rasterise the SVG.
# "The image renders" and "a decoder reads the image a chain returned" are
# different claims, and only the second one matters.
#
#   bash script/anvil-verify.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."

DOMAIN=${DOMAIN:-example.com}
RPC=http://127.0.0.1:8545

# Anvil's account 0, published in Foundry's own documentation. It funds nothing
# but a throwaway local chain that this script kills on the way out.
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

anvil --silent --code-size-limit 24576 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
sleep 2

forge build >/dev/null

# --json puts the run summary on stdout; the deployed addresses are in the
# returns block, keyed by the names run() declares.
# The script reads SPIKE_DEPLOYER_KEY itself, so both the local and the public
# path use one mechanism. A real environment variable takes precedence over the
# env file, which is what lets this override the Sepolia key with anvil's.
OUT=$(SPIKE_DEPLOYER_KEY="$KEY" forge script script/DeploySpike.s.sol:DeploySpike \
        --rpc-url "$RPC" --broadcast --json 2>/dev/null \
      | sed -n '/^{/p' | jq -s '[.[] | select(.returns)] | last')

TOKEN=$(echo "$OUT" | jq -er '.returns.token.value')
RENDERER=$(echo "$OUT" | jq -er '.returns.renderer.value')
echo "renderer $RENDERER"
echo "token    $TOKEN"
echo

# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh"
mkdir -p ../tools/out

FAILED=0
for id in 1 2 3 4; do
  (cd ../tools && node verify-tokenuri.mjs "$TOKEN" "$id" "$RPC" "$DOMAIN") || FAILED=1
  echo
done

[ "$FAILED" -eq 0 ] || { echo "FAIL: at least one token did not verify"; exit 1; }
echo "OK: four tokens read back over RPC, decoded and scanned"
