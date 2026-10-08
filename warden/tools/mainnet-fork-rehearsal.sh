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
# mnemonic: account 0 deploys, account 1 is the Clock (the contract's warden),
# account 2 stands in for the treasury, account 3 receives the rehearsal's
# token, accounts 4-6 sign for a 2-of-3 Safe that becomes the owner, and
# account 7 is the Clock key the Safe rotates to. They hold fork money only.
#
# Exits non-zero if any step FAILs. Every result is also in report.txt in the
# work directory, which is kept (and named at the end) so the logs can be read.
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# The checkout whose Warden settings and database step 5 boots against. A
# worktree has neither, so it can point at the main checkout.
REHEARSE_REPO="${REHEARSE_REPO:-$REPO}"
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

# TWO RECIPIENTS, ON PURPOSE. anvil's test accounts carry an EIP-7702
# delegation on REAL Base mainnet -- their keys are public, so somebody attached
# code to them -- and a fork inherits it. `mint` uses `_mint`, which never calls
# onERC721Received, so a paid mint to a wallet with code still lands:
#   HOLDER    a fresh address with no code.
#   DELEGATED anvil account 3, delegated on mainnet: what an agent paying from
#             a smart or delegated wallet meets.
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
  *) note "anvil account 3 is no longer delegated on mainnet; the second mint below is not a 7702 case" ;;
esac

# --- 1b. the owner Safe ------------------------------------------------------
# Safe's own 1.5.0 contracts, already on Base mainnet and so on the fork. The
# addresses are from safe-global/safe-deployments; their code hashes were
# checked against the chain when this step was written.
step "1b. create a 2-of-3 Safe from Safe's own 1.5.0 factory"
SAFE_FACTORY="0x14F2982D601c9458F93bd70B218933A6f8165e7b"
SAFE_L2="0xEdd160fEBBD92E350D4D398fb636302fccd67C7e"
SAFE_FALLBACK="0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4"
ZERO_ADDR="0x0000000000000000000000000000000000000000"
SIGNERS="$(acct 4),$(acct 5),$(acct 6)"
SETUP="$(cast calldata 'setup(address[],uint256,address,bytes,address,address,uint256,address)' \
  "[$SIGNERS]" 2 "$ZERO_ADDR" 0x "$SAFE_FALLBACK" "$ZERO_ADDR" 0 "$ZERO_ADDR")"
SALT="$(date +%s)"
SAFE="$(cast call "$SAFE_FACTORY" 'createProxyWithNonce(address,bytes,uint256)(address)' "$SAFE_L2" "$SETUP" "$SALT" \
  --from "$(acct 0)" --rpc-url "$FORK" 2>>"$WORK/safe.log")"
cast send "$SAFE_FACTORY" 'createProxyWithNonce(address,bytes,uint256)' "$SAFE_L2" "$SETUP" "$SALT" \
  --private-key "$(testkey 0)" --rpc-url "$FORK" >> "$WORK/safe.log" 2>&1
if [ -n "$SAFE" ] && [ "$(cast call "$SAFE" 'getThreshold()(uint256)' --rpc-url "$FORK" 2>/dev/null)" = "2" ]; then
  ok "Safe $SAFE: version $(cast call "$SAFE" 'VERSION()(string)' --rpc-url "$FORK"), 2 of 3"
else
  bad "the Safe was not created -- see $WORK/safe.log"; exit 1
fi

# Sign a Safe transaction file the way two owners would, then execute it.
# Signatures go in ascending signer order, which is what the Safe checks.
safe_exec() {
  local label="$1" file="$2" hash="$3" data sigs
  data="$(node -e 'console.log(require(process.argv[1]).transactions[0].data)' "$file")"
  sigs="0x"
  for i in $(for k in 4 5; do echo "$(lower "$(acct $k)") $k"; done | sort | cut -d' ' -f2); do
    sigs="$sigs$(cast wallet sign --no-hash "$hash" --private-key "$(testkey "$i")" | sed 's/^0x//')"
  done
  cast send "$SAFE" 'execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)' \
    "$TOK" 0 "$data" 0 0 0 0 "$ZERO_ADDR" "$ZERO_ADDR" "$sigs" \
    --private-key "$(testkey 0)" --rpc-url "$FORK" > "$WORK/safe-$label.log" 2>&1
}

