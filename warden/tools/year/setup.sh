#!/usr/bin/env bash
#
# Prepare the accelerated year: an isolated copy of HEAD, the year's own
# settings, a fresh fast pair on Base Sepolia, and the reconcile cursor.
#
#   bash tools/year/setup.sh --dry-run   # everything except the deploy
#   bash tools/year/setup.sh             # CAUTION: broadcasts a testnet deploy
#
# EVERY STAGE IS SKIPPED WHEN IT IS ALREADY DONE, so this can be run again after
# a failure without deploying a second pair or rewriting a settings file that is
# already in use.
#
# It deploys TEST-ONLY contracts to Base Sepolia (84532) and spends test ETH from
# the deployer. DeployFast.s.sol refuses every other chain outright.
#
# NOTHING FROM A SETTINGS FILE IS EVER PRINTED. The year's settings are built
# from the old fast copy's, which holds the Clock's private key and the
# challenge secret; the two values read out of it by name go into files, never to
# the terminal.
set -euo pipefail

DRY=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY=1 ;;
  *) echo "FAIL: unrecognised argument '$1'. Pass --dry-run, or nothing to deploy." >&2; exit 1 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"

DIR="${MRO_YEAR_DIR:-$HOME/.mro-year}"
export MRO_YEAR_DIR="$DIR"
TREE="$DIR/tree"
CONF="$DIR/year.conf"
FAST_CONF="${MRO_FAST_CONF:-$HOME/.mro-fast/fast.conf}"
RPC="${BASE_RPC_URL:-https://sepolia.base.org}"
BROADCAST="$REPO/contracts/broadcast/DeployFast.s.sol/84532/run-latest.json"
CURSOR="$DIR/state.db.reconcile-cursor"

export PATH="$HOME/.foundry/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$HOME/.nvm/nvm.sh" >/dev/null
fi

fail() { echo "FAIL: $*" >&2; exit 1; }

command -v node >/dev/null || fail "no node on PATH"

# Substitute a setting in place, or append it when the file has no such line.
#
# awk, NOT sed: a sed replacement treats `&` as "the whole match" and the
# delimiter as a delimiter, so an address or a path carrying either would be
# rewritten into something else. awk is handed the value as a variable and prints
# it literally. The file is rewritten through a temp file created under umask 077,
# so the new settings never exist world-readable even for an instant.
set_setting() {
  local key="$1" value="$2" file="$3"
  (
    umask 077
    awk -v key="$key" -v value="$value" '
      index($0, key "=") == 1 { print key "=" value; found = 1; next }
      { print }
      END { if (!found) print key "=" value }
    ' "$file" > "$file.tmp"
  )
  chmod 600 "$file.tmp"
  mv "$file.tmp" "$file"
}

# One setting's value, for the two public ones this script has to know. Nothing
# printed: the caller puts it in a file. awk rather than `sed | head`, because
# under `pipefail` a `head` closing the pipe early makes sed exit 141.
read_setting() {
  awk -v key="$1" 'index($0, key "=") == 1 { sub(/^[^=]*=/, "", $0); gsub(/[ \t\r"'"'"']/, "", $0); print; exit }' "$2"
}

# Is any of this run's PM2 apps up? Read into a variable and parsed by node: a
# `pm2 jlist | grep` would make the gate a pipeline, whose exit status is the last
# command's, and it would leave the whole process list on disk.
year_apps_online() {
  command -v pm2 >/dev/null || return 1
  local jlist
  jlist="$(pm2 jlist 2>/dev/null || true)"
  [ -n "$jlist" ] || return 1
  # A here-string, not a pipe: the status this function returns must be node's
  # answer about the list, not pm2's about having printed one.
  node -e '
    let list = [];
    try { list = JSON.parse(require("fs").readFileSync(0, "utf8")); } catch { process.exit(1); }
    const up = list.filter((a) => a.name?.startsWith("mro-year-") && a.pm2_env?.status === "online");
    process.stdout.write(up.map((a) => a.name).join(" "));
    process.exit(up.length > 0 ? 0 : 1);
  ' <<< "$jlist"
}

mkdir -p "$DIR" "$DIR/logs"
chmod 700 "$DIR"
echo "year: data directory $DIR"

