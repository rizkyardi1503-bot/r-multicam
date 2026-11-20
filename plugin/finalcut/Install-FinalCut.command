#!/bin/bash
# R Project Multicam AI for Final Cut Pro (macOS) v1.0.0 - installer. Double-click (first time: right-click > Open).
#   - R Project Engine into ~/Library/Application Support/RProjectMulticam/finalcut, with its own Node.js when none
#     (>= 18) is installed (official nodejs.org build, pinned version, SHA-256 verified)
#   - FFmpeg: the one the R Project Premiere plugin already set up, else the same pinned, SHA-256 verified build
#   - "R Project Engine for Final Cut" in ~/Applications (Launchpad / Spotlight)
# Nothing is installed into Final Cut Pro itself: the engine writes .fcpxml files that Final Cut imports.
# Test hooks: RP_INSTALL_TEST_ROOT=<existing folder> installs there instead of $HOME (no app, no launch, no macOS check).
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
VERSION="1.0.0"
NODE_VERSION="24.21.0"
NODE_SHA_ARM64="bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057"
NODE_SHA_X64="1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097"
MIN_NODE=18
say_line(){ printf '%s\n' "$*"; }
fail(){ say_line ""; say_line "ERROR: $*"; say_line "Nothing else was changed. You can close this window."; exit 1; }
blocked(){ fail "macOS did not allow Terminal to read the installer folder ($BASE). Move the extracted folder to your home folder (outside Downloads, Desktop and Documents) and run Install-FinalCut.command again, or allow Terminal under System Settings > Privacy & Security > Files and Folders."; }
ls "$BASE" >/dev/null 2>&1 || blocked

TEST_ROOT="${RP_INSTALL_TEST_ROOT:-}"
if [ -n "$TEST_ROOT" ]; then
  [ -d "$TEST_ROOT" ] || fail "Test root must already exist."
  PROFILE_ROOT="$TEST_ROOT"
else
  [ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS."
  PROFILE_ROOT="$HOME"
fi
say_line "R Project Multicam AI for Final Cut Pro v$VERSION"
say_line ""

# ---------------------------------------------------------------- package integrity
SUMS="$BASE/SHA256SUMS-FinalCut.txt"
[ -f "$SUMS" ] || fail "Package checksum list is missing. Extract the whole ZIP first, then run Install-FinalCut.command from the extracted folder."
FILES=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"; [ -z "$line" ] && continue
  expected="${line%%  *}"; rel="${line#*  }"
  case "$rel" in /*|../*|*/../*|*/..) fail "Invalid package path: $rel" ;; esac
  [ -f "$BASE/$rel" ] || fail "Missing package file: $rel (extract the whole ZIP)"
  actual="$( (shasum -a 256 "$BASE/$rel" 2>/dev/null || sha256sum "$BASE/$rel" 2>/dev/null) | awk '{print $1}')" || true
  [ -n "$actual" ] || blocked
  [ "$actual" = "$expected" ] || fail "Package damaged: $rel. Download the ZIP again."
  FILES+=("$rel")
done < "$SUMS"
[ "${#FILES[@]}" -gt 10 ] || fail "Package checksum list is incomplete."

ROOT="$PROFILE_ROOT/Library/Application Support/RProjectMulticam"
DEST="$ROOT/finalcut"
APP="$DEST/app"
RUNTIME="$DEST/runtime"
TOOLS="$ROOT/tools"
for d in "$ROOT" "$DEST" "$TOOLS"; do [ ! -L "$d" ] || fail "Redirected installation path: $d"; done
mkdir -p "$DEST" "$TOOLS"
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="$(uname -m)"; fi

# ---------------------------------------------------------------- stop a running engine (it is replaced)
LOCK="$DEST/engine.lock"
if [ -f "$LOCK" ]; then
  PID="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$LOCK" | head -n 1)"
  if [ -n "$PID" ] && ps -p "$PID" -o command= 2>/dev/null | grep -q 'rp-finalcut-engine.js'; then
    say_line "Stopping the running R Project Engine..."
    kill "$PID" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do ps -p "$PID" >/dev/null 2>&1 || break; sleep 0.5; done
  fi
  rm -f "$LOCK"
