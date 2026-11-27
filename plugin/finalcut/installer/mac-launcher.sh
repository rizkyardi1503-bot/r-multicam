#!/bin/bash
# R Project Multicam AI.app: the app's own executable. Everything it needs is inside the app (the engine, Node.js and
# FFmpeg), so nothing is installed or downloaded: it starts the engine, which opens the app window. Closing the window
# quits it. Data and edits go to ~/Library/Application Support/RProjectMulticam and ~/Movies/R Project Multicam.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
NEED="$(cat "$RES/runtime/ARCH.txt" 2>/dev/null)"
HAVE="$(uname -m)"; [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ] && HAVE="arm64"
if [ -n "$NEED" ] && [ "$NEED" != "$HAVE" ]; then
  if [ "$NEED" = "arm64" ]; then MSG="This download is for Macs with Apple silicon (M1 or newer). This Mac has an Intel processor: download the Intel version from r-multicam.pages.dev."
  else MSG="This download is for Intel Macs. This Mac has Apple silicon: download the Apple silicon version from r-multicam.pages.dev."; fi
  osascript -e "display alert \"R Project Multicam AI\" message \"$MSG\" as critical" >/dev/null 2>&1
  exit 1
fi
export RP_FFMPEG="$RES/runtime/ffmpeg"
exec "$RES/runtime/node" "$RES/app/rp-finalcut-engine.js" --app >/dev/null 2>&1
