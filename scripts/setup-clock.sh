#!/usr/bin/env bash
# One command that gets the Warden and the Clock ready to run on Base Sepolia.
#
# It does two things, each skipped if already done:
#
#   1. Creates warden/.env, filled in for Base Sepolia, with a freshly
#      generated CHALLENGE_SECRET.
#   2. Generates the Clock's signing key into that file (scripts/make-clock-key.sh).
#
# WHY THIS IS A SCRIPT YOU RUN RATHER THAN SOMETHING CLAUDE DOES. Two separate
# reasons, and only the first is a rule:
#
#   - The project's secrets rule blocks Claude from writing to a real .env at
#     all. That block is deliberate and is not lifted by permission.
#   - A private key printed in a terminal Claude can read is a key that lands in
#     a session transcript, and transcripts get backed up and pasted. Generating
#     it here means the secret half exists in exactly one place: this file, at
#     mode 600.
#
# Run it:
#   bash ~/projects/machine-readable-only/scripts/setup-clock.sh
#
# Safe to run again. It never overwrites an existing value.
set -euo pipefail

# EVERY FILE THIS SCRIPT CREATES IS OWNER-ONLY FROM THE MOMENT IT EXISTS.
# `cat >` creates at 0666 & ~umask, which on this box is 664, so the old order
# -- write the CHALLENGE_SECRET, then chmod 600 -- left the HMAC key behind the
# entry challenge group-readable for the length of the write. Setting the umask
# here closes that window instead of narrowing it, and applies to the key
# written by make-clock-key.sh below as well.
umask 077

# Overridable ONLY so this script can be exercised against a scratch copy
# before it is ever pointed at the real one. Defaults to the real project.
PROJECT="${MRO_PROJECT_DIR:-$HOME/projects/machine-readable-only}"
ENV_FILE="$PROJECT/warden/.env"
export PATH="$HOME/.foundry/bin:$PATH"

if [ ! -f "$ENV_FILE" ]; then
  echo "Creating $ENV_FILE for Base Sepolia..."

  # 32 random bytes, base64. This is a real secret -- it is the HMAC key behind
  # the 5-second entry challenge -- so it is generated here rather than being
  # a value anyone typed or pasted.
  CHALLENGE="$(openssl rand -base64 32)"

  cat > "$ENV_FILE" <<ENVEOF
# The Warden's configuration, for BASE SEPOLIA (testnet).
# Created $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/setup-clock.sh.
# Never committed. chmod 600. Claude does not read this file.

# The public hostname the piece is served from, no scheme.
# STILL A PLACEHOLDER: there is no domain yet, and example.com is what the QR
# payloads already encode. Change this and re-solve the bitmaps once a real
# domain exists -- a token's code is written once and is permanent.
MRO_DOMAIN=example.com

# HMAC secret for the stateless entry challenge. Generated above.
CHALLENGE_SECRET=$CHALLENGE

# Read-only Base RPC endpoint. LOAD-BEARING FOR EVERY WRITE: the tools read the
# contract's own gates (sunset, pause, resting, wallet cap) through it, and the
# Clock cannot write without it. A public endpoint is fine to start; if refusals
# show up in the logs, this is the thing to upgrade.
BASE_RPC_URL=https://sepolia.base.org

# The deployed token contract (the fixed build, verified 2026-08-30).
MRO_CONTRACT_ADDRESS=0xfA6D76270e0A9A4f5048F5acC31E1F9F360F4D1D

# 84532 is Base Sepolia; 8453 is Base mainnet. This also decides where payment
# is taken -- the x402 network is derived from it -- so a price is always quoted
# on the chain the token lives on.
MRO_CHAIN_ID=84532

# Where USDC is received. PLACEHOLDER, pending a real treasury address.
# main.mjs REFUSES TO START with this value on any chain but Base Sepolia,
# because USDC settled to it is unrecoverable.
TREASURY_ADDRESS=0x000000000000000000000000000000000000dEaD

# The x402 facilitator. This testnet one needs no API key and supports Base
# Sepolia only. Mainnet is https://api.cdp.coinbase.com/platform/v2/x402 and
# needs a CDP API key.
X402_FACILITATOR_URL=https://x402.org/facilitator

# Where the mirror lives on disk.
STATE_DB_PATH=$PROJECT/warden/state.db
ENVEOF

  chmod 600 "$ENV_FILE"
  unset CHALLENGE
  echo "Created it, mode 600, with a freshly generated CHALLENGE_SECRET."
else
  echo "$ENV_FILE already exists -- leaving it exactly as it is."
fi

echo ""
bash "$PROJECT/scripts/make-clock-key.sh"

echo ""
echo "----------------------------------------------------------------"
echo "Two values in that file are PLACEHOLDERS you may want to change:"
echo ""
echo "  MRO_DOMAIN        example.com  (no real domain yet)"
echo "  TREASURY_ADDRESS  0x...dEaD    (no real treasury yet)"
echo ""
echo "Both are safe on Base Sepolia. The Warden refuses to start with that"
echo "treasury on any other chain, so neither can reach mainnet by accident."
echo "Edit them in WinSCP whenever you have the real values."
