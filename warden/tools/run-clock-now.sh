#!/usr/bin/env bash
# Run the Clock once, NOW, the way its systemd unit runs it: the same working
# directory, the same configuration file loaded by node itself, the same log.
#
#   bash warden/tools/run-clock-now.sh
#
# For when 00:05 UTC is not soon enough -- a paid mint waiting to land, or a
# test that needs the chain to catch up. A second run in one UTC day is safe
# by design: every write is chosen from rows still queued, check-ins only for
# days that have closed, and the Clock's own lock refuses a concurrent run.
#
# Nothing here reads or prints the configuration file; the key reaches only the
# process that signs with it. What systemd adds and this does not: the unit's
# sandboxing (ProtectSystem, MemoryMax=1G) and the logrotate pre-step.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh" >/dev/null

LOG="$HOME/logs/mro-clock.log"
echo "clock: manual run requested $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
node --env-file=.env src/clock/main.mjs >> "$LOG" 2>&1
