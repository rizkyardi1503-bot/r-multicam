#!/usr/bin/env node
// R Project Engine for Final Cut Pro (macOS) - v1.0.0.
// Serves the control page on http://127.0.0.1:<port>/?t=<token> (localhost only). The user picks the music and the
// camera clips; the engine syncs every clip by its own audio, analyzes the music with the Premiere engine, chooses the
// cuts and writes an FCPXML (one multicam clip + a project cut on the beat) that opens straight in Final Cut Pro.
// Final Cut's media is never changed. No npm dependencies.
//   node rp-finalcut-engine.js [--no-browser] [--port N]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), cp = require('child_process');
const { Account } = require('./lib/account');

const VERSION = 'Final Cut v1.0.0 (engine 2.3.11.19)';
const PLUGIN_VERSION = '2.3.11.19-finalcut-v1.0.0';                  // sent to the license server (minimum 2.3.11.11)
const HEARTBEAT_MS = 5 * 60000;
const MAX_CAMERAS = 16, MAX_FILES = 400, MAX_PARTS = 8;
const FCP_BUNDLES = ['com.apple.FinalCut', 'com.apple.FinalCutTrial'];

function supportDir() { return path.join(os.homedir(), 'Library', 'Application Support', 'RProjectMulticam'); }
function appDir() { return process.env.RP_FINALCUT_DIR || path.join(supportDir(), 'finalcut'); }
function defaultOutputDir() { return path.join(os.homedir(), 'Movies', 'R Project Multicam'); }

