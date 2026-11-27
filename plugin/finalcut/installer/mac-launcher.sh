#!/bin/bash
# R Project Multicam AI.app: the app's own executable. Everything it needs is inside the app (engine, Node.js, FFmpeg).
# 1. Starts the engine in the background (its log: ~/Library/Logs/R Project Multicam AI.log).
# 2. Becomes the app window: exec into osascript running lib/mac-window.jxa, a real Cocoa window that checks in with
#    macOS as this app (Dock icon, menu bar). The engine stops when this window process ends.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
LOGDIR="$HOME/Library/Logs"; mkdir -p "$LOGDIR"; LOG="$LOGDIR/R Project Multicam AI.log"
alert() { /usr/bin/osascript -e "display alert \"R Project Multicam AI\" message \"$1\" as critical" >/dev/null 2>&1; }

NEED="$(cat "$RES/runtime/ARCH.txt" 2>/dev/null)"
HAVE="$(uname -m)"; [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ] && HAVE="arm64"
if [ -n "$NEED" ] && [ "$NEED" != "$HAVE" ]; then
  if [ "$NEED" = "arm64" ]; then alert "This download is for Macs with Apple silicon (M1 or newer). This Mac has an Intel processor: download the Intel version."
  else alert "This download is for Intel Macs. This Mac has Apple silicon: download the Apple silicon version."; fi
  exit 1
fi

# Downloaded apps carry a quarantine flag; the app's own helpers (node, ffmpeg) must be able to run.
/usr/bin/xattr -dr com.apple.quarantine "$RES/runtime" 2>/dev/null

URLF="$(mktemp "${TMPDIR:-/tmp}/rpmulticam.XXXXXX")"
{ echo; echo "=== $(date) · starting"; } >>"$LOG"
RP_FFMPEG="$RES/runtime/ffmpeg" "$RES/runtime/node" "$RES/app/rp-finalcut-engine.js" --no-browser --url-file "$URLF" --parent-pid $$ >>"$LOG" 2>&1 &
ENGINE=$!
for _ in $(seq 1 100); do
  [ -s "$URLF" ] && break
  if ! kill -0 "$ENGINE" 2>/dev/null; then sleep 0.3; [ -s "$URLF" ] && break
    alert "The engine could not start. Details are in ~/Library/Logs/R Project Multicam AI.log — please send that file to R Project support."
    rm -f "$URLF"; exit 1; fi
  sleep 0.2
done
URL="$(cat "$URLF" 2>/dev/null)"; rm -f "$URLF"
if [ -z "$URL" ]; then alert "The engine did not answer in time. Details are in ~/Library/Logs/R Project Multicam AI.log."; kill "$ENGINE" 2>/dev/null; exit 1; fi
echo "window: $URL" >>"$LOG"
exec /usr/bin/osascript -l JavaScript "$RES/app/lib/mac-window.jxa" "$URL" "$RES/AppIcon.icns" 2>>"$LOG"
