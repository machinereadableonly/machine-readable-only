#!/bin/bash
# Point git at the repository's tracked hooks.
#
# `core.hooksPath` is LOCAL config: it is not tracked, so it does not travel
# with a clone. Run this once per clone, or the pre-push guard sits in the
# repository doing nothing -- which is exactly the failure it was written to
# prevent.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

chmod +x .githooks/*
git config core.hooksPath .githooks

echo "hooks installed: core.hooksPath = $(git config core.hooksPath)"
echo
echo "the pre-push guard now runs on every push from this clone."
echo "verify with:  git config core.hooksPath"