fi

# ---------------------------------------------------------------- Node.js (>= 18): ours, an installed one, else a pinned copy
node_major(){ "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
NODE=""
for cand in "$RUNTIME/bin/node" "$(command -v node 2>/dev/null || true)" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$cand" ] && [ -x "$cand" ] && [ "$(node_major "$cand")" -ge "$MIN_NODE" ]; then NODE="$cand"; break; fi
done
if [ -z "$NODE" ]; then
  [ -z "$TEST_ROOT" ] || fail "Test mode needs Node.js $MIN_NODE+ on PATH."
  case "$ARCH" in
    arm64) NARCH="arm64"; NSHA="$NODE_SHA_ARM64" ;;
    x86_64) NARCH="x64"; NSHA="$NODE_SHA_X64" ;;
    *) fail "Unsupported Mac processor: $ARCH" ;;
  esac
  say_line "Node.js $MIN_NODE or newer not found: installing a private copy (Node.js $NODE_VERSION, $NARCH)..."
  TMP="$(mktemp -d -t rproject-node.XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
  URL="https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$NARCH.tar.gz"
  curl -fL --proto '=https' --retry 3 --connect-timeout 20 --max-time 1800 "$URL" -o "$TMP/node.tar.gz" || fail "Could not download Node.js. Check your internet connection and run this installer again."
  [ "$(shasum -a 256 "$TMP/node.tar.gz" | awk '{print $1}')" = "$NSHA" ] || fail "Downloaded Node.js failed its integrity check."
  mkdir -p "$TMP/node" && tar -xzf "$TMP/node.tar.gz" -C "$TMP/node" --strip-components 1
  [ "$(node_major "$TMP/node/bin/node")" -ge "$MIN_NODE" ] || fail "Downloaded Node.js cannot run on this Mac."
  rm -rf "$RUNTIME"; mkdir -p "$RUNTIME/bin"
  cp "$TMP/node/bin/node" "$RUNTIME/bin/node"; cp "$TMP/node/LICENSE" "$RUNTIME/NODE-LICENSE.txt" 2>/dev/null || true
  chmod 755 "$RUNTIME/bin/node"; xattr -dr com.apple.quarantine "$RUNTIME" 2>/dev/null || true
  NODE="$RUNTIME/bin/node"
fi
say_line "Node.js: $NODE ($("$NODE" -v))"

# ---------------------------------------------------------------- FFmpeg (shared with the Premiere plugin)
ff_runs(){ [ -n "$1" ] && [ -x "$1" ] && "$1" -version >/dev/null 2>&1; }
USEFF=""
if [ -f "$TOOLS/ffmpeg-path.txt" ]; then SAVED="$(head -n 1 "$TOOLS/ffmpeg-path.txt" | tr -d '\r')"; ff_runs "$SAVED" && USEFF="$SAVED"; fi
if [ -z "$USEFF" ] && [ -z "$TEST_ROOT" ]; then
  case "$ARCH" in
    arm64) FFARCH="arm64"; FFBUILD="1789931890_9.0.2"; FFSHA="c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924" ;;
    x86_64) FFARCH="amd64"; FFBUILD="1789931006_9.0.2"; FFSHA="7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4" ;;
    *) FFARCH="" ;;
  esac
  if [ -n "$FFARCH" ]; then
    say_line "Installing FFmpeg 9.0.2 for macOS $ARCH..."
    FTMP="$(mktemp -d -t rproject-ffmpeg.XXXXXX)"
    if curl -fL --proto '=https' --retry 3 --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 1800 "https://ffmpeg.martin-riedl.de/download/macos/$FFARCH/$FFBUILD/ffmpeg.zip" -o "$FTMP/ffmpeg.zip" \
       && [ "$(shasum -a 256 "$FTMP/ffmpeg.zip" | awk '{print $1}')" = "$FFSHA" ]; then
      ditto -x -k "$FTMP/ffmpeg.zip" "$FTMP/unpacked"
      CANDIDATE="$(find "$FTMP/unpacked" -type f -name ffmpeg | head -n 1 || true)"
      if [ -n "$CANDIDATE" ]; then
        chmod 755 "$CANDIDATE"; xattr -d com.apple.quarantine "$CANDIDATE" 2>/dev/null || true
        if "$CANDIDATE" -version >/dev/null 2>&1; then
          rm -f "$TOOLS/ffmpeg"; cp "$CANDIDATE" "$TOOLS/ffmpeg"; chmod 755 "$TOOLS/ffmpeg"; xattr -d com.apple.quarantine "$TOOLS/ffmpeg" 2>/dev/null || true
          printf '%s\n' "$FFBUILD" > "$TOOLS/ffmpeg-build.txt"; USEFF="$TOOLS/ffmpeg"
        fi
      fi
    else say_line "Could not download a verified FFmpeg; looking for one that is already installed."; fi
    rm -rf "$FTMP"
  fi