function openUrl(url) {
  try { cp.spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref(); }
  catch (e) { /* the URL is printed in the log */ }
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    cp.execFile(cmd, args, { timeout: timeoutMs || 15000, maxBuffer: 4 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

/** Native macOS file chooser (osascript + Standard Additions: no Automation permission prompt). The scripts are
 *  constant: no user text is ever put into them. `activate` brings the dialog in front of the browser. */
const PICK_SCRIPTS = {
  music: ['activate',
    'set fs to choose file with prompt "Choose the music / DJ set audio (several files = several parts of one night)" of type {"public.audio", "public.movie"} with multiple selections allowed',
    'set out to ""', 'repeat with f in fs', 'set out to out & POSIX path of f & linefeed', 'end repeat', 'return out'],
  camera: ['activate',
    'set fs to choose file with prompt "Choose every clip of ONE camera (select several clips with Command or Shift)" of type {"public.movie"} with multiple selections allowed',
    'set out to ""', 'repeat with f in fs', 'set out to out & POSIX path of f & linefeed', 'end repeat', 'return out'],
  folder: ['activate', 'set f to choose folder with prompt "Choose where to save the Final Cut Pro file"', 'return POSIX path of f'],
};
async function pickWithOsascript(kind) {
  const lines = PICK_SCRIPTS[kind];
  if (!lines) throw new Error('Unknown chooser');
  if (process.platform !== 'darwin') throw new Error('The file chooser needs macOS. Paste the paths instead.');
  const r = await run('osascript', [].concat(...lines.map((l) => ['-e', l])), 30 * 60000);
  if (!r.ok) { if (/-128/.test(r.stderr)) return []; throw new Error('File chooser failed: ' + r.stderr.trim()); }
  return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** Open the FCPXML in Final Cut Pro (it asks which library to import into). */
async function openInFinalCut(files) {
  for (const id of FCP_BUNDLES) {
    const r = await run('open', ['-b', id].concat(files));
    if (r.ok) return 'Final Cut Pro';
  }
  const r = await run('open', files);
  if (r.ok) return 'the default app for .fcpxml';
  throw new Error('Final Cut Pro was not found. Import the .fcpxml in Final Cut Pro with File > Import > XML.');
}

// ------------------------------------------------------------------ request validation
function cleanPath(p, what) {
  if (typeof p !== 'string' || !p || p.length > 4096 || p.includes('\0')) throw new Error(what + ': invalid path');
  if (!path.isAbsolute(p)) throw new Error(what + ': use a full path (' + p + ')');
  let st;
  try { st = fs.statSync(p); } catch (e) { throw new Error(what + ' not found: ' + p); }
  if (!st.isFile()) throw new Error(what + ' is not a file: ' + p);
  return path.normalize(p);
}
function cleanMusic(list) {
  const parts = (Array.isArray(list) ? list : [list]).filter((x) => x !== '' && x != null);
  if (!parts.length) throw new Error('Choose the music first.');
  if (parts.length > MAX_PARTS) throw new Error('At most ' + MAX_PARTS + ' music parts.');
  return parts.map((p) => cleanPath(p, 'Music'));
}
function cleanCameras(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('Add at least one camera.');
  if (list.length > MAX_CAMERAS) throw new Error('At most ' + MAX_CAMERAS + ' cameras.');
  let total = 0;
  return list.map((c, i) => {
    const files = (c && Array.isArray(c.files) ? c.files : []).filter(Boolean);
    if (!files.length) throw new Error('Camera ' + (i + 1) + ' has no clips.');
    total += files.length;
    if (total > MAX_FILES) throw new Error('At most ' + MAX_FILES + ' clips in total.');
    const role = String(c.role || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, 60) || 'Camera ' + (i + 1);
    return { files: files.map((f) => cleanPath(f, 'Camera ' + (i + 1) + ' clip')), role };
  });
}
function cleanCadences(list) {
  const out = [2, 4, 6, 8].filter((n) => (Array.isArray(list) ? list : []).map(Number).includes(n));
  return out.length ? out : [4, 6, 8];
}
function safeName(s) { return String(s).replace(/[\/\\:*?"<>|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Multicam'; }
/** <dir>/<name>.fcpxml that does not exist yet (also checks the "- Part N" files of a multi-part night). */
function freeBase(dir, name, parts) {
  const taken = (base) => ['.fcpxml', '.rpplan.json'].some((ext) => {
    if (parts <= 1) return fs.existsSync(path.join(dir, base + ext));
    for (let i = 1; i <= parts; i++) if (fs.existsSync(path.join(dir, base + ' - Part ' + i + ext))) return true;
    return false;
  });
  let base = name;
  for (let n = 2; taken(base); n++) base = name + ' ' + n;
  return path.join(dir, base);
}

// ------------------------------------------------------------------ jobs (child process)
function startJob(tool, args, onProgress, opts) {
  const child = cp.fork(path.join(__dirname, 'rp-finalcut-job.mjs'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: [], env: Object.assign({}, process.env, opts.jobEnv || {}) });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  const done = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    child.on('message', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'ready') child.send({ type: 'run', tool, args });
      else if (m.type === 'progress') onProgress(m.p, m.message);
      else if (m.type === 'done') finish(resolve, m.result);
      else if (m.type === 'error') finish(reject, new Error(m.message));
    });
    child.on('error', (e) => finish(reject, e));
    child.on('exit', (code, sig) => finish(reject, new Error(sig ? 'Engine job stopped (' + sig + ').' : 'Engine job ended (exit ' + code + ')' + (stderr.trim() ? ': ' + stderr.trim().split('\n').pop() : '.'))));
  });
  return {
    done,
    cancel() { try { child.send({ type: 'cancel' }); } catch (e) { /* gone */ } setTimeout(() => { try { child.kill('SIGTERM'); } catch (e) { /* gone */ } }, 4000).unref(); },
    kill() { try { child.kill('SIGTERM'); } catch (e) { /* gone */ } },
  };
}

/** The R Project account for this build. device-id.txt is shared with the Mac Premiere plugin (same folder, same
 *  algorithm): one Mac = one device. The session file is this build's own. */
function makeAccount(log, extra) {
  return new Account(Object.assign({ log, platform: 'macOS', pluginVersion: PLUGIN_VERSION, googleHost: 'finalcut', sessionFile: path.join(appDir(), 'session.json') }, extra || {}));
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

/** One engine at a time. The lock is created atomically ('wx'); an existing lock only counts when that engine answers. */
async function acquireLock(lockFile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return { fd: fs.openSync(lockFile, 'wx', 0o600) }; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let lock = null;
    try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (e) { /* empty or being written */ }
    if (lock && lock.url && await engineAnswers(lock.url)) return { running: lock.url };
    if (!lock && attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
    fs.rmSync(lockFile, { force: true });
  }
  throw new Error('Could not create ' + lockFile);
}

/** Start the engine. Returns { url, port, token, account, close() }. Options are injectable for tests. */
async function start(opts = {}) {
  const lines = [], clients = new Set();
  let seq = 0, busy = null, progress = null, lastResult = null, analysis = null, job = null;
  function log(text) {
    const line = { n: ++seq, t: new Date().toTimeString().slice(0, 8), text: String(text) };
    lines.push(line); if (lines.length > 3000) lines.shift();
    if (!opts.quiet) console.log('[' + line.t + '] ' + line.text);
    for (const res of clients) res.write('data: ' + JSON.stringify(line) + '\n\n');
  }
  const token = opts.token || crypto.randomBytes(16).toString('hex');
  const pick = opts.pickFiles || pickWithOsascript;
  const openFcp = opts.openInFinalCut || openInFinalCut;
  const cacheDir = opts.cacheDir || path.join(appDir(), 'cache');
  // License gate: the same R Project account as the Premiere plugin, checked before every engine job.
  const account = opts.account || makeAccount(log);
  const restored = Promise.resolve(account.restore()).then((st) => { if (st && st.signedIn) log('Account: ' + st.email + ' · ' + st.label); }).catch((e) => log('Account check failed: ' + e.message));
  const beat = setInterval(() => { if (account.session) Promise.resolve(account.heartbeat()).catch((e) => log('Account: ' + e.message)); }, HEARTBEAT_MS);
  if (beat.unref) beat.unref();

  /** Validate, check the license, then run one job in the background (202). */
  async function action(name, prepare, finish) {
    if (busy) return { status: 409, body: { ok: false, error: 'Busy: ' + busy + ' is still running.' } };
    let prepared;
    try { prepared = prepare(); } catch (e) { log(name + ': ' + e.message); return { status: 400, body: { ok: false, error: e.message } }; }
    busy = name;                                                       // reserve before awaiting the license check
    await restored;
    try { await account.ensureAllowed(); }
    catch (e) { busy = null; log(name + ': ' + e.message); lastResult = { action: name, at: Date.now(), ok: false, error: e.message, license: true }; return { status: 403, body: { ok: false, error: e.message, code: e.code || 'NOT_ALLOWED' } }; }
    log('--- ' + name + ' ---');
    progress = { p: 0, message: 'Starting' };
    let lastMsg = '';
    job = startJob(prepared.tool, prepared.args, (p, m) => { progress = { p, message: m }; if (m && m !== lastMsg) { lastMsg = m; log(m); } }, opts);
    const done = job.done.then((r) => finish(r, prepared)).then((r) => { lastResult = Object.assign({ action: name, at: Date.now(), ok: true }, r); log(name + ': done.'); },
      (e) => { lastResult = { action: name, at: Date.now(), ok: false, error: e.message }; log(name + ' failed: ' + e.message); })
      .finally(() => { busy = null; job = null; progress = null; });
    if (opts.awaitActions) await done;
    return { status: 202, body: { ok: true, started: name } };
  }
  async function accountCall(name, fn) {
    try { const r = await fn(); const st = account.status(); log(name + ': ' + (r && r.message ? r.message : st.signedIn ? st.email + ' · ' + st.label : st.label)); return { body: Object.assign({ ok: true }, r && r.message ? { message: r.message } : {}, r && r.link ? { link: r.link } : {}, { account: st }) }; }
    catch (e) { log(name + ': ' + e.message); return { status: 400, body: { ok: false, error: e.message, code: e.code || '', account: account.status() } }; }
  }
  const summarize = (m) => ({ bpm: m.bpm, bpmConfidence: m.bpm_confidence, duration: m.duration, drops: (m.drops || []).length,
    mainDrops: (m.drops || []).slice().sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0)).slice(0, 5).map((d) => d.time).sort((a, b) => a - b),
    sections: (m.sections || []).length, pacing: m.pacing && m.pacing.summary || null });

  const routes = {
    'GET /api/status': async () => ({ body: { ok: true, version: VERSION, platform: process.platform, account: account.status(), busy, progress, lastResult, analysis, defaultOutput: defaultOutputDir() } }),
    'POST /api/pick': async (b) => {
      const kind = String(b.kind || '');
      if (!PICK_SCRIPTS[kind]) return { status: 400, body: { ok: false, error: 'Unknown chooser.' } };
      try { return { body: { ok: true, files: await pick(kind) } }; }
      catch (e) { return { status: 400, body: { ok: false, error: e.message } }; }
    },
    'POST /api/analyze': (b) => action('Analyze Music', () => ({ tool: 'analyze_music', args: { music: cleanMusic(b.music)[0], sensitivity: b.sensitivity } }),
      async (m) => { analysis = summarize(m); log('BPM ' + m.bpm + ' (' + m.bpm_confidence + ') · ' + analysis.drops + ' drop(s)' + (analysis.mainDrops.length ? ' at ' + analysis.mainDrops.map((t) => t.toFixed(1) + ' s').join(', ') : '')); return { analysis }; }),
    'POST /api/multicam': (b) => action('Create Multicam Edit', () => {
      const parts = cleanMusic(b.music), cameras = cleanCameras(b.cameras), cadences = cleanCadences(b.cadences);
      const outDir = b.outputDir ? String(b.outputDir) : defaultOutputDir();
      if (!path.isAbsolute(outDir) || outDir.includes('\0')) throw new Error('Output folder: use a full path.');
      fs.mkdirSync(outDir, { recursive: true });
      const base = freeBase(outDir, safeName(path.basename(parts[0]).replace(/\.[^.]+$/, '') + ' - Multicam AI'), parts.length);
      const dropCamera = b.dropCamera === '' || b.dropCamera == null ? undefined : Number(b.dropCamera);
      if (dropCamera !== undefined && !(Number.isInteger(dropCamera) && dropCamera >= 0 && dropCamera < cameras.length)) throw new Error('Main drop camera is not one of the cameras.');
      return { tool: 'plan_multicam', open: b.open !== false,
        args: { music: parts.length > 1 ? parts : parts[0], cameras, output: base + '.rpplan.json', fcpxml: base + '.fcpxml', cadences, drop_camera: dropCamera,
          sensitivity: ['conservative', 'balanced', 'aggressive'].includes(b.sensitivity) ? b.sensitivity : undefined, cache_dir: cacheDir } };
    }, async (r, prepared) => {
      const plans = r.parts || [r];
      const files = plans.map((p) => p.fcpxml);
      plans.forEach((p, i) => {
        log((plans.length > 1 ? 'Part ' + (i + 1) + ': ' : '') + p.cut_count + ' cuts · BPM ' + p.bpm + ' · ' + p.drops.length + ' drop(s) · ' + path.basename(p.fcpxml));
        for (const c of p.cameras) log('  ' + c.angle + ' "' + c.role + '": ' + c.clips_used + ' clip(s) synced' + (c.clips_excluded ? ', ' + c.clips_excluded + ' left out (no reliable audio match)' : ''));
      });
      let openedWith = null;
      if (prepared.open) {
        try { openedWith = await openFcp(files); log('Opened in ' + openedWith + '. In Final Cut Pro choose the library to import into.'); }
        catch (e) { log(e.message); }
      }
      return { files, openedWith, parts: plans.map((p) => ({ fcpxml: p.fcpxml, cuts: p.cut_count, bpm: p.bpm, drops: p.drops.length, cameras: p.cameras })) };
    }),
    'POST /api/cancel': async () => { if (!job) return { body: { ok: true, cancelled: false } }; job.cancel(); log('Cancelling ' + busy + '…'); return { body: { ok: true, cancelled: true } }; },
    'POST /api/reveal': async () => {
      const f = lastResult && lastResult.ok && lastResult.files && lastResult.files[0];
      if (!f) return { status: 400, body: { ok: false, error: 'Nothing created yet.' } };
      const r = await run('open', ['-R', f]); return r.ok ? { body: { ok: true } } : { status: 400, body: { ok: false, error: 'Could not open Finder.' } };
    },
    'POST /api/open': async () => {
      const files = lastResult && lastResult.ok && lastResult.files;
      if (!files) return { status: 400, body: { ok: false, error: 'Nothing created yet.' } };
      try { const w = await openFcp(files); log('Opened in ' + w + '.'); return { body: { ok: true } }; } catch (e) { return { status: 400, body: { ok: false, error: e.message } }; }
    },
    'POST /api/quit': async () => { log('Stopping R Project Engine.'); if (opts.onQuit) setTimeout(opts.onQuit, 200); return { body: { ok: true, quitting: !!opts.onQuit } }; },
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
    if (!tokenOk(url.searchParams.get('t')) && !tokenOk(req.headers['x-rp-token'])) return send(403, { ok: false, error: 'Missing or wrong token. Open R Project Engine again.' });
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== 'http://' + host) return send(403, { ok: false, error: 'Forbidden origin.' });
    try {
      if (req.method === 'GET' && url.pathname === '/') return send(200, page(token), 'text/html; charset=utf-8');
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
        for await (const chunk of req) { raw += chunk; if (raw.length > 4e6) { send(413, { ok: false, error: 'Too large.' }); req.destroy(); return; } }
        try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return send(400, { ok: false, error: 'Invalid JSON.' }); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { ok: false, error: 'JSON object required.' });
      }
      const r = await route(body);
      return send(r.status || 200, r.body);
    } catch (e) { return send(500, { ok: false, error: String(e && e.message || e) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port || 0, '127.0.0.1', resolve); });
  const port = server.address().port, url = 'http://127.0.0.1:' + port + '/?t=' + token;
  log('R Project Engine ' + VERSION + ' running at ' + url);
  return {
    url, port, token, account, log, lines,
    close: () => new Promise((resolve) => { clearInterval(beat); if (job) job.kill(); for (const c of clients) c.end(); server.close(() => resolve()); }),
  };
}

