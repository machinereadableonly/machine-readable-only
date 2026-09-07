#!/usr/bin/env bash
#
# Point this repository at a NEW Base Sepolia deployment, everywhere at once.
#
#   bash contracts/script/adopt-deployment.sh <renderer> <token> <deploy-block>
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
# It edits files. It sends nothing, restarts nothing and touches no chain.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export PATH="$HOME/.foundry/bin:$PATH"

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
if [ "$OLD_TOK" = "$NEW_TOK" ]; then
  echo "Nothing to do: $NEW_TOK is already the published token address."
  exit 0
fi

echo "superseding"
echo "  token     $OLD_TOK  ->  $NEW_TOK"
echo "  renderer  $OLD_REN  ->  $NEW_REN"
echo "  block                   $NEW_BLOCK"
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

for f in "${FILES[@]}"; do
  before=$(/bin/grep -c "$OLD_TOK\|$OLD_REN" "$f" || true)
  sed -i "s/$OLD_TOK/$NEW_TOK/g; s/$OLD_REN/$NEW_REN/g" "$f"
  echo "  $f: $before reference(s) updated"
done

# The Clock reads DEPLOY_BLOCK at STARTUP and refuses without one for its chain,
# so a redeploy that forgets this stops the Clock rather than mis-running it.
# The number is grouped the way the file already writes it.
GROUPED=$(echo "$NEW_BLOCK" | sed -E ':a;s/([0-9])([0-9]{3})(_|$)/\1_\2\3/;ta')
sed -i -E "s/^export const DEPLOY_BLOCK = \{ 84532: [0-9_]+n \};/export const DEPLOY_BLOCK = { 84532: ${GROUPED}n };/" \
  warden/src/clock/reconcile.mjs
/bin/grep -n "^export const DEPLOY_BLOCK" warden/src/clock/reconcile.mjs

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

echo
echo "Left for you, in order:"
echo "  1. REHEARSE FIRST, before pm2 goes near this:"
echo "       REHEARSE_OVERRIDE=\"MRO_CONTRACT_ADDRESS=$NEW_TOK\" bash warden/tools/rehearse-start.sh"
echo "  2. Set MRO_CONTRACT_ADDRESS=$NEW_TOK in warden/.env (WinSCP; never printed here)"
echo "  3. cp warden/state.db ~/backups/state.db.\$(date -u +%Y%m%dT%H%M%SZ)"
echo "  4. pm2 restart mro-warden"
echo "  5. Verify THROUGH CLOUDFLARE, not against localhost:"
echo "       curl -s https://machinereadableonly.com/llms.txt | /bin/grep $NEW_TOK"
echo "  6. Check all four suites, then commit."
