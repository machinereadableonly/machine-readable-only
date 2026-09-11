#!/usr/bin/env bash
# Measure the Clock's check-in chunk against a real node, and prove the chosen
# CHECKIN_CHUNK lands in ONE transaction through the Clock's own writer.
#
#   cd warden && ~/scripts/safe-build.sh bash tools/chunk-rehearsal.sh
#
# LOCAL ONLY. It starts its own anvil on 127.0.0.1:8599, deploys a fresh pair
# there, and kills it on the way out; chunk-rehearsal.mjs refuses any node that
# is not anvil. Nothing here touches Base. Run it through safe-build.sh: it
# mints 2,000 tokens and takes a few minutes.
#
# Re-run it whenever batchCheckIn, _credit or the Token struct changes. The
# chunk size is only as true as the contract it was measured against.
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh" >/dev/null

PORT=8599
RPC="http://127.0.0.1:$PORT"

# Anvil's account 0. Published in Foundry's own documentation; it funds nothing
# but the throwaway chain this script kills on exit. It is also the Warden here,
# so the key that deploys can check in.
KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# THE CHAIN, STATED: a local anvil wearing Base Sepolia's id, because write.mjs
# refuses any chain id it does not know. Osaka rules with EIP-7825 ENFORCED,
# which is what Base has run since Azul (Sepolia 2026-04-20, mainnet
# 2026-05-28) -- without --enable-tx-gas-limit anvil would accept a transaction
# Base rejects.
#
# --prune-history IS NOT OPTIONAL. Without it anvil writes old chain states to
# ~/.foundry/anvil/tmp/anvil-state-* once it holds enough blocks, and a run
# that is stopped or killed never deletes them. On 2026-09-11 five runs of this
# script left 24 GB there and filled the VPS disk to 100%, under every project
# on the box. With it, anvil keeps no history and persists nothing; every read
# here is against the latest block, and evm_snapshot/evm_revert keep their own
# copies.
anvil --silent --port "$PORT" --chain-id 84532 --hardfork osaka \
  --enable-tx-gas-limit --code-size-limit 24576 --prune-history &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null || true' EXIT

# Wait for the node rather than sleeping a fixed time and hoping.
for _ in $(seq 1 50); do
  cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break
  sleep 0.2
done

# forge prints "No files changed" on stdout ahead of the JSON, hence the sed;
# see contracts/script/anvil-size-check.sh for both traps this line survives.
addr() { sed -n '/^{/,$p' | jq -er '.deployedTo'; }

(cd ../contracts && forge build >/dev/null)
WARDEN=$(cast wallet address --private-key "$KEY")
R=$(cd ../contracts && forge create src/render/Renderer.sol:Renderer \
      --rpc-url "$RPC" --private-key "$KEY" --broadcast --json | addr)
T=$(cd ../contracts && forge create src/MachineReadableOnly.sol:MachineReadableOnly \
      --rpc-url "$RPC" --private-key "$KEY" --broadcast --json \
      --constructor-args "$R" "$WARDEN" | addr)

RPC_URL="$RPC" CONTRACT="$T" ANVIL_KEY="$KEY" node tools/chunk-rehearsal.mjs
