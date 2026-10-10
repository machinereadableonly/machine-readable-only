#!/usr/bin/env bash
#
# Deploy the pair to BASE MAINNET (chain 8453), write the Marks and set the split
# anchor, read from the split seed MRO_SPLIT_SEED_FILE (required; never a Sepolia seed).
# This is the deploy that CANNOT BE UNDONE (Hard Rule 1) and that spends real
# funds (Hard Rule 2): the operator approves every broadcast, every time.
#
# The deploying key is a LEDGER on the operator's Windows PC (D2), in two halves,
# so the split seed never leaves the VPS:
#
#   VPS: bash script/deploy-mainnet.sh --prepare --deployer <ledger address> --warden <address> --owner <safe> --signers <a,b,c>
#   PC:  the command --prepare prints: the same flags plus --ledger --anchor <a> --commit <sha>,
#        first without --broadcast (simulate), then with it. SEND = operator approval.
#
# REHEARSAL ONLY, against a local anvil fork of Base mainnet:
#
#   bash script/deploy-mainnet.sh --warden <address> --owner <safe> --fork http://127.0.0.1:<port> --broadcast
#
# It runs DeployPlan5.s.sol, the script every Sepolia deploy ran.
#
# --warden IS REQUIRED AND HAS NO DEFAULT. It is the mainnet Clock's signer,
# written into the constructor. Only setWarden can correct a wrong value
# afterwards, and the mainnet Clock is a new key chosen at cutover, not the
# Sepolia one.
#
# --owner IS REQUIRED: the 2-of-3 Safe. The Ledger's deploying account signs the
# deploy and offers ownership to the Safe as the broadcast's last call; it stays
# owner only until the Safe calls acceptOwnership (warden/tools/safe-tx.mjs).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$HOME/.foundry/bin:$PATH"

# A resumed broadcast would re-send setUpgrade and setSplitAnchor to a configured contract.
case " $* " in *" --resume "*) echo "FAIL: never resume a deploy; a fresh run deploys a fresh pair" >&2; exit 1;; esac

WARDEN=""
OWNER=""
SIGNERS=""
FORK=""
BROADCAST=""
PREPARE=""
LEDGER=""
DEPLOYER=""
ANCHOR=""
COMMIT=""
HD_PATH=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --prepare) PREPARE=1; shift ;;
    --ledger) LEDGER=1; shift ;;
    --deployer) DEPLOYER="${2:?--deployer needs the Ledger address}"; shift 2 ;;
    --anchor) ANCHOR="${2:?--anchor needs the split anchor --prepare printed}"; shift 2 ;;
    --commit) COMMIT="${2:?--commit needs the sha --prepare printed}"; shift 2 ;;
    --hd-path) HD_PATH="${2:?--hd-path needs the deploying account path}"; shift 2 ;;
    --warden) WARDEN="${2:?--warden needs an address}"; shift 2 ;;
    --owner) OWNER="${2:?--owner needs the Safe address}"; shift 2 ;;
    --signers) SIGNERS="${2:?--signers needs the signer addresses, comma-separated}"; shift 2 ;;
    --fork) FORK="${2:?--fork needs a URL}"; shift 2 ;;
    # THE LITERAL WORD, as in deploy-plan7.sh: a typo must never broadcast.
    --broadcast) BROADCAST="--broadcast"; shift ;;
    *) echo "FAIL: unrecognised argument '$1'." >&2; exit 1 ;;
  esac
done

# Real mainnet is --prepare (VPS) then --ledger (PC); only a fork may use a key in a file.
if [ -n "$FORK" ] && { [ -n "$PREPARE" ] || [ -n "$LEDGER" ]; }; then
  echo "FAIL: --fork rehearses with a test key; it takes neither --prepare nor --ledger." >&2; exit 1
fi
if [ -z "$FORK" ] && [ -z "$PREPARE" ] && [ -z "$LEDGER" ]; then
  echo "FAIL: a real mainnet deploy is --prepare on the VPS, then --ledger on the PC (DEPLOY.md section 10)." >&2; exit 1
