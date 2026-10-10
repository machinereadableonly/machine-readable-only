#!/usr/bin/env bash
#
# Deploy the pair to BASE MAINNET (chain 8453), write the Marks and set the split
# anchor, read from the split seed MRO_SPLIT_SEED_FILE (required; never a Sepolia seed).
# This is the deploy that CANNOT BE UNDONE (Hard Rule 1) and that spends real
# funds (Hard Rule 2): the operator approves every broadcast, every time.
#
#   bash script/deploy-mainnet.sh --warden <address> --owner <safe>               # simulate
#   bash script/deploy-mainnet.sh --warden <address> --owner <safe> --broadcast   # SEND. Operator approval.
#
# REHEARSAL ONLY, against a local anvil fork of Base mainnet:
#
#   bash script/deploy-mainnet.sh --warden <address> --owner <safe> --fork http://127.0.0.1:<port> --broadcast
#
# WHY THIS FILE EXISTS. Until 2026-09-15 the only deploy wrapper was
# deploy-plan7.sh, which hard-codes Base Sepolia -- chain, RPC and the Sepolia
# Clock's address. DeployPlan5.s.sol under it has always handled mainnet
# (MroScript's guardChain, and a MAINNET_DEPLOYER_KEY that refuses the
# throwaway key), but nothing called it for mainnet, so the cutover's most
# important step had no script at all. It runs the SAME Solidity script, for
# the reason deploy-plan7.sh gives: the script that has been run before is the
# script that runs again.
#
# --warden IS REQUIRED AND HAS NO DEFAULT. It is the mainnet Clock's signer,
# written into the constructor. Only setWarden can correct a wrong value
# afterwards, and the mainnet Clock is a new key chosen at cutover, not the
# Sepolia one.
#
# --owner IS REQUIRED: the 2-of-3 Safe. MAINNET_DEPLOYER_KEY signs the deploy
# and offers ownership to the Safe as the broadcast's last call; it stays owner
# only until the Safe calls acceptOwnership (warden/tools/safe-tx.mjs).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

# A resumed broadcast would re-send setUpgrade and setSplitAnchor to a configured contract.
case " $* " in *" --resume "*) echo "FAIL: never resume a deploy; a fresh run deploys a fresh pair" >&2; exit 1;; esac

WARDEN=""
OWNER=""
FORK=""
BROADCAST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --warden) WARDEN="${2:?--warden needs an address}"; shift 2 ;;
    --owner) OWNER="${2:?--owner needs the Safe address}"; shift 2 ;;
    --fork) FORK="${2:?--fork needs a URL}"; shift 2 ;;
    # THE LITERAL WORD, as in deploy-plan7.sh: a typo must never broadcast.
    --broadcast) BROADCAST="--broadcast"; shift ;;
    *) echo "FAIL: unrecognised argument '$1'." >&2; exit 1 ;;
  esac
done

if [ -z "$WARDEN" ]; then
  echo "FAIL: --warden <address> is required -- the mainnet Clock's signer, written into the constructor." >&2
  exit 1
fi
# EIP-55 OR NOTHING, the rule adopt-deployment.sh and the Warden's treasury
# check both apply: a mistyped digit would otherwise be a well-formed address.
if [ "$WARDEN" != "$(cast to-check-sum-address "$WARDEN")" ]; then
  echo "FAIL: --warden $WARDEN is not in EIP-55 checksummed form ($(cast to-check-sum-address "$WARDEN"))." >&2
  exit 1
fi

if [ -z "$OWNER" ]; then
  echo "FAIL: --owner <safe> is required -- the 2-of-3 Safe that will own the piece." >&2
  exit 1
fi
if [ "$OWNER" != "$(cast to-check-sum-address "$OWNER")" ]; then
  echo "FAIL: --owner $OWNER is not in EIP-55 checksummed form ($(cast to-check-sum-address "$OWNER"))." >&2
  exit 1
fi