# --------------------------------------------------------------- 1. the tree
#
# The stack runs from an export of HEAD rather than the live checkout. The
# Warden's own paths are relative to its source, so a fast Warden started in the
# live tree writes where the live site writes -- and a checkout being edited
# mid-run would change the code under a 38-hour run.
#
# The commit exported is recorded beside the tree, because "there is a tree
# there" is not the same question as "it is the code start.sh just tested". A
# tree from an older commit is re-exported over, which is safe while nothing is
# running -- stop the processes before running setup.sh again.
HEAD_ID="$(git -C "$REPO" rev-parse HEAD)"
exported=""
if [ -f "$DIR/tree.head" ]; then exported="$(tr -d " \t\r\n" < "$DIR/tree.head")"; fi

if [ -d "$TREE/warden/src" ] && [ "$exported" = "$HEAD_ID" ]; then
  echo "tree: skipped, $TREE already holds this commit"
else
  # A RE-EXPORT WHILE THE RUN IS UP WOULD SWAP THE CODE UNDER IT: the Warden, the
  # Clock loop and the two tools all read their files from this tree as they go,
  # so a 38-hour run would be half one commit and half another.
  if up="$(year_apps_online)"; then
    fail "the run is up ($up) and $TREE needs re-exporting. Run stop.sh first."
  fi
  mkdir -p "$TREE"
  git -C "$REPO" archive HEAD | tar -x -C "$TREE"
  printf '%s\n' "$HEAD_ID" > "$DIR/tree.head"
  if [ -n "$exported" ]; then
    echo "tree: re-exported over an older export. Stop the four processes before starting them again."
  else
    echo "tree: exported HEAD into $TREE"
  fi
fi

for pkg in warden client tools; do
  [ -d "$REPO/$pkg/node_modules" ] || fail "no $pkg/node_modules in the checkout: run npm install there first"
  ln -sfn "$REPO/$pkg/node_modules" "$TREE/$pkg/node_modules"
done
echo "tree: node_modules linked for warden, client, tools"

# --------------------------------------------------------------- 2. the settings
#
# Built from the old fast copy's file, which already holds the working challenge
# secret, facilitator and Clock key. Six values are this run's own; everything
# else is carried across untouched.
if [ -f "$CONF" ]; then
  echo "settings: skipped, $CONF is already there"
else
  [ -f "$FAST_CONF" ] || fail "no fast settings at $FAST_CONF to build $CONF from"
  ( umask 077; cat "$FAST_CONF" > "$CONF" )
  chmod 600 "$CONF"
  set_setting MRO_DOMAIN fast.test "$CONF"
  set_setting PORT 4006 "$CONF"
  set_setting MRO_DAY_SECONDS 300 "$CONF"
  set_setting MRO_CLOCK_OFFSET_SECONDS 30 "$CONF"
  set_setting STATE_DB_PATH "$DIR/state.db" "$CONF"
  # The pair does not exist yet. A sentinel rather than the old pair's address:
  # the Warden must refuse to start on it, not quietly write to last month's run.
  set_setting MRO_CONTRACT_ADDRESS pending-deploy "$CONF"
  echo "settings: wrote $CONF (mode 600, not printed)"
fi

# The treasury the Warden demands payment to, where the runner reads it to check
# a demand before signing. Public, and written to a file rather than echoed.
TREASURY="$(read_setting TREASURY_ADDRESS "$CONF")"
[ -n "$TREASURY" ] || fail "no TREASURY_ADDRESS in $CONF: the Warden will not start without one"
printf '%s\n' "$TREASURY" > "$DIR/treasury.address"
echo "settings: treasury address written to $DIR/treasury.address"

# --------------------------------------------------------------- 3. the pair
#
# The address and the deploy block are read out of forge's own broadcast record,
# never typed: a hand-copied address is how a run ends up reading state off the
# wrong contract.
CONTRACT=""
if [ -s "$DIR/contract.address" ]; then
  CONTRACT="$(tr -d " \t\r\n" < "$DIR/contract.address")"
  # WRITTEN BACK EVERY TIME, not only on the deploy. contract.address is the
  # record of which pair this data directory belongs to, and year.conf can be
  # rebuilt (it is skipped only while it exists) -- a rebuilt one would otherwise
  # keep the `pending-deploy` sentinel and refuse to start for no reason.
  set_setting MRO_CONTRACT_ADDRESS "$CONTRACT" "$CONF"
  echo "deploy: skipped, $DIR/contract.address already holds $CONTRACT"
