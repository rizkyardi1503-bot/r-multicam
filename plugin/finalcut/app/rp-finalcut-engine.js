#!/usr/bin/env node
// R Project Engine for Final Cut Pro (macOS) - v1.0.0.
// Serves the control page on http://127.0.0.1:<port>/?t=<token> (localhost only). The user picks the music and one
// folder per camera; the engine (the Premiere plugin's own code, through rp-engine) syncs the clips by audio, paces the
// cuts to the music and writes an FCPXML that opens in Final Cut Pro as a multicam clip plus a project cut on the beat.
//   node rp-finalcut-engine.js [--no-browser] [--port N]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), cp = require('child_process');

const APP = __dirname;
// The engine files packaged next to this script (never an older Premiere install on the same Mac).
process.env.RP_PLUGIN_DIR = process.env.RP_PLUGIN_DIR || path.join(APP, 'engine');
const { Account } = require('./lib/account');
const { Studio } = require('./lib/fcp-workflow');

const FCP_VERSION = '1.0.0';
function engineVersion() {
  try { return (fs.readFileSync(path.join(APP, 'engine', 'CSXS', 'manifest.xml'), 'utf8').match(/ExtensionBundleVersion="([0-9.]+)"/) || [])[1] || ''; }
  catch (e) { return ''; }
}
const ENGINE_VERSION = engineVersion();
const VERSION = 'Final Cut v' + FCP_VERSION + ' (engine ' + (ENGINE_VERSION || '?') + ')';
// Reported to the license server: same version line as the Premiere build it carries, so the minimum-version rule and
// "update available" work the same way. Platform macOS: Premiere and Final Cut on one Mac share one device id.
const LICENSE_VERSION = (ENGINE_VERSION || '0') + '-finalcut-v' + FCP_VERSION;
const HEARTBEAT_MS = 5 * 60000;

function supportDir() { return path.join(os.homedir(), 'Library', 'Application Support', 'RProjectMulticam'); }
function appDir() { return process.env.RP_FINALCUT_DIR || path.join(supportDir(), 'finalcut'); }

/** FFmpeg chosen by the installer (same file as the Premiere plugin), else PATH. */
function ffmpegPath() {
  if (process.env.RP_FFMPEG) return process.env.RP_FFMPEG;
  try { const p = fs.readFileSync(path.join(supportDir(), 'tools', 'ffmpeg-path.txt'), 'utf8').trim(); if (p && fs.existsSync(p)) return p; } catch (e) { /* none */ }
  return '';
}

function openBrowser(url) {
  try { const c = cp.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); }
  catch (e) { /* the URL is printed in the console */ }
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
    'POST /api/multicam': (b) => { studio.setRoles(b.roles); return job('Create Multicam Edit', () => studio.multicam({ cadences: b.cadences, dropCamera: b.dropCamera, sensitivity: b.sensitivity })); },
    'POST /api/stop': async () => ({ body: { ok: true, stopping: studio.stop() } }),
    'POST /api/reveal': async () => {
      const r = studio.result;
      if (!r || !r.folder) return { status: 400, body: { ok: false, error: 'Nothing created yet.' } };
      cp.execFile('open', ['-R', r.fcpxml], () => {});
      return { body: { ok: true } };
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
        for await (const chunk of req) { raw += chunk; if (raw.length > 1e6) { send(413, { ok: false, error: 'Too large.' }); req.destroy(); return; } }
        body = raw ? JSON.parse(raw) : {};
      }
      const r = await route(body);
      return send(r.status || 200, r.body);
    } catch (e) { return send(500, { ok: false, error: String(e && e.message || e) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(opts.port || 0, '127.0.0.1', resolve); });
  const port = server.address().port, url = 'http://127.0.0.1:' + port + '/?t=' + token;
  log('R Project Engine ' + VERSION + ' running at ' + url);
  if (!process.env.RP_FFMPEG) log('FFmpeg was not found. Run Install-FinalCut.command again (it installs a verified FFmpeg).');
  return {
    url, port, token, studio, account, log, lines,
    close: () => new Promise((resolve) => { clearInterval(beat); studio.stop(); for (const c of clients) c.end(); server.close(() => resolve()); }),
  };
}

