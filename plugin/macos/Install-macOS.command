#!/bin/bash
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
SRC="$BASE/Plugin"
VERSION="2.3.11.11"
say_line(){ printf '%s\n' "$*"; }
fail(){ say_line "ERROR: $*"; exit 1; }
# macOS privacy protection (TCC) can block Terminal from reading Downloads/Desktop/Documents. Report that instead of "missing" or "damaged" files.
blocked(){ fail "macOS did not allow Terminal to read the installer folder ($BASE). Move the extracted R Project folder to your home folder (outside Downloads, Desktop and Documents) and run Install-macOS.command again, or allow Terminal under System Settings > Privacy & Security > Files and Folders."; }
ls "$BASE" >/dev/null 2>&1 || blocked
[ -d "$SRC" ] || fail "Plugin payload folder is missing. Extract the whole ZIP first, then run Install-macOS.command from the extracted folder."

# Match Premiere by its app bundle path (the process name is truncated and includes the year, so pgrep -x never matched it).
# Other Adobe apps (Photoshop, After Effects) run their own CEPHtmlEngine and must not block installation.
premiere_running(){ pgrep -f '/Adobe Premiere Pro[^/]*\.app/Contents/(MacOS/|.*CEPHtmlEngine)' >/dev/null 2>&1; }
# Premiere can take a while to quit (older update helpers start this installer as soon as the panel closes): wait up to 60 s.
# RP_LIVE_UPDATE (in-panel update, v2.3.11.11+): install while Premiere is open; macOS keeps the loaded panel working and
# the new version is used after Premiere restarts. Waiting for Premiere to quit let macOS stop the update helper.
if [ -z "${RP_LIVE_UPDATE:-}" ] && premiere_running; then
  say_line "Adobe Premiere Pro is still running. Save your project and quit Premiere; installation continues when it has closed (waiting up to 60 seconds)..."
  waited=0
  while premiere_running && [ "$waited" -lt 60 ]; do sleep 2; waited=$((waited + 2)); done
  if premiere_running; then
    [ -z "${RP_AUTO_UPDATE:-}" ] || fail "Adobe Premiere Pro is still running. Quit Premiere completely, then click Update again."
    fail "Adobe Premiere Pro is still running. Save your project, quit Premiere completely, then run Install-macOS.command again."
  fi
  say_line "Adobe Premiere Pro has closed. Continuing installation."
fi
MANIFEST="$SRC/CSXS/manifest.xml"
[ -f "$MANIFEST" ] || fail "Plugin manifest is missing."
grep -q "ExtensionBundleVersion=\"$VERSION\"" "$MANIFEST" || fail "Plugin version mismatch."
grep -Fq "version:'${VERSION}'" "$SRC/jsx/host.jsx" || fail "Host script version mismatch."
grep -Fq "r.version==='${VERSION}'" "$SRC/panel.js" || fail "Panel/host handshake version mismatch."

SUMS="$BASE/SHA256SUMS-macOS.txt"
[ -f "$SUMS" ] || fail "Package checksum inventory is missing."
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"; [ -z "$line" ] && continue
  expected="${line%%  *}"; rel="${line#*  }"; rel="${rel%$'\r'}"; rel="${rel#./}"
  case "$rel" in /*|../*|*/../*|*/..) fail "Invalid package path: $rel" ;; esac
  [ -f "$BASE/$rel" ] || fail "Missing package file: $rel"
  actual="$(shasum -a 256 "$BASE/$rel" 2>/dev/null | awk '{print $1}')" || true
  [ -n "$actual" ] || blocked
  [ "$actual" = "$expected" ] || fail "Package damaged: $rel"
done < "$SUMS"