function page(token) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>R Project Engine</title><style>
:root{--bg:#111418;--panel:#1b2027;--line:#2c333d;--text:#e8ecf1;--muted:#9aa5b1;--acc:#e0533d;--ok:#3fb27f;--warn:#e0a23d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:880px;margin:0 auto;padding:20px 16px}h1{font-size:20px;margin:0 0 4px}small{color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0}
.status{display:flex;gap:10px;align-items:center}.dot{width:10px;height:10px;border-radius:50%;background:var(--warn);flex:none}.dot.ok{background:var(--ok)}
label{display:block;margin:8px 0 4px;color:var(--muted)}textarea,input,select{width:100%;background:#0d1014;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1;min-width:180px}.chk{display:inline-flex;gap:6px;align-items:center;margin-right:14px;color:var(--text)}
.chk input{width:auto}button{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:10px 14px;font-weight:600;cursor:pointer}
button.sec{background:#38404b}button.small{padding:6px 10px;font-weight:500}button:disabled{opacity:.5;cursor:default}.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
#log{height:260px;overflow:auto;background:#0d1014;border:1px solid var(--line);border-radius:6px;padding:8px;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap}
.bar{height:6px;background:#0d1014;border-radius:3px;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;width:0;background:var(--acc)}
.stats{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px}.stats b{display:block;font-size:18px}
.files{font:12px/1.4 ui-monospace,Menlo,monospace;color:var(--muted);margin-top:6px;word-break:break-all}
.cam{border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:10px}.cam .head{display:flex;gap:10px;align-items:center}.cam .head input{flex:1}
a{color:#8ab4ff}.buy{display:inline-block;background:#2f9e6b;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;font-weight:600}[hidden]{display:none!important}#acct small{display:block;margin-top:8px}
button.google{background:#fff;color:#1f1f1f;display:inline-flex;align-items:center;gap:10px;border:1px solid #dadce0}.or{margin-top:10px;color:#8b95a3;font-size:12px}
details summary{cursor:pointer;color:var(--muted);margin-top:8px}
</style></head><body><main>
<h1>R Project Multicam AI <small>for Final Cut Pro · v1.0.0</small></h1>
<div class="card" id="acct"><div class="status"><span class="dot" id="adot"></span><div><b id="alabel">Account</b><br><small id="adetail">Checking your account…</small></div></div>
<div id="signedOut"><div class="row"><div><label for="email">Email</label><input id="email" type="email" autocomplete="username"></div>
<div><label for="password">Password</label><input id="password" type="password" autocomplete="current-password"></div></div>
<div class="btns"><button id="signin">Sign in</button><button class="sec" id="forgot">Forgot password</button></div>
<div class="or">or</div><div class="btns"><button class="google" id="google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button><button class="sec" id="gcancel" hidden>Cancel Google sign-in</button></div>
<small id="glink" hidden>Browser tab did not open? <a id="glinkA" href="#" target="_blank" rel="noopener">Open the Google sign-in page</a></small>
<small>Use the same R Project account as the Premiere plugin (email or Google). No account yet? <a href="https://r-multicam.pages.dev/?signup" target="_blank" rel="noopener noreferrer">Create one on the website</a>.</small></div>
<div id="signedIn" hidden><div class="btns"><button class="sec" id="signout">Sign out</button><button class="sec" id="check">Check license</button><a class="buy" id="buy" href="https://r-multicam.pages.dev/#pricing" target="_blank" rel="noopener noreferrer">Buy lifetime</a></div></div></div>

<div class="card"><b>1. Music</b> <small>· the master audio of the set (several files = several parts of one night)</small>
<div class="btns"><button class="sec small" id="pickMusic">Choose music…</button><button class="sec small" id="clearMusic">Clear</button></div>
<div class="files" id="musicList">No music chosen.</div>
<details><summary>Paste paths instead</summary><textarea id="musicPaste" rows="2" placeholder="/Volumes/SSD/Set/master.wav"></textarea><div class="btns"><button class="sec small" id="useMusicPaste">Use these paths</button></div></details>
<div class="stats"><div><small>BPM</small><b id="bpm">—</b></div><div><small>DROPS</small><b id="drops">—</b></div><div><small>MAIN DROPS</small><b id="mainDrops">—</b></div></div>
<div class="btns"><button id="analyze">Analyze Music</button></div></div>

<div class="card"><b>2. Cameras</b> <small>· one camera = all clips it recorded; each clip is synced by its own audio</small>
<div id="cams"></div>
<div class="btns"><button class="sec small" id="addCam">Add camera…</button></div>
<details><summary>Paste paths instead</summary><textarea id="camPaste" rows="3" placeholder="One clip path per line; they become ONE new camera"></textarea><div class="btns"><button class="sec small" id="useCamPaste">Add as a camera</button></div></details></div>

<div class="card"><b>3. Auto Cut Multicam</b> <small>· writes an .fcpxml with a multicam clip + a project cut on the beat; your media is not changed</small>
<label>Cut every</label><span class="chk"><input type="checkbox" id="c2">2</span><span class="chk"><input type="checkbox" id="c4" checked>4</span><span class="chk"><input type="checkbox" id="c6" checked>6</span><span class="chk"><input type="checkbox" id="c8" checked>8</span> beats
<div class="row"><div><label for="dropCam">Main Drop Camera</label><select id="dropCam"><option value="">Auto</option></select></div>
<div><label for="sens">Drop sensitivity</label><select id="sens"><option value="balanced">Balanced</option><option value="conservative">Conservative</option><option value="aggressive">Aggressive</option></select></div></div>
<label for="outDir">Save to</label><div class="row"><div style="flex:3"><input id="outDir" placeholder=""></div><div style="flex:0 0 auto;min-width:0"><button class="sec small" id="pickOut">Choose…</button></div></div>
<label><span class="chk"><input type="checkbox" id="openFcp" checked>Open in Final Cut Pro when done</span></label>
<div class="btns"><button id="multicam">Create Multicam Edit</button><button class="sec" id="cancel">Cancel</button><button class="sec" id="reopen" hidden>Open in Final Cut Pro</button><button class="sec" id="reveal" hidden>Show in Finder</button></div></div>

<div class="card"><b id="state">Ready</b><div class="bar"><i id="bar"></i></div><div id="log" aria-live="polite"></div>
<div class="btns"><button class="sec small" id="quit">Quit R Project Engine</button></div></div>
</main><script>
const T=${JSON.stringify(token)};const $=(id)=>document.getElementById(id);let last=0;
let music=[],cams=[];
const KEY='rp-fcp-setup';try{const s=JSON.parse(localStorage.getItem(KEY)||'{}');music=s.music||[];cams=s.cams||[];}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify({music,cams}));}catch(e){}}
function base(p){return String(p).split('/').pop();}
function pageLog(text){const d=$('log');const t=new Date().toTimeString().slice(0,8);d.textContent+=(d.textContent?'\\n':'')+t+'  [page] '+text;d.scrollTop=d.scrollHeight;}
async function api(p,b){const r=await fetch(p+'?t='+T,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{cache:'no-store'});let j={};try{j=await r.json();}catch(e){}return {status:r.status,body:j};}
async function act(label,p,b){pageLog(label+': sending…');try{const r=await api(p,b);pageLog(label+': '+(r.body.error?r.body.error:r.body.started?'started':'ok'));return r;}catch(e){pageLog(label+': engine not reachable ('+e.message+')');}finally{tick();}}
function addLog(l){last=Math.max(last,l.n);const d=$('log');d.textContent+=(d.textContent?'\\n':'')+l.t+'  '+l.text;d.scrollTop=d.scrollHeight;}
let es=null;function connect(){if(es)es.close();es=new EventSource('/api/events?t='+T+'&since='+last);es.onmessage=(e)=>addLog(JSON.parse(e.data));es.onerror=()=>{es.close();es=null;setTimeout(connect,2000);};}
function el(tag,props,kids){const e=document.createElement(tag);Object.assign(e,props||{});(kids||[]).forEach(k=>e.append(k));return e;}
function render(){
 $('musicList').textContent=music.length?music.map((m,i)=>(music.length>1?'Part '+(i+1)+': ':'')+m).join('\\n'):'No music chosen.';$('musicList').style.whiteSpace='pre-wrap';
 const box=$('cams');box.textContent='';
 cams.forEach((c,i)=>{const role=el('input',{value:c.role||'',placeholder:'Role, e.g. Master Wide / DJ Close-Up / Crowd'});role.oninput=()=>{c.role=role.value;save();setDrop();};
  const add=el('button',{className:'sec small',textContent:'Add clips…'});add.onclick=async()=>{const r=await pickFiles('camera');if(r.length){c.files=c.files.concat(r.filter(f=>!c.files.includes(f)));save();render();}};
  const rm=el('button',{className:'sec small',textContent:'Remove'});rm.onclick=()=>{cams.splice(i,1);save();render();};
  const files=el('div',{className:'files',textContent:c.files.length+' clip(s): '+c.files.slice(0,6).map(base).join(', ')+(c.files.length>6?' …':'')});
  box.append(el('div',{className:'cam'},[el('div',{className:'head'},[el('b',{textContent:'Camera '+(i+1)}),role,add,rm]),files]));});
 if(!cams.length)box.append(el('div',{className:'files',textContent:'No cameras yet. Click "Add camera…" and select every clip of one camera.'}));
 setDrop();}
function setDrop(){const sel=$('dropCam'),v=sel.value;while(sel.options.length)sel.remove(0);sel.add(new Option('Auto',''));cams.forEach((c,i)=>sel.add(new Option('Camera '+(i+1)+(c.role?' ('+c.role+')':''),String(i))));sel.value=v&&Number(v)<cams.length?v:'';}
async function pickFiles(kind){pageLog('Opening the macOS file chooser…');try{const r=await api('/api/pick',{kind});if(r.body.error){pageLog(r.body.error);return [];}return r.body.files||[];}catch(e){pageLog('engine not reachable');return [];}}
const lines=(t)=>t.split(/\\r?\\n/).map(s=>s.trim().replace(/^["']|["']$/g,'')).filter(Boolean);
$('pickMusic').onclick=async()=>{const r=await pickFiles('music');if(r.length){music=r;save();render();}};
$('clearMusic').onclick=()=>{music=[];save();render();};
$('useMusicPaste').onclick=()=>{const r=lines($('musicPaste').value);if(r.length){music=r;save();render();}};
$('addCam').onclick=async()=>{const r=await pickFiles('camera');if(r.length){cams.push({role:'',files:r});save();render();}};
$('useCamPaste').onclick=()=>{const r=lines($('camPaste').value);if(r.length){cams.push({role:'',files:r});$('camPaste').value='';save();render();}};
$('pickOut').onclick=async()=>{const r=await pickFiles('folder');if(r.length)$('outDir').value=r[0];};
async function tick(){try{const s=(await api('/api/status')).body;
 if(!$('outDir').placeholder)$('outDir').placeholder=s.defaultOutput||'';
 $('state').textContent=s.busy?s.busy+(s.progress&&s.progress.message?' · '+s.progress.message:'')+'…':(s.lastResult?(s.lastResult.action+': '+(s.lastResult.ok?'done':'failed — '+(s.lastResult.error||''))):'Ready');
 $('bar').style.width=(s.progress&&s.busy?Math.round(100*Math.min(1,s.progress.p||0)):0)+'%';$('cancel').disabled=!s.busy;
 const a=s.analysis;if(a){$('bpm').textContent=a.bpm||'—';$('drops').textContent=a.drops;$('mainDrops').textContent=a.mainDrops.length?a.mainDrops.map(t=>{const m=Math.floor(t/60),x=Math.round(t%60);return m+':'+String(x).padStart(2,'0');}).join('  '):'—';}
 const made=s.lastResult&&s.lastResult.ok&&s.lastResult.files;$('reveal').hidden=!made;$('reopen').hidden=!made;
 const ac=s.account||{};$('adot').className='dot'+(ac.canUse?' ok':'');$('alabel').textContent=ac.signedIn?ac.email+' · '+ac.label:'Not signed in';$('adetail').textContent=ac.detail||'';$('signedOut').hidden=!!ac.signedIn;$('signedIn').hidden=!ac.signedIn;$('buy').hidden=ac.code==='LIFETIME';$('google').disabled=!!ac.googlePending;$('gcancel').hidden=!ac.googlePending;if(!ac.googlePending&&ac.signedIn)$('glink').hidden=true;
}catch(e){$('state').textContent='Engine not reachable (closed?). Open R Project Engine again.';}}
$('signin').onclick=async()=>{await act('Sign in','/api/account/signin',{email:$('email').value,password:$('password').value});$('password').value='';};
$('google').onclick=async()=>{const w=window.open('about:blank','_blank');pageLog('Google sign-in: starting…');let r;try{r=await api('/api/account/google',{});}catch(e){if(w)w.close();pageLog('Google sign-in: engine not reachable ('+e.message+')');return;}
if(!r.body.link){if(w)w.close();pageLog('Google sign-in: '+(r.body.error||'failed'));tick();return;}
$('glinkA').href=r.body.link;$('glink').hidden=false;if(w){try{w.opener=null;w.location.href=r.body.link;}catch(e){}}pageLog('Google sign-in: continue in the browser tab that opened. This page updates automatically.');tick();};
$('gcancel').onclick=()=>act('Cancel Google sign-in','/api/account/google/cancel',{});
$('forgot').onclick=()=>act('Forgot password','/api/account/forgot',{email:$('email').value});$('signout').onclick=()=>act('Sign out','/api/account/signout',{});$('check').onclick=()=>act('Check license','/api/account/check',{});
$('analyze').onclick=()=>act('Analyze Music','/api/analyze',{music,sensitivity:$('sens').value});
$('multicam').onclick=()=>act('Create Multicam Edit','/api/multicam',{music,cameras:cams.map(c=>({files:c.files,role:c.role})),cadences:[2,4,6,8].filter(n=>$('c'+n).checked),dropCamera:$('dropCam').value,sensitivity:$('sens').value,outputDir:$('outDir').value.trim(),open:$('openFcp').checked});
$('cancel').onclick=()=>act('Cancel','/api/cancel',{});$('reveal').onclick=()=>act('Show in Finder','/api/reveal',{});$('reopen').onclick=()=>act('Open in Final Cut Pro','/api/open',{});
$('quit').onclick=async()=>{await act('Quit','/api/quit',{});$('state').textContent='R Project Engine stopped. Open it again from Applications.';};
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();if(!es)connect();}});
render();connect();tick();setInterval(tick,1000);
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
    if (!noBrowser) openUrl(lock.running);
    return;
  }
  let eng = null, ended = false;
  const shutdown = () => {
    if (ended) return; ended = true;
    try { const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')); if (l.pid === process.pid) fs.rmSync(lockFile, { force: true }); } catch (e) { /* gone */ }
    Promise.resolve(eng && eng.close()).finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  try { eng = await start({ port, onQuit: shutdown }); }
  catch (e) { fs.closeSync(lock.fd); fs.rmSync(lockFile, { force: true }); throw e; }
  fs.writeSync(lock.fd, JSON.stringify({ pid: process.pid, url: eng.url }));
  fs.closeSync(lock.fd);
  console.log('\nOpen this address if the browser does not open:\n  ' + eng.url + '\n');
  if (!noBrowser) openUrl(eng.url);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown);
}

if (require.main === module) main().catch((e) => { console.error('R Project Engine failed: ' + (e && e.stack || e)); process.exitCode = 1; });
module.exports = { start, page, VERSION, PLUGIN_VERSION, makeAccount, acquireLock, engineAnswers, cleanCameras, cleanMusic, freeBase, safeName, PICK_SCRIPTS };
