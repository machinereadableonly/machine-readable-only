#!/usr/bin/env bash
#
# Move any environment-file backups out of the git worktree, and drop the one
# that is a duplicate of the current value.
#
#   bash warden/deploy/relocate-env-backups.sh
#
# WHY. set-contract-address.sh originally wrote its backup beside the file it
# copied, which is inside the repository. That is the exact shape that put a
# CHALLENGE_SECRET into git on 2026-09-03: the ignore rule held, but the fix is
# that the file is never in the tree to be added. The script has been corrected;
# this clears what the old version left behind.
#
# Prints no value from any file.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
DEST="$HOME/backups"
mkdir -p "$DEST"

shopt -s nullglob
found=0
for f in ./.env.bak.*; do
  found=1
  base="warden-env.bak.${f##*.bak.}"
  if cmp -s "$f" ./.env; then
    # Identical to the live file, so it restores nothing: it is a record of a
    # no-op run, not a rollback point.
    rm -f "$f"
    echo "removed  $f  (identical to the current file, so it is not a rollback point)"
  else
    mv "$f" "$DEST/$base"
    chmod 600 "$DEST/$base"
    echo "moved    $f  ->  ~/backups/$base"
  fi
done

[ "$found" = 1 ] || echo "nothing to do: no environment backups in the worktree"

echo
echo "worktree now holds:"
ls -1 ./.env* 2>/dev/null | sed 's/^/  /'
