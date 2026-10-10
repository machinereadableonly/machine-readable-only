#!/usr/bin/env bash
# Build the Clock's installed tree from one commit, owning nothing of the
# working checkout.
#
#   bash build-clock-tree.sh <repo> <commit> <dest> <node-version> [<bundle-maker>]
#
# install-clock-user.sh runs it as root. It runs as anyone too, which is how it
# is rehearsed.
#
# - The code comes from <commit> through a git bundle, so git checks every
#   object against its hash: nothing the checkout's owner changed after that
#   commit reaches <dest>. <bundle-maker> is the command prefix that writes the
#   bundle (the installer passes `sudo -u <owner>`), so root never runs git
#   inside a repository someone else controls.
# - Node is downloaded from nodejs.org and checked against the SHA-256 the
#   release publishes.
# - Dependencies are installed with `npm ci --ignore-scripts` from the
#   commit's own lockfile, so each package is checked against its integrity
#   hash and none runs an install script.
# - Any symlink resolving outside <dest> is refused.
set -euo pipefail

REPO="${1:?repo}"
COMMIT="${2:?commit}"
DEST="${3:?dest}"
NODE_VERSION="${4:?node version, e.g. v24.14.1}"
MAKER="${5:-}"

die() { printf 'build-clock-tree: %s\n' "$1" >&2; exit 1; }
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "the commit must be a full 40-character sha"
[[ "$NODE_VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "the node version must look like v24.14.1"
[ ! -e "$DEST" ] || die "$DEST already exists"
mkdir -p "$DEST"
built=0
trap '[ "$built" -eq 1 ] || rm -rf "$DEST"' EXIT

# 1. The commit, through a bundle written by the repository's owner.
BUNDLE_DIR="$($MAKER mktemp -d)"
$MAKER /usr/bin/git -C "$REPO" bundle create "$BUNDLE_DIR/clock.bundle" HEAD >/dev/null 2>&1 \
  || die "could not bundle $REPO"
SRC="$DEST/src"
/usr/bin/git init --quiet "$SRC"
/usr/bin/git -C "$SRC" fetch --quiet "$BUNDLE_DIR/clock.bundle" HEAD || die "could not read the bundle"
$MAKER rm -rf "$BUNDLE_DIR"
/usr/bin/git -C "$SRC" -c advice.detachedHead=false checkout --quiet "$COMMIT" \
  || die "commit $COMMIT is not in $REPO's history"
[ "$(/usr/bin/git -C "$SRC" rev-parse HEAD)" = "$COMMIT" ] || die "checked out the wrong commit"

mkdir -p "$DEST/warden" "$DEST/bin"
cp -a "$SRC/warden/src" "$SRC/warden/deploy" "$SRC/warden/package.json" "$SRC/warden/package-lock.json" "$DEST/warden/"
rm -rf "$SRC"

# 2. Node, checked against the release's published SHA-256.
TARBALL="node-$NODE_VERSION-linux-x64.tar.xz"
DL="$DEST/node-download"
mkdir -p "$DL"
curl -fsSL --proto '=https' "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$DL/SHASUMS256.txt" \
  || die "could not fetch Node's checksums"
curl -fsSL --proto '=https' "https://nodejs.org/dist/$NODE_VERSION/$TARBALL" -o "$DL/$TARBALL" \
  || die "could not fetch $TARBALL"
( cd "$DL" && /bin/grep " $TARBALL\$" SHASUMS256.txt | sha256sum -c --quiet - ) \
  || die "$TARBALL does not match its published SHA-256"
tar -xJf "$DL/$TARBALL" -C "$DL"
NODE_HOME="$DL/node-$NODE_VERSION-linux-x64"
install -m 755 "$NODE_HOME/bin/node" "$DEST/bin/node"

# 3. Dependencies from the commit's lockfile, with no install scripts.
( cd "$DEST/warden" && PATH="$NODE_HOME/bin:$PATH" npm ci --ignore-scripts --omit=dev --no-audit --no-fund >/dev/null ) \
  || die "npm ci failed"
rm -rf "$DL"

# 4. No link may lead out of the tree.
while IFS= read -r -d '' link; do
  target="$(readlink -f "$link")"
  case "$target" in "$DEST"/*) ;; *) die "a symlink leads out of the tree: ${link#"$DEST"/}" ;; esac
done < <(find "$DEST" -type l -print0)

built=1
echo "build-clock-tree: $DEST built from $COMMIT with node $NODE_VERSION"
