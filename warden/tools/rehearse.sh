#!/usr/bin/env bash
# Run the Clock rehearsal against Base Sepolia with the real key.
#
#   cd warden && bash tools/rehearse.sh <bitmap-hex-file> [tokenId]
#
# The wrapper exists so the configuration file is loaded by node itself, exactly
# as the systemd unit does it. Nothing here reads or prints the file, and the
# key reaches only the process that needs to sign with it.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node --env-file=.env tools/clock-rehearsal.mjs "$@"