fi
if [ -n "$PREPARE" ] && [ -n "$LEDGER" ]; then
  echo "FAIL: --prepare and --ledger are the two halves; run one at a time." >&2; exit 1
fi
if [ -n "$PREPARE" ] && [ -n "$BROADCAST" ]; then
  echo "FAIL: --prepare sends nothing; --broadcast belongs to the --ledger half." >&2; exit 1
fi
if [ -n "$PREPARE$LEDGER" ]; then
  if [ -z "$DEPLOYER" ] || [ "$DEPLOYER" != "$(cast to-check-sum-address "$DEPLOYER")" ]; then
    echo "FAIL: --deployer must be the Ledger's address in EIP-55 form (cast wallet address --ledger)." >&2; exit 1
  fi
fi
if [ -n "$LEDGER" ]; then
  [[ "$ANCHOR" =~ ^0x[0-9a-fA-F]{64}$ ]] || { echo "FAIL: --anchor must be the 0x... value --prepare printed." >&2; exit 1; }
  [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "FAIL: --commit must be the 40-character sha --prepare printed." >&2; exit 1; }
  # Its own account, never the Ledger account that signs for the Safe (checked below).
  HD_RE="^m(/[0-9]+'?)+\$"
  [[ "$HD_PATH" =~ $HD_RE ]] || { echo "FAIL: --hd-path must be the deploying account's path, e.g. \"m/44'/60'/1'/0/0\"." >&2; exit 1; }
  [ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "FAIL: this checkout is not at $COMMIT; git fetch && git checkout $COMMIT" >&2; exit 1; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "FAIL: this checkout has uncommitted changes." >&2; exit 1; }
fi

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
if [ -z "$SIGNERS" ]; then
  echo "FAIL: --signers <a,b,c> is required -- the exact signer set the Safe must have, read off the devices." >&2
  exit 1
fi

if [ -n "$FORK" ]; then
  # A FORK IS LOOPBACK OR IT IS NOT A FORK. Anything else could be a real
  # endpoint, and the test key below must never sign for one.
  # Anchored: a prefix glob let `http://127.0.0.1:8545@<remote-host>` through.
  if ! [[ "$FORK" =~ ^http://(127\.0\.0\.1|localhost):[0-9]+/?$ ]]; then
    echo "FAIL: --fork must be a loopback URL (http://127.0.0.1:<port>), got '$FORK'." >&2
    exit 1
  fi
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
  # No key in any file: the Ledger signs, on the PC.
  unset MAINNET_DEPLOYER_KEY SPIKE_DEPLOYER_KEY
  RPC="https://mainnet.base.org"
  if [ -n "$PREPARE" ]; then MODE="PREPARE for BASE MAINNET -- checks only, sends nothing"
  else MODE="BASE MAINNET from the Ledger -- permanent"; export MAINNET_DEPLOYER_ADDRESS="$DEPLOYER"; fi
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
  '"1.5.0"') ;;
  *) echo "FAIL: --owner $OWNER does not answer VERSION() as a Safe 1.5.0 (got '${SAFE_VERSION:-nothing}')." >&2; exit 1 ;;
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
# IDENTITY, NOT SHAPE. Any contract can answer VERSION, getThreshold and getOwners.
addrs() { printf '%s' "$1" | tr 'A-F' 'a-f' | /bin/grep -oE '0x[0-9a-f]{40}' | sort -u | tr '\n' ' '; }
if [ "$(addrs "$SAFE_OWNERS")" != "$(addrs "$SIGNERS")" ]; then
  echo "FAIL: the Safe's signers are $(addrs "$SAFE_OWNERS")-- not the --signers given, $(addrs "$SIGNERS")" >&2
  exit 1
