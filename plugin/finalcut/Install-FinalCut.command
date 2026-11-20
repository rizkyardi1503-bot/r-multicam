#!/bin/bash
# R Project Multicam AI for Final Cut Pro (macOS) - installer.
# Installs the engine into ~/Library/Application Support/RProjectMulticam/finalcut, a verified Node.js runtime and a
# verified FFmpeg (the same pinned FFmpeg as the Premiere plugin), and the launcher "R Project Engine for Final Cut".
# No administrator password is needed. Re-running it updates the engine in place.
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
VERSION="1.0.0"
say_line(){ printf '%s\n' "$*"; }
fail(){ say_line "ERROR: $*"; say_line "Press Enter to close."; read -r _ || true; exit 1; }
blocked(){ fail "macOS did not allow Terminal to read the installer folder ($BASE). Move the extracted folder to your home folder (outside Downloads, Desktop and Documents) and run Install-FinalCut.command again, or allow Terminal under System Settings > Privacy & Security > Files and Folders."; }
ls "$BASE" >/dev/null 2>&1 || blocked
[ "$(uname -s)" = "Darwin" ] || [ -n "${RP_INSTALL_TEST_ROOT:-}" ] || fail "This installer is for macOS."
[ -f "$BASE/app/rp-finalcut-engine.js" ] || fail "The app folder is missing. Extract the whole ZIP first, then run Install-FinalCut.command from the extracted folder."

say_line "R Project Multicam AI for Final Cut Pro v$VERSION"
SUMS="$BASE/SHA256SUMS-FinalCut.txt"
[ -f "$SUMS" ] || fail "Package checksum inventory is missing."
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"; [ -z "$line" ] && continue
  expected="${line%%  *}"; rel="${line#*  }"; rel="${rel#./}"
  case "$rel" in /*|../*|*/../*|*/..) fail "Invalid package path: $rel" ;; esac
  [ -f "$BASE/$rel" ] || fail "Missing package file: $rel"
  actual="$(shasum -a 256 "$BASE/$rel" 2>/dev/null | awk '{print $1}')" || true
  [ -n "$actual" ] || blocked
  [ "$actual" = "$expected" ] || fail "Package damaged: $rel. Download the ZIP again."
done < "$SUMS"

ROOT="${RP_INSTALL_TEST_ROOT:-$HOME}"
SUPPORT="$ROOT/Library/Application Support/RProjectMulticam"
TOOLS="$SUPPORT/tools"
DEST="$SUPPORT/finalcut"
APPS="$ROOT/Applications"
mkdir -p "$TOOLS" "$DEST" "$APPS"

if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="$(uname -m)"; fi
case "$ARCH" in
  arm64) NODEARCH="arm64"; NODESHA="bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057"
         FFARCH="arm64"; FFBUILD="1789931890_9.0.2"; FFSHA="c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924" ;;
  x86_64) NODEARCH="x64"; NODESHA="1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097"
          FFARCH="amd64"; FFBUILD="1789931006_9.0.2"; FFSHA="7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4" ;;
  *) fail "Unsupported Mac architecture: $ARCH" ;;
esac
download(){ curl -fL --proto '=https' --retry 3 --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 1800 "$1" -o "$2"; }

# ---- Node.js (official build, pinned version, SHA-256 verified). Kept in tools/, never on the system PATH.
NODEVER="v24.21.0"
NODEDIR="$TOOLS/node-$NODEVER-darwin-$NODEARCH"
NODE="$NODEDIR/bin/node"
if [ -n "${RP_INSTALL_TEST_ROOT:-}" ] && [ -n "${RP_TEST_NODE:-}" ]; then
  NODE="$RP_TEST_NODE"   # installer tests on a non-Mac machine
elif [ -x "$NODE" ] && [ "$(cat "$NODEDIR/.rp-sha256" 2>/dev/null)" = "$NODESHA" ] && "$NODE" --version >/dev/null 2>&1; then
  say_line "Node.js $NODEVER is already installed."
else
  say_line "Installing Node.js $NODEVER for macOS $ARCH..."
  TMP="$(mktemp -d -t rproject-node.XXXXXX)"
  NAME="node-$NODEVER-darwin-$NODEARCH"
  download "https://nodejs.org/dist/$NODEVER/$NAME.tar.gz" "$TMP/node.tar.gz" || { rm -rf "$TMP"; fail "Could not download Node.js. Check your internet connection and run the installer again."; }
  [ "$(shasum -a 256 "$TMP/node.tar.gz" | awk '{print $1}')" = "$NODESHA" ] || { rm -rf "$TMP"; fail "Downloaded Node.js failed its integrity check."; }
  tar -xzf "$TMP/node.tar.gz" -C "$TMP"
  "$TMP/$NAME/bin/node" --version >/dev/null 2>&1 || { rm -rf "$TMP"; fail "Downloaded Node.js cannot run on this Mac."; }
  rm -rf "$NODEDIR"; mv "$TMP/$NAME" "$NODEDIR"; printf '%s' "$NODESHA" > "$NODEDIR/.rp-sha256"
  xattr -dr com.apple.quarantine "$NODEDIR" 2>/dev/null || true
  rm -rf "$TMP"
