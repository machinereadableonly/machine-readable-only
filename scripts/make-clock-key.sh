#!/usr/bin/env bash
# Generate the Clock's signing key, straight into the Warden's environment file.
#
# WHY THIS IS A SCRIPT AND NOT SOMETHING CLAUDE RUNS FOR YOU. A private key that
# appears in a terminal Claude can read is a key that lands in a session
# transcript, and transcripts get backed up, pasted and shared. This writes the
# secret half directly to disk and prints only the public address, so the key
# exists in exactly one place.
#
# It is also why Claude cannot simply do this: the project's secrets rule blocks
# it from writing to a real .env at all.
#
# Run it once:
#   bash ~/projects/machine-readable-only/scripts/make-clock-key.sh
#
# Safe to run again: it refuses rather than overwriting an existing key, because
# overwriting one whose address is already set as the contract's warden would
# lock the Clock out of its own contract until setWarden was called again.
set -euo pipefail

# Overridable ONLY so this can be exercised against a scratch copy first.
PROJECT="${MRO_PROJECT_DIR:-$HOME/projects/machine-readable-only}"
ENV_FILE="$PROJECT/warden/.env"
DERIVE="$PROJECT/warden/tools/derive-address.mjs"
export PATH="$HOME/.foundry/bin:$PATH"

if ! command -v cast >/dev/null 2>&1; then
  echo "ERROR: foundry's 'cast' is not on PATH. Expected it at ~/.foundry/bin." >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE does not exist yet." >&2
  echo "Create it first from warden/.env.example (WinSCP), then run this again." >&2
  exit 1
fi

# TIGHTEN THE MODE BEFORE ANYTHING IS WRITTEN, not after. A file freshly
# uploaded by WinSCP arrives 644 under the default umask, and appending the key
# first would leave it world-readable for as long as the write took. Doing it
# here covers every path below, including the backfill.
chmod 600 "$ENV_FILE"

# Read one variable out of the environment file. Never echoes what it found.
read_var() {
  grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-
}

# "Set" means "has a value". warden/.env.example carries both of these names
# with EMPTY values, so a file copied from it would satisfy a bare
# `grep '^CLOCK_PRIVATE_KEY='` and send this script down the wrong branch --
# refusing to generate a key that does not exist, then trying to derive an
# address from an empty string.
has_value() {
  grep -q "^$1=." "$ENV_FILE"
}

if has_value CLOCK_PRIVATE_KEY; then
  echo "A CLOCK_PRIVATE_KEY is already set in $ENV_FILE -- refusing to replace it."

  if has_value CLOCK_ADDRESS; then
    # THE ORDINARY PATH. The address is public and was recorded when the key was
    # generated, so answering "which address is this" costs nothing and touches
    # no secret.
    echo "Its address is:"
    echo "  $(read_var CLOCK_ADDRESS)"
    exit 0
  fi

  # THE BACKFILL, which runs at most once: this key predates CLOCK_ADDRESS being
  # recorded, so the address has to be derived from it one final time. The key
  # goes to the deriving process on STDIN and never becomes a command-line
  # argument -- /proc/<pid>/cmdline is readable by every local user, which is a
  # wider boundary than the 0600 file above.
  echo "This key predates CLOCK_ADDRESS being recorded. Deriving it once..."

  # Non-interactive shells have no node on PATH; nvm puts it there.
  if ! command -v node >/dev/null 2>&1; then
    # shellcheck disable=SC1090
    [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"
  fi
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is not on PATH and ~/.nvm/nvm.sh did not provide it." >&2
    exit 1
  fi

  ADDRESS="$(read_var CLOCK_PRIVATE_KEY | node "$DERIVE")"

  {
    echo ""
    echo "# The Clock's public address, derived from the key above and recorded"
    echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) so nothing ever has to read the key to"
    echo "# answer 'which address is this'. Public: safe to paste anywhere."
    echo "CLOCK_ADDRESS=$ADDRESS"
  } >> "$ENV_FILE"

  echo "Recorded it. Future runs will not touch the key at all."
  echo ""
  echo "The Clock's address is:"
  echo "  $ADDRESS"
  exit 0
fi

# `cast wallet new` prints an address and a private key. Capture both, write the
# secret straight to the file, and let only the address reach the terminal.
NEW="$(cast wallet new)"
ADDRESS="$(printf '%s\n' "$NEW" | grep -i '^Address:' | awk '{print $2}')"
PRIVATE="$(printf '%s\n' "$NEW" | grep -i '^Private key:' | awk '{print $3}')"

if [ -z "$ADDRESS" ] || [ -z "$PRIVATE" ]; then
  echo "ERROR: could not parse 'cast wallet new' output. Nothing was written." >&2
  exit 1
fi

{
  echo ""
  echo "# The Clock's signer. Holds ONLY gas ETH and has only warden powers:"
  echo "# mint, batchCheckIn, applyMark, seed. It is deliberately NOT the"
  echo "# contract owner, so a compromised Clock cannot sunset the piece,"
  echo "# swap the renderer, or transfer ownership."
  echo "# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/make-clock-key.sh."
  echo "CLOCK_PRIVATE_KEY=$PRIVATE"
  echo "# The same key's public address, recorded here so that re-running this"
  echo "# script never has to read the secret half back. Safe to paste anywhere."
  echo "CLOCK_ADDRESS=$ADDRESS"
} >> "$ENV_FILE"

unset PRIVATE NEW

echo "Wrote CLOCK_PRIVATE_KEY to $ENV_FILE (mode 600)."
echo ""
echo "The Clock's address is:"
echo "  $ADDRESS"
echo ""
echo "Tell Claude that address. It is public -- it is safe to paste anywhere."
echo "Claude will fund it with testnet ETH and point the contract's warden at it."