fi
# The canonical Safe 1.5.0 singletons (Safe, SafeL2), from safe-global's safe-deployments.
# The same pair as warden/tools/safe-tx-lib.mjs; test/safe-tx.test.mjs keeps them equal.
SINGLETON="0x$(cast storage "$OWNER" 0 --rpc-url "$RPC" | tail -c 41 | tr 'A-F' 'a-f')"
case "$SINGLETON" in
  0xff51a5898e281db6dfc7855790607438df2ca44b|0xedd160febbd92e350d4d398fb636302fccd67c7e) ;;
  *) echo "FAIL: the Safe's singleton is $SINGLETON, not a canonical Safe 1.5.0." >&2; exit 1 ;;
esac
MODULES="$(cast call "$OWNER" "getModulesPaginated(address,uint256)(address[],address)" 0x0000000000000000000000000000000000000001 10 --rpc-url "$RPC" | head -1)"
[ "$MODULES" = "[]" ] || { echo "FAIL: the Safe has modules enabled ($MODULES), which can act without its signers." >&2; exit 1; }
# keccak256("guard_manager.guard.address"), Safe's GuardManager.
GUARD="$(cast storage "$OWNER" 0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8 --rpc-url "$RPC")"
[ "$(cast to-dec "$GUARD")" = 0 ] || { echo "FAIL: the Safe has a transaction guard set." >&2; exit 1; }
if [ -n "$FORK" ]; then
  # Read from the environment, never from argv, so the key is never on a command line.
  DEPLOYER_ADDRESS="$(cd ../warden && node --input-type=module -e 'import { privateKeyToAccount } from "viem/accounts"; console.log(privateKeyToAccount(process.env.MAINNET_DEPLOYER_KEY).address)')"
else
  DEPLOYER_ADDRESS="$DEPLOYER"
