#!/bin/bash
# R Project Multicam AI.app (from the .dmg): the app's own executable. On the first launch (or after an update) it runs the
# bundled installer once - Node.js and FFmpeg are downloaded and SHA-256 verified into
# ~/Library/Application Support/RProjectMulticam - then it opens the app window. Later launches start straight away.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
PAYLOAD="$RES/payload"
SUPPORT="$HOME/Library/Application Support/RProjectMulticam"
DEST="$SUPPORT/finalcut"
LAUNCH="$DEST/Start-RProject-Engine.command"
VERSION="$(cat "$PAYLOAD/VERSION.txt" 2>/dev/null)"
LOG="$SUPPORT/setup.log"
mkdir -p "$SUPPORT"

say() { osascript -e "display notification \"$1\" with title \"R Project Multicam AI\"" >/dev/null 2>&1 || true; }
alert() { osascript -e "display alert \"R Project Multicam AI\" message \"$1\" as critical" >/dev/null 2>&1 || true; }

if [ ! -x "$LAUNCH" ] || [ "$(cat "$DEST/app-version.txt" 2>/dev/null)" != "$VERSION" ]; then
  say "Setting up (first launch, about a minute)…"
  if RP_NO_START=1 RP_NO_LAUNCHER=1 /bin/bash "$PAYLOAD/Install-FinalCut.command" </dev/null >"$LOG" 2>&1; then
    printf '%s' "$VERSION" > "$DEST/app-version.txt"
  else
    alert "Setup could not finish. Check your internet connection and open the app again. Details: $LOG"
    exit 1
  fi
fi
exec "$LAUNCH" --app >/dev/null 2>&1
