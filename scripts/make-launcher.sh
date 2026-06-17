#!/bin/bash
# Build a real, double-clickable Posse.app for local development WITHOUT
# electron-builder/DMG. It is a rebranded copy of the project's own Electron
# binary whose app entry loads this project's compiled main from disk and
# rebuilds it on launch. Because the running PROCESS is Posse.app (not the raw
# Electron.app), the Dock shows the Posse icon, keeps the right identity, uses a
# single tile, and relaunches Posse — even after you quit.
#
# A "new version" is just: edit source, then double-click Posse.app. It runs
# `npm run build:ts` at startup, so it always launches the latest code. Re-run
# THIS script only if you move the project, bump Electron, or change branding.
#
# Output: /Applications/Posse.app  (override dir with arg 1)
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Posse"
OUT_DIR="${1:-/Applications}"
APP_PATH="${OUT_DIR}/${APP_NAME}.app"

ELECTRON_APP="${PROJECT_DIR}/node_modules/electron/dist/Electron.app"
ICON_SRC="${PROJECT_DIR}/build/icon.icns"
NPM_BIN="$(command -v npm)"
NODE_DIR="$(dirname "$NPM_BIN")"

[ -d "$ELECTRON_APP" ] || { echo "Electron not found: $ELECTRON_APP (run npm install)"; exit 1; }

echo "Copying Electron bundle -> ${APP_PATH} ..."
rm -rf "$APP_PATH"
cp -R "$ELECTRON_APP" "$APP_PATH"

CONTENTS="${APP_PATH}/Contents"
PLIST="${CONTENTS}/Info.plist"

# Rename the executable so the process/Dock identity reads "Posse", not "Electron".
mv "${CONTENTS}/MacOS/Electron" "${CONTENTS}/MacOS/${APP_NAME}"

# Rebrand Info.plist.
plutil -replace CFBundleExecutable   -string "${APP_NAME}"        "$PLIST"
plutil -replace CFBundleName         -string "${APP_NAME}"        "$PLIST"
plutil -replace CFBundleDisplayName  -string "${APP_NAME}"        "$PLIST" || plutil -insert CFBundleDisplayName -string "${APP_NAME}" "$PLIST"
plutil -replace CFBundleIdentifier   -string "com.posse.app"      "$PLIST"
plutil -replace CFBundleIconFile     -string "icon"               "$PLIST"
[ -f "$ICON_SRC" ] && cp "$ICON_SRC" "${CONTENTS}/Resources/icon.icns"

# App entry: a tiny bootstrap that rebuilds the project then loads its main.
APP_SRC_DIR="${CONTENTS}/Resources/app"
mkdir -p "$APP_SRC_DIR"
cat > "${APP_SRC_DIR}/package.json" <<JSON
{ "name": "posse-dev-launcher", "version": "1.0.0", "main": "bootstrap.js" }
JSON

cat > "${APP_SRC_DIR}/bootstrap.js" <<JS
// Rebuild the project to dist/, then load its compiled Electron main.
// Runs inside the rebranded Posse.app's Electron main process.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const PROJECT = "${PROJECT_DIR}";
const NPM = "${NPM_BIN}";
const NODE_DIR = "${NODE_DIR}";
const MAIN = path.join(PROJECT, 'dist', 'main', 'index.js');
const LOG = '/tmp/posse-launch.log';

// Best-effort rebuild so a click always runs the latest source. Guarded: a
// build failure must never block launch — we fall back to the existing dist.
try {
  const env = Object.assign({}, process.env, { PATH: NODE_DIR + ':' + (process.env.PATH || '') });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(NPM, ['run', 'build:ts'], { cwd: PROJECT, stdio: 'ignore', env, timeout: 120000 });
  fs.writeFileSync(LOG, 'build status=' + r.status + ' error=' + (r.error ? r.error.message : 'none') + '\\n');
} catch (e) {
  try { fs.appendFileSync(LOG, 'build threw: ' + (e && e.stack || e) + '\\n'); } catch (_) {}
}

require(MAIN);
JS

# Re-sign ad-hoc; editing a signed bundle invalidates the signature.
codesign --force --deep -s - "$APP_PATH" >/dev/null 2>&1 || true

# Bust the Dock/Finder icon cache so the new icon + name show immediately.
touch "$APP_PATH"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREGISTER" ] && "$LSREGISTER" -f "$APP_PATH" >/dev/null 2>&1 || true
killall Dock >/dev/null 2>&1 || true

echo "Built: ${APP_PATH}"
echo "Double-click it (or Spotlight 'Posse'). It rebuilds + runs the latest source; the Dock tile is a real Posse.app now."