fi
if [ -z "$USEFF" ]; then
  for SYSFF in "$(command -v ffmpeg 2>/dev/null || true)" /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do
    if ff_runs "$SYSFF"; then USEFF="$SYSFF"; break; fi
  done
fi
[ -n "$USEFF" ] || fail "Could not install FFmpeg. Check your internet connection and run this installer again, or install FFmpeg yourself (for example with Homebrew) and retry."
printf '%s' "$USEFF" > "$TOOLS/ffmpeg-path.txt"
say_line "FFmpeg: $USEFF"

# ---------------------------------------------------------------- engine files (replaced as a whole)
NEW="$DEST/app.new"
rm -rf "$NEW"; mkdir -p "$NEW"
for rel in "${FILES[@]}"; do
  case "$rel" in *.command|SHA256SUMS-FinalCut.txt) continue ;; esac
  mkdir -p "$NEW/$(dirname "$rel")"; cp "$BASE/$rel" "$NEW/$rel"; chmod 644 "$NEW/$rel"
done
cp "$BASE/Uninstall-FinalCut.command" "$DEST/Uninstall-FinalCut.command"; chmod 755 "$DEST/Uninstall-FinalCut.command"
rm -rf "$DEST/app.old"; [ ! -d "$APP" ] || mv "$APP" "$DEST/app.old"
mv "$NEW" "$APP"; rm -rf "$DEST/app.old"
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

# Launcher: starts the engine in the background (or just opens the page when it already runs). Log kept under 5 MB.
LAUNCH="$DEST/launch.sh"
cat > "$LAUNCH" <<EOF
#!/bin/bash
# R Project Engine for Final Cut Pro - started by "R Project Engine for Final Cut.app".
LOG="$DEST/engine.log"
[ ! -f "\$LOG" ] || [ "\$(wc -c < "\$LOG")" -lt 5000000 ] || mv -f "\$LOG" "\$LOG.1"
nohup "$NODE" "$APP/rp-finalcut-engine.js" >> "\$LOG" 2>&1 < /dev/null &
EOF
chmod 755 "$LAUNCH"
printf '%s\n' "$VERSION" > "$DEST/VERSION.txt"

# ---------------------------------------------------------------- app in ~/Applications
APPNAME="R Project Engine for Final Cut"
if [ -z "$TEST_ROOT" ]; then
  mkdir -p "$HOME/Applications"
  BUNDLE="$HOME/Applications/$APPNAME.app"
  esc="$(printf '%s' "$LAUNCH" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  rm -rf "$BUNDLE"
  osacompile -o "$BUNDLE" -e "do shell script \"/bin/bash \" & quoted form of \"$esc\"" || fail "Could not create $BUNDLE."
  say_line "App: $BUNDLE"
  open "$BUNDLE" || true
fi

say_line ""
say_line "Done. R Project Engine for Final Cut is installed."
say_line "Open it any time from Launchpad or Spotlight: \"$APPNAME\". Your browser shows the control page."
say_line "You can close this window."
