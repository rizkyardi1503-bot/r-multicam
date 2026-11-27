#!/usr/bin/env node
// R Project Multicam AI for Final Cut Pro and DaVinci Resolve (macOS; Windows for DaVinci) - v1.1.0 draft.
// Serves the control page on http://127.0.0.1:<port>/?t=<token> (localhost only). The user drops the timeline exported
// as FCPXML from Final Cut Pro or DaVinci Resolve; the engine (the Premiere plugin's own code, through rp-engine) syncs
// the clips by audio, paces the cuts to the music and writes an FCPXML to import back: a multicam project for Final Cut
// Pro, a flat timeline for DaVinci Resolve.
//   node rp-finalcut-engine.js [--no-browser] [--port N]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), cp = require('child_process');

const APP = __dirname;
// The engine files packaged next to this script (never an older Premiere install on the same Mac).
process.env.RP_PLUGIN_DIR = process.env.RP_PLUGIN_DIR || path.join(APP, 'engine');
const { Account } = require('./lib/account');
const { Studio, revealFile } = require('./lib/fcp-workflow');

const FCP_VERSION = '1.2.0';
function engineVersion() {
  try { return (fs.readFileSync(path.join(APP, 'engine', 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([0-9.]+)"/) || [])[1] || ''; }
  catch (e) { return ''; }
}
const ENGINE_VERSION = engineVersion();
const VERSION = 'v' + FCP_VERSION + ' (engine ' + (ENGINE_VERSION || '?') + ')';
// Reported to the license server: same version line as the Premiere build it carries, so the minimum-version rule and
// "update available" work the same way. Platform macOS: Premiere and Final Cut on one Mac share one device id.
const LICENSE_VERSION = (ENGINE_VERSION || '0') + '-finalcut-v' + FCP_VERSION;
const HEARTBEAT_MS = 5 * 60000;

function supportDir() {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'RProjectMulticam');
  return path.join(os.homedir(), 'Library', 'Application Support', 'RProjectMulticam');
}
function appDir() { return process.env.RP_FINALCUT_DIR || path.join(supportDir(), 'finalcut'); }

/** FFmpeg chosen by the installer (same file as the Premiere plugin), else PATH. */
function ffmpegPath() {
  if (process.env.RP_FFMPEG) return process.env.RP_FFMPEG;
  try { const p = fs.readFileSync(path.join(supportDir(), 'tools', 'ffmpeg-path.txt'), 'utf8').trim(); if (p && fs.existsSync(p)) return p; } catch (e) { /* none */ }
  const own = path.join(supportDir(), 'tools', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');   // put there by the installers
  return fs.existsSync(own) ? own : '';
}

/** Streams an MP4 with Range support (the player needs it to seek). */
function sendVideo(req, res, file) {
  const size = fs.statSync(file).size, m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  const head = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  if (!m) { res.writeHead(200, Object.assign(head, { 'Content-Length': size })); return fs.createReadStream(file).pipe(res); }
  let start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1]), end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!(start <= end && start < size)) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
  res.writeHead(206, Object.assign(head, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': end - start + 1 }));
  return fs.createReadStream(file, { start, end }).pipe(res);
}

function openBrowser(url) {
  try {
    const c = process.platform === 'win32' ? cp.spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' })
      : cp.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    c.on('error', () => {}); c.unref();
  } catch (e) { /* the URL is printed in the console */ }
}

/** A Chromium browser that can open a page as its own app window (no tabs, no address bar): Edge ships with Windows. */
function appBrowser() {
  if (process.env.RP_APP_BROWSER) return process.env.RP_APP_BROWSER;           // tests
  const env = process.env, list = process.platform === 'win32'
    ? [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean).flatMap((b) => [
      path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(b, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')])
    : process.platform === 'darwin'
      ? ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'].flatMap((n) => ['/Applications', path.join(os.homedir(), 'Applications')].map((d) => path.join(d, n + '.app', 'Contents', 'MacOS', n)))
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return list.find((f) => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }) || '';
}

/** Opens the page in its own window. Returns the window's process (it ends when the window closes), or null when only a
 *  normal browser tab could be opened. A separate browser profile keeps the window in a process of its own. */
function openAppWindow(url, profileDir) {
  const exe = appBrowser();
  if (!exe) { openBrowser(url); return null; }
  try {
    const c = cp.spawn(exe, ['--app=' + url, '--user-data-dir=' + profileDir, '--window-size=980,900', '--no-first-run', '--no-default-browser-check',
      '--disable-features=Translate', '--class=RProjectMulticamAI'], { detached: false, stdio: 'ignore', windowsHide: false });
    c.on('error', () => openBrowser(url));
    return c;
  } catch (e) { openBrowser(url); return null; }
}

/** Is an R Project Engine answering at this URL (status API with its token, 1 s timeout)? */
function engineAnswers(url, timeoutMs = 1000) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve(false); }
    if (u.hostname !== '127.0.0.1') return resolve(false);
    const req = http.get({ host: '127.0.0.1', port: u.port, path: '/api/status?t=' + encodeURIComponent(u.searchParams.get('t') || ''), headers: { Host: '127.0.0.1:' + u.port }, timeout: timeoutMs }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(res.statusCode === 200 && JSON.parse(body).ok === true); } catch (e) { resolve(false); } });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** One engine at a time. The lock is created atomically ('wx'); a lock only counts while its engine answers. */
async function acquireLock(lockFile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return { fd: fs.openSync(lockFile, 'wx') }; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let lock = null;
    try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (e) { /* empty or being written */ }
    if (lock && lock.url && await engineAnswers(lock.url)) return { running: lock.url };
    if (!lock && attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
    fs.rmSync(lockFile, { force: true });
  }
  throw new Error('Could not create ' + lockFile);
}

async function start(opts = {}) {
  const lines = [], clients = new Set();
  let seq = 0, progress = null, lastResult = null;
  function log(text) {
    const line = { n: ++seq, t: new Date().toTimeString().slice(0, 8), text: String(text) };
    lines.push(line); if (lines.length > 3000) lines.shift();
    if (!opts.quiet) console.log('[' + line.t + '] ' + line.text);
    for (const res of clients) res.write('data: ' + JSON.stringify(line) + '\n\n');
  }
  if (!process.env.RP_FFMPEG) { const ff = ffmpegPath(); if (ff) process.env.RP_FFMPEG = ff; }
  const studio = opts.studio || new Studio({ log, progress: (p) => { progress = p; }, picker: opts.picker, open: opts.open, outDir: opts.outDir });
  const token = opts.token || crypto.randomBytes(16).toString('hex');
  // License gate: same R Project account and device as the Premiere plugin, checked before every engine action.
  const account = opts.account || new Account({ log, platform: process.platform === 'win32' ? 'Windows' : 'macOS', pluginVersion: LICENSE_VERSION, sessionFile: path.join(supportDir(), 'finalcut', 'session.json') });
  const restored = Promise.resolve(account.restore()).then((st) => { if (st && st.signedIn) log('Account: ' + st.email + ' · ' + st.label); }).catch((e) => log('Account check failed: ' + e.message));
  const beat = setInterval(() => { if (account.session) Promise.resolve(account.heartbeat()).catch((e) => log('Account: ' + e.message)); }, HEARTBEAT_MS);
  if (beat.unref) beat.unref();

  async function licensed(name) {
    await restored;
    try { await account.ensureAllowed(); return null; }
    catch (e) { log(name + ': ' + e.message); lastResult = { action: name, at: Date.now(), ok: false, error: e.message, license: true }; return { status: 403, body: { ok: false, error: e.message, code: e.code || 'NOT_ALLOWED' } }; }
  }
  /** Long engine jobs run in the background; the page follows progress and the log. */
  async function job(name, fn) {
    if (studio.busy) return { status: 409, body: { ok: false, error: 'Busy: ' + studio.busy + ' is still running.' } };
    const denied = await licensed(name);
    if (denied) return denied;
    log('--- ' + name + ' ---');
    const done = Promise.resolve().then(fn).then((r) => { lastResult = Object.assign({ action: name, at: Date.now() }, r); log(name + ': done.'); return r; },
      (e) => { const stopped = e && (e.name === 'AbortError' || /abort|stopped/i.test(e.message)); lastResult = { action: name, at: Date.now(), ok: false, error: stopped ? 'Stopped.' : e.message }; log(name + ': ' + (stopped ? 'stopped.' : 'ERROR: ' + e.message)); });
    if (opts.awaitActions) await done;
    return { status: 202, body: { ok: true, started: name } };
  }
  /** Quick actions (file dialogs, list edits): answered when done. */
  async function quick(name, fn) {
    if (studio.busy) return { status: 409, body: { ok: false, error: 'Busy: ' + studio.busy + ' is still running.' } };
    try { const r = await fn(); return { body: Object.assign({ ok: true }, r || {}, { studio: studio.state() }) }; }
    catch (e) { log(name + ': ' + e.message); return { status: 400, body: { ok: false, error: e.message, studio: studio.state() } }; }
  }
  async function accountCall(name, fn) {
    try { const r = await fn(); const st = account.status(); log(name + ': ' + (r && r.message ? r.message : st.signedIn ? st.email + ' · ' + st.label : st.label)); return { body: Object.assign({ ok: true }, r && r.message ? { message: r.message } : {}, r && r.link ? { link: r.link } : {}, { account: st }) }; }
    catch (e) { log(name + ': ' + e.message); return { status: 400, body: { ok: false, error: e.message, code: e.code || '', account: account.status() } }; }
  }

  const routes = {
    'GET /api/status': async () => ({ body: { ok: true, version: VERSION, account: account.status(), busy: studio.busy, progress, lastResult, studio: studio.state(), ffmpeg: !!process.env.RP_FFMPEG } }),
    'POST /api/music': () => quick('Choose music', () => studio.pickMusic()),
    'POST /api/camera/add': (b) => quick('Add camera', () => studio.addCamera(b.mode === 'files' ? 'files' : 'folder', b.role)),
    'POST /api/camera/remove': (b) => quick('Remove camera', () => studio.removeCamera(b.index)),
    'POST /api/camera/roles': (b) => quick('Camera roles', () => { studio.setRoles(b.roles); return {}; }),
    'POST /api/analyze': () => job('Analyze Music', () => studio.analyze()),
    'POST /api/xml': (b) => quick('Load timeline', () => studio.loadTimeline(b.text, b.name)),
    'POST /api/multicam': (b) => { studio.setRoles(b.roles); return job('Create edit', () => studio.multicam({ cadences: b.cadences, dropCamera: b.dropCamera, sensitivity: b.sensitivity, target: b.target })); },
    'POST /api/drops': (b) => { studio.setRoles(b.roles); return job('Find drops', () => studio.findDrops({ cadences: b.cadences })); },
    'POST /api/export': (b) => job('Export', () => studio.exportVideos({ drops: b.drops, full: !!b.full, format: b.format, length: b.length, zoom: b.zoom !== false, lut: b.lut !== false })),
    'POST /api/export-xml': (b) => job('Export XML', () => studio.exportXml(b.target)),
    'GET /api/timeline': (b, url) => quick('Timeline', () => ({ timeline: studio.dropTimeline(url.searchParams.get('i'), url.searchParams.get('l')) })),
    'POST /api/camera': (b) => quick('Change camera', () => studio.setCamera(b.cut, b.camera)),
    'POST /api/lut': () => quick('Choose LUT', () => studio.pickLut()),
    'POST /api/lut/clear': () => quick('LUT', () => { studio.lut = ''; return { message: 'No LUT.' }; }),
    'POST /api/open-folder': async () => {
      if (!studio.project) return { status: 400, body: { ok: false, error: 'Nothing exported yet.' } };
      const last = studio.exports[studio.exports.length - 1];
      return { body: { ok: true, shownIn: await revealFile(last ? last.file : studio.planFile) } };
    },
    'POST /api/stop': async () => ({ body: { ok: true, stopping: studio.stop() } }),
    'POST /api/reveal': async () => {
      const r = studio.result;
      if (!r || !r.fcpxml) return { status: 400, body: { ok: false, error: 'Nothing created yet.' } };
      return { body: { ok: true, shownIn: await revealFile(r.fcpxml) } };
    },
    'POST /api/account/signin': async (b) => accountCall('Sign in', () => account.signIn(b.email, b.password)),
    'POST /api/account/google': async () => accountCall('Google sign-in', () => account.startGoogle()),
    'POST /api/account/google/cancel': async () => accountCall('Google sign-in', () => account.cancelGoogle()),
    'POST /api/account/forgot': async (b) => accountCall('Forgot password', () => account.forgotPassword(b.email)),
    'POST /api/account/signout': async () => accountCall('Sign out', () => account.signOut()),
    'POST /api/account/check': async () => accountCall('License check', () => account.heartbeat().then(() => account.status())),
  };

  const MAX_SSE = 8;
  const tokenOk = (t) => typeof t === 'string' && t.length === token.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(token));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const host = String(req.headers.host || '');
    const send = (status, body, type) => {
      res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });
      res.end(type ? body : JSON.stringify(body));
    };
    // Localhost only + token on every request (no DNS rebinding, no other local page can drive the engine).
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(403, { ok: false, error: 'Forbidden host.' });
    if (!tokenOk(url.searchParams.get('t')) && !tokenOk(req.headers['x-rp-token'])) return send(403, { ok: false, error: 'Missing or wrong token. Open the address printed by R Project Engine.' });
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== 'http://' + host) return send(403, { ok: false, error: 'Forbidden origin.' });
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(200, page(token), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/api/result') {
        const r = studio.result;
        if (!r || !r.fcpxml || !fs.existsSync(r.fcpxml)) return send(404, { ok: false, error: 'Nothing created yet.' });
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'attachment; filename="' + r.name.replace(/[^\w .()-]/g, '_') + '"' });
        return res.end(fs.readFileSync(r.fcpxml));
      }
      if (req.method === 'GET' && url.pathname === '/api/preview') {
        const denied = await licensed('Preview');
        if (denied) return send(denied.status, denied.body);
        let file;
        try { file = await studio.preview(url.searchParams.get('i'), { format: url.searchParams.get('f'), length: url.searchParams.get('l'), zoom: url.searchParams.get('z') !== '0' }); }
        catch (e) { log('Preview: ' + e.message); return send(400, { ok: false, error: e.message }); }
        return sendVideo(req, res, file);
      }
      if (req.method === 'GET' && url.pathname === '/api/thumb') {
        const f = studio.thumb(url.searchParams.get('i'));
        if (!f) return send(404, { ok: false, error: 'No picture.' });
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(f));
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (clients.size >= MAX_SSE) return send(429, { ok: false, error: 'Too many open pages.' });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'Referrer-Policy': 'no-referrer' });
        const since = Number(url.searchParams.get('since')) || 0;
        for (const l of lines) if (l.n > since) res.write('data: ' + JSON.stringify(l) + '\n\n');
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      const route = routes[req.method + ' ' + url.pathname];
      if (!route) return send(404, { ok: false, error: 'Not found.' });
      let body = {};
      if (req.method === 'POST') {
        if (!/application\/json/.test(String(req.headers['content-type'] || ''))) return send(415, { ok: false, error: 'JSON body required.' });
        let raw = '';
        for await (const chunk of req) { raw += chunk; if (raw.length > 40e6) { send(413, { ok: false, error: 'Too large.' }); req.destroy(); return; } }
        body = raw ? JSON.parse(raw) : {};
      }
      const r = await route(body, url);
      return send(r.status || 200, r.body);
    } catch (e) { return send(500, { ok: false, error: String(e && e.message || e) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port || 0, '127.0.0.1', resolve); });
  const port = server.address().port, url = 'http://127.0.0.1:' + port + '/?t=' + token;
  log('R Project Engine ' + VERSION + ' running at ' + url);
  if (!process.env.RP_FFMPEG) log('FFmpeg was not found. Run the installer again (it installs a verified FFmpeg).');
  return {
    url, port, token, studio, account, log, lines,
    close: () => new Promise((resolve) => { clearInterval(beat); studio.stop(); for (const c of clients) c.end(); server.close(() => resolve()); }),
  };
}

