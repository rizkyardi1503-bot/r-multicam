// Builds the user-facing installers from the release ZIP (pack-finalcut.cjs):
//   releases/app/R-Project-Multicam-AI-Setup-<version>.exe   Windows setup (NSIS: makensis)
//   releases/app/R-Project-Multicam-AI-<version>.dmg         macOS disk image with "R Project Multicam AI.app" and an
//                                                            Applications link (ISO 9660 + Rock Ridge: genisoimage)
// Both carry the exact files of the ZIP (same SHA256SUMS-FinalCut.txt), so the installers inside verify them as before.
// Usage: node installer/build-installers.cjs            (needs makensis, genisoimage and unzip on PATH)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto');
const HERE = __dirname, ROOT = path.join(HERE, '..'), REPO = path.join(ROOT, '..', '..');
const { NAME, VERSION } = require(path.join(ROOT, 'pack-finalcut.cjs'));
const ZIP = path.join(REPO, 'releases', 'finalcut', NAME + '.zip'), OUT = path.join(REPO, 'releases', 'app');
const run = (cmd, args, opts = {}) => { const r = cp.spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts)); if (r.status !== 0) throw new Error(cmd + ' failed: ' + (r.stderr || r.stdout || r.error)); return r.stdout; };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

if (!fs.existsSync(ZIP)) throw new Error('Run node plugin/finalcut/pack-finalcut.cjs first (' + ZIP + ' is missing).');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-installers-'));
try {
  run('unzip', ['-q', ZIP, '-d', work]);
  const pkg = path.join(work, NAME);
  fs.mkdirSync(OUT, { recursive: true });
  const outputs = [];

  // ---------------------------------------------------------------- Windows: offline NSIS setup .exe
  // Node.js and FFmpeg go inside the setup (pinned builds, the same SHA-256 as Install-Windows.ps1), cached in .cache/.
  const cache = path.join(HERE, '.cache'); fs.mkdirSync(cache, { recursive: true });
  const fetch = (urls, sum, name) => {
    const f = path.join(cache, name);
    if (!(fs.existsSync(f) && sha(f) === sum)) {
      for (const u of urls) { try { run('curl', ['-fsSL', '--retry', '2', '-o', f, u]); if (sha(f) === sum) break; } catch (e) { /* next source */ } }
      if (!fs.existsSync(f) || sha(f) !== sum) throw new Error(name + ': download failed or SHA-256 mismatch');
    }
    return f;
  };
  const nodeZip = fetch(['https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip'], '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541', 'node-v24.21.0-win-x64.zip');
  const ffZip = fetch(['https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip', 'https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip'],
    '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba', 'ffmpeg-9.0.2-essentials_build.zip');
  const nodeDir = path.join(work, 'node'), ffDir = path.join(work, 'ff');
  run('unzip', ['-q', '-j', nodeZip, 'node-v24.21.0-win-x64/node.exe', 'node-v24.21.0-win-x64/LICENSE', '-d', nodeDir]);
  run('unzip', ['-q', '-j', ffZip, 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe', 'ffmpeg-9.0.2-essentials_build/LICENSE', '-d', ffDir]);
  fs.renameSync(path.join(ffDir, 'LICENSE'), path.join(ffDir, 'FFMPEG-LICENSE.txt'));
  const exe = path.join(OUT, 'R-Project-Multicam-AI-Setup-' + VERSION + '.exe');
  run('makensis', ['-V2', '-DVERSION=' + VERSION, '-DSRC=' + pkg, '-DOUT=' + exe, '-DNODEDIR=' + nodeDir, '-DFFDIR=' + ffDir, path.join(HERE, 'setup.nsi')]);
  outputs.push(exe);

  // ---------------------------------------------------------------- macOS: .app inside a .dmg
  const vol = path.join(work, 'dmg'), app = path.join(vol, 'R Project Multicam AI.app'), contents = path.join(app, 'Contents');
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });
  fs.writeFileSync(path.join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>R Project Multicam AI</string>
  <key>CFBundleDisplayName</key><string>R Project Multicam AI</string>
  <key>CFBundleIdentifier</key><string>dev.r-multicam.app</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>R Project Multicam AI</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
`);
  const launcher = path.join(contents, 'MacOS', 'R Project Multicam AI');
  fs.copyFileSync(path.join(HERE, 'mac-launcher.sh'), launcher); fs.chmodSync(launcher, 0o755);
  fs.copyFileSync(path.join(pkg, 'app', 'assets', 'icon.icns'), path.join(contents, 'Resources', 'AppIcon.icns'));
  const payload = path.join(contents, 'Resources', 'payload');
  fs.cpSync(pkg, payload, { recursive: true });
  for (const f of ['Install-FinalCut.command', 'Uninstall-FinalCut.command']) fs.chmodSync(path.join(payload, f), 0o755);
  fs.writeFileSync(path.join(payload, 'VERSION.txt'), VERSION);
  fs.symlinkSync('/Applications', path.join(vol, 'Applications'));
  fs.writeFileSync(path.join(vol, 'Read me.txt'), [
    'R Project Multicam AI ' + VERSION, '',
    '1. Drag "R Project Multicam AI" onto Applications.',
    '2. Open it from Applications. The first time macOS asks: right-click the app > Open > Open',
    '   (on macOS 15: System Settings > Privacy & Security > Open Anyway).',
    '3. The first launch sets up Node.js and FFmpeg (about a minute, stay online), then the app opens.', '',
    '1. Seret "R Project Multicam AI" ke Applications.',
    '2. Buka dari Applications. Pertama kali: klik kanan aplikasi > Open > Open',
    '   (macOS 15: System Settings > Privacy & Security > Open Anyway).',
    '3. Pembukaan pertama menyiapkan Node.js dan FFmpeg (sekitar 1 menit, tetap online), lalu aplikasi terbuka.', ''].join('\n'));
  const dmg = path.join(OUT, 'R-Project-Multicam-AI-' + VERSION + '.dmg');
  run('genisoimage', ['-quiet', '-V', 'R Project Multicam AI', '-D', '-R', '-J', '-joliet-long', '-no-pad', '-o', dmg, vol]);
  outputs.push(dmg);

  for (const f of outputs) {
    fs.writeFileSync(f + '.sha256', sha(f) + '  ' + path.basename(f) + '\n');
    console.log(path.relative(REPO, f) + '  ' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB  ' + sha(f));
  }
} finally { fs.rmSync(work, { recursive: true, force: true }); }