# Prepare one action with safe-tx.mjs; prints the file path and the safeTxHash.
safe_prepare() {
  local label="$1"; shift
  ( cd "$TREE/warden" && MRO_SAFE_TX_OUT="$WORK/safe-tx" node tools/safe-tx.mjs "$@" \
      --contract "$TOK" --safe "$SAFE" --rpc "$FORK" ) > "$WORK/safe-tx-$label.log" 2>&1 || return 1
  echo "$(sed -n 's/^file *//p' "$WORK/safe-tx-$label.log") $(sed -n 's/^ *Trezor *safeTxHash *//p' "$WORK/safe-tx-$label.log")"
}

# --- 2. deploy -----------------------------------------------------------------
step "2. deploy with contracts/script/deploy-mainnet.sh --fork --owner <the Safe>"
SPLIT_SEED_FILE="$WORK/split-seed"
if ( cd "$TREE/warden" && node tools/split-seed.mjs new "$SPLIT_SEED_FILE" ) > "$WORK/split-seed.log" 2>&1; then
  ok "a throwaway split seed for the fork"
else
  bad "split-seed.mjs new -- see $WORK/split-seed.log"; exit 1
fi
( cd "$TREE/contracts" && MRO_SPLIT_SEED_FILE="$SPLIT_SEED_FILE" bash script/deploy-mainnet.sh --warden "$WARDEN" --owner "$SAFE" --fork "$FORK" --broadcast ) \
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
PENDING="$(cast call "$TOK" 'pendingOwner()(address)' --rpc-url "$FORK")"
[ "$(lower "$OWNER")" = "$(lower "$DEPLOYER")" ] && ok "owner is the deploying key until the Safe accepts" || bad "owner is $OWNER, expected $DEPLOYER"
[ "$(lower "$PENDING")" = "$(lower "$SAFE")" ] && ok "pending owner is the Safe" || bad "pending owner is $PENDING, expected $SAFE"
[ "$(lower "$ONCHAIN_WARDEN")" = "$(lower "$WARDEN")" ] && ok "warden is the Clock key given to --warden" || bad "warden is $ONCHAIN_WARDEN, expected $WARDEN"

# --- 3b. the Safe accepts ownership ---------------------------------------------
step "3b. the Safe accepts ownership through safe-tx.mjs"
if read -r FILE HASH < <(safe_prepare accept accept-ownership) && [ -n "$HASH" ]; then
  ok "safe-tx.mjs accept-ownership: its hash matches the Safe's own ($HASH)"
  safe_exec accept "$FILE" "$HASH" || bad "execTransaction for acceptOwnership -- see $WORK/safe-accept.log"
  OWNER="$(cast call "$TOK" 'owner()(address)' --rpc-url "$FORK")"
  [ "$(lower "$OWNER")" = "$(lower "$SAFE")" ] && ok "owner is now the Safe, signed by two of its three keys" || bad "owner is $OWNER after acceptOwnership"
else
  bad "safe-tx.mjs accept-ownership -- see $WORK/safe-tx-accept.log"
fi

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
OVR="MRO_CHAIN_ID=8453 MRO_CONTRACT_ADDRESS=$TOK BASE_RPC_URL=$FORK X402_FACILITATOR_URL=$CDP_URL TREASURY_ADDRESS=$TREASURY MRO_HOUSE_KEY_ID=rehearsal-house"
REHEARSE_OVERRIDE="$OVR" bash "$REHEARSE_REPO/warden/tools/rehearse-start.sh" 25 > "$WORK/warden-boot.log" 2>&1
BOOT=$?
if [ "$BOOT" -eq 0 ] && /bin/grep -q "payment ready (eip155:8453" "$WORK/warden-boot.log"; then
  ok "the Warden booted on 8453: $(/bin/grep -o 'payment ready.*' "$WORK/warden-boot.log" | head -1)"
