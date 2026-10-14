#!/bin/bash
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
SRC="$BASE/Plugin"
VERSION="2.3.11.4"
[ -d "$SRC" ] || { printf "%s\n" "ERROR: Plugin payload folder is missing."; exit 1; }
say_line(){ printf '%s\n' "$*"; }
fail(){ say_line "ERROR: $*"; exit 1; }

if pgrep -x "Adobe Premiere Pro" >/dev/null 2>&1 || pgrep -x "CEPHtmlEngine" >/dev/null 2>&1; then fail "Close Adobe Premiere Pro and Adobe CEP processes, then run this installer again."; fi
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
  actual="$(shasum -a 256 "$BASE/$rel" | awk '{print $1}')"
  [ "$actual" = "$expected" ] || fail "Package damaged: $rel"
done < "$SUMS"

PROFILE_ROOT="${RP_INSTALL_TEST_ROOT:-$HOME}"
if [ -n "${RP_INSTALL_TEST_ROOT:-}" ]; then [ -d "$PROFILE_ROOT" ] || fail "Test root must already exist."; fi
EXTROOT="$PROFILE_ROOT/Library/Application Support/Adobe/CEP/extensions"
DEST="$EXTROOT/RProjectMulticamAI"
SUPPORT="$PROFILE_ROOT/Library/Application Support/RProjectMulticamAI"
BACKUP="$SUPPORT/backups/$(date +%Y%m%d-%H%M%S)-$$"
TOOLS="$PROFILE_ROOT/Library/Application Support/RProjectMulticam/tools"
check_ancestors(){ local cursor="$1"; while [ "$cursor" != / ] && [ -n "$cursor" ]; do [ ! -L "$cursor" ] || fail "Redirected installation path: $cursor"; cursor="$(dirname "$cursor")"; done; }
check_ancestors "$EXTROOT"; check_ancestors "$BACKUP"; check_ancestors "$TOOLS"
mkdir -p "$EXTROOT" "$BACKUP" "$TOOLS"

# Preflight FFmpeg BEFORE changing the installed plugin.
FF="$TOOLS/ffmpeg"
if [ -x "$FF" ]; then
  "$FF" -version >/dev/null 2>&1 || rm -f "$FF"
fi
if [ ! -x "$FF" ]; then
  SYSFF="$(command -v ffmpeg 2>/dev/null || true)"
  if [ -n "$SYSFF" ] && "$SYSFF" -version >/dev/null 2>&1; then
    say_line "Using existing FFmpeg: $SYSFF"
    cp "$SYSFF" "$FF"; chmod 755 "$FF"
  fi
fi
if [ ! -x "$FF" ]; then
  ARCH="$(uname -m)"
  # FFmpeg is pinned to one exact release build per architecture and verified before it is executed.
  case "$ARCH" in
    arm64) FFARCH="arm64"; FFBUILD="1789931890_9.0.2"; FFSHA="c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924" ;;
    x86_64) FFARCH="amd64"; FFBUILD="1789931006_9.0.2"; FFSHA="7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4" ;;
    *) fail "Unsupported Mac architecture: $ARCH" ;;
  esac
  say_line "Installing FFmpeg 9.0.2 for macOS $ARCH..."
  TMP="$(mktemp -d -t rproject-ffmpeg.XXXXXX)"; trap 'rm -rf "$TMP"' EXIT
  URL="https://ffmpeg.martin-riedl.de/download/macos/$FFARCH/$FFBUILD/ffmpeg.zip"
  curl -fL --proto '=https' --retry 3 --connect-timeout 20 "$URL" -o "$TMP/ffmpeg.zip" || fail "Could not download FFmpeg. Check your internet connection and run this installer again."
  FFACTUAL="$(shasum -a 256 "$TMP/ffmpeg.zip" | awk '{print $1}')"
  [ "$FFACTUAL" = "$FFSHA" ] || fail "Downloaded FFmpeg failed its integrity check. Run this installer again, or install FFmpeg yourself (for example with Homebrew) and retry."
  ditto -x -k "$TMP/ffmpeg.zip" "$TMP/unpacked"
  CANDIDATE="$(find "$TMP/unpacked" -type f -name ffmpeg | head -n 1 || true)"
  [ -n "$CANDIDATE" ] || fail "Downloaded FFmpeg package did not contain ffmpeg."
  chmod 755 "$CANDIDATE"; "$CANDIDATE" -version >/dev/null 2>&1 || fail "Downloaded FFmpeg cannot run on this Mac."
  cp "$CANDIDATE" "$FF"; chmod 755 "$FF"; rm -rf "$TMP"; trap - EXIT
fi
"$FF" -version >/dev/null 2>&1 || fail "FFmpeg cannot run on this Mac."
printf '%s' "$FF" > "$TOOLS/ffmpeg-path.txt"

# Enable CEP legacy extension loading before the switch.
for v in 9 10 11 12 13 14 15; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1 >/dev/null 2>&1 || true; done

STAGE="$EXTROOT/.rproject-stage-$VERSION-$$"
[ ! -e "$STAGE" ] && [ ! -L "$STAGE" ] || fail "Staging path already exists. Run installer again."
cp -R "$SRC" "$STAGE"
MOVED=""
INSTALLED=0
rollback(){
  if [ "$INSTALLED" = 1 ]; then rm -rf "$DEST" 2>/dev/null || true; fi
  rm -rf "$STAGE" 2>/dev/null || true
  for name in RProjectMulticamAI com.rproject.multicam R-Project-Multicam-AI r.project.multicam; do
    if [ -e "$BACKUP/$name" ]; then mv "$BACKUP/$name" "$EXTROOT/$name" 2>/dev/null || true; fi
  done
}
trap 'rollback' ERR
for name in RProjectMulticamAI com.rproject.multicam R-Project-Multicam-AI r.project.multicam; do old="$EXTROOT/$name"; [ ! -L "$old" ] || { rollback; fail "Redirected plugin folder: $old"; }; if [ -e "$old" ]; then mv "$old" "$BACKUP/$name"; MOVED="$MOVED $name"; fi; done
mv "$STAGE" "$DEST"
INSTALLED=1
rm -f "$DEST/windows-install-helper.ps1" 2>/dev/null || true
if ! grep -q "ExtensionBundleVersion=\"$VERSION\"" "$DEST/CSXS/manifest.xml"; then rollback; fail "Installed plugin verification failed; previous plugin restored."; fi
if ! grep -Fq "version:'${VERSION}'" "$DEST/jsx/host.jsx"; then rollback; fail "Installed host script version verification failed; previous plugin restored."; fi
if ! grep -Fq "r.version==='${VERSION}'" "$DEST/panel.js"; then rollback; fail "Installed panel/host handshake verification failed; previous plugin restored."; fi
trap - ERR

say_line "Installed R Project Multicam AI v$VERSION · PUBLIC macOS LOW MEMORY"
say_line "Plugin: $DEST"
say_line "FFmpeg: $FF"
say_line "Backup: $BACKUP"
say_line "No Homebrew is required. Open Premiere > Window > Extensions (Legacy) > R Project Multicam AI."