fi
if [ -n "$(addrs "$SAFE_OWNERS" | /bin/grep -i "$(printf '%s' "$DEPLOYER_ADDRESS" | tr 'A-F' 'a-f')" || true)" ]; then
  echo "FAIL: the deploying key $DEPLOYER_ADDRESS is one of the Safe's signers." >&2
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
if [ -z "$LEDGER" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
  echo "pinning warden/src/clock/abi.mjs against the freshly compiled artifact"
  ( cd ../warden && node --test test/abi.test.mjs )
else
  echo "ABI pin: run by --prepare at commit $COMMIT, which this checkout matches"
fi

# The anchor comes from the split seed and is set, once and for ever, inside the deploy's
# broadcast. A seed whose keys Sepolia has already revealed would make every early mainnet
# day's answer rule public, so the seed is named explicitly and checked against every
# Sepolia anchor this box knows (DEPLOY.md section 10).
if [ -n "$LEDGER" ]; then
  SPLIT_ANCHOR="$ANCHOR"
else
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
fi
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
  echo "FAIL: anchor $SPLIT_ANCHOR is the live Sepolia pair's ($SEPOLIA_TOKEN)." >&2
  exit 1
fi
export SPLIT_ANCHOR

echo
echo "mode     $MODE"
echo "chain    $ACTUAL  (expected $EXPECTED_CHAIN_ID)"
echo "warden   $WARDEN_ADDRESS"
echo "owner    $OWNER  (Safe $SAFE_VERSION, $SAFE_THRESHOLD of $(printf '%s' "$SAFE_OWNERS" | /bin/grep -o '0x[0-9a-fA-F]\{40\}' | wc -l); pending until it accepts)"
echo "anchor   $SPLIT_ANCHOR"
echo "deployer $DEPLOYER_ADDRESS"
echo "send     ${BROADCAST:-no -- simulate only}"
echo

if [ -n "$PREPARE" ]; then
  echo "PREPARED. Every check above passed at commit $(git rev-parse HEAD)."
  echo "On the PC, in Git Bash, in contracts/ of a clean checkout at that commit, with the Ledger"
  echo "unlocked and its Ethereum app open -- first to simulate, then again with --broadcast:"
  echo
  echo "  bash script/deploy-mainnet.sh --ledger --hd-path \"m/44'/60'/1'/0/0\" --deployer $DEPLOYER --warden $WARDEN --owner $OWNER --signers $SIGNERS --anchor $SPLIT_ANCHOR --commit $(git rev-parse HEAD)"
  exit 0
fi

# Captured, then judged by its own exit code: never piped into anything.
DEPLOY_LOG="$(mktemp)"
forge script script/DeployPlan5.s.sol:DeployPlan5 \
  --sig "run(address)" "$OWNER" \
  --rpc-url "$RPC" \
  $BROADCAST ${BROADCAST:+--slow} \
  ${LEDGER:+--ledger --mnemonic-derivation-paths "$HD_PATH" --sender "$DEPLOYER"} \
  -vvv > "$DEPLOY_LOG" 2>&1 && DEPLOY_EXIT=0 || DEPLOY_EXIT=$?
cat "$DEPLOY_LOG"
[ "$DEPLOY_EXIT" -eq 0 ] || { echo "FAIL: forge script exited $DEPLOY_EXIT" >&2; exit 1; }
[ -n "$BROADCAST" ] || exit 0

# READ IT BACK, from the chain. A broadcast that died part way can leave the
# deploying key the owner with nothing pending.
TOK="$(/bin/grep -oE "token +0x[0-9a-fA-F]{40}" "$DEPLOY_LOG" | tail -1 | /bin/grep -oE "0x[0-9a-fA-F]{40}")"
REN="$(/bin/grep -oE "renderer +0x[0-9a-fA-F]{40}" "$DEPLOY_LOG" | tail -1 | /bin/grep -oE "0x[0-9a-fA-F]{40}")"
[ -n "$TOK" ] && [ -n "$REN" ] || { echo "FAIL: the deploy log names no token or renderer: $DEPLOY_LOG" >&2; exit 1; }
lc() { printf '%s' "$1" | tr 'A-F' 'a-f'; }
PENDING_NOW="$(cast call "$TOK" 'pendingOwner()(address)' --rpc-url "$RPC")"
WARDEN_NOW="$(cast call "$TOK" 'warden()(address)' --rpc-url "$RPC")"
ANCHOR_NOW="$(cast call "$TOK" 'splitAnchor()(bytes32)' --rpc-url "$RPC")"
OWNER_NOW="$(cast call "$TOK" 'owner()(address)' --rpc-url "$RPC")"
readback=0
[ "$(lc "$PENDING_NOW")" = "$(lc "$OWNER")" ] || { echo "FAIL: pendingOwner is $PENDING_NOW, not the Safe $OWNER" >&2; readback=1; }
[ "$(lc "$WARDEN_NOW")" = "$(lc "$WARDEN")" ] || { echo "FAIL: warden is $WARDEN_NOW, not $WARDEN" >&2; readback=1; }
[ "$(lc "$ANCHOR_NOW")" = "$(lc "$SPLIT_ANCHOR")" ] || { echo "FAIL: splitAnchor is $ANCHOR_NOW, not $SPLIT_ANCHOR" >&2; readback=1; }
echo "read back: token $TOK, renderer $REN, owner $OWNER_NOW (the deploying key), pendingOwner $PENDING_NOW, warden $WARDEN_NOW"
[ "$readback" -eq 0 ] || exit 1

echo
echo "Next, in order. ACCEPTANCE IS FIRST: until it lands, the deploying key owns the contract."
echo "  1. the Safe accepts ownership (DEPLOY.md section 10); the deploying account then owns nothing:"
echo "     cd ../warden && node tools/safe-tx.mjs accept-ownership --contract $TOK --safe $OWNER --signers $SIGNERS --rpc $RPC"
echo "  2. bash script/verify-plan7.sh $REN $TOK $WARDEN 8453"
echo "  3. cd ../warden && node tools/check-deployed-abi.mjs $TOK $RPC"
echo "  4. cd ../warden && node tools/read-ladder.mjs $TOK $RPC"
echo "  5. MRO_OWNER_SAFE=$OWNER bash contracts/script/adopt-deployment.sh --chain 8453 $REN $TOK <deploy-block>"
echo "  6. warden/DEPLOY.md section 10, in order."
