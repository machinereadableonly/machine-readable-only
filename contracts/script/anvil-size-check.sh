#!/usr/bin/env bash
# The project's deployability rule, second half: a strict-limit deploy proving
# the contracts actually land on chain with non-empty code, then one real
# tokenURI read back over RPC.
#
# Foundry's test EVM does not enforce EIP-170, so ContractSize.t.sol passing is
# necessary and not sufficient. This is the part that would catch a contract
# that measures small enough but still gets rejected by a node.
#
#   bash script/anvil-size-check.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."

# Anvil's account 0. Published in Foundry's own documentation; it funds nothing
# but a throwaway local chain that this script kills on the way out. Doubles
# as the Warden below, so the same key that deploys can also check in.
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

anvil --silent --code-size-limit 24576 &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT
sleep 2

# Build first, so the deploys below print nothing but their JSON.
forge build >/dev/null

# Two things this pipeline has to survive, both learned the hard way:
#
#  - forge prints "No files changed, compilation skipped" on STDOUT, ahead of
#    the JSON, so the sed trims everything before the opening brace. jq on the
#    unfiltered stream fails with "Invalid numeric literal".
#  - --constructor-args is variadic and greedy: it swallows every flag that
#    follows it, so the deploy fails with "expected 1 but got 7". It has to
#    come last on the line.
addr() { sed -n '/^{/,$p' | jq -er '.deployedTo'; }

WARDEN=$(cast wallet address --private-key "$KEY")

R=$(forge create src/render/Renderer.sol:Renderer \
      --rpc-url local --private-key "$KEY" --broadcast --json | addr)
# MachineReadableOnly is the real, permanent collection contract -- the spike
# (src/spike/MROSpikeToken.sol) was the Phase 0 rendering throwaway and is
# superseded by this pair as of Task 8. The Warden here is account 0 itself,
# so the one key that deployed the contract can also drive the check-in below.
T=$(forge create src/MachineReadableOnly.sol:MachineReadableOnly \
      --rpc-url local --private-key "$KEY" --broadcast --json \
      --constructor-args "$R" "$WARDEN" | addr)

for pair in "Renderer:$R" "MachineReadableOnly:$T"; do
  name=${pair%%:*}
  addr=${pair#*:}
  # cast code returns "0x" plus a trailing newline for an empty account, and
  # two hex characters per byte otherwise.
  bytes=$(( ( $(cast code "$addr" --rpc-url local | wc -c) - 3 ) / 2 ))
  echo "$name at $addr: $bytes runtime bytes"
  [ "$bytes" -gt 0 ] || { echo "FAIL: $name deployed with empty code"; exit 1; }
done

# And prove the pair works end to end, not merely that it deployed. The bitmap
# comes from the same generator the tests use; its CLI takes <tokenId> [domain]
# and prints the 344 hex characters alone on stdout.
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh"
CODE=0x$(cd ../tools && node token-bitmap.mjs 1 example.com 2>/dev/null)

cast send "$T" "mint(uint256,address,bytes32,bytes)" \
  1 \
  0x0000000000000000000000000000000000000A11 \
  0x0000000000000000000000000000000000000000000000000000000000000a9e \
  "$CODE" \
  --rpc-url local --private-key "$KEY" >/dev/null

CHARS=$(cast call "$T" "tokenURI(uint256)(string)" 1 --rpc-url local | wc -c)
echo "tokenURI: $CHARS chars returned"
[ "$CHARS" -gt 5000 ] || { echo "FAIL: tokenURI came back short"; exit 1; }
echo "OK"
