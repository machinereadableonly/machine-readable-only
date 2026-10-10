#!/usr/bin/env bash
# Point the Warden at a different deployed contract. One implementation lives
# in warden/tools/set-contract-address.sh; this name forwards to it.
#
#   bash warden/deploy/set-contract-address.sh 0x<address>
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/../tools/set-contract-address.sh" "$@"
