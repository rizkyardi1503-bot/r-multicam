#!/bin/bash
# Removes R Project Multicam AI for Final Cut Pro. Your edits (Movies/R Project Multicam) and the Premiere plugin,
# Node.js and FFmpeg in tools/ (shared with the Premiere plugin) are kept.
set -uo pipefail
ROOT="${RP_INSTALL_TEST_ROOT:-$HOME}"
DEST="$ROOT/Library/Application Support/RProjectMulticam/finalcut"
if [ -f "$DEST/engine.lock" ]; then
  PID="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$DEST/engine.lock" 2>/dev/null || true)"
  if [ -n "$PID" ] && ps -p "$PID" -o command= 2>/dev/null | grep -q rp-finalcut-engine; then kill "$PID" 2>/dev/null || true; fi
fi
rm -rf "$DEST" "$ROOT/Applications/R Project Engine for Final Cut.app"
rm -f "$ROOT/Desktop/R Project Engine for Final Cut.app"
echo "R Project Multicam AI for Final Cut Pro was removed. Your edits in Movies/R Project Multicam are kept."
echo "R Project Multicam AI untuk Final Cut Pro sudah dihapus. Hasil edit di Movies/R Project Multicam tetap ada."