PROFILE_ROOT="${RP_INSTALL_TEST_ROOT:-$HOME}"
if [ -n "${RP_INSTALL_TEST_ROOT:-}" ]; then [ -d "$PROFILE_ROOT" ] || fail "Test root must already exist."; fi
EXTROOT="$PROFILE_ROOT/Library/Application Support/Adobe/CEP/extensions"
DEST="$EXTROOT/RProjectMulticamAI"
SUPPORT="$PROFILE_ROOT/Library/Application Support/RProjectMulticamAI"
BACKUP="$SUPPORT/backups/$(date +%Y%m%d-%H%M%S)-$$"
TOOLS="$PROFILE_ROOT/Library/Application Support/RProjectMulticam/tools"
# Only folders inside the profile are checked; a symlinked home or /Users is a valid setup.
check_ancestors(){ local cursor="$1"; while [ "$cursor" != / ] && [ -n "$cursor" ] && [ "$cursor" != "$PROFILE_ROOT" ]; do [ ! -L "$cursor" ] || fail "Redirected installation path: $cursor"; cursor="$(dirname "$cursor")"; done; }
check_ancestors "$EXTROOT"; check_ancestors "$BACKUP"; check_ancestors "$TOOLS"
mkdir -p "$EXTROOT" "$BACKUP" "$TOOLS"
# A manual install supersedes any pending in-panel update: retire its helper and clear its status.
if [ -z "${RP_AUTO_UPDATE:-}" ] && [ -z "${RP_INSTALL_TEST_ROOT:-}" ]; then rm -f "$SUPPORT/updater/attempt.txt" "$SUPPORT/updater/status.json" 2>/dev/null || true; fi

# Preflight FFmpeg BEFORE changing the installed plugin.
# The pinned static build (one exact release per architecture, verified before it runs) is always preferred. A Homebrew
# ffmpeg is never copied into tools/ (a copy loads Homebrew's libraries and breaks after "brew upgrade"); it is only used
# in place, and only when the pinned build cannot be downloaded.
FF="$TOOLS/ffmpeg"
MARK="$TOOLS/ffmpeg-build.txt"
if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || echo 0)" = "1" ]; then ARCH="arm64"; else ARCH="$(uname -m)"; fi
case "$ARCH" in
  arm64) FFARCH="arm64"; FFBUILD="1789931890_9.0.2"; FFSHA="c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924" ;;
  x86_64) FFARCH="amd64"; FFBUILD="1789931006_9.0.2"; FFSHA="7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4" ;;
  *) fail "Unsupported Mac architecture: $ARCH" ;;
esac
# tools/ffmpeg counts as ours only when it carries the marker of this pinned build and still runs.
if [ -x "$FF" ] && [ "$(cat "$MARK" 2>/dev/null)" = "$FFSHA" ] && "$FF" -version >/dev/null 2>&1; then
  USEFF="$FF"
else
  USEFF=""
  say_line "Installing FFmpeg 9.0.2 for macOS $ARCH..."
  TMP="$(mktemp -d -t rproject-ffmpeg.XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
  URL="https://ffmpeg.martin-riedl.de/download/macos/$FFARCH/$FFBUILD/ffmpeg.zip"
  if curl -fL --proto '=https' --retry 3 --connect-timeout 20 --speed-limit 1024 --speed-time 60 --max-time 1800 "$URL" -o "$TMP/ffmpeg.zip"; then
    FFACTUAL="$(shasum -a 256 "$TMP/ffmpeg.zip" | awk '{print $1}')"
    if [ "$FFACTUAL" = "$FFSHA" ]; then
      ditto -x -k "$TMP/ffmpeg.zip" "$TMP/unpacked"
      CANDIDATE="$(find "$TMP/unpacked" -type f -name ffmpeg | head -n 1 || true)"
      if [ -n "$CANDIDATE" ]; then
        chmod 755 "$CANDIDATE"
        if "$CANDIDATE" -version >/dev/null 2>&1; then
          rm -f "$FF"; cp "$CANDIDATE" "$FF"; chmod 755 "$FF"; xattr -d com.apple.quarantine "$FF" 2>/dev/null || true
          printf '%s' "$FFSHA" > "$MARK"; USEFF="$FF"
        else say_line "Downloaded FFmpeg cannot run on this Mac."; fi
      else say_line "Downloaded FFmpeg package did not contain ffmpeg."; fi
    else say_line "Downloaded FFmpeg failed its integrity check."; fi
  else say_line "Could not download FFmpeg."; fi
  rm -rf "$TMP"; trap - EXIT
  if [ -z "$USEFF" ]; then
    # Fallback: an FFmpeg that is already installed (for example Homebrew), used where it is, never copied.
    for SYSFF in "$(command -v ffmpeg 2>/dev/null || true)" /opt/homebrew/bin/ffmpeg /usr/local/bin/ffmpeg; do
      if [ -n "$SYSFF" ] && [ -x "$SYSFF" ] && "$SYSFF" -version >/dev/null 2>&1; then USEFF="$SYSFF"; say_line "Using existing FFmpeg: $SYSFF"; break; fi
    done
  fi
  if [ -n "$USEFF" ] && [ "$USEFF" != "$FF" ] && [ -e "$FF" ] && [ "$(cat "$MARK" 2>/dev/null)" != "$FFSHA" ]; then
    # A copied (non-pinned) ffmpeg left by an older installer is retired, but only once another FFmpeg was chosen.
    rm -f "$FF" "$MARK"
  elif [ -z "$USEFF" ] && [ -x "$FF" ] && "$FF" -version >/dev/null 2>&1; then
    # Offline update and nothing else available: keep the FFmpeg that still works; the next online install replaces it.
    USEFF="$FF"; say_line "Keeping the current FFmpeg for now; run the installer again when online to get the verified build."
  fi
  [ -n "$USEFF" ] || fail "Could not install FFmpeg. Check your internet connection and run this installer again, or install FFmpeg yourself (for example with Homebrew) and retry."