else
  bad "the Warden's mainnet boot (exit $BOOT) -- see $WORK/warden-boot.log"
fi
OVR_DEAD="MRO_CHAIN_ID=8453 MRO_CONTRACT_ADDRESS=$TOK BASE_RPC_URL=$FORK X402_FACILITATOR_URL=$CDP_URL TREASURY_ADDRESS=$PLACEHOLDER MRO_HOUSE_KEY_ID=rehearsal-house"
REHEARSE_OVERRIDE="$OVR_DEAD" bash "$REHEARSE_REPO/warden/tools/rehearse-start.sh" 15 > "$WORK/warden-placeholder.log" 2>&1
# The REASON is asserted, not just the exit: a boot that died for any other
# cause would otherwise pass this line.
DEAD=$?
if [ "$DEAD" -ne 0 ] && /bin/grep -q "TREASURY_ADDRESS is a placeholder" "$WORK/warden-placeholder.log"; then
  ok "the placeholder treasury on 8453 is REFUSED at boot: $(/bin/grep -o -m1 'TREASURY_ADDRESS is a placeholder[^:]*' "$WORK/warden-placeholder.log")"
elif [ "$DEAD" -eq 0 ]; then
  bad "the Warden STARTED on 8453 with the 0x...dEaD placeholder treasury -- see $WORK/warden-placeholder.log"
else
  bad "the placeholder boot exited $DEAD for some other reason, so the refusal was not tested -- see $WORK/warden-placeholder.log"
fi

# --- 6. the Clock, mainnet mode ------------------------------------------------------
step "6. the Clock in MAINNET mode against the fork"
MIRROR="$WORK/clock-mirror.db"
CLOCK_ENV=(BASE_RPC_URL="$FORK" MRO_CONTRACT_ADDRESS="$TOK" MRO_CHAIN_ID=8453 CLOCK_PRIVATE_KEY="$(testkey 1)" STATE_DB_PATH="$MIRROR" MRO_SPLIT_SEED_FILE="$SPLIT_SEED_FILE")
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
  ok "seeded a paid mint for token 2 to the DELEGATED recipient"
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
if /bin/grep -q "mint 2 ok" "$WORK/clock-run1.log"; then
  ok "the PAID mint to a delegated wallet lands: $(/bin/grep -o 'mint 2 ok.*' "$WORK/clock-run1.log" | head -1)"
else
  bad "the mint to the delegated recipient did not land -- see $WORK/clock-run1.log"
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
# Both mints were closed by the mint pass in run 1; reconcile reads their
# Minted events back and counts each as confirmed.
RECON="$(/bin/grep -o 'reconciled .*' "$WORK/clock-run2.log" | tail -1)"
echo "$RECON" | /bin/grep -q '"Minted":2' && ok "reconcile read both mints back from the fork: $RECON" || bad "reconcile did not see both mints: ${RECON:-no reconcile line}"

# --- 6c. the emergency rotation, through the Safe ---------------------------------
step "6c. rotate the Clock key through the Safe (DEPLOY.md section 9b)"
NEW_WARDEN="$(acct 7)"
if read -r FILE HASH < <(safe_prepare rotate set-warden "$NEW_WARDEN") && [ -n "$HASH" ]; then
  ok "safe-tx.mjs set-warden: its hash matches the Safe's own ($HASH)"
  safe_exec rotate "$FILE" "$HASH" || bad "execTransaction for setWarden -- see $WORK/safe-rotate.log"
  ONCHAIN_WARDEN="$(cast call "$TOK" 'warden()(address)' --rpc-url "$FORK")"
  [ "$(lower "$ONCHAIN_WARDEN")" = "$(lower "$NEW_WARDEN")" ] && ok "warden is now $NEW_WARDEN" || bad "warden is $ONCHAIN_WARDEN after setWarden"
else
  bad "safe-tx.mjs set-warden -- see $WORK/safe-tx-rotate.log"
fi

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
