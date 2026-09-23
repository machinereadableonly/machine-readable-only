#!/usr/bin/env bash
#
# Point this repository at a NEW deployment, everywhere at once.
#
#   bash contracts/script/adopt-deployment.sh <renderer> <token> <deploy-block>
#   bash contracts/script/adopt-deployment.sh --chain 8453 <renderer> <token> <deploy-block>
#
# --chain says which chain the deploy block belongs to; the default is Base
# Sepolia (84532). It used to be Sepolia-only by construction: the Clock's
# DEPLOY_BLOCK was rewritten with a pattern that matched `{ 84532: ... }` and
# nothing else, so a MAINNET adoption would have failed at exactly the step
# that keeps the Clock from mis-running (found 2026-09-15). That step is now
# set-deploy-block.sh, which keeps every other chain's entry.
#
# WHY ONE SCRIPT RATHER THAN A CHECKLIST. The address is in nine places across
# five kinds of file -- served copy, the reference copy inside the skill, a
# rendered HTML, two operator tools, the Clock's start block and the project
# record -- and they are not all obvious. Two of them (protocol-transcript.mjs
# and x402-live-mint-check.mjs) rotted unnoticed through an earlier redeploy
# because nothing named them. A checklist is only as good as the person reading
# it at the end of a deploy; this refuses to half-finish.
#
# THE OLD ADDRESSES ARE READ FROM WHAT IS CURRENTLY PUBLISHED, not hardcoded
# here, so this script cannot itself go stale.
#
# It edits files. It sends nothing and restarts nothing. Its only chain access
# is one READ, on a Base Sepolia adoption: the deploy block's timestamp, for the
# date in CLAUDE.md.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PATH="$HOME/.foundry/bin:$PATH"

CHAIN=84532
if [ "${1:-}" = "--chain" ]; then
  CHAIN="${2:?--chain needs a chain id}"
  shift 2
fi
case "$CHAIN" in
  84532|8453) ;;
  *) echo "FAIL: --chain must be 84532 (Base Sepolia) or 8453 (Base mainnet), got '$CHAIN'" >&2; exit 1 ;;
esac

NEW_REN="${1:?renderer address}"
NEW_TOK="${2:?token address}"
NEW_BLOCK="${3:?deploy block number}"

LLMS=warden/public/llms.txt
PROTO=docs/2026-09-01-mro-raw-protocol.md
SKILL_COPY=skills/machine-readable-only/references/raw-protocol.md

# EIP-55 OR NOTHING. An address that is merely 40 hex characters carries no
# checksum, so a single mistyped digit produces a well-formed address that
# every one of these files would then publish to agents. Same rule the Warden
# applies to TREASURY_ADDRESS at boot, and for the same reason.
for a in "$NEW_REN" "$NEW_TOK"; do
  if [ "$a" != "$(cast to-check-sum-address "$a")" ]; then
    echo "FAIL: $a is not in EIP-55 checksummed form -- refusing to publish it" >&2
    echo "      the checksummed form is $(cast to-check-sum-address "$a")" >&2
    exit 1
  fi
done
case "$NEW_BLOCK" in
  ''|*[!0-9]*) echo "FAIL: deploy block '$NEW_BLOCK' is not a plain number" >&2; exit 1 ;;
esac

# What is published today. The token comes off the served copy and the renderer
# off the protocol document, because those are the two files an agent reads.
OLD_TOK=$(/bin/grep -oE '0x[0-9a-fA-F]{40}' "$LLMS" | head -1)
OLD_REN=$(/bin/grep -A2 '^ *Renderer:' "$PROTO" | /bin/grep -oE '0x[0-9a-fA-F]{40}' | head -1)
if [ -z "$OLD_TOK" ] || [ -z "$OLD_REN" ]; then
  echo "FAIL: could not find the addresses currently published -- read $LLMS and $PROTO by hand" >&2
  exit 1
fi
# RE-RUNNABLE, DELIBERATELY. This used to `exit 0` here whenever the served
# copy already named the new token, on the reasoning that the work was done.
# It is not the same statement: under `set -e` a failure anywhere after the
# first `sed` -- most likely the render at the end, which shells out to npx --
# leaves the addresses rewritten and the HTML stale, and the early exit then
# made a re-run a silent no-op. Half a rename that reports success is the exact
# drift class this repository has already shipped once.
#
# So the address pass is skipped only when there is genuinely nothing to
# rewrite, and EVERY later step runs regardless. All of them are idempotent: a
# sed whose pattern no longer matches changes nothing, `cp` is a copy either
# way, and the renderer overwrites its output. Re-running after any failure
# therefore converges rather than stalling.
if [ "$OLD_TOK" = "$NEW_TOK" ] && [ "$OLD_REN" = "$NEW_REN" ]; then
  echo "addresses already published; completing the remaining steps"
  REWRITE=no
