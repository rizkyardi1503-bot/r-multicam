#!/bin/bash
# Removes R Project Multicam AI for Final Cut Pro v1.0.0: the engine, its app in ~/Applications, its cache and session.
# Kept (shared with the R Project Premiere plugin): ~/Library/Application Support/RProjectMulticam/tools (FFmpeg) and
# device-id.txt. Your .fcpxml files in Movies/R Project Multicam and your Final Cut libraries are not touched.
set -euo pipefail
PROFILE_ROOT="${RP_INSTALL_TEST_ROOT:-$HOME}"
DEST="$PROFILE_ROOT/Library/Application Support/RProjectMulticam/finalcut"
APPNAME="R Project Engine for Final Cut"
LOCK="$DEST/engine.lock"
if [ -f "$LOCK" ]; then
  PID="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$LOCK" | head -n 1)"
  if [ -n "$PID" ] && ps -p "$PID" -o command= 2>/dev/null | grep -q 'rp-finalcut-engine.js'; then
    printf '%s\n' "Stopping R Project Engine..."
    kill "$PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do ps -p "$PID" >/dev/null 2>&1 || break; sleep 0.5; done
  fi
fi
[ ! -L "$DEST" ] || { printf '%s\n' "ERROR: redirected folder $DEST, not removed."; exit 1; }
rm -rf "$DEST"
[ -n "${RP_INSTALL_TEST_ROOT:-}" ] || rm -rf "$HOME/Applications/$APPNAME.app"
printf '%s\n' "R Project Multicam AI for Final Cut Pro was removed. You can close this window."