elif [ "$DRY" = 1 ]; then
  echo "deploy: would simulate, then broadcast:"
  echo "        bash contracts/script/fast/deploy-fast.sh"
  echo "        bash contracts/script/fast/deploy-fast.sh --broadcast"
  echo "        then read the address and block from $BROADCAST"
else
  # A broadcast record from an EARLIER deploy is still sitting at run-latest.json,
  # so the file is only believed if it was written after this run started.
  started="$(date +%s)"
  bash "$REPO/contracts/script/fast/deploy-fast.sh"
  bash "$REPO/contracts/script/fast/deploy-fast.sh" --broadcast
  [ -f "$BROADCAST" ] || fail "no broadcast record at $BROADCAST"
  written="$(stat -c %Y "$BROADCAST")"
  [ "$written" -ge "$started" ] || fail "$BROADCAST is older than this run: refusing to read a previous deploy's address"

  CONTRACT="$(jq -r 'first(.transactions[] | select(.contractName == "MachineReadableOnlyFast" and .transactionType == "CREATE") | .contractAddress) // ""' "$BROADCAST")"
  [[ "$CONTRACT" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "no MachineReadableOnlyFast creation in $BROADCAST"
  block_hex="$(jq -r --arg a "$CONTRACT" 'first(.receipts[] | select(((.contractAddress // "") | ascii_downcase) == ($a | ascii_downcase)) | .blockNumber) // ""' "$BROADCAST")"
  [ -n "$block_hex" ] || fail "no receipt for $CONTRACT in $BROADCAST"
  BLOCK=$(( block_hex ))

  printf '%s\n' "$CONTRACT" > "$DIR/contract.address"
  printf '%s\n' "$BLOCK" > "$DIR/deploy.block"
  set_setting MRO_CONTRACT_ADDRESS "$CONTRACT" "$CONF"
  echo "deploy: $CONTRACT at block $BLOCK"
fi

# The pair is only real if the chain has code at that address. A deploy that
# reverted, or an address read from the wrong record, fails here.
#
# A DRY RUN MAKES NO NETWORK CALL AT ALL, including this one: it is the rehearsal
# an operator does before deciding to deploy, and it has to work on a box with no
# route to Base and no foundry.
if [ "$DRY" = 1 ]; then
  echo "deploy: would read back cast code for ${CONTRACT:-the new pair}"
elif [ -n "$CONTRACT" ]; then
  code="$(cast code "$CONTRACT" --rpc-url "$RPC")"
  [ -n "$code" ] && [ "$code" != "0x" ] || fail "no code at $CONTRACT on $RPC: the pair is not deployed"
  echo "deploy: cast code at $CONTRACT is ${#code} characters, the pair is live"
fi

# --------------------------------------------------------------- 4. the cursor
#
# Where reconcile starts reading logs. Without it the Clock floors at the LIVE
# pair's deploy block, which is millions of blocks back, and every run would page
# through them 1,000 at a time. One block before the deploy, so the deploy's own
# block is included.
if [ -f "$CURSOR" ]; then
  echo "cursor: skipped, $CURSOR is already there"
elif [ -s "$DIR/deploy.block" ]; then
  printf '%s\n' "$(( $(tr -d " \t\r\n" < "$DIR/deploy.block") - 1 ))" > "$CURSOR"
  echo "cursor: wrote $CURSOR"
elif [ "$DRY" = 1 ]; then
  echo "cursor: would write the deploy block minus one into $CURSOR"
else
  fail "no deploy block at $DIR/deploy.block: write the pair's deploy block there, or reconcile will page from the live pair's"
fi

echo
if [ "$DRY" = 1 ]; then
  echo "dry run: nothing was deployed and no transaction was sent."
else
  echo "next: node tools/year/wallets.mjs, node tools/year/fund.mjs, bash tools/year/start.sh"
fi
