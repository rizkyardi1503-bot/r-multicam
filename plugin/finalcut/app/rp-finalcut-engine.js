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
  // macOS: a real Cocoa window with WebKit (works without Chrome; no browser chrome at all).
  if (process.platform === 'darwin' && !process.env.RP_APP_BROWSER) {
    try {
      const c = cp.spawn('/usr/bin/osascript', ['-l', 'JavaScript', path.join(APP, 'lib', 'mac-window.jxa'), url, path.join(APP, 'assets', 'icon.icns')], { stdio: 'ignore' });
      const t0 = Date.now();
      c.on('error', () => openBrowser(url));
      // The native window failed to start (old macOS, blocked scripting): show the app in a browser window instead.
      c.on('exit', (code) => { if (code && Date.now() - t0 < 5000) { const exe = appBrowser(); if (exe) cp.spawn(exe, ['--app=' + url, '--user-data-dir=' + profileDir], { stdio: 'ignore', detached: true }).unref(); else openBrowser(url); } });
      return c;
    } catch (e) { /* fall back to a browser app window */ }
  }
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

  /** Create account: the same Supabase sign-up as the website (email confirmation, then sign in in the app). */
  async function signUp(email, password) {
    email = String(email || '').trim(); password = String(password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
    if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
    let d;
    try { d = await account.request('/auth/v1/signup?redirect_to=' + encodeURIComponent('https://r-multicam.pages.dev/auth/confirmed/'), { method: 'POST', body: { email, password } }); }
    catch (e) { throw new Error(e && e.message ? e.message : 'Could not create the account.'); }
    if (d && d.access_token) return account.signIn(email, password);
    return { message: 'Account created. Open the confirmation email sent to ' + email + ', then sign in here.' };
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
    'POST /api/account/signup': async (b) => accountCall('Create account', () => signUp(b.email, b.password)),
    // The app window may not open new windows: the engine opens Google sign-in and website pages in the system browser.
    'POST /api/account/google': async () => accountCall('Google sign-in', async () => { const r = await account.startGoogle(); if (r && r.link) openBrowser(r.link); return r; }),
    'POST /api/open': async (b) => {
      const u = String(b.url || '');
      if (!/^https:\/\/r-multicam\.pages\.dev(\/|$)/.test(u)) return { status: 400, body: { ok: false, error: 'Not allowed.' } };
      openBrowser(u); return { body: { ok: true } };
    },
    'POST /api/xml/pick': () => quick('Import XML', () => studio.pickXml()),
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
:root{--ink:#1d1d1f;--sub:#6e6e73;--faint:#8e8e93;--hair:#0000001f;--side:#efeff2;--panel:#f6f6f8;--canvas:#e7e7ea;--sel:#0a84ff;--blue:#0a84ff;--ok:#30d158;--err:#ff3b30;--font:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable Text","Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box;margin:0}html,body{height:100%}
body{display:flex;flex-direction:column;overflow:hidden;background:var(--panel);color:var(--ink);font:13px/1.35 var(--font);-webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none;cursor:default}
input,select,button{font:inherit;color:inherit}input{-webkit-user-select:text;user-select:text;cursor:text}[hidden]{display:none!important}
button{cursor:default}
/* macOS-style push buttons */
.pb{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:24px;padding:0 12px;border:.5px solid #00000033;border-radius:6px;background:linear-gradient(#fff,#f7f7f7);box-shadow:0 .5px 1px #0000001f;font-size:13px;white-space:nowrap}
.pb:active:not(:disabled){background:#e8e8ea}.pb:disabled{opacity:.45}
.pb.def{border-color:#0063e1;background:linear-gradient(#3b9dff,#0a7cff);color:#fff;box-shadow:0 .5px 1px #0050c0}.pb.def:active:not(:disabled){background:#0a6fe6}
.pb.big{height:28px;font-size:13px;padding:0 16px}.pb.wide{width:100%}
.ib{width:28px;height:24px;padding:0;border:0;border-radius:6px;background:none;color:var(--sub)}.ib:hover{background:#0000000d}
select{height:22px;padding:0 6px;border:.5px solid #00000033;border-radius:5px;background:#fff;box-shadow:0 .5px 1px #0000001a}
/* ---------------------------------------------------------------- sign-in screen */
.gate{flex:1;display:grid;place-items:center;background:radial-gradient(1200px 600px at 50% -10%,#ffffff,#ececf0)}
.gcard{width:340px;text-align:center}.gcard img{width:72px;height:72px;margin-bottom:14px;filter:drop-shadow(0 6px 14px #0a84ff40)}
.gcard h1{font-size:22px;font-weight:600;letter-spacing:-.01em}.gcard>p{margin:6px 0 20px;color:var(--sub)}
.tabs{display:inline-flex;padding:2px;margin-bottom:14px;border-radius:7px;background:#00000012}.tabs button{height:22px;padding:0 14px;border:0;border-radius:5px;background:none;font-size:12px}.tabs button[aria-pressed="true"]{background:#fff;box-shadow:0 1px 2px #00000026}
.field{display:block;width:100%;height:28px;margin-bottom:8px;padding:0 9px;border:.5px solid #00000038;border-radius:6px;background:#fff;font-size:13px}.field:focus{outline:3px solid #0a84ff55;outline-offset:0;border-color:#0a84ff}
.gcard .pb.def{width:100%;height:28px;margin-top:4px}
.or{display:flex;align-items:center;gap:10px;margin:14px 0;color:var(--faint);font-size:11px}.or::before,.or::after{content:"";flex:1;height:.5px;background:var(--hair)}
.lnk{border:0;background:none;padding:0;color:var(--blue);font-size:12px}.lnk:hover{text-decoration:underline}
.gmsg{min-height:18px;margin-top:12px;font-size:12px;color:var(--sub)}.gmsg.bad{color:var(--err)}
.gfoot{margin-top:18px;display:flex;justify-content:space-between}
/* ---------------------------------------------------------------- main window */
.tb{flex:none;display:flex;align-items:center;gap:8px;height:40px;padding:0 10px;border-bottom:.5px solid var(--hair);background:linear-gradient(#f8f8fa,#efeff2)}
.tb .title{font-weight:600}.tb .grow{flex:1}.tb .sub{color:var(--sub)}
.who{display:flex;align-items:center;gap:6px;height:24px;padding:0 4px 0 8px;border:0;border-radius:6px;background:none}.who:hover{background:#0000000d}
.who i{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--blue);color:#fff;font-style:normal;font-size:10px;font-weight:600}
.lic{font-size:11px;color:var(--sub)}
.win{flex:1;min-height:0;display:grid;grid-template-columns:236px 1fr 260px}
.side{overflow:auto;padding:8px 8px 12px;background:var(--side);border-right:.5px solid var(--hair)}
.sh{display:flex;justify-content:space-between;align-items:center;padding:10px 8px 4px;font-size:11px;font-weight:600;color:var(--faint)}
.row{display:flex;align-items:center;gap:8px;width:100%;min-height:26px;padding:3px 8px;border:0;border-radius:6px;background:none;text-align:left;font-size:13px}
.row:hover{background:#0000000a}.row.on{background:var(--sel);color:#fff}.row.on small{color:#ffffffcc}
.row svg{flex:none;width:16px;height:16px;color:var(--blue)}.row.on svg{color:#fff}.row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row small{color:var(--faint);font-size:11px}
.row .x{visibility:hidden;width:16px;height:16px;border:0;border-radius:50%;background:#0000001a;color:var(--sub);font-size:9px;line-height:16px;padding:0}.row:hover .x{visibility:visible}
.row.add{color:var(--blue)}.row img,.row .ph{flex:none;width:44px;height:26px;border-radius:4px;object-fit:cover;background:#d8d8dc}
.chk{flex:none;width:14px;height:14px;margin:0;accent-color:var(--blue)}
.center{min-width:0;display:flex;flex-direction:column;background:var(--canvas)}
.stage{flex:1;min-height:0;display:grid;place-items:center;padding:18px;position:relative}
video{max-width:100%;max-height:calc(100vh - 40px - 22px - 36px - var(--tlh,0px));border-radius:8px;background:#000;box-shadow:0 12px 34px -18px #0007}
.empty{text-align:center;color:var(--sub);max-width:320px}.empty svg{width:44px;height:44px;color:#b4b4ba;margin-bottom:10px}.empty b{display:block;color:var(--ink);font-size:15px;margin-bottom:4px}
.busy{position:absolute;bottom:18px;display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:7px;background:#ffffffe8;box-shadow:0 4px 14px -6px #0004;font-size:12px}
.spin{width:12px;height:12px;border-radius:50%;border:2px solid #0a84ff33;border-top-color:var(--blue);animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
.tl{flex:none;padding:8px 12px 10px;border-top:.5px solid var(--hair);background:var(--panel)}.tlh{display:flex;justify-content:space-between;margin-bottom:6px;color:var(--sub);font-size:11px;font-variant-numeric:tabular-nums}
.lanes{position:relative;display:grid;gap:3px;margin-left:86px}.lane{position:relative;height:18px;border-radius:4px;background:#00000009}
.lane em{position:absolute;left:-86px;width:80px;top:2px;font-size:11px;font-style:normal;color:var(--sub);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.blk{position:absolute;top:1px;bottom:1px;border-radius:3px}.dm{position:absolute;top:-3px;bottom:-3px;width:2px;background:#ff375f}.hd{position:absolute;top:-5px;bottom:-5px;width:1.5px;background:var(--ink);pointer-events:none}
.insp{overflow:auto;padding:10px 12px;background:var(--panel);border-left:.5px solid var(--hair)}
.grp{margin-bottom:14px}.grp h4{margin:0 0 6px;font-size:11px;font-weight:600;color:var(--faint)}
.fr{display:grid;grid-template-columns:84px 1fr;align-items:center;gap:6px 8px;min-height:26px}.fr>label{color:var(--sub);text-align:right;font-size:12px}
.seg{display:inline-flex;padding:1px;border-radius:6px;background:#0000000f}.seg button{height:20px;padding:0 8px;border:0;border-radius:5px;background:none;font-size:12px}.seg button[aria-pressed="true"]{background:#fff;box-shadow:0 .5px 2px #0000002e}
.two{display:grid;grid-template-columns:1fr 1fr;gap:6px}.note{margin-top:6px;color:var(--faint);font-size:11px}
.done{margin-top:8px;padding:8px 10px;border-radius:7px;background:#30d1581a;font-size:12px}.done b{display:block}
.err{margin-top:8px;padding:8px 10px;border-radius:7px;background:#ff3b3014;color:#c41d14;font-size:12px}
.sb{flex:none;display:flex;align-items:center;gap:10px;height:22px;padding:0 10px;border-top:.5px solid var(--hair);background:var(--side);font-size:11px;color:var(--sub)}
.sb .bar{width:140px;height:4px;border-radius:2px;background:#0000001a;overflow:hidden}.sb .bar i{display:block;height:100%;width:0;background:var(--blue);transition:width .3s}
.sb .grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
details.log{font-size:11px}#log{position:fixed;right:12px;bottom:28px;width:520px;max-height:240px;overflow:auto;padding:10px;border-radius:8px;background:#fff;box-shadow:0 10px 30px -10px #0005;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;-webkit-user-select:text;user-select:text}
.over{outline:2px solid var(--blue);outline-offset:-2px}
.menu{position:fixed;right:10px;top:38px;z-index:9;width:240px;padding:10px;border-radius:9px;background:#fffffff5;border:.5px solid var(--hair);box-shadow:0 12px 32px -10px #0005}.menu b{display:block;overflow:hidden;text-overflow:ellipsis}.menu p{margin:2px 0 10px;color:var(--sub);font-size:12px}.menu .pb{width:100%;margin-top:5px}
</style></head><body>
<!-- ================================================================ sign in (shown until the account may use the app) -->
<section class="gate" id="gate">
<div class="gcard">
<img alt="" src="${ICON}"><h1 id="gtitle">R Project Multicam AI</h1><p id="gsub">Sign in with your R Project account.</p>
<div id="gform">
<div class="tabs"><button id="tIn" aria-pressed="true">Sign In</button><button id="tUp" aria-pressed="false">Create Account</button></div>
<input class="field" id="email" type="email" placeholder="Email" autocomplete="username">
<input class="field" id="password" type="password" placeholder="Password" autocomplete="current-password">
<input class="field" id="password2" type="password" placeholder="Confirm password" autocomplete="new-password" hidden>
<button class="pb def" id="gsubmit">Sign In</button>
<div class="or">or</div>
<button class="pb wide" id="google"><svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45 24.5c0-1.6-.1-2.8-.4-4H24v7.6h11.9c-.5 3-2.4 5.5-5.2 7.2v6h8.4c4.9-4.5 7.9-11.1 7.9-16.8z"/><path fill="#34A853" d="M24 46c6.5 0 11.9-2.1 15.9-5.8l-8.4-6c-2.2 1.5-5.1 2.4-7.5 2.4-5.8 0-10.6-3.9-12.4-9.1H2.9v6.2C6.8 41.4 14.8 46 24 46z"/><path fill="#FBBC05" d="M11.6 27.5c-.4-1.3-.7-2.6-.7-4s.3-2.8.7-4v-6.2H2.9C1.1 16.8 0 20.3 0 23.5s1.1 6.7 2.9 10.2z"/><path fill="#EA4335" d="M24 10.4c3.3 0 6.2 1.1 8.5 3.3l7.4-7.4C35.9 2.6 30.5 0 24 0 14.8 0 6.8 4.6 2.9 13.3l8.7 6.2c1.8-5.2 6.6-9.1 12.4-9.1z"/></svg>Continue with Google</button>
<div class="gfoot"><button class="lnk" id="forgot">Forgot password?</button><button class="lnk" id="site">r-multicam.pages.dev</button></div>
</div>
<div id="gplan" hidden><div class="two" style="margin-top:4px"><button class="pb def" id="buy">Get a Plan</button><button class="pb" id="recheck">Check Again</button></div>
<div class="gfoot" style="justify-content:center"><button class="lnk" id="gout">Sign out</button></div></div>
<div class="gmsg" id="gmsg" role="status"></div>
</div></section>

<!-- ================================================================ app window -->
<section id="appv" hidden style="flex:1;min-height:0;display:flex;flex-direction:column">
<div class="tb"><span class="title" id="ptitle">Untitled</span><span class="sub" id="pinfo"></span><span class="grow"></span>
<button class="pb" id="find" disabled>Find Drops</button>
<button class="who" id="who" title="Account"><span class="lic" id="lic"></span><i id="ini">R</i></button></div>
<div class="win">
<nav class="side" id="side">
<div class="sh">MUSIC</div><div id="mus"></div>
<div class="sh">CAMERAS</div><div id="cams"></div>
<div class="sh">CUT EVERY</div><div style="padding:2px 8px 4px"><div class="seg" id="beats"><button data-b="2" aria-pressed="false">2</button><button data-b="4" aria-pressed="true">4</button><button data-b="6" aria-pressed="true">6</button><button data-b="8" aria-pressed="true">8</button></div> <small style="color:var(--faint)">beats</small></div>
<div id="dsec" hidden><div class="sh"><span>DROPS <span id="dcount"></span></span><button class="lnk" id="all" style="font-size:11px">Select All</button></div><div id="drops"></div></div>
<div class="sh" style="margin-top:6px">IMPORT</div>
<button class="row" id="xmlin"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 1.5h5l3 3v10H4z"/><path d="M9 1.5v3h3"/><path d="M6.2 9.5 5 11l1.2 1.5M9.8 9.5 11 11l-1.2 1.5"/></svg><span>Final Cut / DaVinci XML…</span></button>
</nav>
<main class="center">
<div class="stage" id="stage"><div class="empty" id="empty"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10" width="38" height="28" rx="4"/><path d="m21 19 9 5-9 5z" fill="currentColor"/></svg><b id="etitle">Add your footage</b><span id="etext">Choose the music and one folder per camera in the sidebar, then click Find Drops.</span></div>
<video id="vid" controls playsinline hidden></video><div class="busy" id="vbusy" hidden><span class="spin"></span>Preparing preview…</div></div>
<div class="tl" id="tl" hidden><div class="tlh"><span id="tlname"></span><span id="tltime">0:00</span></div><div class="lanes" id="lanes"></div></div>
</main>
<aside class="insp">
<div class="grp"><h4>OUTPUT</h4>
<div class="fr"><label>Format</label><div class="seg" id="fmt"><button data-v="9x16" aria-pressed="true">9:16</button><button data-v="4x5" aria-pressed="false">4:5</button><button data-v="16x9" aria-pressed="false">16:9</button></div>
<label>Length</label><select id="len"><option value="15">15 seconds</option><option value="30" selected>30 seconds</option><option value="60">60 seconds</option></select>
<label>Zoom</label><label style="text-align:left;color:var(--ink);display:flex;gap:6px;align-items:center"><input type="checkbox" class="chk" id="zoom" checked>Punch in on the drop</label>
<label>Color</label><div><button class="pb" id="lut">Add LUT…</button></div>
<label>Encoding</label><span id="enc">Auto</span></div></div>
<div class="grp"><button class="pb def big wide" id="export" disabled>Export</button>
<div class="two" style="margin-top:6px"><button class="pb" id="full" disabled>Full Set</button><button class="pb" id="reveal">Show in Folder</button></div></div>
<div class="grp"><h4>FINISH IN</h4><div class="two"><button class="pb" id="xfcp" disabled>Final Cut Pro</button><button class="pb" id="xres" disabled>DaVinci Resolve</button></div>
<div class="note">The whole cut as XML, for fine-tuning.</div></div>
<div class="err" id="err" role="alert" hidden></div>
<div class="done" id="done" hidden><b id="dtitle"></b><span id="dtext"></span></div>
</aside>
</div>
<div class="sb"><span class="grow" id="stat">Ready</span><span id="pwrap" hidden style="display:flex;align-items:center;gap:8px"><span class="bar"><i id="bar"></i></span><button class="lnk" id="stop" style="font-size:11px">Stop</button></span><button class="lnk" id="logbtn" style="font-size:11px;color:var(--sub)">Log</button><span>${VERSION}</span></div>
<div id="log" hidden></div>
<div class="menu" id="menu" hidden><b id="memail"></b><p id="mlabel"></p><button class="pb" id="mplan">Plans &amp; Billing</button><button class="pb" id="mcheck">Check License</button><button class="pb" id="mout">Sign Out</button></div>
</section>

<script>
const T=${JSON.stringify(token)};const $=(id)=>document.getElementById(id);
let last=0,beats=[4,6,8],fmt='9x16',len=30,zoom=true,sel=new Set(),active=-1,dropsKey='',can=false,signed=false,busy=false,lastAct='',lut='',tl=null,vkey='',mode='in',acct={};
const COLORS=['#0a84ff','#ff9f0a','#30d158','#bf5af2','#ff375f','#64d2ff','#ffd60a','#ac8e68'];
const I={music:'<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 12.2V3.6l7-1.6v8.2a2 2 0 1 1-1.2-1.8V4.7L7.2 5.8v6.4A2 2 0 1 1 6 12.2z"/></svg>',
 cam:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="1.5" y="4" width="9.5" height="8" rx="1.6"/><path d="m11 7 3.5-2v6L11 9"/></svg>',
 plus:'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3v10M3 8h10"/></svg>'};
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clock=(t)=>{t=Math.max(0,Math.floor(t));const h=Math.floor(t/3600),m=Math.floor(t/60)%60,x=t%60;return (h?h+':'+String(m).padStart(2,'0'):m)+':'+String(x).padStart(2,'0');};
const q=(p,o)=>p+'?t='+T+Object.entries(o||{}).map(([k,v])=>'&'+k+'='+encodeURIComponent(v)).join('');
async function api(p,b,o){const r=await fetch(q(p,o),b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{cache:'no-store'});let j={};try{j=await r.json();}catch(e){}return j;}
function err(m){$('err').textContent=m||'';$('err').hidden=!m;}
function gmsg(m,bad){$('gmsg').textContent=m||'';$('gmsg').className='gmsg'+(bad?' bad':'');}
function addLog(l){last=Math.max(last,l.n);const d=$('log');d.textContent+=(d.textContent?'\\n':'')+l.t+'  '+l.text;d.scrollTop=d.scrollHeight;}
let es=null;function connect(){if(es)es.close();es=new EventSource(q('/api/events',{since:last}));es.onmessage=(e)=>addLog(JSON.parse(e.data));es.onerror=()=>{es.close();setTimeout(connect,2000);};}
const open=(url)=>api('/api/open',{url});
// Files dropped anywhere must never navigate the window away; an .fcpxml dropped on the sidebar is imported.
['dragover','drop'].forEach((e)=>window.addEventListener(e,(v)=>v.preventDefault()));
const side=$('side');side.addEventListener('dragover',()=>side.classList.add('over'));side.addEventListener('dragleave',()=>side.classList.remove('over'));
side.addEventListener('drop',async(v)=>{side.classList.remove('over');const f=v.dataTransfer.files[0];if(f){const text=await f.text();quick('/api/xml',{name:f.name,text});}});
document.addEventListener('contextmenu',(e)=>{if(!e.target.closest('input'))e.preventDefault();});
// ---------------------------------------------------------------- sign in
function setMode(m){mode=m;$('tIn').setAttribute('aria-pressed',String(m==='in'));$('tUp').setAttribute('aria-pressed',String(m==='up'));$('password2').hidden=m!=='up';$('gsubmit').textContent=m==='up'?'Create Account':'Sign In';$('password').autocomplete=m==='up'?'new-password':'current-password';gmsg('');}
$('tIn').onclick=()=>setMode('in');$('tUp').onclick=()=>setMode('up');
async function submit(){const email=$('email').value.trim(),pw=$('password').value;
 if(mode==='up'&&pw!==$('password2').value)return gmsg('The passwords do not match.',true);
 $('gsubmit').disabled=true;gmsg(mode==='up'?'Creating your account…':'Signing in…');
 const r=await api(mode==='up'?'/api/account/signup':'/api/account/signin',{email,password:pw});$('gsubmit').disabled=false;
 if(!r.ok)return gmsg(r.error||'Could not sign in.',true);$('password').value='';$('password2').value='';
 if(mode==='up'&&r.message){setMode('in');gmsg(r.message);}else gmsg('');tick();}
$('gsubmit').onclick=submit;['email','password','password2'].forEach((id)=>$(id).addEventListener('keydown',(e)=>{if(e.key==='Enter')submit();}));
$('google').onclick=async()=>{gmsg('Continue in your browser, then come back here.');const r=await api('/api/account/google',{});if(!r.ok)gmsg(r.error,true);};
$('forgot').onclick=async()=>{const r=await api('/api/account/forgot',{email:$('email').value});gmsg(r.ok?(r.message||'Check your email.'):r.error,!r.ok);};
$('site').onclick=()=>open('https://r-multicam.pages.dev/');$('buy').onclick=()=>open('https://r-multicam.pages.dev/#pricing');
$('recheck').onclick=async()=>{gmsg('Checking…');const r=await api('/api/account/check',{});gmsg(r.ok?'':r.error,!r.ok);tick();};
const signout=async()=>{await api('/api/account/signout',{});gmsg('Signed out.');tick();};$('gout').onclick=signout;
$('who').onclick=(e)=>{e.stopPropagation();$('memail').textContent=acct.email||'';$('mlabel').textContent=acct.detail||acct.label||'';$('menu').hidden=!$('menu').hidden;};
document.addEventListener('click',(e)=>{if(!e.target.closest('#menu'))$('menu').hidden=true;});
$('mplan').onclick=()=>open('https://r-multicam.pages.dev/#pricing');$('mcheck').onclick=async()=>{await api('/api/account/check',{});tick();};$('mout').onclick=()=>{$('menu').hidden=true;signout();};
// ---------------------------------------------------------------- app
async function quick(p,b){err('');const r=await api(p,b||{});if(!r.ok&&r.error&&!/No (music|folder|file|clips) chosen/.test(r.error))err(r.error);tick();return r;}
async function run(p,b,act){err('');$('done').hidden=true;lastAct=act;const r=await api(p,b);if(!r.ok)err(r.error);tick();}
$('mus').onclick=()=>quick('/api/music');
$('cams').onclick=(e)=>{const rm=e.target.closest('[data-rm]');if(rm){e.stopPropagation();return quick('/api/camera/remove',{index:+rm.dataset.rm});}if(e.target.closest('.add'))quick('/api/camera/add',{mode:'folder'});};
$('xmlin').onclick=()=>quick('/api/xml/pick');
$('beats').querySelectorAll('button').forEach((b)=>b.onclick=()=>{const n=+b.dataset.b,on=beats.includes(n);if(on&&beats.length===1)return;beats=on?beats.filter((x)=>x!==n):beats.concat(n).sort();b.setAttribute('aria-pressed',String(!on));});
$('fmt').querySelectorAll('button').forEach((b)=>b.onclick=()=>{$('fmt').querySelectorAll('button').forEach((x)=>x.setAttribute('aria-pressed',String(x===b)));fmt=b.dataset.v;show();});
$('len').onchange=()=>{len=+$('len').value;show();};$('zoom').onchange=()=>{zoom=$('zoom').checked;show();};
$('lut').onclick=()=>quick(lut?'/api/lut/clear':'/api/lut').then(show);
$('find').onclick=()=>run('/api/drops',{cadences:beats},'drops');
$('drops').onclick=(e)=>{const row=e.target.closest('.row');if(!row)return;const i=+row.dataset.i;
 if(e.target.classList.contains('chk')){e.target.checked?sel.add(i):sel.delete(i);count();return;}
 active=i;document.querySelectorAll('#drops .row').forEach((r)=>r.classList.toggle('on',+r.dataset.i===i));show();};
$('all').onclick=()=>{const rows=[...document.querySelectorAll('#drops .row')];const allOn=rows.every((r)=>sel.has(+r.dataset.i));rows.forEach((r)=>{const i=+r.dataset.i;allOn?sel.delete(i):sel.add(i);r.querySelector('.chk').checked=!allOn;});count();};
function count(){const n=sel.size;$('export').textContent=n?'Export '+n+' Clip'+(n>1?'s':''):'Tick drops to export';$('export').disabled=busy||!n;}
$('export').onclick=()=>run('/api/export',{drops:[...sel],format:fmt,length:len,zoom},'video');
$('full').onclick=()=>run('/api/export',{full:true,format:fmt,zoom},'video');
$('xfcp').onclick=()=>run('/api/export-xml',{target:'fcp'},'fcp');$('xres').onclick=()=>run('/api/export-xml',{target:'resolve'},'resolve');
$('stop').onclick=()=>api('/api/stop',{});$('reveal').onclick=()=>api(lastAct==='video'?'/api/open-folder':'/api/reveal',{});
$('logbtn').onclick=()=>{$('log').hidden=!$('log').hidden;};
const vid=$('vid');vid.addEventListener('loadstart',()=>{if(vid.src)$('vbusy').hidden=false;});vid.addEventListener('canplay',()=>{$('vbusy').hidden=true;});
vid.addEventListener('error',()=>{$('vbusy').hidden=true;if(vid.src)err('The preview could not be made. Open the Log for details.');});
async function show(){if(active<0)return;const key=[active,fmt,len,zoom,lut].join('|');
 const r=await api('/api/timeline',null,{i:active,l:len});if(r.ok){tl=r.timeline;drawTl();}
 if(key===vkey)return;vkey=key;$('empty').hidden=true;vid.hidden=false;vid.src=q('/api/preview',{i:active,f:fmt,l:len,z:zoom?1:0,k:key});vid.play().catch(()=>{});}
function drawTl(){if(!tl)return;$('tl').hidden=false;document.body.style.setProperty('--tlh',(44+tl.cameras.length*21)+'px');
 $('tlname').textContent='Drop at '+clock(tl.start+tl.drop)+' · '+tl.shots.length+' shots';const L=tl.length,pct=(t)=>(t/L*100).toFixed(3)+'%';
 $('lanes').innerHTML=tl.cameras.map((c,k)=>'<div class="lane"><em>'+esc(c.name)+'</em>'+tl.shots.filter((s)=>s.camera===k).map((s)=>'<i class="blk" style="left:'+pct(s.start)+';width:'+pct(s.end-s.start)+';background:'+COLORS[k%COLORS.length]+'"></i>').join('')+'</div>').join('')+'<i class="dm" style="left:'+pct(tl.drop)+'"></i><i class="hd" id="hd" style="left:0"></i>';}
$('lanes').onclick=(e)=>{if(!tl||vid.hidden)return;const r=$('lanes').getBoundingClientRect();vid.currentTime=Math.max(0,Math.min(tl.length,(e.clientX-r.left)/r.width*tl.length));};
(function loop(){if(tl&&!vid.hidden&&$('hd')){$('hd').style.left=(Math.min(1,vid.currentTime/tl.length)*100)+'%';$('tltime').textContent=clock(vid.currentTime)+' / '+clock(tl.length);}requestAnimationFrame(loop);})();
async function tick(){let s;try{s=await api('/api/status');}catch(e){return;}if(!s.ok)return;
 acct=s.account||{};signed=!!acct.signedIn;can=!!acct.canUse;
 // Gate: the app opens only for a signed-in account that may use it (trial, plan or lifetime).
 const inApp=signed&&can;$('gate').hidden=inApp;$('appv').hidden=!inApp;
 if(!inApp){const plan=signed&&!can;$('gform').hidden=plan;$('gplan').hidden=!plan;
  $('gtitle').textContent=plan?(acct.label||'Your access has ended'):'R Project Multicam AI';
  $('gsub').textContent=plan?(acct.detail||'Get a plan to keep using R Project Multicam AI on this computer.')+' · '+(acct.email||''):(mode==='up'?'Create your R Project account.':'Sign in with your R Project account.');
  if(acct.googlePending)gmsg('Waiting for Google sign-in in your browser…');return;}
 $('lic').textContent=acct.label||'';$('ini').textContent=(acct.email||'R')[0].toUpperCase();$('who').title=acct.email||'';
 const st=s.studio||{};busy=!!s.busy;
 const mname=st.music?st.music.split(/[\\\\/]/).pop():'';
 $('mus').innerHTML='<button class="row'+(st.music?'':' add')+'">'+(st.music?I.music:I.plus)+'<span>'+esc(mname||'Choose Music…')+'</span></button>';
 $('cams').innerHTML=(st.cameras||[]).map((c,i)=>'<div class="row">'+I.cam+'<span>'+esc(c.name)+'</span><small>'+c.files+'</small><button class="x" data-rm="'+i+'" title="Remove">✕</button></div>').join('')+'<button class="row add">'+I.plus+'<span>Add Camera Folder…</span></button>';
 $('ptitle').textContent=st.timeline?st.timeline.title:mname?mname.replace(/\\.[^.]+$/,''):'Untitled';
 $('pinfo').textContent=st.set?clock(st.set.duration)+' · '+st.set.cuts+' cuts'+(st.set.bpm?' · '+Math.round(st.set.bpm)+' BPM':''):'';
 const ready=!!(st.music&&(st.cameras||[]).length);$('find').disabled=busy||!ready;$('find').textContent=st.set?'Find Drops Again':'Find Drops';$('find').classList.toggle('def',ready&&!st.set);
 if(!st.set){$('etitle').textContent=ready?'Ready to find the drops':'Add your footage';$('etext').textContent=ready?'Click Find Drops in the toolbar. The cameras are synced to the music and every drop is listed in the sidebar.':'Choose the music and one folder per camera in the sidebar, then click Find Drops.';}
 const d=st.drops||[],key=st.set?d.map((x)=>x.time).join(','):'';
 if(key!==dropsKey){dropsKey=key;sel=new Set();active=-1;vkey='';tl=null;vid.removeAttribute('src');vid.hidden=true;$('tl').hidden=true;$('empty').hidden=false;
  $('drops').innerHTML=d.map((x,n)=>'<div class="row" data-i="'+x.index+'">'+(x.thumb?'<img alt="" src="'+q('/api/thumb',{i:x.index,k:key})+'">':'<span class="ph"></span>')+'<span>'+clock(x.time)+' <small>Drop '+(n+1)+'</small></span><input type="checkbox" class="chk" title="Export this drop"></div>').join('');
  if(d.length){active=d[0].index;document.querySelector('#drops .row').classList.add('on');setTimeout(show,0);}}
 $('dsec').hidden=!st.set;$('dcount').textContent=d.length?'· '+d.length:'';count();
 lut=st.lut||'';$('lut').textContent=lut?lut+'  ✕':'Add LUT…';$('enc').textContent=st.encoder||'Auto';
 ['full','xfcp','xres'].forEach((id)=>$(id).disabled=busy||!st.set);
 const p=s.progress;$('pwrap').hidden=!busy;$('stat').textContent=busy&&p?(p.text||s.busy):(st.set?d.length+' drop'+(d.length===1?'':'s')+' found':'Ready');if(busy&&p)$('bar').style.width=Math.round(p.p*100)+'%';
 const lr=s.lastResult;if(!busy&&lr&&lr.ok===false&&!lr.license&&lr.at>(window._shown||0)){window._shown=lr.at;err(lr.error);}
 if(!busy&&lr&&lr.ok!==false&&lr.at>(window._done||0)&&/Export/.test(lr.action||'')){window._done=lr.at;$('done').hidden=false;
  if(lr.action==='Export'){$('dtitle').textContent=lr.exported+' video'+(lr.exported>1?'s':'')+' ready to post';$('dtext').textContent=lr.encoders?'Encoded with '+lr.encoders+'.':'';lastAct='video';}
  else{$('dtitle').textContent='XML ready';$('dtext').textContent=lr.target==='resolve'?'In DaVinci Resolve: File → Import → Timeline.':lr.openedIn==='Final Cut Pro'?'Opened in Final Cut Pro.':'In Final Cut Pro: File → Import → XML.';lastAct='xml';}}
 if(busy)$('done').hidden=true;}
connect();tick();setInterval(tick,1000);
</script></body></html>`;
}

async function main() {
  const args = process.argv.slice(2), noBrowser = args.includes('--no-browser'), appMode = args.includes('--app');
  // macOS app bundle: the launcher opens the window itself; it passes --url-file (where to write the address) and
  // --parent-pid (the window's process: when it ends, the engine ends too).
  const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };
  const urlFile = arg('--url-file'), parentPid = Number(arg('--parent-pid')) || 0;
  const tellUrl = (u) => { if (urlFile) try { fs.writeFileSync(urlFile, u); } catch (e) { /* launcher times out */ } };
  const portArg = args.indexOf('--port'), port = portArg >= 0 ? Number(args[portArg + 1]) : 0;
  const dir = appDir(), lockFile = path.join(dir, 'engine.lock');
  fs.mkdirSync(dir, { recursive: true });
  const lock = await acquireLock(lockFile);
  if (lock.running) {
    console.log('R Project Engine is already running: ' + lock.running);
    tellUrl(lock.running);
    if (!noBrowser) { if (appMode) openAppWindow(lock.running, path.join(dir, 'window')); else openBrowser(lock.running); }
    return;
  }
  let eng;
  try { eng = await start({ port }); }
  catch (e) { fs.closeSync(lock.fd); fs.rmSync(lockFile, { force: true }); throw e; }
  fs.writeSync(lock.fd, JSON.stringify({ pid: process.pid, url: eng.url }));
  fs.closeSync(lock.fd);
  tellUrl(eng.url);
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
  if (parentPid) {
    const watch = setInterval(() => { try { process.kill(parentPid, 0); } catch (e) { clearInterval(watch); eng.studio.stop(); shutdown(); } }, 1500);
  }
}

if (require.main === module) main().catch((e) => { console.error('R Project Engine failed: ' + (e && e.stack || e)); process.exitCode = 1; });
module.exports = { start, page, VERSION, LICENSE_VERSION, acquireLock, engineAnswers, appBrowser };
