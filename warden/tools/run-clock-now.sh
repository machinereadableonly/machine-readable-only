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
# The Clock runs only as the system unit, as mro-clock with its own env file
# (DEPLOY.md section 12). There is no fallback that runs it as the main user.
set -euo pipefail

if ! systemctl cat mro-clock.service >/dev/null 2>&1; then
  echo "clock: mro-clock.service is not installed; see DEPLOY.md section 12" >&2
  exit 1
fi
echo "clock: starting mro-clock.service; the run logs to /var/log/mro/clock.log"
exec sudo systemctl start mro-clock.service
