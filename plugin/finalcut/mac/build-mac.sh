#!/bin/bash
# Builds "R Project Multicam AI.app" and its .dmg on macOS (GitHub Actions macos runner).
#   plugin/finalcut/mac/build-mac.sh <arm64|x86_64> <out-dir>
# The app is a native Swift/Cocoa program (main.swift) carrying the engine (plugin/finalcut/app), Node.js and FFmpeg
# (pinned builds, SHA-256 checked, the same as Install-FinalCut.command). Ad-hoc signed; the .dmg holds the app and an
# Applications link (drag to install, drag to the Trash or use the app menu's Uninstall to remove).
set -euo pipefail
ARCH="$1"; OUT="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"; FC="$(cd "$HERE/.." && pwd)"
VERSION="$(node -p "require('$FC/pack-finalcut.cjs').VERSION")"
NAME="R Project Multicam AI"
case "$ARCH" in
  arm64)  NODE_T="node-v24.21.0-darwin-arm64"; NODE_SHA="bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057"
          FF_URL="https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip"; FF_SHA="c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924"; LABEL="AppleSilicon" ;;
  x86_64) NODE_T="node-v24.21.0-darwin-x64"; NODE_SHA="1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097"
          FF_URL="https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip"; FF_SHA="7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4"; LABEL="Intel" ;;
  *) echo "arch must be arm64 or x86_64"; exit 2 ;;
esac
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
fetch() { curl -fsSL --retry 3 -o "$2" "$1"; [ "$(shasum -a 256 "$2" | cut -d' ' -f1)" = "$3" ] || { echo "SHA-256 mismatch: $1"; exit 1; }; }

APP="$WORK/stage/$NAME.app"; C="$APP/Contents"
mkdir -p "$C/MacOS" "$C/Resources/runtime"
swiftc -O -target "$ARCH-apple-macos12.0" -framework Cocoa -framework WebKit "$HERE/main.swift" -o "$C/MacOS/$NAME"
cat > "$C/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>$NAME</string>
  <key>CFBundleDisplayName</key><string>$NAME</string>
  <key>CFBundleIdentifier</key><string>dev.r-multicam.app</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>$NAME</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.video</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>R Project</string>
</dict></plist>
EOF
cp "$FC/app/assets/icon.icns" "$C/Resources/AppIcon.icns"
cp -R "$FC/app" "$C/Resources/app"
cp "$FC/README-FinalCut.md" "$FC/THIRD-PARTY-NOTICES.txt" "$C/Resources/"

fetch "https://nodejs.org/dist/v24.21.0/$NODE_T.tar.gz" "$WORK/node.tgz" "$NODE_SHA"
tar -xzf "$WORK/node.tgz" -C "$WORK" "$NODE_T/bin/node" "$NODE_T/LICENSE"
cp "$WORK/$NODE_T/bin/node" "$C/Resources/runtime/node"; cp "$WORK/$NODE_T/LICENSE" "$C/Resources/runtime/NODE-LICENSE.txt"
fetch "$FF_URL" "$WORK/ff.zip" "$FF_SHA"
mkdir -p "$WORK/ff"; ditto -x -k "$WORK/ff.zip" "$WORK/ff"
cp "$(find "$WORK/ff" -type f -name ffmpeg | head -n 1)" "$C/Resources/runtime/ffmpeg"
chmod 755 "$C/Resources/runtime/node" "$C/Resources/runtime/ffmpeg" "$C/MacOS/$NAME"
echo "$ARCH" > "$C/Resources/runtime/ARCH.txt"

# Signing: helpers keep a valid signature of their own (ad-hoc when they had none), then the app is ad-hoc signed.
for b in node ffmpeg; do codesign -v "$C/Resources/runtime/$b" 2>/dev/null || codesign -f -s - "$C/Resources/runtime/$b"; done
codesign -f -s - "$APP"
codesign -v --strict "$APP"

ln -s /Applications "$WORK/stage/Applications"
DMG="$OUT/R-Project-Multicam-AI-$VERSION-$LABEL.dmg"
rm -f "$DMG"
hdiutil create -volname "$NAME" -srcfolder "$WORK/stage" -ov -format UDZO "$DMG" >/dev/null
echo "built $DMG ($(du -h "$DMG" | cut -f1))"

# Smoke test on a matching runner: launch the real app, wait for the engine and the page, save a picture of the window.
if [ "$(uname -m)" = "$ARCH" ] && [ -n "${RP_SMOKE_PNG:-}" ]; then
  RP_SNAPSHOT="$RP_SMOKE_PNG" "$C/MacOS/$NAME" &
  PID=$!
  for _ in $(seq 1 90); do [ -s "$RP_SMOKE_PNG" ] && break; kill -0 $PID 2>/dev/null || break; sleep 1; done
  kill $PID 2>/dev/null || true
  echo "--- engine log"; tail -20 "$HOME/Library/Logs/$NAME.log" || true
  [ -s "$RP_SMOKE_PNG" ] || { echo "Smoke test failed: the app window did not show the engine page."; exit 1; }
  echo "smoke test passed: $RP_SMOKE_PNG"
fi