fi
"$USEFF" -version >/dev/null 2>&1 || fail "FFmpeg cannot run on this Mac."
printf '%s' "$USEFF" > "$TOOLS/ffmpeg-path.txt"

# Enable CEP legacy extension loading before the switch.
for v in 9 10 11 12 13 14 15; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 >/dev/null 2>&1 || true; done

STAGE="$EXTROOT/.rproject-stage-$VERSION-$$"
[ ! -e "$STAGE" ] && [ ! -L "$STAGE" ] || fail "Staging path already exists. Run installer again."
MOVED=""
INSTALLED=0
rollback(){
  if [ "$INSTALLED" = 1 ]; then rm -rf "$DEST" 2>/dev/null || true; fi
  rm -rf "$STAGE" 2>/dev/null || true
  for name in RProjectMulticamAI com.rproject.multicam R-Project-Multicam-AI r.project.multicam; do
    if [ -e "$BACKUP/$name" ]; then mv "$BACKUP/$name" "$EXTROOT/$name" 2>/dev/null || true; fi
  done
}
trap 'rollback; say_line "ERROR: Installation failed; previous plugin restored."' ERR
cp -R "$SRC" "$STAGE"
for name in RProjectMulticamAI com.rproject.multicam R-Project-Multicam-AI r.project.multicam; do old="$EXTROOT/$name"; [ ! -L "$old" ] || { rollback; fail "Redirected plugin folder: $old"; }; if [ -e "$old" ]; then mv "$old" "$BACKUP/$name"; MOVED="$MOVED $name"; fi; done
mv "$STAGE" "$DEST"
INSTALLED=1
rm -f "$DEST/windows-install-helper.ps1" 2>/dev/null || true
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
if ! grep -q "ExtensionBundleVersion=\"$VERSION\"" "$DEST/CSXS/manifest.xml"; then rollback; fail "Installed plugin verification failed; previous plugin restored."; fi
if ! grep -Fq "version:'${VERSION}'" "$DEST/jsx/host.jsx"; then rollback; fail "Installed host script version verification failed; previous plugin restored."; fi
if ! grep -Fq "r.version==='${VERSION}'" "$DEST/panel.js"; then rollback; fail "Installed panel/host handshake verification failed; previous plugin restored."; fi
trap - ERR

say_line "Installed R Project Multicam AI v$VERSION · PUBLIC macOS LOW MEMORY"
say_line "Plugin: $DEST"
say_line "FFmpeg: $USEFF"
say_line "Backup: $BACKUP"
say_line "No Homebrew is required. Open Premiere > Window > Extensions (Legacy) > R Project Multicam AI."
