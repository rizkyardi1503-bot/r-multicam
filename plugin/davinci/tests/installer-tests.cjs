// Installer / uninstaller tests on redirected profile folders (no real install, no internet):
//  A Node.js package with a wrong SHA-256 is refused (clear error, nothing half-installed)
//  B a verified Node.js package is extracted to runtime\ and the shortcut uses runtime\node.exe
//  C a reinstall reuses runtime\ (no download) and keeps the saved sign-in
//  D without runtime\, Node.js >= 18 on PATH is used
//  E an FFmpeg package with a wrong SHA-256 is refused
//  F the uninstaller removes everything it installed and keeps the shared FFmpeg
// Usage: node tests/installer-tests.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto'), assert = require('assert');

const ROOT = path.join(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-installer-'));
let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const ps = (cmd) => cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8', timeout: 600000 });
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function profile(name) {
  const base = path.join(T, name);
  const p = { base, local: path.join(base, 'local'), roaming: path.join(base, 'roaming'), pd: path.join(base, 'pd', 'Fusion', 'Scripts', 'Utility'), old: path.join(base, 'old'), desk: path.join(base, 'desk'), pub: path.join(base, 'pub') };
  p.app = path.join(p.local, 'RProjectMulticam', 'davinci'); p.tools = path.join(p.local, 'RProjectMulticam', 'tools');
  for (const d of [p.local, p.roaming, p.pd, p.old, p.desk]) fs.mkdirSync(d, { recursive: true });
  return p;
}
function install(p, extra) {
  const r = ps('$env:LOCALAPPDATA=' + q(p.local) + '; $env:APPDATA=' + q(p.roaming) + '; & ' + q(path.join(ROOT, 'Install-DaVinci.ps1')) +
    ' -ScriptsDir ' + q(p.pd) + ' -OldScriptsDirs ' + q(p.old) + ' -ShortcutDirs ' + q(p.desk) + ' -OldPublicDir ' + q(p.pub) + ' -NoElevate ' + (extra || '') + '; exit $LASTEXITCODE');
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function shortcut(p) {
  const r = ps('$s=(New-Object -ComObject WScript.Shell).CreateShortcut(' + q(path.join(p.desk, 'R Project Engine.lnk')) + '); $s.TargetPath + "|" + $s.Arguments');
  return r.stdout.trim();
}
function zipFolder(folder, out) { const r = ps('Compress-Archive -Path ' + q(folder + '\\*') + ' -DestinationPath ' + q(out) + ' -Force'); if (r.status !== 0) throw Error(r.stderr); }

// fixtures: a real Node.js package layout (node.exe = this node), a bogus package, a real ffmpeg
const goodDir = path.join(T, 'pkg-good', 'node-v24.21.0-win-x64'); fs.mkdirSync(goodDir, { recursive: true });
fs.copyFileSync(process.execPath, path.join(goodDir, 'node.exe')); fs.writeFileSync(path.join(goodDir, 'LICENSE'), 'MIT (test)');
const goodZip = path.join(T, 'node-good.zip'); zipFolder(path.join(T, 'pkg-good'), goodZip);
const badDir = path.join(T, 'pkg-bad', 'x'); fs.mkdirSync(badDir, { recursive: true }); fs.writeFileSync(path.join(badDir, 'node.exe'), 'not node');
const badZip = path.join(T, 'bad.zip'); zipFolder(path.join(T, 'pkg-bad'), badZip);
const realFF = (() => { const local = path.join(process.env.LOCALAPPDATA, 'RProjectMulticam', 'tools', 'ffmpeg.exe'); if (fs.existsSync(local)) return local; return cp.execFileSync('where', ['ffmpeg'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim(); })();
const withFFmpeg = (p) => { fs.mkdirSync(p.tools, { recursive: true }); fs.copyFileSync(realFF, path.join(p.tools, 'ffmpeg.exe')); };

// A: wrong Node.js hash
let p = profile('a'); withFFmpeg(p);
let r = install(p, '-ForceNodeDownload -NodeZipSources ' + q(badZip));
ok(r.code !== 0 && /Could not download a verified copy of Node\.js/.test(r.out), 'A: wrong SHA-256 refused: ' + r.out.slice(-300));
ok(!fs.existsSync(path.join(p.app, 'runtime')) && !fs.existsSync(path.join(p.desk, 'R Project Engine.lnk')), 'A: no runtime, no shortcut');
console.log('PASS A: Node.js package with a wrong SHA-256 refused, nothing half-installed');

// B: verified Node.js package
p = profile('b'); withFFmpeg(p);
fs.writeFileSync(path.join(p.old, 'R Project Multicam AI.lua'), 'old'); fs.writeFileSync(path.join(p.old, 'rp_bridge_test.lua'), 'keep');
r = install(p, '-ForceNodeDownload -NodeZipSources ' + q(goodZip) + ' -NodeZipSha256 ' + sha(goodZip));
if (r.code !== 0) console.log(r.out); ok(r.code === 0, 'B: install ok');
const rt = path.join(p.app, 'runtime', 'node.exe');
ok(fs.existsSync(rt) && cp.execFileSync(rt, ['--version'], { encoding: 'utf8' }).startsWith('v') && fs.existsSync(path.join(p.app, 'runtime', 'NODE-LICENSE.txt')), 'B: runtime\\node.exe runs, license copied');
ok(shortcut(p).toLowerCase() === (rt + '|"' + path.join(p.app, 'rp-davinci-engine.js') + '"').toLowerCase(), 'B: shortcut -> runtime\\node.exe "rp-davinci-engine.js": ' + shortcut(p));
ok(fs.existsSync(path.join(p.pd, 'R Project Multicam AI.lua')) && !fs.existsSync(path.join(p.old, 'R Project Multicam AI.lua')) && fs.existsSync(path.join(p.old, 'rp_bridge_test.lua')), 'B: Lua in the all-users folder; old copy removed, other scripts kept');
for (const f of ['lib/account.js', 'lib/google-auth.js', 'lib/bridge.js', 'engine/ai-director.js', 'rp-davinci-engine.js']) ok(fs.existsSync(path.join(p.app, f)), 'B: installed ' + f);
ok(fs.readFileSync(path.join(p.tools, 'ffmpeg-path.txt'), 'utf8').trim() === path.join(p.tools, 'ffmpeg.exe'), 'B: ffmpeg-path.txt written like the Premiere installer');
ok(fs.existsSync(path.join(p.roaming, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Profiles', 'Default', 'RProjectBridge')), 'B: per-user command folder created');
// M1: the all-users script is recreated with a fixed ACL (inheritance off; Administrators + SYSTEM full; Users read & execute)
const aclOut = ps("$a = Get-Acl -LiteralPath " + q(path.join(p.pd, 'R Project Multicam AI.lua')) + "; 'PROTECTED=' + $a.AreAccessRulesProtected; $a.Access | ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value + '=' + $_.FileSystemRights + '/' + $_.AccessControlType + '/' + $_.IsInherited }").stdout;
ok(/PROTECTED=True/.test(aclOut) && /S-1-5-32-544=FullControl\/Allow\/False/.test(aclOut) && /S-1-5-18=FullControl\/Allow\/False/.test(aclOut) && /S-1-5-32-545=ReadAndExecute, Synchronize\/Allow\/False/.test(aclOut) && aclOut.trim().split(/\r?\n/).length === 4,
  'B: script ACL = Administrators + SYSTEM full, Users read/execute, no inheritance: ' + aclOut.replace(/\r?\n/g, ' | '));
fs.writeFileSync(path.join(p.pd, 'R Project Multicam AI.py'), 'old');
r = install(p, '-NodeZipSources ' + q(path.join(T, 'does-not-exist.zip')));
ok(r.code === 0 && !fs.existsSync(path.join(p.pd, 'R Project Multicam AI.py')), 'B: reinstall replaces the restricted script and removes an old .py: ' + r.out.slice(-500));
console.log('PASS B: verified Node.js package installed to runtime\\; shortcut, Lua script, engine, FFmpeg path, command folder');

// C: reinstall reuses runtime (no download) and keeps the saved sign-in
fs.writeFileSync(path.join(p.app, 'session.json'), '{"schema":1}');
r = install(p, '-NodeZipSources ' + q(path.join(T, 'does-not-exist.zip')));
ok(r.code === 0 && !/Node\.js 18 or newer not found/.test(r.out) && fs.existsSync(path.join(p.app, 'session.json')), 'C: runtime reused, session kept: ' + r.out.slice(-200));
console.log('PASS C: reinstall reuses runtime\\node.exe and keeps session.json');

// D: no runtime -> Node.js on PATH (>= 18)
fs.rmSync(path.join(p.app, 'runtime'), { recursive: true, force: true });
r = install(p, '-NodeZipSources ' + q(path.join(T, 'does-not-exist.zip')));
const pathNode = cp.execFileSync('where', ['node'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
ok(r.code === 0 && shortcut(p).toLowerCase().startsWith(pathNode.toLowerCase() + '|'), 'D: PATH node used: ' + shortcut(p));
console.log('PASS D: Node.js >= 18 on PATH is used when there is no private copy');

// E: wrong FFmpeg hash (no ffmpeg anywhere)
const p2 = profile('e');
r = install(p2, '-NoPathLookup -NodeZipSources ' + q(goodZip) + ' -NodeZipSha256 ' + sha(goodZip) + ' -FFmpegSources ' + q(badZip));
ok(r.code !== 0 && /Could not download a verified copy of FFmpeg 9\.0\.2/.test(r.out) && !fs.existsSync(path.join(p2.tools, 'ffmpeg.exe')), 'E: FFmpeg with a wrong SHA-256 refused: ' + r.out.slice(-300));
console.log('PASS E: FFmpeg package with a wrong SHA-256 refused');

// F: uninstall (L2): stops our engine, never aborts halfway, removes the Fusion.prefs keys only while Resolve is closed
const unq = (extra) => ps('$env:LOCALAPPDATA=' + q(p.local) + '; $env:APPDATA=' + q(p.roaming) + '; $env:ProgramData=' + q(path.join(p.base, 'pdroot')) + '; & ' + q(path.join(ROOT, 'Uninstall-DaVinci.ps1')) +
  ' -ScriptsDirs ' + q(p.pd) + ',' + q(p.old) + ' -ShortcutDirs ' + q(p.desk) + ' -OldPublicDir ' + q(p.pub) + ' -NoElevate ' + extra + '; exit $LASTEXITCODE');
const dummy = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', path.join(p.app, 'rp-davinci-engine.js')], { stdio: 'ignore' });
const other = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
fs.writeFileSync(path.join(p.app, 'engine.lock'), JSON.stringify({ pid: dummy.pid, url: 'http://127.0.0.1:1/?t=x' }));
const profDir = path.join(p.roaming, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Profiles', 'Default');
const prefsText = '{\n\tGlobal = {\n\t\tPaths = {\n\t\t\tMap = { ["Scripts:"] = "UserPaths:Scripts" },\n\t\t},\n\t\tRProjectBridge = {\n\t\t\tBeat = "s1xab:3:9:idle",\n\t\t\tHello = "s1xab:7b7d",\n\t\t\tResponse = "",\n\t\t\tSession = "4",\n\t\t},\n\t},\n}\n';
fs.writeFileSync(path.join(profDir, 'Fusion.prefs'), prefsText);
r = unq('-ResolveProcess node');                                  // "Resolve" (here: node) is running
const out1 = r.stdout || '';
ok(r.status === 1 && /Close DaVinci Resolve and run the uninstaller again/.test(out1) && fs.readFileSync(path.join(profDir, 'Fusion.prefs'), 'utf8') === prefsText, 'F: Resolve running -> prefs untouched, told to close Resolve and rerun: ' + out1.slice(-200));
ok(!fs.existsSync(p.app) && !fs.existsSync(path.join(p.pd, 'R Project Multicam AI.lua')) && !fs.existsSync(path.join(p.desk, 'R Project Engine.lnk')), 'F: all other steps still ran (no abort halfway)');
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
ok(!alive(dummy.pid) && alive(other.pid), 'F: our engine process (node ... rp-davinci-engine.js) stopped; an unrelated node process left alone');
other.kill();
r = unq('-ResolveProcess no-such-process');
const cleaned = fs.readFileSync(path.join(profDir, 'Fusion.prefs'), 'utf8');
ok(r.status === 0 && !/RProjectBridge/.test(cleaned) && /Map = \{ \["Scripts:"\] = "UserPaths:Scripts" \}/.test(cleaned) && fs.readFileSync(path.join(profDir, 'Fusion.prefs.rp-backup'), 'utf8') === prefsText,
  'F: Resolve closed -> RProjectBridge keys removed, other prefs kept, backup written: ' + (r.stdout || '').slice(-150));
ok(fs.existsSync(path.join(p.tools, 'ffmpeg.exe')) && fs.existsSync(path.join(p.old, 'rp_bridge_test.lua')), 'F: shared FFmpeg and other scripts kept');
console.log('PASS F: uninstaller stops our engine only, finishes every step with a summary, removes Fusion.prefs keys only while Resolve is closed; keeps shared FFmpeg');
fs.rmSync(T, { recursive: true, force: true });
console.log('ALL PASS (' + checks + ' checks)');