else
  REWRITE=yes
  echo "superseding"
  echo "  token     $OLD_TOK  ->  $NEW_TOK"
  echo "  renderer  $OLD_REN  ->  $NEW_REN"
  echo "  block                   $NEW_BLOCK"
fi
echo

# THE FILES THAT NAME THE DEPLOYMENT, and what each one is.
#
#   llms.txt              served to agents at the door
#   raw-protocol.md       the agent-facing protocol document
#   raw-protocol.html     its rendered form, re-rendered below
#   agent-facing-copy     the locked copy this is all drawn from, .md and .html
#   protocol-transcript   the tool that CAPTURES the protocol document
#   x402-live-mint-check  the live payment check
#   CLAUDE.md             the project record
#
# NOT in this list, deliberately: warden/test/chain-read.test.mjs and the specs,
# plans and task reports. Those state where a frozen fixture came from or what
# was true on a given day. Rewriting a historical record to name a contract that
# did not exist yet would be a lie, not an update.
FILES=(
  "$LLMS"
  "$PROTO"
  docs/2026-09-01-mro-agent-facing-copy.md
  docs/2026-09-01-mro-agent-facing-copy.html
  warden/tools/protocol-transcript.mjs
  warden/tools/x402-live-mint-check.mjs
  CLAUDE.md
)

# FILES THAT MAY NAME EACH ADDRESS ONLY ONCE.
#
# On 2026-09-07 this script rewrote a HISTORICAL paragraph in CLAUDE.md, leaving
# the 2026-09-06 record naming the 2026-09-07 pair at the old block. The operator restored
# it by hand. The cause was structural: CLAUDE.md held live statements AND dated
# history in one file, and a blanket `sed` cannot tell them apart.
#
# CLAUDE.md was trimmed on 2026-09-10 so it now names the CURRENT pair exactly
# once and carries no deploy history at all -- the history lives in auto-memory
# and in git. This guard keeps it that way: more than one occurrence means a
# historical record has crept back in, and rewriting it would falsify it. Fail
# loudly rather than corrupt the record.
SINGLE_ADDRESS_FILES=(CLAUDE.md)

if [ "$REWRITE" = yes ]; then
  for f in "${SINGLE_ADDRESS_FILES[@]}"; do
    for addr in "$OLD_TOK" "$OLD_REN"; do
      n=$(/bin/grep -c "$addr" "$f" || true)
      if [ "$n" -gt 1 ]; then
        echo "REFUSING: $f names $addr $n times; it may name it at most once." >&2
        echo "  A second occurrence is almost certainly a dated historical record." >&2
        echo "  Rewriting it would state that an old deploy used the new address." >&2
        echo "  Move the history to auto-memory, leave the live line, then re-run." >&2
        exit 1
      fi
    done
  done

  for f in "${FILES[@]}"; do
    before=$(/bin/grep -c "$OLD_TOK\|$OLD_REN" "$f" || true)
    sed -i "s/$OLD_TOK/$NEW_TOK/g; s/$OLD_REN/$NEW_REN/g" "$f"
    echo "  $f: $before reference(s) updated"
  done
fi

# WHAT IS ACTUALLY TRUE ON DISK, checked rather than assumed. A partial run that
# rewrote some files and died leaves the rest carrying the old address, and the
# loop above cannot see that on a re-run because OLD_TOK is read from a file it
# already fixed. This says so instead of reporting success over it.
stale=0
for f in "${FILES[@]}"; do
  if /bin/grep -q "$NEW_TOK" "$f" || /bin/grep -q "$NEW_REN" "$f"; then continue; fi
  echo "  WARNING: $f names neither new address -- check it by hand" >&2
  stale=$((stale + 1))
done

# The Clock reads DEPLOY_BLOCK at STARTUP and refuses without one for its chain,
# so a redeploy that forgets this stops the Clock rather than mis-running it.
# set-deploy-block.sh writes THIS chain's entry, keeps every other chain's,
# asserts the result rather than assuming it, and is tested on its own
# (warden/test/set-deploy-block.test.mjs).
bash contracts/script/set-deploy-block.sh "$CHAIN" "$NEW_BLOCK" warden/src/clock/reconcile.mjs

