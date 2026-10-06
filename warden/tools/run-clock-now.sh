#!/usr/bin/env bash
# Run the Clock once, NOW, the way its timer runs it.
#
#   bash warden/tools/run-clock-now.sh
#
# For when 00:05 UTC is not soon enough -- a paid mint waiting to land, or a
# test that needs the chain to catch up. A second run in one UTC day is safe
# by design: every write is chosen from rows still queued, check-ins only for
# days that have closed, and the Clock's own lock refuses a concurrent run.
#
# After the cutover (DEPLOY.md section 12) the Clock is the system unit run as
# mro-clock, with its own env file and log, so this starts that unit. Before
# it, the Clock is the main user's, and this runs it the way that user unit
# did, minus its sandboxing and logrotate pre-step. Prints no configuration.
set -euo pipefail

if [ "$(systemctl is-enabled mro-clock.timer 2>/dev/null || true)" = enabled ]; then
  echo "clock: starting mro-clock.service; the run logs to /var/log/mro/clock.log"
  exec sudo systemctl start mro-clock.service
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# shellcheck source=/dev/null
. "$HOME/.nvm/nvm.sh" >/dev/null

LOG="$HOME/logs/mro-clock.log"
echo "clock: manual run requested $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
node --env-file=.env src/clock/main.mjs >> "$LOG" 2>&1
