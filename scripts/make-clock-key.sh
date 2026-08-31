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

ENV_FILE="$HOME/projects/machine-readable-only/warden/.env"
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

if grep -q '^CLOCK_PRIVATE_KEY=' "$ENV_FILE"; then
  echo "A CLOCK_PRIVATE_KEY is already set in $ENV_FILE -- refusing to replace it."
  echo "Its address is:"
  # Read the key into a variable and hand it to cast on stdin. It is never
  # echoed, and never becomes a command-line argument (which would be visible
  # to anyone running `ps` while this runs).
  CLOCK_KEY="$(grep '^CLOCK_PRIVATE_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
  cast wallet address --private-key "$CLOCK_KEY"
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
} >> "$ENV_FILE"

chmod 600 "$ENV_FILE"
unset PRIVATE NEW

echo "Wrote CLOCK_PRIVATE_KEY to $ENV_FILE (mode 600)."
echo ""
echo "The Clock's address is:"
echo "  $ADDRESS"
echo ""
echo "Tell Claude that address. It is public -- it is safe to paste anywhere."
echo "Claude will fund it with testnet ETH and point the contract's warden at it."