# AND THE TEST THAT PINS IT. clock-reconcile.test.mjs asserts the Base Sepolia
# block as a LITERAL on purpose -- it is the thing that fails when a redeploy
# happens and nobody updates the floor, which would otherwise read as a quiet
# chain rather than a misconfiguration. But this script claims to change the
# deployment "everywhere at once", and on 2026-09-22 it left that pin behind:
# an otherwise clean adoption ended with the warden suite red.
#
# THE GROUPED LITERAL IS READ BACK FROM THE FILE set-deploy-block.sh JUST
# WROTE, not re-derived here. The first attempt formatted the digits with
# `sed ':a;s/\B[0-9]\{3\}\>/_&/;ta'` and HUNG: an underscore is a word
# character, so \B still matches after the first insertion and the loop never
# terminates. One source for the formatting means there is no second place for
# it to be wrong.
#
# Only the Base Sepolia pin moves, and only on a Base Sepolia adoption. The
# literals in set-deploy-block.test.mjs are scratch INPUTS to the rewriter, not
# records of a deployment, and must not move.
if [ "$CHAIN" = "84532" ]; then
  PIN=warden/test/clock-reconcile.test.mjs
  GROUPED="$(sed -n 's|.*84532: \([0-9_]*\)n.*|\1|p' warden/src/clock/reconcile.mjs | head -1)"
  if [ -z "$GROUPED" ]; then
    echo "FAIL: could not read the grouped block back from reconcile.mjs" >&2
    exit 1
  fi
  sed -i "s|assert.equal(DEPLOY_BLOCK\[84532\], [0-9_]*n);|assert.equal(DEPLOY_BLOCK[84532], ${GROUPED}n);|" "$PIN"
  if ! /bin/grep -q "assert.equal(DEPLOY_BLOCK\[84532\], ${GROUPED}n);" "$PIN"; then
    echo "FAIL: could not rewrite the deploy-block pin in $PIN" >&2
    exit 1
  fi
  echo "  $PIN: deploy-block pin updated to ${GROUPED}"

  # AND THE BLOCK AND DATE IN CLAUDE.md. The address pass above rewrote the
  # addresses there but never the line under them, so the 2026-09-22 redeploy
  # left the old pair's block beside the new address (found 2026-09-23).
  # The date is the deploy block's own timestamp, read from the chain, not
  # today's date: adoption can run days after the deploy.
  TS="$(cast block "$NEW_BLOCK" -f timestamp --rpc-url https://sepolia.base.org)"
  if [ -z "$TS" ]; then
    echo "FAIL: could not read block $NEW_BLOCK's timestamp from Base Sepolia" >&2
    exit 1
  fi
  bash contracts/script/set-record-block.sh "$NEW_BLOCK" "$(date -u -d "@$TS" +%F)" CLAUDE.md
else
  # CLAUDE.md's live-deployment paragraph is written about Base Sepolia. A
  # mainnet adoption changes what that paragraph is ABOUT, which a rewrite of
  # one line cannot do honestly.
  echo "  NOTE: CLAUDE.md's live-deployment paragraph describes Base Sepolia -- rewrite it by hand for mainnet"
fi

# THE SKILL'S COPY IS A COPY, byte for byte. It is the same document reaching
# agents by a second route, and a skill that quotes a different address from the
# served document is worse than a skill with no address at all.
cp "$PROTO" "$SKILL_COPY"
if ! diff -q "$PROTO" "$SKILL_COPY" >/dev/null; then
  echo "FAIL: the skill's copy did not come out identical" >&2
  exit 1
fi
echo "  $SKILL_COPY: re-copied, byte-identical"

# And the rendered form, because the operator reads the HTML.
node "$HOME/scripts/render-md-to-html.js" "$PROTO"

if [ "$stale" -ne 0 ]; then
  echo
  echo "FAIL: $stale file(s) above name neither new address. Every other step has" >&2
  echo "      been completed, so fixing those and re-running this is safe." >&2
  exit 1
fi

echo
echo "Left for you, in order:"
echo "  1. REHEARSE FIRST, before pm2 goes near this:"
echo "       REHEARSE_OVERRIDE=\"MRO_CONTRACT_ADDRESS=$NEW_TOK\" bash warden/tools/rehearse-start.sh"
echo "  2. Point the Warden's environment at the new pair -- no hand editing:"
echo "       bash warden/tools/set-contract-address.sh $NEW_TOK"
echo "  3. Snapshot the mirror:"
echo "       cd warden && node tools/mirror-snapshot.mjs ~/backups/state.db.pre-reset.\$(date -u +%Y%m%dT%H%M%SZ)"
echo "  4. CLEAR THE MIRROR'S CHAIN ROWS. Every token, mint, credit and Mark"
echo "     order in it belongs to the OLD contract, and the mint path reads"
echo "     them: a returning agent is told \"already-minted\" for a token this"
echo "     pair has never heard of. Found the hard way on 2026-09-22, by a mint"
echo "     refused against a contract that held no tokens at all."
echo "       cd warden && node tools/mirror-reset-chain.mjs state.db --yes"
echo "     Registered KEYS are kept -- door state, not chain state."
echo "  5. pm2 restart mro-warden"
echo "  6. Verify THROUGH CLOUDFLARE, not against localhost:"
echo "       curl -s https://machinereadableonly.com/llms.txt | /bin/grep $NEW_TOK"
echo "  7. Check all four suites, then commit."
