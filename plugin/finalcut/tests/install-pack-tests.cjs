// Package + installer tests: the ZIP is deterministic, holds exactly the user files with the right Unix modes and a
// checksum list; the committed ZIP is current (--check); Install-FinalCut.command, run from the extracted ZIP into a
// test root (RP_INSTALL_TEST_ROOT: no app, no downloads), installs a working engine that runs a real licensed job
// path, refuses a damaged package, and Uninstall-FinalCut.command removes it while keeping the shared FFmpeg folder.
// Needs bash, unzip, node and ffmpeg on PATH.  Usage: node tests/install-pack-tests.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http'), crypto = require('crypto'), assert = require('assert');
const pack = require('../pack-finalcut.cjs');
const { makeMedia } = require('./media.cjs');

let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'rp-fcp-' + p + '-'));
const sh = (args, env) => cp.spawnSync('bash', args, { encoding: 'utf8', env: Object.assign({}, process.env, env || {}) });
function get(url, p) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    http.get({ host: '127.0.0.1', port: u.port, path: p + '?t=' + u.searchParams.get('t'), headers: { Host: '127.0.0.1:' + u.port } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(t) }));
    }).on('error', reject);
  });
}

(async () => {
  // ---------------------------------------------------------------- package
  const a = pack.makeZip(), b = pack.makeZip();
  ok(a.buf.equals(b.buf), 'deterministic: same bytes twice');
  for (const need of ['Install-FinalCut.command', 'Uninstall-FinalCut.command', 'README-FinalCut.md', 'THIRD-PARTY-NOTICES.txt', 'rp-finalcut-engine.js', 'rp-finalcut-job.mjs',
    'SHA256SUMS-FinalCut.txt', 'lib/account.js', 'lib/google-auth.js', 'rp-engine/lib/fcpxml.mjs', 'rp-engine/lib/tools.mjs', 'engine/ai-director.js', 'engine/audio-engine.js'])
    ok(a.files.includes(need), 'package contains ' + need);
  ok(a.files.every((f) => !/^tests\//.test(f) && !/\.cjs$/.test(f)), 'no tests or dev scripts in the package');
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'pack-finalcut.cjs'), '--check'], { encoding: 'utf8' });
  ok(r.status === 0, 'committed ZIP and shared copies are current (pack-finalcut.cjs --check): ' + r.stderr);
  const zinfo = cp.spawnSync('zipinfo', [pack.OUT], { encoding: 'utf8' });
  if (!zinfo.error) {
    ok(/-rwxr-xr-x .* unx .*Install-FinalCut\.command/.test(zinfo.stdout) && /-rwxr-xr-x .* unx .*Uninstall-FinalCut\.command/.test(zinfo.stdout), '.command files stored executable (Unix mode)');
    ok(/-rw-r--r-- .* unx .*rp-finalcut-engine\.js/.test(zinfo.stdout), 'other files 0644');
  }
  // The DaVinci account file in the package is the current one (Final Cut follows plugin/davinci/lib/account.js).
  ok(fs.readFileSync(path.join(__dirname, '..', 'lib', 'account.js')).equals(fs.readFileSync(path.join(__dirname, '..', '..', 'davinci', 'lib', 'account.js'))), 'lib/account.js = plugin/davinci/lib/account.js');
  for (const f of ['ai-director.js', 'audio-engine.js']) ok(fs.readFileSync(path.join(__dirname, '..', 'engine', f)).equals(fs.readFileSync(path.join(__dirname, '..', '..', 'macos', 'Plugin', f))), 'engine/' + f + ' = Mac Premiere engine');
  console.log('PASS package: ' + pack.NAME + '.zip · ' + a.buf.length + ' bytes · ' + a.files.length + ' files · SHA256 ' + a.sha);

  // ---------------------------------------------------------------- install from the extracted ZIP
  const ex = tmp('unzip');
  ok(cp.spawnSync('unzip', ['-q', pack.OUT, '-d', ex]).status === 0, 'unzip');
  const pkg = path.join(ex, pack.NAME);
  const root = tmp('home'), support = path.join(root, 'Library', 'Application Support', 'RProjectMulticam');
  fs.mkdirSync(path.join(support, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(support, 'device-id.txt'), 'RP-1111-2222-3333-4444\n');    // as the Premiere plugin left it
  let res = sh([path.join(pkg, 'Install-FinalCut.command')], { RP_INSTALL_TEST_ROOT: root });
  ok(res.status === 0, 'installer ran: ' + res.stdout + res.stderr);
  const dest = path.join(support, 'finalcut'), app = path.join(dest, 'app');
  for (const f of ['rp-finalcut-engine.js', 'rp-finalcut-job.mjs', 'lib/account.js', 'rp-engine/lib/engine.mjs', 'engine/ai-director.js', 'README-FinalCut.md'])
    ok(fs.existsSync(path.join(app, f)), 'installed ' + f);
  ok(!fs.existsSync(path.join(app, 'Install-FinalCut.command')) && fs.existsSync(path.join(dest, 'Uninstall-FinalCut.command')), 'installer not copied; uninstaller kept next to the engine');
  ok(fs.statSync(path.join(dest, 'launch.sh')).mode & 0o100, 'launch.sh executable');
  const launch = fs.readFileSync(path.join(dest, 'launch.sh'), 'utf8');
  ok(launch.includes(path.join(app, 'rp-finalcut-engine.js')) && /nohup .* < \/dev\/null &/.test(launch), 'launcher starts the installed engine in the background');
  const ffPath = fs.readFileSync(path.join(support, 'tools', 'ffmpeg-path.txt'), 'utf8').trim();
  ok(ffPath && cp.spawnSync(ffPath, ['-version']).status === 0, 'FFmpeg recorded for the engine: ' + ffPath);
  ok(fs.readFileSync(path.join(support, 'device-id.txt'), 'utf8').trim() === 'RP-1111-2222-3333-4444', 'device id shared with Premiere left untouched');
  res = sh([path.join(pkg, 'Install-FinalCut.command')], { RP_INSTALL_TEST_ROOT: root });
  ok(res.status === 0 && !fs.existsSync(path.join(dest, 'app.old')) && !fs.existsSync(path.join(dest, 'app.new')), 'reinstall over an existing install');
  console.log('PASS install: engine, launcher, FFmpeg path, device id kept, reinstall');

  // ---------------------------------------------------------------- the installed engine starts and runs a job
  const media = makeMedia(path.join(os.tmpdir(), 'rp-fcp-media-v2'));
  const child = cp.spawn(process.execPath, [path.join(app, 'rp-finalcut-engine.js'), '--no-browser'], { env: Object.assign({}, process.env, { HOME: root }), stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 100 && !/http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+/.test(out); i++) await new Promise((r2) => setTimeout(r2, 100));
    const url = (out.match(/http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+/) || [])[0];
    ok(url, 'installed engine printed its address');
    const st = await get(url, '/api/status');
    ok(st.status === 200 && /Final Cut v1\.0\.0/.test(st.body.version) && st.body.account && st.body.account.signedIn === false, 'installed engine answers, signed out');
    const lock = JSON.parse(fs.readFileSync(path.join(dest, 'engine.lock'), 'utf8'));
    ok(lock.pid === child.pid && lock.url === url, 'engine.lock written in the install folder');
    // Same engine code, run as the job child, from the installed folder (license is bypassed only in this direct test).
    const job = cp.fork(path.join(app, 'rp-finalcut-job.mjs'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: Object.assign({}, process.env, { HOME: root }) });
    const result = await new Promise((resolve, reject) => {
      job.on('message', (m) => { if (m.type === 'ready') job.send({ type: 'run', tool: 'analyze_music', args: { music: media.music } }); else if (m.type === 'done') resolve(m.result); else if (m.type === 'error') reject(new Error(m.message)); });
      job.on('exit', (c) => reject(new Error('job exit ' + c)));
    });
    ok(Math.abs(result.bpm - media.bpm) <= 1.5, 'installed engine analyzes music: BPM ' + result.bpm);
  } finally { child.kill('SIGTERM'); await new Promise((r2) => child.once('exit', r2)); }
  ok(!fs.existsSync(path.join(dest, 'engine.lock')), 'lock removed when the engine stops');
  console.log('PASS installed engine: starts, status API, lock, analysis from the installed files');

  // ---------------------------------------------------------------- damaged package refused
  const bad = tmp('bad');
  cp.spawnSync('cp', ['-R', pkg, bad]);
  const badPkg = path.join(bad, pack.NAME);
  fs.appendFileSync(path.join(badPkg, 'rp-finalcut-engine.js'), '\n// tampered\n');
  const root2 = tmp('home2');
  res = sh([path.join(badPkg, 'Install-FinalCut.command')], { RP_INSTALL_TEST_ROOT: root2 });
  ok(res.status !== 0 && /Package damaged: rp-finalcut-engine\.js/.test(res.stdout), 'tampered file refused: ' + res.stdout.trim().split('\n').pop());
  ok(!fs.existsSync(path.join(root2, 'Library', 'Application Support', 'RProjectMulticam', 'finalcut', 'app')), 'nothing installed from a damaged package');
  fs.rmSync(path.join(badPkg, 'lib', 'account.js'));
  res = sh([path.join(badPkg, 'Install-FinalCut.command')], { RP_INSTALL_TEST_ROOT: root2 });
  ok(res.status !== 0 && /Missing package file/.test(res.stdout), 'missing file refused');
  console.log('PASS damaged / incomplete package refused before anything is installed');

  // ---------------------------------------------------------------- uninstall
  res = sh([path.join(dest, 'Uninstall-FinalCut.command')], { RP_INSTALL_TEST_ROOT: root });
  ok(res.status === 0 && !fs.existsSync(dest), 'uninstaller removed the Final Cut engine');
  ok(fs.existsSync(path.join(support, 'tools', 'ffmpeg-path.txt')) && fs.existsSync(path.join(support, 'device-id.txt')), 'shared FFmpeg folder and device id kept (Premiere uses them)');
  console.log('PASS uninstall');
  console.log('ALL PASS (' + checks + ' checks)');
})().catch((e) => { console.error(e); process.exit(1); });
