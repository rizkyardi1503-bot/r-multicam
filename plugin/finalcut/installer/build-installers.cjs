// Builds the user-facing installers from the release ZIP (pack-finalcut.cjs):
//   releases/app/R-Project-Multicam-AI-Setup-<version>.exe   Windows setup (NSIS: makensis)
//   (the macOS .dmg is built on a Mac by .github/workflows/app-release.yml)
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

  // macOS: the native app and its .dmg are built on a Mac by .github/workflows/app-release.yml (plugin/finalcut/mac).
  for (const f of fs.readdirSync(OUT)) if (/-Mac-(AppleSilicon|Intel)\.zip(\.sha256)?$|\.dmg(\.sha256)?$/.test(f)) fs.rmSync(path.join(OUT, f));

  for (const f of outputs) {
    fs.writeFileSync(f + '.sha256', sha(f) + '  ' + path.basename(f) + '\n');
    console.log(path.relative(REPO, f) + '  ' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB  ' + sha(f));
  }
} finally { fs.rmSync(work, { recursive: true, force: true }); }
