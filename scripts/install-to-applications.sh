#!/usr/bin/env bash
# Copy the freshly built Posse.app over /Applications/Posse.app so the installed
# app is always the latest build. Safe to run while the old app is running:
# macOS keeps the running process (and its pty-daemon child) on the old on-disk
# files, so we do NOT kill anything — the next launch picks up the new bundle.
set -euo pipefail

SRC="release/mac-arm64/Posse.app"
DEST="/Applications/Posse.app"

if [ ! -d "$SRC" ]; then
  echo "[install] $SRC not found — run the mac build first" >&2
  exit 1
fi

echo "[install] replacing $DEST"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

VER="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$DEST/Contents/Info.plist" 2>/dev/null || echo '?')"
echo "[install] $DEST is now version $VER"
