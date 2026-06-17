#!/bin/bash
# Build a double-clickable launcher app for local Posse development.
# The launcher recompiles dist (build:ts, seconds) then starts Electron from
# source — so a "new version" never needs electron-builder/DMG. Just edit the
# source and double-click the launcher again to run the latest code.
#
# Output: "Posse Dev.app" — installed into /Applications by default.
# Re-run this script only if you move the project or change the launch logic;
# day-to-day you just double-click the produced .app.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Posse"
OUT_DIR="${1:-/Applications}"
APP_PATH="${OUT_DIR}/${APP_NAME}.app"

# Resolve the dir holding node/npm so the GUI launch (no shell profile) finds them.
NPM_BIN="$(command -v npm)"
NODE_DIR="$(dirname "$NPM_BIN")"

SCRIPT="
on run
	set projectDir to \"${PROJECT_DIR}\"
	set extraPath to \"${NODE_DIR}\"
	try
		do shell script \"cd \" & quoted form of projectDir & \" && export PATH=\" & quoted form of extraPath & \":\$PATH && unset ELECTRON_RUN_AS_NODE && npm run build:ts >/tmp/posse-dev-build.log 2>&1 && nohup ./node_modules/.bin/electron . >/tmp/posse-dev-run.log 2>&1 </dev/null &\"
	on error errMsg
		display dialog \"Posse failed to start:\" & return & errMsg & return & return & \"See /tmp/posse-dev-build.log\" buttons {\"OK\"} with icon stop
	end try
end run
"

rm -rf "$APP_PATH"
TMP_SCPT="$(mktemp -t posse-launcher).applescript"
printf '%s' "$SCRIPT" > "$TMP_SCPT"
osacompile -o "$APP_PATH" "$TMP_SCPT"
rm -f "$TMP_SCPT"

# Give it the real Posse icon (only matters if it ever surfaces).
ICON_SRC="${PROJECT_DIR}/build/icon.icns"
if [ -f "$ICON_SRC" ]; then
  cp "$ICON_SRC" "${APP_PATH}/Contents/Resources/applet.icns"
fi

# Hide the launcher itself from the Dock/▲-Tab — it's a one-shot helper that
# spawns Electron. Without this you get TWO dock icons (applet + Electron).
plutil -replace LSUIElement -bool true "${APP_PATH}/Contents/Info.plist" \
  || plutil -insert LSUIElement -bool true "${APP_PATH}/Contents/Info.plist"

# Re-sign ad-hoc: editing Info.plist invalidates osacompile's signature.
codesign --force --deep -s - "$APP_PATH" 2>/dev/null || true

echo "Built: ${APP_PATH}"
echo "Double-click it (or Spotlight 'Posse') to launch the latest source build."