fi

# ---- FFmpeg: the same pinned static build (and the same tools/ffmpeg-path.txt) as the Premiere installer.
FF="$TOOLS/ffmpeg"; MARK="$TOOLS/ffmpeg-build.txt"; USEFF=""
if [ -x "$FF" ] && [ "$(cat "$MARK" 2>/dev/null)" = "$FFSHA" ] && "$FF" -version >/dev/null 2>&1; then
  USEFF="$FF"
else
  say_line "Installing FFmpeg 9.0.2 for macOS $ARCH..."
  TMP="$(mktemp -d -t rproject-ffmpeg.XXXXXX)"
  if download "https://ffmpeg.martin-riedl.de/download/macos/$FFARCH/$FFBUILD/ffmpeg.zip" "$TMP/ffmpeg.zip" && [ "$(shasum -a 256 "$TMP/ffmpeg.zip" | awk '{print $1}')" = "$FFSHA" ]; then
    ditto -x -k "$TMP/ffmpeg.zip" "$TMP/unpacked"
    CANDIDATE="$(find "$TMP/unpacked" -type f -name ffmpeg | head -n 1 || true)"
    if [ -n "$CANDIDATE" ]; then
      chmod 755 "$CANDIDATE"
      if "$CANDIDATE" -version >/dev/null 2>&1; then rm -f "$FF"; cp "$CANDIDATE" "$FF"; chmod 755 "$FF"; xattr -d com.apple.quarantine "$FF" 2>/dev/null || true; printf '%s' "$FFSHA" > "$MARK"; USEFF="$FF"; fi
    fi
  fi
  rm -rf "$TMP"
  if [ -z "$USEFF" ]; then
    for SYSFF in "$(cat "$TOOLS/ffmpeg-path.txt" 2>/dev/null || true)" "$(command -v ffmpeg 2>/dev/null || true)" /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do
      if [ -n "$SYSFF" ] && [ -x "$SYSFF" ] && "$SYSFF" -version >/dev/null 2>&1; then USEFF="$SYSFF"; say_line "Using existing FFmpeg: $SYSFF"; break; fi
    done
  fi
  [ -n "$USEFF" ] || fail "Could not install FFmpeg. Check your internet connection and run this installer again, or install FFmpeg yourself (for example with Homebrew) and retry."
fi
printf '%s' "$USEFF" > "$TOOLS/ffmpeg-path.txt"

# ---- Stop a running engine, then replace the app folder (sessions and caches next to it are kept).
if [ -f "$DEST/engine.lock" ]; then
  PID="$(sed -n 's/.*"pid":\([0-9]*\).*/\1/p' "$DEST/engine.lock" 2>/dev/null || true)"
  if [ -n "$PID" ] && ps -p "$PID" -o command= 2>/dev/null | grep -q rp-finalcut-engine; then kill "$PID" 2>/dev/null || true; sleep 1; fi
  rm -f "$DEST/engine.lock"
fi
STAGE="$DEST/.app-new-$$"
rm -rf "$STAGE"; cp -R "$BASE/app" "$STAGE"
rm -rf "$DEST/app"; mv "$STAGE" "$DEST/app"
xattr -dr com.apple.quarantine "$DEST/app" 2>/dev/null || true

# ---- Launcher: a small app in ~/Applications that opens the engine in Terminal (the window shows the engine log).
LAUNCH="$DEST/Start-RProject-Engine.command"
cat > "$LAUNCH" <<EOF
#!/bin/bash
# R Project Engine for Final Cut Pro. Close this window to stop the engine.
exec "$NODE" "$DEST/app/rp-finalcut-engine.js" "\$@"
EOF
chmod 755 "$LAUNCH"
APPBUNDLE="$APPS/R Project Engine for Final Cut.app"
if command -v osacompile >/dev/null 2>&1; then
  rm -rf "$APPBUNDLE"
  osacompile -o "$APPBUNDLE" -e "do shell script \"open -a Terminal \" & quoted form of \"$LAUNCH\"" >/dev/null 2>&1 || say_line "Could not create the app launcher; use $LAUNCH instead."
fi
[ -d "$APPBUNDLE" ] && ln -sfn "$APPBUNDLE" "$ROOT/Desktop/R Project Engine for Final Cut.app" 2>/dev/null || true

"$NODE" -e "require('$DEST/app/lib/fcp-workflow.js')" || fail "The engine does not start with Node.js on this Mac."
say_line ""
say_line "Installed. Start \"R Project Engine for Final Cut\" from your Applications folder (or the Desktop)."
say_line "Terpasang. Buka \"R Project Engine for Final Cut\" dari folder Applications (atau Desktop)."
if [ -z "${RP_INSTALL_TEST_ROOT:-}" ] && [ -z "${RP_NO_START:-}" ]; then open -a Terminal "$LAUNCH" || true; fi
