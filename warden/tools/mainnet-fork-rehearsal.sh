#!/usr/bin/env bash
#
# Rehearse the Base MAINNET cutover against a local anvil fork of Base mainnet.
#
#   ~/scripts/safe-build.sh bash warden/tools/mainnet-fork-rehearsal.sh
#
# Plan: docs/plans/2026-09-15-mro-mainnet-rehearsal.md.
#
# NOTHING HERE SENDS A TRANSACTION TO A REAL CHAIN. anvil forks Base mainnet
# into a local chain on 127.0.0.1; every write goes to that copy, and the copy
# dies with this script. Real mainnet is only READ (its state, as the fork's
# starting point, and today's gas price), and Coinbase's facilitator is only
# asked what it supports -- a free read.
#
# It works from an EXPORTED COPY of the working tree, never the repository:
# forge writes a broadcast log that reads exactly like a real mainnet deploy
# record, and adopt-deployment.sh rewrites a dozen files. One step is the
# exception: the Warden boot uses rehearse-start.sh in the real repository,
# because it needs the operator's settings file for the Coinbase key -- and it
# assembles its own temporary copy of that outside every tree, never printed.
#
# Keys are anvil's own PUBLIC test accounts, derived from anvil's public test
# mnemonic: account 0 deploys (and so owns the fork's copy), account 1 is the
# Clock (the contract's warden), account 2 stands in for the treasury and
# account 3 receives the rehearsal's token. They hold fork money only.
#
# Exits non-zero if any step FAILs. Every result is also in report.txt in the
# work directory, which is kept (and named at the end) so the logs can be read.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh" >/dev/null

MAINNET_RPC="https://mainnet.base.org"
PORT="${FORK_PORT:-8546}"
FORK="http://127.0.0.1:$PORT"
MNEMONIC="test test test test test test test test test test test junk"
DOMAIN="machinereadableonly.com"
CDP_URL="https://api.cdp.coinbase.com/platform/v2/x402"
PLACEHOLDER="0x000000000000000000000000000000000000dEaD"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/mro-mainnet-rehearsal.XXXXXX")"
TREE="$WORK/tree"
REPORT="$WORK/report.txt"
fails=0

ok()   { echo "PASS  $*" | tee -a "$REPORT"; }
bad()  { echo "FAIL  $*" | tee -a "$REPORT"; fails=$((fails + 1)); }
note() { echo "NOTE  $*" | tee -a "$REPORT"; }
step() { echo; echo "== $*"; }
lower() { echo "$1" | tr 'A-F' 'a-f'; }
acct() { cast wallet address --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }
testkey() { cast wallet private-key --mnemonic "$MNEMONIC" --mnemonic-index "$1"; }

ANVIL_PID=""
cleanup() {
  if [ -n "$ANVIL_PID" ]; then
    kill "$ANVIL_PID" 2>/dev/null
    wait "$ANVIL_PID" 2>/dev/null
  fi
  echo
  echo "anvil stopped; ~/.foundry/anvil/tmp holds $(du -sh "$HOME/.foundry/anvil/tmp" 2>/dev/null | cut -f1) (it must stay near zero)"
  echo "work directory kept for reading: $WORK"
}
trap cleanup EXIT

# --- 0. the exported copy -----------------------------------------------------
step "0. export the working tree (tracked and new files, nothing ignored) to $TREE"
mkdir -p "$TREE"
( cd "$REPO" && git ls-files -co --exclude-standard -z | tar --null -T - -cf - ) | tar -xf - -C "$TREE"
for d in warden tools client; do
  [ -d "$REPO/$d/node_modules" ] && ln -s "$REPO/$d/node_modules" "$TREE/$d/node_modules"
done
if [ -f "$TREE/contracts/script/deploy-mainnet.sh" ] && [ -d "$TREE/contracts/lib/forge-std" ]; then
  ok "exported $(cd "$TREE" && find . -type f | wc -l) files, contracts/lib included"
else
  bad "the export is missing deploy-mainnet.sh or contracts/lib"; exit 1
fi

