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

  // ---------------------------------------------------------------- macOS: self-contained .app, one ZIP per processor
  // The app carries the engine, Node.js and FFmpeg (pinned builds, the same SHA-256 as Install-FinalCut.command), so it
  // runs without installing or downloading anything. ZIP (not .dmg) keeps it small enough and Archive Utility keeps the
  // executable bits.
  const MAC = [
    { arch: 'arm64', label: 'AppleSilicon', node: ['https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-arm64.tar.gz', 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057', 'node-v24.21.0-darwin-arm64'],
      ff: ['https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2/ffmpeg.zip', 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924', 'ffmpeg-mac-arm64.zip'] },
    { arch: 'x86_64', label: 'Intel', node: ['https://nodejs.org/dist/v24.21.0/node-v24.21.0-darwin-x64.tar.gz', '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097', 'node-v24.21.0-darwin-x64'],
      ff: ['https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2/ffmpeg.zip', '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4', 'ffmpeg-mac-amd64.zip'] },
  ];
  for (const m of MAC) {
    const nodeTgz = fetch([m.node[0]], m.node[1], m.node[2] + '.tar.gz'), ffz = fetch([m.ff[0]], m.ff[1], m.ff[2]);
    const vol = path.join(work, 'mac-' + m.arch), app = path.join(vol, 'R Project Multicam AI.app'), contents = path.join(app, 'Contents');
    const res = path.join(contents, 'Resources'), rt = path.join(res, 'runtime');
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true }); fs.mkdirSync(rt, { recursive: true });
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
    fs.copyFileSync(path.join(pkg, 'app', 'assets', 'icon.icns'), path.join(res, 'AppIcon.icns'));
    fs.cpSync(path.join(pkg, 'app'), path.join(res, 'app'), { recursive: true });
    for (const f of ['README-FinalCut.md', 'THIRD-PARTY-NOTICES.txt']) fs.copyFileSync(path.join(pkg, f), path.join(res, f));
    run('tar', ['-xzf', nodeTgz, '-C', work, m.node[2] + '/bin/node', m.node[2] + '/LICENSE']);
    fs.renameSync(path.join(work, m.node[2], 'bin', 'node'), path.join(rt, 'node'));
    fs.renameSync(path.join(work, m.node[2], 'LICENSE'), path.join(rt, 'NODE-LICENSE.txt'));
    const ffx = path.join(work, 'ff-' + m.arch); run('unzip', ['-q', '-o', ffz, '-d', ffx]);
    const ffbin = run('find', [ffx, '-type', 'f', '-name', 'ffmpeg']).trim().split('\n')[0];
    fs.renameSync(ffbin, path.join(rt, 'ffmpeg'));
    fs.chmodSync(path.join(rt, 'node'), 0o755); fs.chmodSync(path.join(rt, 'ffmpeg'), 0o755);
    fs.writeFileSync(path.join(rt, 'ARCH.txt'), m.arch);
    fs.writeFileSync(path.join(vol, 'Read me.txt'), [
      'R Project Multicam AI ' + VERSION + ' for ' + (m.arch === 'arm64' ? 'Macs with Apple silicon (M1 or newer)' : 'Intel Macs'), '',
      '1. Drag "R Project Multicam AI" into your Applications folder.',
      '2. Right-click it > Open > Open (only the first time).',
      '   macOS 15 or newer: open it once, then System Settings > Privacy & Security > Open Anyway.',
      'Nothing else to install: the app includes everything it needs.', '',
      '1. Seret "R Project Multicam AI" ke folder Applications.',
      '2. Klik kanan > Open > Open (hanya pertama kali).',
      '   macOS 15 ke atas: buka sekali, lalu System Settings > Privacy & Security > Open Anyway.',
      'Tidak perlu install apa-apa lagi: semua sudah ada di dalam aplikasi.', ''].join('\n'));
    const zip = path.join(OUT, 'R-Project-Multicam-AI-' + VERSION + '-Mac-' + m.label + '.zip');
    fs.rmSync(zip, { force: true });
    run('zip', ['-q', '-r', '-y', '-9', '-X', zip, 'R Project Multicam AI.app', 'Read me.txt'], { cwd: vol });
    outputs.push(zip);
  }
  fs.rmSync(path.join(OUT, 'R-Project-Multicam-AI-' + VERSION + '.dmg'), { force: true });
  fs.rmSync(path.join(OUT, 'R-Project-Multicam-AI-' + VERSION + '.dmg.sha256'), { force: true });

  for (const f of outputs) {
    fs.writeFileSync(f + '.sha256', sha(f) + '  ' + path.basename(f) + '\n');
    console.log(path.relative(REPO, f) + '  ' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB  ' + sha(f));
  }
} finally { fs.rmSync(work, { recursive: true, force: true }); }
