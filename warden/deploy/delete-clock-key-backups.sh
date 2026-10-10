#!/usr/bin/env bash
# Deletes every settings backup that still holds a Clock private key, so the
# Clock installer stops refusing. Finds files by the installer's own rule and
# prints names only, never a value.
#
#   bash warden/deploy/delete-clock-key-backups.sh            # list, then ask
#   bash warden/deploy/delete-clock-key-backups.sh --dry-run  # list only
set -euo pipefail

DRY=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY=1 ;;
  *) echo "usage: delete-clock-key-backups.sh [--dry-run]" >&2; exit 2 ;;
esac

# Same search as install-clock-user.sh, so "none left" here means it passes.
find_left() {
  /bin/grep -rlE '^CLOCK_PRIVATE_KEY=.' "$HOME/.mro-env-backups" "$HOME/backups" 2>/dev/null || true
}

mapfile -t FILES < <(find_left)
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "Nothing to delete: no backup holds a Clock key."
  exit 0
fi

echo "These ${#FILES[@]} file(s) hold a Clock private key:"
for f in "${FILES[@]}"; do echo "  $f"; done

if [ "$DRY" -eq 1 ]; then
  echo "Dry run: nothing deleted."
  exit 0
fi

printf '\nType delete to remove them for good: '
read -r answer
[ "$answer" = "delete" ] || { echo "Not deleted."; exit 1; }

for f in "${FILES[@]}"; do rm -f -- "$f"; echo "deleted  $f"; done

mapfile -t LEFT < <(find_left)
if [ "${#LEFT[@]}" -ne 0 ]; then
  echo "FAILED: still holding a Clock key:"
  for f in "${LEFT[@]}"; do echo "  $f"; done
  exit 1
fi
echo "Done: no backup holds a Clock key now."