# --- 1. the fork ---------------------------------------------------------------
step "1. fork Base mainnet on $FORK"
HEAD_BLOCK="$(cast block-number --rpc-url "$MAINNET_RPC")"
FORK_BLOCK=$((HEAD_BLOCK - 5))
# --prune-history: keep no history and persist no states. A plain anvil wrote
# 24 GB to ~/.foundry/anvil/tmp on 2026-09-11 and filled the disk.
anvil --fork-url "$MAINNET_RPC" --fork-block-number "$FORK_BLOCK" --prune-history \
  --host 127.0.0.1 --port "$PORT" > "$WORK/anvil.log" 2>&1 &
ANVIL_PID=$!
for _ in $(seq 1 40); do
  [ "$(cast chain-id --rpc-url "$FORK" 2>/dev/null)" = "8453" ] && break
  sleep 1
done
if [ "$(cast chain-id --rpc-url "$FORK" 2>/dev/null)" = "8453" ]; then
  ok "fork up: chain 8453, forked at real mainnet block $FORK_BLOCK"
else
  bad "the fork did not come up -- see $WORK/anvil.log"; exit 1
fi

DEPLOYER="$(acct 0)"; WARDEN="$(acct 1)"; TREASURY="$(acct 2)"
note "deployer $DEPLOYER, warden (Clock) $WARDEN, treasury stand-in $TREASURY"

# TWO RECIPIENTS, ON PURPOSE (found 2026-09-15). anvil's test accounts carry an
# EIP-7702 delegation on REAL Base mainnet -- their keys are public, so somebody
# attached code to them -- and a fork inherits it. `mint` ends in `_safeMint`,
# which calls onERC721Received on any recipient with code, and that code
# refuses. So:
#   HOLDER    a fresh address with no code: the mint that must land.
#   DELEGATED anvil account 3, delegated on mainnet: the mint that must NOT,
#             which is exactly what an agent paying to a wallet that cannot
#             receive an ERC-721 would meet on mainnet.
# The fresh key is generated inside the substitution and never printed.
HOLDER="$(cast wallet address --private-key "0x$(openssl rand -hex 32)")"
DELEGATED="$(acct 3)"
if [ "$(cast code "$HOLDER" --rpc-url "$FORK")" = "0x" ]; then
  ok "holder $HOLDER has no code"
else
  bad "the fresh holder address has code on the fork"; exit 1
fi
case "$(cast code "$DELEGATED" --rpc-url "$FORK")" in
  0xef0100*) ok "delegated recipient $DELEGATED carries an EIP-7702 delegation on the fork" ;;
  *) note "anvil account 3 is no longer delegated on mainnet; the negative mint below is not a 7702 case" ;;
esac

# --- 2. deploy -----------------------------------------------------------------
step "2. deploy with contracts/script/deploy-mainnet.sh --fork"
( cd "$TREE/contracts" && bash script/deploy-mainnet.sh --warden "$WARDEN" --fork "$FORK" --broadcast ) \
  > "$WORK/deploy.log" 2>&1
DEPLOY_EXIT=$?
REN="$(/bin/grep -oE "renderer +0x[0-9a-fA-F]{40}" "$WORK/deploy.log" | tail -1 | /bin/grep -oE "0x[0-9a-fA-F]{40}")"
TOK="$(/bin/grep -oE "token +0x[0-9a-fA-F]{40}" "$WORK/deploy.log" | tail -1 | /bin/grep -oE "0x[0-9a-fA-F]{40}")"
if [ "$DEPLOY_EXIT" -eq 0 ] && [ -n "$REN" ] && [ -n "$TOK" ]; then
  ok "deployed: renderer $REN, token $TOK"
else
  bad "deploy-mainnet.sh exited $DEPLOY_EXIT -- see $WORK/deploy.log"; exit 1
