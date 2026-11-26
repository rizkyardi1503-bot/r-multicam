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

const FCP_VERSION = '1.1.0';
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
  return '';
}

function openBrowser(url) {
  try {
    const c = process.platform === 'win32' ? cp.spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' })
      : cp.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    c.on('error', () => {}); c.unref();
  } catch (e) { /* the URL is printed in the console */ }
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
  const account = opts.account || new Account({ log, platform: 'macOS', pluginVersion: LICENSE_VERSION, sessionFile: path.join(supportDir(), 'finalcut', 'session.json') });
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
      const r = await route(body);
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

function page(token) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>R Project Multicam AI</title><style>
:root{--ink:#1d1d1f;--prose:#424245;--muted:#6e6e73;--line:#d2d2d7;--soft:#f5f5f7;--blue:#0071e3;--blue2:#0066cc;--ok:#34c759;--err:#d70015}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:#fff;color:var(--ink);font:17px/1.47 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
button,input{font:inherit;color:inherit}button{cursor:pointer}[hidden]{display:none!important}
header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 max(20px,calc(50% - 340px));background:#ffffffcc;-webkit-backdrop-filter:saturate(180%) blur(18px);backdrop-filter:saturate(180%) blur(18px);border-bottom:1px solid #0000000f}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:15px}.brand i{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:var(--blue);color:#fff;font-style:normal;font-size:14px}
.pill{display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:14px}.pill b{width:7px;height:7px;border-radius:50%;background:#c7c7cc}.pill b.on{background:var(--ok)}
main{max-width:680px;margin:0 auto;padding:56px 20px 40px}
h1{margin:0;font-size:clamp(34px,6vw,48px);line-height:1.08;letter-spacing:-.025em;font-weight:600;text-align:center}
.sub{margin:14px auto 36px;max-width:30em;color:var(--muted);font-size:19px;text-align:center}
.drop{display:grid;place-items:center;gap:10px;min-height:210px;padding:28px;border:1.5px dashed var(--line);border-radius:24px;background:var(--soft);text-align:center;transition:border-color .2s,background-color .2s}
.drop.over{border-color:var(--blue);background:#0071e30d}.drop svg{width:44px;height:44px;color:var(--blue)}.drop strong{font-size:21px;font-weight:600}
.link{padding:0;border:0;background:none;color:var(--blue2);font-size:17px}.link:hover{text-decoration:underline}
.card{border-radius:24px;background:var(--soft);padding:24px}
.tl{display:flex;align-items:center;justify-content:space-between;gap:12px}.tl strong{font-size:21px;font-weight:600}.tl small{display:block;color:var(--muted);font-size:14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}.chips span{padding:5px 12px;border-radius:999px;background:#fff;font-size:14px;color:var(--prose)}.chips span.mus{color:#bf4800}
.row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:22px;flex-wrap:wrap}.row>span{font-size:15px;color:var(--muted)}
.seg{display:inline-flex;padding:3px;border-radius:999px;background:#e8e8ed}.seg button{min-height:34px;padding:0 16px;border:0;border-radius:999px;background:none;color:var(--prose);font-size:14px;font-weight:500}
.seg button[aria-pressed="true"]{background:#fff;color:var(--ink);box-shadow:0 1px 3px #0000001f}
.beats{display:inline-flex;gap:6px}.beats button{width:42px;height:34px;border:0;border-radius:999px;background:#e8e8ed;color:var(--prose);font-size:14px;font-weight:500}.beats button[aria-pressed="true"]{background:var(--ink);color:#fff}
.go{display:block;width:100%;min-height:52px;margin-top:24px;border:0;border-radius:999px;background:var(--blue);color:#fff;font-size:17px;font-weight:500}.go:hover{background:#0077ed}.go:disabled{background:#0071e366;cursor:default}
.prog{margin-top:22px}.bar{height:4px;border-radius:2px;background:#e8e8ed;overflow:hidden}.bar i{display:block;height:100%;width:0;background:var(--blue);transition:width .4s}
.prog p{display:flex;justify-content:space-between;margin:10px 0 0;font-size:14px;color:var(--muted)}
.done{margin-top:24px;text-align:center}.done svg{width:48px;height:48px;color:var(--ok)}.done h2{margin:10px 0 4px;font-size:24px;font-weight:600;letter-spacing:-.015em}.done p{margin:0;color:var(--muted)}
.btns{display:flex;justify-content:center;gap:10px;margin-top:18px;flex-wrap:wrap}.btn{min-height:40px;padding:0 20px;border:1px solid var(--blue);border-radius:999px;background:#fff;color:var(--blue);font-size:15px;text-decoration:none;display:inline-flex;align-items:center}.btn.fill{background:var(--blue);color:#fff}
.err{margin-top:16px;color:var(--err);font-size:15px;text-align:center}
footer{max-width:680px;margin:0 auto;padding:0 20px 40px;color:var(--muted);font-size:13px;text-align:center}footer details{margin-top:10px;text-align:left}footer summary{cursor:pointer;text-align:center}
#log{max-height:220px;overflow:auto;margin-top:10px;padding:12px;border-radius:12px;background:var(--soft);font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}
dialog{width:min(400px,calc(100% - 32px));padding:28px;border:0;border-radius:22px;box-shadow:0 30px 80px -20px #0000004d}dialog::backdrop{background:#0000004d;-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
dialog h2{margin:0 0 6px;font-size:24px;font-weight:600}dialog p{margin:0 0 18px;color:var(--muted);font-size:15px}
dialog input{display:block;width:100%;min-height:44px;margin-bottom:10px;padding:0 14px;border:1px solid var(--line);border-radius:12px}dialog input:focus{outline:2px solid var(--blue);border-color:transparent}
dialog .go{margin-top:6px}.alt{display:flex;justify-content:space-between;margin-top:14px}.or{margin:16px 0;text-align:center;color:var(--muted);font-size:13px}
.gbtn{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:44px;border:1px solid var(--line);border-radius:999px;background:#fff;font-size:15px}
.x{position:absolute;right:16px;top:14px;width:30px;height:30px;border:0;border-radius:50%;background:var(--soft);color:var(--muted)}
@media (max-width:560px){main{padding-top:36px}.row{flex-direction:column;align-items:stretch}.seg,.beats{justify-content:center}}
</style></head><body>
<header><div class="brand"><i>R</i>Multicam AI</div><button class="pill" id="acct"><b id="adot"></b><span id="alabel">Sign in</span></button></header>
<main>
<h1>Cut your timeline<br>to the music.</h1>
<p class="sub">Export XML from Final Cut Pro or DaVinci Resolve. Drop it here. Import the result.</p>
<div class="drop" id="drop"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M28 6H14a4 4 0 0 0-4 4v28a4 4 0 0 0 4 4h20a4 4 0 0 0 4-4V16z"/><path d="M28 6v10h10M24 34V22m-5 5 5-5 5 5"/></svg>
<strong>Drop your .fcpxml</strong><button class="link" id="choose">or choose a file</button><input id="file" type="file" accept=".fcpxml,.xml,.fcpxmld" hidden></div>
<section class="card" id="loaded" hidden><div class="tl"><div><strong id="tlname"></strong><small id="tlfrom"></small></div><button class="link" id="change">Change</button></div>
<div class="chips" id="chips"></div>
<div class="row"><span>Open in</span><div class="seg" role="group" aria-label="Open in"><button data-t="fcp" aria-pressed="true">Final Cut Pro</button><button data-t="resolve" aria-pressed="false">DaVinci Resolve</button></div></div>
<div class="row"><span>Cut every</span><div class="beats" role="group" aria-label="Cut every"><button data-b="2" aria-pressed="false">2</button><button data-b="4" aria-pressed="true">4</button><button data-b="6" aria-pressed="true">6</button><button data-b="8" aria-pressed="true">8</button></div></div></section>
<button class="go" id="go" disabled>Create edit</button>
<div class="prog" id="prog" hidden><div class="bar"><i id="bar"></i></div><p><span id="ptext">Starting…</span><button class="link" id="stop">Stop</button></p></div>
<div class="err" id="err" role="alert" hidden></div>
<div class="done" id="done" hidden><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="m16 24 6 6 11-12"/></svg>
<h2>Your edit is ready.</h2><p id="dtext"></p><div class="btns"><button class="btn fill" id="reveal">Show file</button><a class="btn" id="dl" href="#">Download</a></div></div>
</main>
<footer>Runs on this computer. Your media never leaves it. · ${VERSION}<details><summary>Details</summary><div id="log"></div></details></footer>
<dialog id="sheet"><button class="x" id="close" aria-label="Close">✕</button>
<div id="out"><h2>Sign in</h2><p>Use your R Project account.</p><input id="email" type="email" placeholder="Email" autocomplete="username"><input id="password" type="password" placeholder="Password" autocomplete="current-password">
<button class="go" id="signin">Sign in</button><div class="alt"><button class="link" id="forgot">Forgot password?</button><a class="link" href="https://r-multicam.pages.dev/?signup" target="_blank" rel="noopener noreferrer">Create account</a></div>
<div class="or">or</div><button class="gbtn" id="google">Continue with Google</button><p id="glink" hidden><a class="link" id="glinkA" href="#" target="_blank" rel="noopener">Open Google sign-in</a></p></div>
<div id="in" hidden><h2 id="iemail"></h2><p id="ilabel"></p><div class="btns"><a class="btn fill" id="buy" href="https://r-multicam.pages.dev/#pricing" target="_blank" rel="noopener noreferrer">Get a plan</a><button class="btn" id="check">Refresh</button><button class="btn" id="signout">Sign out</button></div></div>
<p id="amsg" style="margin:14px 0 0"></p></dialog>
<script>
const T=${JSON.stringify(token)};const $=(id)=>document.getElementById(id);let last=0,target='fcp',beats=[4,6,8],signed=false,can=false,loaded=false,busy=false;
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(p,b){const r=await fetch(p+'?t='+T,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{cache:'no-store'});let j={};try{j=await r.json();}catch(e){}return j;}
function err(m){$('err').textContent=m||'';$('err').hidden=!m;}
function addLog(l){last=Math.max(last,l.n);const d=$('log');d.textContent+=(d.textContent?'\\n':'')+l.t+'  '+l.text;d.scrollTop=d.scrollHeight;}
let es=null;function connect(){if(es)es.close();es=new EventSource('/api/events?t='+T+'&since='+last);es.onmessage=(e)=>addLog(JSON.parse(e.data));es.onerror=()=>{es.close();setTimeout(connect,2000);};}
async function load(f){if(!f)return;err('');const text=await f.text();const r=await api('/api/xml',{name:f.name,text});if(!r.ok)return err(r.error);if(r.app)setTarget(r.app);$('done').hidden=true;tick();}
function setTarget(t){target=t;document.querySelectorAll('.seg button').forEach((b)=>b.setAttribute('aria-pressed',String(b.dataset.t===t)));}
const drop=$('drop');['dragenter','dragover'].forEach((e)=>drop.addEventListener(e,(v)=>{v.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach((e)=>drop.addEventListener(e,(v)=>{v.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',(v)=>load(v.dataTransfer.files[0]));$('choose').onclick=()=>$('file').click();$('change').onclick=()=>$('file').click();$('file').onchange=(v)=>{load(v.target.files[0]);v.target.value='';};
document.querySelectorAll('.seg button').forEach((b)=>b.onclick=()=>setTarget(b.dataset.t));
document.querySelectorAll('.beats button').forEach((b)=>b.onclick=()=>{const n=+b.dataset.b,on=beats.includes(n);if(on&&beats.length===1)return;beats=on?beats.filter((x)=>x!==n):beats.concat(n).sort();b.setAttribute('aria-pressed',String(!on));});
$('go').onclick=async()=>{if(!can){$('sheet').showModal();return;}err('');$('done').hidden=true;const r=await api('/api/multicam',{target,cadences:beats});if(!r.ok)err(r.error);tick();};
$('stop').onclick=()=>api('/api/stop',{});$('reveal').onclick=()=>api('/api/reveal',{});
$('acct').onclick=()=>$('sheet').showModal();$('close').onclick=()=>$('sheet').close();
const acc=async(p,b)=>{const r=await api(p,b);$('amsg').textContent=r.ok?(r.message||''):(r.error||'');tick();return r;};
$('signin').onclick=async()=>{await acc('/api/account/signin',{email:$('email').value,password:$('password').value});$('password').value='';};
$('forgot').onclick=()=>acc('/api/account/forgot',{email:$('email').value});$('signout').onclick=()=>acc('/api/account/signout',{});$('check').onclick=()=>acc('/api/account/check',{});
$('google').onclick=async()=>{const w=window.open('about:blank','_blank');const r=await acc('/api/account/google',{});if(r.link){if(w)w.location=r.link;$('glinkA').href=r.link;$('glink').hidden=false;}else if(w)w.close();};
async function tick(){let s;try{s=await api('/api/status');}catch(e){return;}if(!s.ok)return;
 const a=s.account||{};signed=!!a.signedIn;can=!!a.canUse;$('adot').className=can?'on':'';$('alabel').textContent=signed?a.label:'Sign in';
 $('out').hidden=signed;$('in').hidden=!signed;$('iemail').textContent=a.email||'';$('ilabel').textContent=a.detail||a.label||'';$('buy').hidden=a.licenseStatus==='lifetime';
 const st=s.studio||{},tl=st.timeline;loaded=!!(tl&&st.music);$('drop').hidden=loaded;$('loaded').hidden=!loaded;
 if(loaded){$('tlname').textContent=tl.title;$('tlfrom').textContent=(tl.app==='resolve'?'DaVinci Resolve':'Final Cut Pro')+' · '+tl.file;
  $('chips').innerHTML='<span class="mus">♪ '+esc(st.music.split(/[\\/]/).pop())+'</span>'+st.cameras.map((c)=>'<span>'+esc(c.name)+' · '+c.files+'</span>').join('');}
 busy=!!s.busy;const p=s.progress;$('prog').hidden=!busy;$('go').disabled=!loaded||busy;$('go').textContent=can?'Create edit':'Sign in to create';
 if(busy&&p){$('bar').style.width=Math.round(p.p*100)+'%';$('ptext').textContent=p.text||s.busy;}
 const lr=s.lastResult;if(!busy&&lr&&lr.ok===false&&!lr.license&&lr.at>(window._shown||0)){window._shown=lr.at;err(lr.error);}
 const r=st.result;$('done').hidden=busy||!r;if(r){$('dtext').textContent=r.target==='resolve'?'In DaVinci Resolve: File → Import → Timeline.':r.openedIn==='Final Cut Pro'?'Opened in Final Cut Pro.':'In Final Cut Pro: File → Import → XML.';$('dl').href='/api/result?t='+T;}}
connect();tick();setInterval(tick,1000);
</script></body></html>`;
}

async function main() {
  const args = process.argv.slice(2), noBrowser = args.includes('--no-browser');
  const portArg = args.indexOf('--port'), port = portArg >= 0 ? Number(args[portArg + 1]) : 0;
  const dir = appDir(), lockFile = path.join(dir, 'engine.lock');
  fs.mkdirSync(dir, { recursive: true });
  const lock = await acquireLock(lockFile);
  if (lock.running) {
    console.log('R Project Engine is already running: ' + lock.running);
    if (!noBrowser) openBrowser(lock.running);
    return;
  }
  let eng;
  try { eng = await start({ port }); }
  catch (e) { fs.closeSync(lock.fd); fs.rmSync(lockFile, { force: true }); throw e; }
  fs.writeSync(lock.fd, JSON.stringify({ pid: process.pid, url: eng.url }));
  fs.closeSync(lock.fd);
  console.log('\nOpen this address if the browser does not open:\n  ' + eng.url + '\nClose this window to stop R Project Engine.\n');
  if (!noBrowser) openBrowser(eng.url);
  let ended = false;
  const shutdown = () => {
    if (ended) return; ended = true;
    try { const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')); if (l.pid === process.pid) fs.rmSync(lockFile, { force: true }); } catch (e) { /* gone */ }
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown);
}

if (require.main === module) main().catch((e) => { console.error('R Project Engine failed: ' + (e && e.stack || e)); process.exitCode = 1; });
module.exports = { start, page, VERSION, LICENSE_VERSION, acquireLock, engineAnswers };
