#!/usr/bin/env bash
# Prove a Mark lands on chain, with the real key. (Its sibling tools/rehearse.sh
# was retired on 2026-09-15; for the mainnet path see mainnet-fork-rehearsal.sh.)
#
#   cd warden && bash tools/mark-rehearse.sh <bitmap-hex-file> [tokenId]
#
# The wrapper exists so the configuration file is loaded by node itself, exactly
# as the systemd unit does it. Nothing here reads or prints the file, and the
# key reaches only the process that needs to sign with it.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --env-file=.env tools/mark-rehearsal.mjs "$@"