let ICON = '';
try { ICON = 'data:image/png;base64,' + fs.readFileSync(path.join(APP, 'assets', 'icon-256.png')).toString('base64'); } catch (e) { /* no icon */ }
function page(token) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>R Project Multicam AI</title>${ICON ? '<link rel="icon" href="' + ICON + '">' : ''}<style>
:root{--ink:#1d1d1f;--prose:#424245;--muted:#6e6e73;--line:#0000001a;--soft:#f5f5f7;--blue:#0071e3;--blue2:#0066cc;--ok:#34c759;--err:#d70015}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;background:#fff;color:var(--ink);font:15px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;overflow:hidden}
button,input{font:inherit;color:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.45}[hidden]{display:none!important}
header{flex:none;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 18px;border-bottom:1px solid var(--line);background:#fbfbfd}
.brand{display:flex;align-items:center;gap:9px;font-weight:600}.brand i{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:var(--blue);color:#fff;font-style:normal;font-size:14px}
.pill{display:inline-flex;align-items:center;gap:8px;min-height:30px;padding:0 13px;border:1px solid #d2d2d7;border-radius:999px;background:#fff;font-size:13px}.pill b{width:7px;height:7px;border-radius:50%;background:#c7c7cc}.pill b.on{background:var(--ok)}
.app{flex:1;min-height:0;display:grid;grid-template-columns:290px 1fr 300px}
aside,.right{overflow:auto;padding:18px;background:#fbfbfd}aside{border-right:1px solid var(--line)}.right{border-left:1px solid var(--line)}
h3{margin:0 0 10px;font-size:13px;font-weight:600;color:var(--muted);letter-spacing:.02em;text-transform:uppercase}h3+*{margin-top:0}
.box{border-radius:14px;background:#fff;border:1px solid var(--line);padding:4px 12px;margin-bottom:12px}
.item{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:44px}.item+.item{border-top:1px solid var(--line)}.item>span{color:var(--muted);font-size:13px;white-space:nowrap}
.add{min-height:28px;max-width:170px;padding:0 11px;border:0;border-radius:999px;background:var(--soft);color:var(--blue2);font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cams{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px;padding:6px 0}.cams span{display:inline-flex;align-items:center;gap:5px;padding:3px 4px 3px 10px;border-radius:999px;background:var(--soft);font-size:12px}.cams span button{width:18px;height:18px;border:0;border-radius:50%;background:#e3e3e8;color:var(--muted);font-size:10px}
.seg{display:inline-flex;padding:2px;border-radius:999px;background:#ececf0}.seg button{min-height:28px;padding:0 11px;border:0;border-radius:999px;background:none;color:var(--prose);font-size:12px;font-weight:500}.seg button[aria-pressed="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 3px #0000001f}
.beats{display:inline-flex;gap:4px}.beats button{width:32px;height:28px;border:0;border-radius:999px;background:#ececf0;color:var(--prose);font-size:12px;font-weight:500}.beats button[aria-pressed="true"]{background:var(--ink);color:#fff}
.switch{position:relative;width:40px;height:24px;border:0;border-radius:999px;background:#e3e3e8;transition:background .2s}.switch::after{content:"";position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0003;transition:transform .2s}.switch[aria-pressed="true"]{background:var(--ok)}.switch[aria-pressed="true"]::after{transform:translateX(16px)}
.go{display:block;width:100%;min-height:42px;border:0;border-radius:999px;background:var(--blue);color:#fff;font-size:15px;font-weight:500}.go:hover:not(:disabled){background:#0077ed}
.btn{min-height:36px;padding:0 16px;border:1px solid var(--blue);border-radius:999px;background:#fff;color:var(--blue);font-size:13px;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}.btn.fill{background:var(--blue);color:#fff}
.two{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.note{margin:8px 0 0;color:var(--muted);font-size:12px}
.link{padding:0;border:0;background:none;color:var(--blue2);font-size:12px}.link:hover{text-decoration:underline}
.drops{display:grid;gap:6px}.drow{display:grid;grid-template-columns:72px 1fr auto;align-items:center;gap:10px;padding:6px;border:1px solid transparent;border-radius:12px;background:#fff;text-align:left}
.drow.on{border-color:var(--blue);background:#0071e30a}.drow img,.drow .ph{width:72px;height:44px;border-radius:7px;object-fit:cover;background:#e3e3e8}.drow b{font-size:14px}.drow small{display:block;color:var(--muted);font-size:11px}
.tick{width:22px;height:22px;border-radius:50%;border:1.5px solid #c7c7cc;background:#fff;position:relative}.tick[aria-pressed="true"]{background:var(--blue);border-color:var(--blue)}.tick[aria-pressed="true"]::after{content:"";position:absolute;left:6px;top:2px;width:5px;height:10px;border:solid #fff;border-width:0 2px 2px 0;transform:rotate(45deg)}
main{min-width:0;display:flex;flex-direction:column;background:var(--soft)}
.stage{flex:1;min-height:0;display:grid;place-items:center;padding:24px;position:relative}
video{max-width:100%;max-height:calc(100vh - 52px - 48px - var(--tlh,0px));border-radius:14px;background:#000;box-shadow:0 20px 50px -25px #0006}
.empty{max-width:340px;text-align:center;color:var(--muted)}.empty strong{display:block;margin-bottom:6px;color:var(--ink);font-size:22px;font-weight:600;letter-spacing:-.01em}
.busy{position:absolute;inset:auto;display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;background:#ffffffe6;box-shadow:0 6px 20px -10px #0004;font-size:13px}.spin{width:16px;height:16px;border-radius:50%;border:2px solid #0071e333;border-top-color:var(--blue);animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.tl{flex:none;padding:12px 18px 16px;background:#fff;border-top:1px solid var(--line)}.tlhead{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;margin-bottom:8px}
.lanes{position:relative;display:grid;gap:4px;cursor:pointer;margin-left:96px}.lane{position:relative;height:22px;border-radius:6px;background:var(--soft)}.lane em{position:absolute;left:-96px;width:88px;top:3px;font-size:11px;font-style:normal;color:var(--muted);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blk{position:absolute;top:0;bottom:0;border-radius:5px;opacity:.9}.dropmark{position:absolute;top:-4px;bottom:-4px;width:2px;background:#ff375f;border-radius:1px}.dropmark::before{content:"DROP";position:absolute;top:-14px;left:-14px;font-size:9px;font-weight:700;color:#ff375f}
.head{position:absolute;top:-6px;bottom:-6px;width:2px;background:var(--ink);pointer-events:none}
.prog{margin-top:12px}.bar{height:4px;border-radius:2px;background:#e3e3e8;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--blue);transition:width .4s}.prog p{display:flex;justify-content:space-between;gap:8px;margin:8px 0 0;font-size:12px;color:var(--muted)}
.err{margin-top:10px;color:var(--err);font-size:13px}.done{margin-top:12px;padding:12px;border-radius:12px;background:#34c75914;font-size:13px}.done b{display:block;margin-bottom:6px}
details{margin-top:18px;font-size:12px;color:var(--muted)}#log{max-height:180px;overflow:auto;margin-top:8px;padding:10px;border-radius:10px;background:var(--soft);font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
dialog{width:min(400px,calc(100% - 32px));padding:28px;border:0;border-radius:22px;box-shadow:0 30px 80px -20px #0000004d}dialog::backdrop{background:#0000004d;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
dialog h2{margin:0 0 6px;font-size:24px;font-weight:600}dialog p{margin:0 0 18px;color:var(--muted);font-size:15px}
dialog input{display:block;width:100%;min-height:44px;margin-bottom:10px;padding:0 14px;border:1px solid #d2d2d7;border-radius:12px}dialog input:focus{outline:2px solid var(--blue);border-color:transparent}
dialog .go{margin-top:6px}.alt{display:flex;justify-content:space-between;margin-top:14px}.alt .link{font-size:14px}.or{margin:16px 0;text-align:center;color:var(--muted);font-size:13px}
.gbtn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:44px;border:1px solid #d2d2d7;border-radius:999px;background:#fff;font-size:15px}
.btns{display:flex;justify-content:center;gap:10px;margin-top:18px;flex-wrap:wrap}.x{position:absolute;right:16px;top:14px;width:30px;height:30px;border:0;border-radius:50%;background:var(--soft);color:var(--muted)}
.card-over{outline:2px dashed var(--blue);outline-offset:-2px}
@media (max-width:980px){body{overflow:auto;height:auto}.app{display:block}aside,.right{border:0}.stage{min-height:420px}}
</style></head><body>
<header><div class="brand"><i>R</i>Multicam AI</div><button class="pill" id="acct"><b id="adot"></b><span id="alabel">Sign in</span></button></header>
<div class="app">
<aside>
<h3>Footage</h3>
<div class="box" id="footage">
<div class="item"><span>Music</span><button class="add" id="music">Choose…</button></div>
<div class="item"><span>Cameras</span><div class="cams" id="cams"></div></div>
<div class="item"><span>Cut every</span><div class="beats" id="beats"><button data-b="2" aria-pressed="false">2</button><button data-b="4" aria-pressed="true">4</button><button data-b="6" aria-pressed="true">6</button><button data-b="8" aria-pressed="true">8</button></div></div>
</div>
<button class="go" id="find" disabled>Find drops</button>
<p class="note">One folder per camera, or drop an .fcpxml here · <button class="link" id="choose">Choose XML</button></p><input id="file" type="file" accept=".fcpxml,.xml" hidden>
<div id="dropsbox" hidden><h3 style="margin-top:22px">Drops <span id="dcount" style="text-transform:none"></span></h3><div class="drops" id="drops"></div>
<p class="note"><button class="link" id="all">Select all for export</button></p></div>
</aside>
<main>
<div class="stage" id="stage"><div class="empty" id="empty"><strong>From set to Reels.</strong>Add the music and one folder per camera, then Find drops.</div>
<video id="vid" controls playsinline hidden></video><div class="busy" id="vbusy" hidden><span class="spin"></span><span>Preparing preview…</span></div></div>
<div class="tl" id="tl" hidden><div class="tlhead"><span id="tlname"></span><span id="tltime">0:00</span></div><div class="lanes" id="lanes"></div></div>
</main>
<div class="right">
<h3>Export</h3>
<div class="box">
<div class="item"><span>Format</span><div class="seg" id="fmt"><button data-v="9x16" aria-pressed="true">9:16</button><button data-v="4x5" aria-pressed="false">4:5</button><button data-v="16x9" aria-pressed="false">16:9</button></div></div>
<div class="item"><span>Length</span><div class="seg" id="len"><button data-v="15" aria-pressed="false">15 s</button><button data-v="30" aria-pressed="true">30 s</button><button data-v="60" aria-pressed="false">60 s</button></div></div>
<div class="item"><span>Zoom on drop</span><button class="switch" id="zoom" aria-pressed="true" aria-label="Zoom on drop"></button></div>
<div class="item"><span>Color</span><button class="add" id="lut">Add LUT</button></div>
<div class="item"><span>Encoding</span><span id="enc" style="color:var(--ink)">Auto</span></div>
</div>
<button class="go" id="export" disabled>Export</button>
<div class="two"><button class="btn" id="full" disabled>Full set</button><button class="btn" id="reveal">Show folder</button></div>
<h3 style="margin-top:22px">Finish in</h3>
<div class="two"><button class="btn" id="xfcp" disabled>Final Cut</button><button class="btn" id="xres" disabled>DaVinci</button></div>
<p class="note">Exports the whole cut as XML for fine-tuning.</p>
<div class="prog" id="prog" hidden><div class="bar"><i id="bar"></i></div><p><span id="ptext">Starting…</span><button class="link" id="stop">Stop</button></p></div>
<div class="err" id="err" role="alert" hidden></div>
<div class="done" id="done" hidden><b id="dtitle"></b><span id="dtext"></span></div>
<details><summary>Details · ${VERSION}</summary><div id="log"></div></details>
</div>
</div>
<dialog id="sheet"><button class="x" id="close" aria-label="Close">✕</button>
<div id="out"><h2>Sign in</h2><p>Use your R Project account.</p><input id="email" type="email" placeholder="Email" autocomplete="username"><input id="password" type="password" placeholder="Password" autocomplete="current-password">
<button class="go" id="signin">Sign in</button><div class="alt"><button class="link" id="forgot">Forgot password?</button><a class="link" href="https://r-multicam.pages.dev/?signup" target="_blank" rel="noopener noreferrer">Create account</a></div>
<div class="or">or</div><button class="gbtn" id="google">Continue with Google</button><p id="glink" hidden><a class="link" id="glinkA" href="#" target="_blank" rel="noopener">Open Google sign-in</a></p></div>
<div id="in" hidden><h2 id="iemail"></h2><p id="ilabel"></p><div class="btns"><a class="btn fill" id="buy" href="https://r-multicam.pages.dev/#pricing" target="_blank" rel="noopener noreferrer">Get a plan</a><button class="btn" id="check">Refresh</button><button class="btn" id="signout">Sign out</button></div></div>
<p id="amsg" style="margin:14px 0 0"></p></dialog>
<script>
const T=${JSON.stringify(token)};const $=(id)=>document.getElementById(id);
let last=0,beats=[4,6,8],fmt='9x16',len=30,zoom=true,sel=new Set(),active=-1,dropsKey='',signed=false,can=false,busy=false,lastAct='',lut='',tl=null,vkey='';
const COLORS=['#0071e3','#ff9f0a','#30d158','#bf5af2','#ff375f','#64d2ff','#ffd60a','#ac8e68'];
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock=(t)=>{t=Math.max(0,Math.floor(t));const h=Math.floor(t/3600),m=Math.floor(t/60)%60,x=t%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');};
const q=(p,o)=>p+'?t='+T+Object.entries(o||{}).map(([k,v])=>'&'+k+'='+encodeURIComponent(v)).join('');
async function api(p,b,o){const r=await fetch(q(p,o),b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{cache:'no-store'});let j={};try{j=await r.json();}catch(e){}return j;}
function err(m){$('err').textContent=m||'';$('err').hidden=!m;}
function addLog(l){last=Math.max(last,l.n);const d=$('log');d.textContent+=(d.textContent?'\\n':'')+l.t+'  '+l.text;d.scrollTop=d.scrollHeight;}
let es=null;function connect(){if(es)es.close();es=new EventSource(q('/api/events',{since:last}));es.onmessage=(e)=>addLog(JSON.parse(e.data));es.onerror=()=>{es.close();setTimeout(connect,2000);};}
async function quick(p,b){err('');const r=await api(p,b||{});if(!r.ok)err(r.error);tick();return r;}
async function run(p,b,act){if(!can){$('sheet').showModal();return;}err('');$('done').hidden=true;lastAct=act;const r=await api(p,b);if(!r.ok)err(r.error);tick();}
async function load(f){if(!f)return;const text=await f.text();quick('/api/xml',{name:f.name,text});}
const side=document.querySelector('aside');['dragenter','dragover'].forEach((e)=>side.addEventListener(e,(v)=>{v.preventDefault();side.classList.add('card-over');}));
['dragleave','drop'].forEach((e)=>side.addEventListener(e,(v)=>{v.preventDefault();side.classList.remove('card-over');}));
side.addEventListener('drop',(v)=>load(v.dataTransfer.files[0]));$('choose').onclick=()=>$('file').click();$('file').onchange=(v)=>{load(v.target.files[0]);v.target.value='';};
$('music').onclick=()=>quick('/api/music');
$('cams').onclick=(e)=>{if(e.target.id==='addcam')return quick('/api/camera/add',{mode:'folder'});const i=e.target.dataset.rm;if(i!=null)quick('/api/camera/remove',{index:+i});};
const seg=(id,set)=>$(id).querySelectorAll('button').forEach((b)=>b.onclick=()=>{$(id).querySelectorAll('button').forEach((x)=>x.setAttribute('aria-pressed',String(x===b)));set(b.dataset.v);show();});
seg('fmt',(v)=>fmt=v);seg('len',(v)=>len=+v);
$('beats').querySelectorAll('button').forEach((b)=>b.onclick=()=>{const n=+b.dataset.b,on=beats.includes(n);if(on&&beats.length===1)return;beats=on?beats.filter((x)=>x!==n):beats.concat(n).sort();b.setAttribute('aria-pressed',String(!on));});
$('zoom').onclick=()=>{zoom=!zoom;$('zoom').setAttribute('aria-pressed',String(zoom));show();};
$('lut').onclick=()=>quick(lut?'/api/lut/clear':'/api/lut').then(show);
$('find').onclick=()=>run('/api/drops',{cadences:beats},'drops');
$('drops').onclick=(e)=>{const row=e.target.closest('.drow');if(!row)return;const i=+row.dataset.i;
 if(e.target.closest('.tick')){sel.has(i)?sel.delete(i):sel.add(i);e.target.closest('.tick').setAttribute('aria-pressed',String(sel.has(i)));count();return;}
 active=i;document.querySelectorAll('.drow').forEach((r)=>r.classList.toggle('on',+r.dataset.i===i));show();};
$('all').onclick=()=>{const ticks=[...document.querySelectorAll('.drow')];const allOn=ticks.every((r)=>sel.has(+r.dataset.i));ticks.forEach((r)=>{const i=+r.dataset.i;allOn?sel.delete(i):sel.add(i);r.querySelector('.tick').setAttribute('aria-pressed',String(!allOn));});count();};
function count(){const n=sel.size;$('export').textContent=n?'Export '+n+' clip'+(n>1?'s':''):'Tick drops to export';$('export').disabled=busy||!n;}
$('export').onclick=()=>run('/api/export',{drops:[...sel],format:fmt,length:len,zoom},'video');
$('full').onclick=()=>run('/api/export',{full:true,format:fmt,zoom},'video');
$('xfcp').onclick=()=>run('/api/export-xml',{target:'fcp'},'fcp');$('xres').onclick=()=>run('/api/export-xml',{target:'resolve'},'resolve');
$('stop').onclick=()=>api('/api/stop',{});$('reveal').onclick=()=>api(lastAct==='video'?'/api/open-folder':'/api/reveal',{});
// Preview: a fast low-resolution render of the chosen drop, with its camera timeline underneath.
const vid=$('vid');vid.addEventListener('loadstart',()=>{if(vid.src)$('vbusy').hidden=false;});vid.addEventListener('canplay',()=>{$('vbusy').hidden=true;});
vid.addEventListener('error',()=>{$('vbusy').hidden=true;if(vid.src)err('Preview could not be made. Details shows why.');});
async function show(){if(active<0)return;const key=[active,fmt,len,zoom,lut].join('|');
 const r=await api('/api/timeline',null,{i:active,l:len});if(r.ok){tl=r.timeline;drawTl();}
 if(key===vkey)return;vkey=key;$('empty').hidden=true;vid.hidden=false;vid.src=q('/api/preview',{i:active,f:fmt,l:len,z:zoom?1:0,k:key});vid.play().catch(()=>{});}
function drawTl(){if(!tl)return;$('tl').hidden=false;document.body.style.setProperty('--tlh',(56+tl.cameras.length*26)+'px');$('tlname').textContent='Drop at '+clock(tl.start+tl.drop)+' · '+tl.shots.length+' shots';
 const L=tl.length,pct=(t)=>(t/L*100).toFixed(3)+'%';
 $('lanes').innerHTML=tl.cameras.map((c,k)=>'<div class="lane"><em>'+esc(c.name)+'</em>'+tl.shots.filter((s)=>s.camera===k).map((s)=>'<i class="blk" style="left:'+pct(s.start)+';width:'+pct(s.end-s.start)+';background:'+COLORS[k%COLORS.length]+'"></i>').join('')+'</div>').join('')+
  '<i class="dropmark" style="left:'+pct(tl.drop)+'"></i><i class="head" id="head" style="left:0"></i>';}
$('lanes').onclick=(e)=>{if(!tl||vid.hidden)return;const r=$('lanes').getBoundingClientRect();vid.currentTime=Math.max(0,Math.min(tl.length,(e.clientX-r.left)/r.width*tl.length));};
(function loop(){if(tl&&!vid.hidden&&$('head')){$('head').style.left=(Math.min(1,vid.currentTime/tl.length)*100)+'%';$('tltime').textContent=clock(vid.currentTime)+' / '+clock(tl.length);}requestAnimationFrame(loop);})();
$('acct').onclick=()=>$('sheet').showModal();$('close').onclick=()=>$('sheet').close();
const acc=async(p,b)=>{const r=await api(p,b);$('amsg').textContent=r.ok?(r.message||''):(r.error||'');tick();return r;};
$('signin').onclick=async()=>{await acc('/api/account/signin',{email:$('email').value,password:$('password').value});$('password').value='';};
$('forgot').onclick=()=>acc('/api/account/forgot',{email:$('email').value});$('signout').onclick=()=>acc('/api/account/signout',{});$('check').onclick=()=>acc('/api/account/check',{});
$('google').onclick=async()=>{const w=window.open('about:blank','_blank');const r=await acc('/api/account/google',{});if(r.link){if(w)w.location=r.link;$('glinkA').href=r.link;$('glink').hidden=false;}else if(w)w.close();};
async function tick(){let s;try{s=await api('/api/status');}catch(e){return;}if(!s.ok)return;
 const a=s.account||{};signed=!!a.signedIn;can=!!a.canUse;$('adot').className=can?'on':'';$('alabel').textContent=signed?a.label:'Sign in';
 $('out').hidden=signed;$('in').hidden=!signed;$('iemail').textContent=a.email||'';$('ilabel').textContent=a.detail||a.label||'';$('buy').hidden=a.licenseStatus==='lifetime';
 const st=s.studio||{};busy=!!s.busy;
 $('music').textContent=st.music?'♪ '+st.music.split(/[\\\\/]/).pop():'Choose…';$('music').title=st.music||'';
 $('cams').innerHTML=(st.cameras||[]).map((c,i)=>'<span>'+esc(c.name)+' · '+c.files+'<button data-rm="'+i+'" aria-label="Remove">✕</button></span>').join('')+'<button class="add" id="addcam">+ Add</button>';
 const ready=!!(st.music&&(st.cameras||[]).length);$('find').disabled=busy||!ready;$('find').textContent=can?(st.set?'Find drops again':'Find drops'):'Sign in to start';
 const d=st.drops||[],key=st.set?d.map((x)=>x.time).join(','):'';
 if(key!==dropsKey){dropsKey=key;sel=new Set();active=-1;vkey='';tl=null;vid.removeAttribute('src');vid.hidden=true;$('tl').hidden=true;$('empty').hidden=false;
  $('drops').innerHTML=d.map((x,n)=>'<div class="drow" data-i="'+x.index+'" role="button" tabindex="0">'+(x.thumb?'<img alt="" src="'+q('/api/thumb',{i:x.index,k:key})+'">':'<span class="ph"></span>')+'<span><b>'+clock(x.time)+'</b><small>Drop '+(n+1)+'</small></span><button class="tick" aria-pressed="false" aria-label="Export this drop"></button></div>').join('');
  if(d.length){active=d[0].index;document.querySelector('.drow').classList.add('on');setTimeout(show,0);}}
 $('dropsbox').hidden=!st.set;$('dcount').textContent=d.length?'· '+d.length:'';count();
 lut=st.lut||'';$('lut').textContent=lut?lut+'  ✕':'Add LUT';$('enc').textContent=st.encoder||'Auto';
 ['full','xfcp','xres'].forEach((id)=>$(id).disabled=busy||!st.set);
 const p=s.progress;$('prog').hidden=!busy;if(busy&&p){$('bar').style.width=Math.round(p.p*100)+'%';$('ptext').textContent=p.text||s.busy;}
 const lr=s.lastResult;if(!busy&&lr&&lr.ok===false&&!lr.license&&lr.at>(window._shown||0)){window._shown=lr.at;err(lr.error);}
 if(!busy&&lr&&lr.ok!==false&&lr.at>(window._done||0)&&/Export/.test(lr.action||'')){window._done=lr.at;$('done').hidden=false;
  if(lr.action==='Export'){$('dtitle').textContent=lr.exported+' video'+(lr.exported>1?'s':'')+' ready to post.';$('dtext').textContent='Saved next to your project · '+(lr.encoders||'');lastAct='video';}
  else{$('dtitle').textContent='XML ready.';$('dtext').textContent=lr.target==='resolve'?'In DaVinci Resolve: File → Import → Timeline.':lr.openedIn==='Final Cut Pro'?'Opened in Final Cut Pro.':'In Final Cut Pro: File → Import → XML.';lastAct='xml';}}
 if(busy)$('done').hidden=true;}
connect();tick();setInterval(tick,1000);
</script></body></html>`;
}

async function main() {
  const args = process.argv.slice(2), noBrowser = args.includes('--no-browser'), appMode = args.includes('--app');
  const portArg = args.indexOf('--port'), port = portArg >= 0 ? Number(args[portArg + 1]) : 0;
  const dir = appDir(), lockFile = path.join(dir, 'engine.lock');
  fs.mkdirSync(dir, { recursive: true });
  const lock = await acquireLock(lockFile);
  if (lock.running) {
    console.log('R Project Engine is already running: ' + lock.running);
    if (!noBrowser) { if (appMode) openAppWindow(lock.running, path.join(dir, 'window')); else openBrowser(lock.running); }
    return;
  }
  let eng;
  try { eng = await start({ port }); }
  catch (e) { fs.closeSync(lock.fd); fs.rmSync(lockFile, { force: true }); throw e; }
  fs.writeSync(lock.fd, JSON.stringify({ pid: process.pid, url: eng.url }));
  fs.closeSync(lock.fd);
  console.log('\nOpen this address if the browser does not open:\n  ' + eng.url + '\nClose this window to stop R Project Engine.\n');
  let ended = false, win = null;
  if (!noBrowser && appMode) win = openAppWindow(eng.url, path.join(dir, 'window'));
  else if (!noBrowser) openBrowser(eng.url);
  const shutdown = () => {
    if (ended) return; ended = true;
    try { const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')); if (l.pid === process.pid) fs.rmSync(lockFile, { force: true }); } catch (e) { /* gone */ }
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown);
  // App mode: closing the window quits the app (a window that ends within seconds handed off to a running browser instead).
  if (win) { const opened = Date.now(); win.on('exit', () => { if (Date.now() - opened > 5000) { eng.studio.stop(); shutdown(); } }); }
}

if (require.main === module) main().catch((e) => { console.error('R Project Engine failed: ' + (e && e.stack || e)); process.exitCode = 1; });
module.exports = { start, page, VERSION, LICENSE_VERSION, acquireLock, engineAnswers, appBrowser };