if [ -n "$FORK" ]; then
  # A FORK IS LOOPBACK OR IT IS NOT A FORK. Anything else could be a real
  # endpoint, and the test key below must never sign for one.
  case "$FORK" in
    http://127.0.0.1:[0-9]*|http://localhost:[0-9]*) ;;
    *) echo "FAIL: --fork must be a loopback URL (http://127.0.0.1:<port>), got '$FORK'." >&2; exit 1 ;;
  esac
  # NOT INSIDE THE REPOSITORY. forge writes a broadcast log to
  # broadcast/DeployPlan5.s.sol/8453/ -- ignored by git, but a file that reads
  # exactly like a real mainnet deploy record. A rehearsal must run from an
  # exported copy (warden/tools/mainnet-fork-rehearsal.sh does).
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "FAIL: --fork refuses to run inside a git working tree: its broadcast log would sit in" >&2
    echo "      broadcast/.../8453/ looking like a real mainnet deploy. Run it from an exported copy." >&2
    exit 1
  fi
  RPC="$FORK"
  # anvil's own well-known account 0, derived from anvil's public test
  # mnemonic -- it holds fork money only. The environment file is NOT read, so
  # the real mainnet key cannot reach a rehearsal.
  MAINNET_DEPLOYER_KEY="$(cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index 0)"
  export MAINNET_DEPLOYER_KEY
  unset SPIKE_DEPLOYER_KEY
  MODE="REHEARSAL on a local fork"
else
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  if [ -z "${MAINNET_DEPLOYER_KEY:-}" ]; then
    echo "FAIL: MAINNET_DEPLOYER_KEY is not set in contracts/.env (the operator adds it via WinSCP)." >&2
    exit 1
  fi
  RPC="https://mainnet.base.org"
  MODE="BASE MAINNET -- permanent"
fi

# THE CHAIN, STATED, and checked against the endpoint before anything is built.
# MroScript.guardChain checks it again inside the script.
export EXPECTED_CHAIN_ID=8453
export WARDEN_ADDRESS="$WARDEN"
ACTUAL="$(cast chain-id --rpc-url "$RPC")"
if [ "$ACTUAL" != "8453" ]; then
  echo "FAIL: $RPC reports chain $ACTUAL, not Base mainnet (8453)." >&2
  exit 1
fi
# DeployPlan5 refuses an owner with no code too; this says so before a build.
if [ "$(cast code "$OWNER" --rpc-url "$RPC")" = "0x" ]; then
  echo "FAIL: --owner $OWNER has no code on chain $ACTUAL. Create the Safe first (DEPLOY.md section 10)." >&2
  exit 1
fi
# Any contract has code; only the Safe can ever accept. safe-tx.mjs makes the same checks.
SAFE_VERSION="$(cast call "$OWNER" "VERSION()(string)" --rpc-url "$RPC" 2>/dev/null || true)"
case "$SAFE_VERSION" in
  '"1.4.1"' | '"1.5.0"') ;;
  *) echo "FAIL: --owner $OWNER does not answer VERSION() as a Safe 1.4.1 or 1.5.0 (got '${SAFE_VERSION:-nothing}')." >&2; exit 1 ;;
esac
SAFE_THRESHOLD="$(cast call "$OWNER" "getThreshold()(uint256)" --rpc-url "$RPC")"
if [ "$SAFE_THRESHOLD" -lt 2 ]; then
  echo "FAIL: the Safe $OWNER has threshold $SAFE_THRESHOLD: one signer could act alone." >&2
  exit 1
fi
SAFE_OWNERS="$(cast call "$OWNER" "getOwners()(address[])" --rpc-url "$RPC")"
if printf '%s' "$SAFE_OWNERS" | tr 'A-F' 'a-f' | /bin/grep -qi "$(printf '%s' "$WARDEN" | tr 'A-F' 'a-f')"; then
  echo "FAIL: the Clock key $WARDEN is one of the Safe's signers." >&2
  exit 1
fi

# DEPLOYABLE, NOT MERELY COMPILING (Hard Rule 7). `--sizes` PRINTS the runtime
# sizes -- forge's own help says only that, so it is not relied on as a gate.
# The gate is the repository's own size test, which fails on any contract over
# the EIP-170 limit that plain `forge test` runs with disabled.
echo "building with --sizes, for the record"
forge build --sizes
echo "gating on test/ContractSize.t.sol (fails on any contract over 24,576 bytes)"
forge test --match-path test/ContractSize.t.sol

ARTIFACT=out/MachineReadableOnly.sol/MachineReadableOnly.json
if [ ! -f "$ARTIFACT" ]; then
  echo "FAIL: $ARTIFACT is missing after forge build -- the ABI pin would skip, not pass" >&2
  exit 1
fi

# The ABI pin, BEFORE the deploy, for deploy-plan7.sh's reason: drift found
# afterwards is drift found with a permanent address already on chain.
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
echo "pinning warden/src/clock/abi.mjs against the freshly compiled artifact"
( cd ../warden && node --test test/abi.test.mjs )

