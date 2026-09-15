#!/usr/bin/env bash
#
# Deploy the pair to BASE MAINNET (chain 8453) and write the ten Marks.
# This is the deploy that CANNOT BE UNDONE (Hard Rule 1) and that spends real
# funds (Hard Rule 2): the operator approves every broadcast, every time.
#
#   bash script/deploy-mainnet.sh --warden <address>               # simulate against mainnet
#   bash script/deploy-mainnet.sh --warden <address> --broadcast   # SEND. Operator approval.
#
# REHEARSAL ONLY, against a local anvil fork of Base mainnet:
#
#   bash script/deploy-mainnet.sh --warden <address> --fork http://127.0.0.1:<port> --broadcast
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
# THE OWNER. The key that signs becomes the piece's PERMANENT owner (see
# MroScript.deployerKey). It is MAINNET_DEPLOYER_KEY from the environment file,
# never the throwaway spike key; prefer transferring ownership to a hardware
# wallet or Safe straight after (Ownable2Step makes that two steps).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

WARDEN=""
FORK=""
BROADCAST=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --warden) WARDEN="${2:?--warden needs an address}"; shift 2 ;;
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

echo
echo "mode     $MODE"
echo "chain    $ACTUAL  (expected $EXPECTED_CHAIN_ID)"
echo "warden   $WARDEN_ADDRESS"
echo "send     ${BROADCAST:-no -- simulate only}"
echo

forge script script/DeployPlan5.s.sol:DeployPlan5 \
  --rpc-url "$RPC" \
  $BROADCAST \
  -vvv

echo
echo "Next, in order:"
echo "  1. cd ../warden && node tools/check-deployed-abi.mjs <token> $RPC"
echo "  2. cd ../warden && node tools/read-ladder.mjs <token> $RPC"
echo "  3. bash contracts/script/adopt-deployment.sh --chain 8453 <renderer> <token> <deploy-block>"
echo "  4. warden/DEPLOY.md section 10, in order."