fi
BCAST="$TREE/contracts/broadcast/DeployPlan5.s.sol/8453/run-latest.json"
read -r DEPLOY_BLOCK DEPLOY_GAS DEPLOY_TXS < <(node -e '
  const r = require(process.argv[1]).receipts;
  const blocks = r.map((x) => Number(BigInt(x.blockNumber)));
  const gas = r.reduce((s, x) => s + BigInt(x.gasUsed), 0n);
  console.log(Math.min(...blocks), gas.toString(), r.length);
' "$BCAST")
note "deploy: $DEPLOY_TXS transactions, first in block $DEPLOY_BLOCK, $DEPLOY_GAS gas in total"

# --- 3. read it back -----------------------------------------------------------
step "3. read the deployment back"
if ( cd "$TREE/warden" && node tools/check-deployed-abi.mjs "$TOK" "$FORK" ) > "$WORK/abi.log" 2>&1; then
  ok "check-deployed-abi: this repository's ABI describes the deployed bytecode"
else
  bad "check-deployed-abi -- see $WORK/abi.log"
fi
if ( cd "$TREE/warden" && node tools/read-ladder.mjs "$TOK" "$FORK" ) > "$WORK/ladder.log" 2>&1; then
  ok "read-ladder: the ten Mark records match the spec"
else
  bad "read-ladder -- see $WORK/ladder.log"
fi
OWNER="$(cast call "$TOK" 'owner()(address)' --rpc-url "$FORK")"
ONCHAIN_WARDEN="$(cast call "$TOK" 'warden()(address)' --rpc-url "$FORK")"
[ "$(lower "$OWNER")" = "$(lower "$DEPLOYER")" ] && ok "owner is the deploying key" || bad "owner is $OWNER, expected $DEPLOYER"
[ "$(lower "$ONCHAIN_WARDEN")" = "$(lower "$WARDEN")" ] && ok "warden is the Clock key given to --warden" || bad "warden is $ONCHAIN_WARDEN, expected $WARDEN"

# --- 4. adopt ------------------------------------------------------------------
step "4. adopt-deployment.sh --chain 8453, in the exported copy"
( cd "$TREE" && bash contracts/script/adopt-deployment.sh --chain 8453 "$REN" "$TOK" "$DEPLOY_BLOCK" ) \
  > "$WORK/adopt.log" 2>&1
ADOPT_EXIT=$?
LINE="$(/bin/grep "^export const DEPLOY_BLOCK" "$TREE/warden/src/clock/reconcile.mjs")"
if [ "$ADOPT_EXIT" -eq 0 ] && echo "$LINE" | /bin/grep -q "[{ ]8453: " && echo "$LINE" | /bin/grep -q "84532: "; then
  ok "adopt: $LINE"
else
  bad "adopt exited $ADOPT_EXIT, map is '$LINE' -- see $WORK/adopt.log"
fi
SERVED="$(/bin/grep -c "$TOK" "$TREE/warden/public/llms.txt" || true)"
[ "$SERVED" -ge 1 ] && ok "llms.txt in the copy now names the new token ($SERVED times)" || bad "llms.txt in the copy does not name $TOK"

# --- 5. the Warden, mainnet mode -------------------------------------------------
step "5. boot the Warden in MAINNET mode against the fork (rehearse-start.sh, real settings, IPv4)"
OVR="MRO_CHAIN_ID=8453 MRO_CONTRACT_ADDRESS=$TOK BASE_RPC_URL=$FORK X402_FACILITATOR_URL=$CDP_URL TREASURY_ADDRESS=$TREASURY"
REHEARSE_OVERRIDE="$OVR" bash "$REPO/warden/tools/rehearse-start.sh" 25 > "$WORK/warden-boot.log" 2>&1
BOOT=$?
if [ "$BOOT" -eq 0 ] && /bin/grep -q "payment ready (eip155:8453" "$WORK/warden-boot.log"; then
  ok "the Warden booted on 8453: $(/bin/grep -o 'payment ready.*' "$WORK/warden-boot.log" | head -1)"
else
  bad "the Warden's mainnet boot (exit $BOOT) -- see $WORK/warden-boot.log"
fi
OVR_DEAD="MRO_CHAIN_ID=8453 MRO_CONTRACT_ADDRESS=$TOK BASE_RPC_URL=$FORK X402_FACILITATOR_URL=$CDP_URL TREASURY_ADDRESS=$PLACEHOLDER"
REHEARSE_OVERRIDE="$OVR_DEAD" bash "$REPO/warden/tools/rehearse-start.sh" 15 > "$WORK/warden-placeholder.log" 2>&1
# The REASON is asserted, not just the exit: a boot that died for any other
# cause would otherwise pass this line.
if [ $? -ne 0 ] && /bin/grep -q "TREASURY_ADDRESS is a placeholder" "$WORK/warden-placeholder.log"; then
  ok "the placeholder treasury on 8453 is REFUSED at boot: $(/bin/grep -o -m1 'TREASURY_ADDRESS is a placeholder[^:]*' "$WORK/warden-placeholder.log")"
else
  bad "the Warden STARTED on 8453 with the 0x...dEaD placeholder treasury -- see $WORK/warden-placeholder.log"
fi

# --- 6. the Clock, mainnet mode ------------------------------------------------------
step "6. the Clock in MAINNET mode against the fork"
MIRROR="$WORK/clock-mirror.db"
CLOCK_ENV=(BASE_RPC_URL="$FORK" MRO_CONTRACT_ADDRESS="$TOK" MRO_CHAIN_ID=8453 CLOCK_PRIVATE_KEY="$(testkey 1)" STATE_DB_PATH="$MIRROR")
# clock <tree> <log> [NAME=value ...] -- extra settings for that run only.
clock() {
  local tree="$1" log="$2"
  shift 2
  ( cd "$tree/warden" && env "${CLOCK_ENV[@]}" "$@" node src/clock/main.mjs ) > "$log" 2>&1
}

# 6a. The REPOSITORY has no deploy block for 8453, so its Clock must refuse.
clock "$REPO" "$WORK/clock-noblock.log"
if [ $? -ne 0 ] && /bin/grep -q "no deploy block recorded for chain 8453" "$WORK/clock-noblock.log"; then
  ok "without DEPLOY_BLOCK[8453] the Clock refuses before writing anything"
else
  bad "the Clock did not refuse a missing deploy block -- see $WORK/clock-noblock.log"
fi

# 6b. A paid, solved mint for token 1, then the adopted copy's Clock writes it.
TODAY="$(cast call "$TOK" 'today()(uint32)' --rpc-url "$FORK" | awk '{print $1}')"
if ( cd "$TREE/warden" && node tools/mainnet-fork-clock.mjs seed-mint --db "$MIRROR" --token 1 \
     --to "$HOLDER" --day "$TODAY" --domain "$DOMAIN" ) > "$WORK/seed-mint.log" 2>&1; then
  ok "seeded a paid mint for token 1 on day $TODAY, artwork solved against $DOMAIN"
else
  bad "seeding the mint -- see $WORK/seed-mint.log"
fi
if ( cd "$TREE/warden" && node tools/mainnet-fork-clock.mjs seed-mint --db "$MIRROR" --token 2 \
     --to "$DELEGATED" --day "$TODAY" --domain "$DOMAIN" ) > "$WORK/seed-mint2.log" 2>&1; then
  ok "seeded a paid mint for token 2 to the DELEGATED recipient, expected never to land"
else
  bad "seeding the delegated mint -- see $WORK/seed-mint2.log"
fi
# 6b-i. THE GAS GUARD, deliberately. anvil prices its own blocks -- about
# 1 gwei, measured 2026-09-15 -- not Base's (0.006 gwei that day), so at the
# default MAX_GAS_GWEI of 0.05 the Clock must write NOTHING and exit 0, leaving
# every row for the next run.
clock "$TREE" "$WORK/clock-guard.log"
GUARD=$?
if [ "$GUARD" -eq 0 ] && /bin/grep -q "above the cap of 0.05 gwei -- nothing written" "$WORK/clock-guard.log"; then
  ok "gas guard held: $(/bin/grep -o 'gas is [^-]*' "$WORK/clock-guard.log" | head -1)-- nothing written, exit 0"
else
  bad "the gas guard did not hold (exit $GUARD) -- see $WORK/clock-guard.log"
fi

# 6b-ii. The operator's dial raised to the FORK's own price, then the write. The
# cost table below multiplies gas USED by the REAL mainnet price instead.
clock "$TREE" "$WORK/clock-run1.log" MAX_GAS_GWEI=5
RUN1=$?
MINT_GAS="$(/bin/grep -oE "mint 1 ok, tx 0x[0-9a-f]+, gas [0-9]+" "$WORK/clock-run1.log" | /bin/grep -oE "[0-9]+$")"
[ "$RUN1" -eq 0 ] && [ -n "$MINT_GAS" ] && ok "Clock run 1: token 1 minted on the fork ($MINT_GAS gas)" || bad "Clock run 1 (exit $RUN1) -- see $WORK/clock-run1.log"
if /bin/grep -q "mint 2 failed" "$WORK/clock-run1.log"; then
  ok "the PAID mint to a delegated wallet cannot land: $(/bin/grep -o 'mint 2 failed.*' "$WORK/clock-run1.log" | head -1)"
else
  bad "the mint to the delegated recipient did not fail as expected -- see $WORK/clock-run1.log"
fi
/bin/grep -q "builder code none yet" "$WORK/clock-run1.log" && note "Builder Code still null: every mainnet write would go unattributed (DEPLOY.md section 10)"

# 6c. Two days on, a check-in and a Mark; twelve blocks so the mint reconciles.
cast rpc evm_increaseTime 172800 --rpc-url "$FORK" >/dev/null
cast rpc anvil_mine 0xd --rpc-url "$FORK" >/dev/null
( cd "$TREE/warden" && node tools/mainnet-fork-clock.mjs seed-credit --db "$MIRROR" --token 1 --day $((TODAY + 1)) \
  && node tools/mainnet-fork-clock.mjs seed-mark --db "$MIRROR" --token 1 --mark 1 ) > "$WORK/seed-2.log" 2>&1 \
  || bad "seeding the check-in and the Mark -- see $WORK/seed-2.log"
clock "$TREE" "$WORK/clock-run2.log" MAX_GAS_GWEI=5
RUN2=$?
CHECKIN_GAS="$(/bin/grep -oE "batchCheckIn x1 ok, tx 0x[0-9a-f]+, gas [0-9]+" "$WORK/clock-run2.log" | /bin/grep -oE "[0-9]+$")"
MARK_GAS="$(/bin/grep -oE "applyMark 1 on 1 ok, tx 0x[0-9a-f]+, gas [0-9]+" "$WORK/clock-run2.log" | /bin/grep -oE "[0-9]+$")"
[ -n "$CHECKIN_GAS" ] && ok "Clock run 2: the day-$((TODAY + 1)) check-in written ($CHECKIN_GAS gas)" || bad "no check-in written in run 2 -- see $WORK/clock-run2.log"
[ -n "$MARK_GAS" ] && ok "Clock run 2: Hush applied ($MARK_GAS gas)" || bad "no Mark applied in run 2 -- see $WORK/clock-run2.log"
[ "$RUN2" -eq 0 ] && ok "Clock run 2 exited 0" || bad "Clock run 2 exited $RUN2"
RECON="$(/bin/grep -o 'reconciled .*' "$WORK/clock-run2.log" | tail -1)"
echo "$RECON" | /bin/grep -q '"Minted":1' && ok "reconcile read the mint back from the fork: $RECON" || bad "reconcile did not see the mint: ${RECON:-no reconcile line}"

# --- 7. what it costs on real mainnet today --------------------------------------
step "7. cost at today's real Base mainnet gas price"
GAS_PRICE="$(cast gas-price --rpc-url "$MAINNET_RPC")"
node -e '
  const [price, deploy, mint, checkin, mark] = process.argv.slice(1).map((v) => BigInt(v || "0"));
  const eth = (gas) => (Number(gas * price) / 1e18).toFixed(9);
  console.log(`gas price  ${price} wei (${(Number(price) / 1e9).toFixed(6)} gwei), read from ${"https://mainnet.base.org"}`);
  console.log(`deploy     ${deploy} gas  = ${eth(deploy)} ETH`);
  console.log(`one mint   ${mint} gas  = ${eth(mint)} ETH`);
  console.log(`check-in   ${checkin} gas  = ${eth(checkin)} ETH  (a one-entry batch)`);
  console.log(`one Mark   ${mark} gas  = ${eth(mark)} ETH`);
' "$GAS_PRICE" "$DEPLOY_GAS" "$MINT_GAS" "$CHECKIN_GAS" "$MARK_GAS" | tee -a "$REPORT"
note "L2 execution gas only: Base also charges an L1 data fee per transaction, which a fork does not reproduce"

step "done"
echo "$fails step(s) failed" | tee -a "$REPORT"
[ "$fails" -eq 0 ]