# The anchor comes from the split seed and is set, once and for ever, inside the deploy's
# broadcast. A seed whose keys Sepolia has already revealed would make every early mainnet
# day's answer rule public, so the seed is named explicitly and checked against every
# Sepolia anchor this box knows (DEPLOY.md section 10).
SEED_FILE="${MRO_SPLIT_SEED_FILE:-}"
if [ -z "$SEED_FILE" ]; then
  echo "FAIL: set MRO_SPLIT_SEED_FILE to this deployment's own seed (never the Sepolia one)." >&2
  echo "      Make one with: node ../warden/tools/split-seed.mjs new <path outside ~/.mro-split>" >&2
  exit 1
fi
if [ ! -f "$SEED_FILE" ]; then
  echo "FAIL: no split seed at $SEED_FILE. Make one: node ../warden/tools/split-seed.mjs new $SEED_FILE" >&2
  exit 1
fi
anchor_of() { node ../warden/tools/split-seed.mjs anchor "$1" | sed -n 's/^anchor //p'; }
SPLIT_ANCHOR=$(anchor_of "$SEED_FILE")
if [ -z "$SPLIT_ANCHOR" ]; then
  echo "FAIL: could not read an anchor from $SEED_FILE" >&2
  exit 1
fi
SEPOLIA_DIR="$(realpath -m "$HOME/.mro-split")"
case "$(realpath -m "$SEED_FILE")" in
  "$SEPOLIA_DIR"/*) echo "FAIL: $SEED_FILE is in the Sepolia seed's directory; keep this deployment's seed elsewhere." >&2; exit 1 ;;
esac
for other in "$HOME"/.mro-split/seed*; do
  [ -f "$other" ] || continue
  if [ "$(anchor_of "$other")" = "$SPLIT_ANCHOR" ]; then
    echo "FAIL: $SEED_FILE has the same anchor as $other, a Sepolia seed." >&2
    exit 1
  fi
done
# The live Sepolia pair, named once in CLAUDE.md (adopt-deployment.sh keeps it there).
SEPOLIA_TOKEN="${MRO_SEPOLIA_CONTRACT:-$(sed -n 's/^ *MachineReadableOnly  *\(0x[0-9a-fA-F]\{40\}\).*/\1/p' ../CLAUDE.md | head -1)}"
SEPOLIA_ANCHOR="$(cast call "$SEPOLIA_TOKEN" 'splitAnchor()(bytes32)' --rpc-url https://sepolia.base.org 2>/dev/null || true)"
if [ -z "$SEPOLIA_ANCHOR" ]; then
  if [ -z "$FORK" ]; then
    echo "FAIL: could not read the Sepolia pair's anchor (${SEPOLIA_TOKEN:-no address}); set MRO_SEPOLIA_CONTRACT and retry." >&2
    exit 1
  fi
  echo "note: the Sepolia anchor could not be read; a fork rehearsal goes on without that check" >&2
elif [ "$(echo "$SEPOLIA_ANCHOR" | tr 'A-F' 'a-f')" = "$(echo "$SPLIT_ANCHOR" | tr 'A-F' 'a-f')" ]; then
  echo "FAIL: $SEED_FILE is the live Sepolia pair's seed ($SEPOLIA_TOKEN)." >&2
  exit 1
fi
export SPLIT_ANCHOR

echo
echo "mode     $MODE"
echo "chain    $ACTUAL  (expected $EXPECTED_CHAIN_ID)"
echo "warden   $WARDEN_ADDRESS"
echo "owner    $OWNER  (Safe $SAFE_VERSION, $SAFE_THRESHOLD of $(printf '%s' "$SAFE_OWNERS" | /bin/grep -o '0x[0-9a-fA-F]\{40\}' | wc -l); pending until it accepts)"
echo "anchor   $SPLIT_ANCHOR"
echo "send     ${BROADCAST:-no -- simulate only}"
echo

forge script script/DeployPlan5.s.sol:DeployPlan5 \
  --sig "run(address)" "$OWNER" \
  --rpc-url "$RPC" \
  $BROADCAST \
  -vvv

echo
echo "Next, in order:"
echo "  1. bash script/verify-plan7.sh <renderer> <token> $WARDEN 8453"
echo "  2. cd ../warden && node tools/check-deployed-abi.mjs <token> $RPC"
echo "  3. cd ../warden && node tools/read-ladder.mjs <token> $RPC"
echo "  4. bash contracts/script/adopt-deployment.sh --chain 8453 <renderer> <token> <deploy-block>"
echo "  5. the Safe accepts ownership (DEPLOY.md section 10):"
echo "     cd ../warden && node tools/safe-tx.mjs accept-ownership --contract <token> --safe $OWNER --rpc $RPC"
echo "  6. warden/DEPLOY.md section 10, in order."