function page(token) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>R Project Engine · Final Cut</title><style>
:root{--bg:#111418;--panel:#1b2027;--line:#2c333d;--text:#e8ecf1;--muted:#9aa5b1;--acc:#e0533d;--ok:#3fb27f;--warn:#e0a23d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:860px;margin:0 auto;padding:20px 16px}h1{font-size:20px;margin:0 0 4px}small{color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0}
.status{display:flex;gap:10px;align-items:center}.dot{width:10px;height:10px;border-radius:50%;background:var(--warn);flex:none}.dot.ok{background:var(--ok)}
label{display:block;margin:8px 0 4px;color:var(--muted)}input,select{width:100%;background:#0d1014;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1;min-width:180px}.chk{display:inline-flex;gap:6px;align-items:center;margin-right:14px;color:var(--text)}
.chk input{width:auto}button{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:10px 14px;font-weight:600;cursor:pointer}
button.sec{background:#38404b}button:disabled{opacity:.5;cursor:default}.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
#log{height:260px;overflow:auto;background:#0d1014;border:1px solid var(--line);border-radius:6px;padding:8px;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap}
.bar{height:6px;background:#0d1014;border-radius:3px;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;width:0;background:var(--acc)}
.stats{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px}.stats b{display:block;font-size:18px}
.step{font-weight:700;color:var(--acc);margin-right:6px}
.cam{display:flex;gap:10px;align-items:center;border-top:1px solid var(--line);padding:8px 0}.cam:first-child{border-top:0}
.cam .n{flex:1;min-width:0}.cam .n b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cam input{max-width:200px}.cam button{padding:6px 10px}
a{color:#8ab4ff}.buy{display:inline-block;background:#2f9e6b;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;font-weight:600}[hidden]{display:none!important}#acct small{display:block;margin-top:8px}
button.google{background:#fff;color:#1f1f1f;display:inline-flex;align-items:center;gap:10px;border:1px solid #dadce0}.or{margin-top:10px;color:#8b95a3;font-size:12px}
.path{word-break:break-all;color:var(--muted)}
</style></head><body><main>
<h1>R Project Multicam AI <small>for Final Cut Pro · v${FCP_VERSION}</small></h1>
<div class="card" id="acct"><div class="status"><span class="dot" id="adot"></span><div><b id="alabel">Account</b><br><small id="adetail">Checking your account…</small></div></div>
<div id="signedOut"><div class="row"><div><label for="email">Email</label><input id="email" type="email" autocomplete="username"></div>
<div><label for="password">Password</label><input id="password" type="password" autocomplete="current-password"></div></div>
<div class="btns"><button id="signin">Sign in</button><button class="sec" id="forgot">Forgot password</button></div>
<div class="or">or</div><div class="btns"><button class="google" id="google">Continue with Google</button><button class="sec" id="gcancel" hidden>Cancel Google sign-in</button></div>
<small id="glink" hidden>Browser tab did not open? <a id="glinkA" href="#" target="_blank" rel="noopener">Open the Google sign-in page</a></small>
<small>Use the same R Project account as the Premiere plugin (email or Google). No account yet? <a href="https://r-multicam.pages.dev/?signup" target="_blank" rel="noopener noreferrer">Create one on the website</a>.</small></div>
<div id="signedIn" hidden><div class="btns"><button class="sec" id="signout">Sign out</button><button class="sec" id="check">Check license</button><a class="buy" id="buy" href="https://r-multicam.pages.dev/#pricing" target="_blank" rel="noopener noreferrer">Buy lifetime</a></div></div></div>

<div class="card"><span class="step">1</span><b>Music</b> <small>· the master music or DJ-set recording the edit follows</small>
<p class="path" id="music">No music chosen yet.</p>
<div class="stats"><div><small>BPM</small><b id="bpm">—</b></div><div><small>DROPS</small><b id="drops">—</b></div><div><small>ENERGY</small><b id="energy">—</b></div></div>
<div class="btns"><button class="sec" id="pickMusic">Choose music…</button><button id="analyze">Analyze Music</button></div></div>

<div class="card"><span class="step">2</span><b>Cameras</b> <small>· one folder per camera; every clip is synced to the music by its own audio</small>
<div id="cams"><p class="path">No cameras yet.</p></div>
<div class="btns"><button class="sec" id="addFolder">Add camera folder…</button><button class="sec" id="addFiles">Add camera clips…</button></div>
<small>Each camera needs its own sound of the music (on-camera mic is fine). Clips the engine cannot place reliably are left out and listed in the log.</small></div>

<div class="card"><span class="step">3</span><b>Auto Cut Multicam</b> <small>· creates a new .fcpxml and opens it in Final Cut Pro; your media is not changed</small>
<label>Cut every</label><span class="chk"><input type="checkbox" id="c2">2</span><span class="chk"><input type="checkbox" id="c4" checked>4</span><span class="chk"><input type="checkbox" id="c6" checked>6</span><span class="chk"><input type="checkbox" id="c8" checked>8</span> beats
<div class="row"><div><label for="dropCam">Main Drop Camera</label><select id="dropCam"><option value="">Auto</option></select></div>
<div><label for="sens">Drop detection</label><select id="sens"><option value="balanced">Balanced · recommended</option><option value="conservative">Conservative · strongest only</option><option value="aggressive">Aggressive · more drops</option></select></div></div>
<div class="btns"><button id="multicam">Create Multicam Edit</button><button class="sec" id="reveal" hidden>Show in Finder</button><button class="sec" id="stop">Stop</button></div>
<small id="resultInfo"></small></div>

<div class="card"><b id="state">Ready</b><div class="bar"><i id="bar"></i></div><div id="log" aria-live="polite"></div></div>
<small>R Project Engine runs on this Mac only; media never leaves it. Keep the Terminal window open while you work. ${VERSION}</small>
</main><script>
const T=${JSON.stringify(token)};const $=(id)=>document.getElementById(id);let last=0,camKey='';
const esc=(s)=>String(s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function addLog(l){last=Math.max(last,l.n);const d=$('log');d.textContent+=(d.textContent?'\\n':'')+l.t+'  '+l.text;d.scrollTop=d.scrollHeight;}
function pageLog(t){addLog({n:last,t:new Date().toTimeString().slice(0,8),text:'[page] '+t});}
async function api(p,b){const r=await fetch(p+'?t='+T,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{cache:'no-store'});let body={};try{body=await r.json();}catch(e){}return {status:r.status,body};}
async function act(label,p,b){try{const r=await api(p,b);if(!r.body.ok)pageLog(label+': '+(r.body.error||('HTTP '+r.status)));else if(r.body.message)pageLog(label+': '+r.body.message);tick();return r;}catch(e){pageLog(label+': '+e.message);}}
let es=null;function connect(){if(es)es.close();es=new EventSource('/api/events?t='+T+'&since='+last);es.onmessage=(e)=>addLog(JSON.parse(e.data));es.onerror=()=>{es.close();setTimeout(connect,2000);};}
function roles(){return Array.from(document.querySelectorAll('.cam input')).map((i)=>i.value);}
function renderCams(cams){const key=JSON.stringify(cams.map(c=>[c.name,c.files]));if(key===camKey)return;camKey=key;
 $('cams').innerHTML=cams.length?cams.map((c,i)=>'<div class="cam"><div class="n"><b>'+(i+1)+'. '+esc(c.name)+'</b><small>'+c.files+' clip'+(c.files===1?'':'s')+(c.first?' · '+esc(c.first)+(c.files>1?' …':''):'')+'</small></div><input aria-label="Role of camera '+(i+1)+'" value="'+esc(c.role)+'" placeholder="Role, e.g. Master Wide"><button class="sec" data-rm="'+i+'">Remove</button></div>').join(''):'<p class="path">No cameras yet.</p>';
 document.querySelectorAll('[data-rm]').forEach((b)=>b.onclick=()=>act('Remove camera','/api/camera/remove',{index:Number(b.dataset.rm)}));
 document.querySelectorAll('.cam input').forEach((i)=>i.onchange=()=>api('/api/camera/roles',{roles:roles()}));
 const sel=$('dropCam'),v=sel.value;sel.innerHTML='<option value="">Auto</option>'+cams.map((c,i)=>'<option value="'+i+'">'+(i+1)+'. '+esc(c.name)+'</option>').join('');if(Number(v)<cams.length)sel.value=v;}
async function tick(){try{const s=(await api('/api/status')).body;if(!s.ok)return;
 const ac=s.account||{};$('adot').className='dot'+(ac.canUse?' ok':'');$('alabel').textContent=ac.signedIn?ac.email+' · '+ac.label:'Not signed in';$('adetail').textContent=ac.detail||ac.message||'';
 $('signedOut').hidden=!!ac.signedIn;$('signedIn').hidden=!ac.signedIn;$('buy').hidden=ac.licenseStatus==='lifetime';$('gcancel').hidden=!ac.googlePending;
 const st=s.studio||{};$('music').textContent=st.music||'No music chosen yet.';renderCams(st.cameras||[]);
 const a=st.analysis;$('bpm').textContent=a&&a.bpm||'—';$('drops').textContent=a&&a.drops!=null?a.drops:'—';$('energy').textContent=a&&a.energy||'—';
 const busy=!!s.busy;['pickMusic','analyze','addFolder','addFiles','multicam'].forEach((id)=>$(id).disabled=busy);$('stop').disabled=!busy;
 const p=s.progress;$('state').textContent=busy?(p&&p.text||s.busy)+(p?' · '+Math.round(p.p*100)+'%':''):(s.lastResult?(s.lastResult.action+': '+(s.lastResult.ok===false?s.lastResult.error:'done')):'Ready');$('bar').style.width=busy&&p?Math.round(p.p*100)+'%':'0';
 const r=st.result;$('reveal').hidden=!r;$('resultInfo').textContent=r?('Last edit: '+r.cuts+' cuts, '+r.placed+' clips synced'+(r.excluded?', '+r.excluded+' left out':'')+' · '+r.fcpxml):'';
 if(!s.ffmpeg)$('state').textContent='FFmpeg not found: run Install-FinalCut.command again.';
}catch(e){$('state').textContent='Engine not answering. Start R Project Engine again.';}}
$('signin').onclick=async()=>{await act('Sign in','/api/account/signin',{email:$('email').value,password:$('password').value});$('password').value='';};
$('google').onclick=async()=>{const w=window.open('about:blank','_blank');const r=await act('Google sign-in','/api/account/google',{});const link=r&&r.body&&r.body.link;if(link){if(w)w.location=link;$('glinkA').href=link;$('glink').hidden=false;}else if(w)w.close();};
$('gcancel').onclick=()=>act('Cancel Google sign-in','/api/account/google/cancel',{});
$('forgot').onclick=()=>act('Forgot password','/api/account/forgot',{email:$('email').value});$('signout').onclick=()=>act('Sign out','/api/account/signout',{});$('check').onclick=()=>act('License check','/api/account/check',{});
$('pickMusic').onclick=()=>act('Choose music','/api/music',{});$('analyze').onclick=()=>act('Analyze Music','/api/analyze',{});
$('addFolder').onclick=()=>act('Add camera','/api/camera/add',{mode:'folder'});$('addFiles').onclick=()=>act('Add camera','/api/camera/add',{mode:'files'});
$('multicam').onclick=()=>act('Create Multicam Edit','/api/multicam',{roles:roles(),cadences:[2,4,6,8].filter(n=>$('c'+n).checked),dropCamera:$('dropCam').value,sensitivity:$('sens').value});
$('stop').onclick=()=>act('Stop','/api/stop',{});$('reveal').onclick=()=>act('Show in Finder','/api/reveal',{});
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
