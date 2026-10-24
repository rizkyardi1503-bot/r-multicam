#!/usr/bin/env node
// R Project Engine for DaVinci Resolve (Free and Studio) - v1.0.0.
// Serves the control page on http://127.0.0.1:<port>/?t=<token> (localhost only) and drives DaVinci through the
// Lua bridge "R Project Multicam AI" (Workspace > Scripts). No npm dependencies.
//   node rp-davinci-engine.js [--no-browser] [--port N]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), cp = require('child_process');
const { Bridge } = require('./lib/bridge');
const { Session } = require('./lib/workflow');
const { Account } = require('./lib/account');

const VERSION = 'DaVinci v1.0.0 (engine 2.3.11.8)';
const HEARTBEAT_MS = 5 * 60000;

function appDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return process.env.RP_DAVINCI_DIR || path.join(base, 'RProjectMulticam', 'davinci');
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') cp.spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref();
    else cp.spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
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

/** One engine at a time (two would race for the same bridge commands). The lock is created atomically ('wx'); an
 *  existing lock only counts when that engine answers its status API, otherwise it is stale and replaced. */
async function acquireLock(lockFile) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return { fd: fs.openSync(lockFile, 'wx') }; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    let lock = null;
    try { lock = JSON.parse(fs.readFileSync(lockFile, 'utf8')); } catch (e) { /* empty or being written */ }
    if (lock && lock.url && await engineAnswers(lock.url)) return { running: lock.url };
    if (!lock && attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }   // another start is writing it
    fs.rmSync(lockFile, { force: true });
  }
  throw new Error('Could not create ' + lockFile);
}

/** Bridge that only reports why the real one could not start (the engine keeps running and shows the reason). */
function failedBridge(message) {
  return { start() { return this; }, stop() {}, sendStopSync() { return false; },
    status() { return { connected: false, busy: false, helloId: null, info: {}, state: 'error', error: message, lastBeatAgoMs: null }; },
    async call() { throw new Error(message); } };
}

/** Start the engine. Returns { url, port, token, bridge, session, close() }. */
async function start(opts = {}) {
  const lines = [], clients = new Set();
  let seq = 0, progress = null, lastResult = null, cameras = [];
  function log(text) {
    const line = { n: ++seq, t: new Date().toTimeString().slice(0, 8), text: String(text) };
    lines.push(line); if (lines.length > 3000) lines.shift();
    if (!opts.quiet) console.log('[' + line.t + '] ' + line.text);
    for (const res of clients) res.write('data: ' + JSON.stringify(line) + '\n\n');
  }
  let bridge;
  try { bridge = new Bridge({ prefsPath: opts.prefsPath, profileDir: opts.profileDir, programData: opts.programData, pollMs: opts.pollMs, staleMs: opts.staleMs, timeouts: opts.timeouts, isResolveRunning: opts.isResolveRunning, deadAfterMs: opts.deadAfterMs, log }).start(); }
  catch (e) { bridge = failedBridge('The DaVinci command folder cannot be used: ' + (e && e.message || e)); log('ERROR: ' + bridge.status().error); }
  const session = new Session({ bridge, log, progress: (p) => { progress = p; }, pollMs: opts.renderPollMs, sleep: opts.sleep });
  const token = opts.token || crypto.randomBytes(16).toString('hex');
  // License gate: same R Project account as the Premiere plugin. Checked here, in the API handlers, before every action.
  const account = opts.account || new Account({ log });
  const restored = Promise.resolve(account.restore()).then((st) => { if (st && st.signedIn) log('Account: ' + st.email + ' · ' + st.label); }).catch((e) => log('Account check failed: ' + e.message));
  const beat = setInterval(() => { if (account.session) Promise.resolve(account.heartbeat()).catch((e) => log('Account: ' + e.message)); }, HEARTBEAT_MS);
  if (beat.unref) beat.unref();

  async function action(name, fn, licensed = true) {
    if (session.busy) return { status: 409, body: { ok: false, error: 'Busy: ' + session.busy + ' is still running.' } };
    if (licensed) {
      await restored;
      try { await account.ensureAllowed(); }
      catch (e) { log(name + ': ' + e.message); lastResult = { action: name, at: Date.now(), ok: false, error: e.message, license: true }; return { status: 403, body: { ok: false, error: e.message, code: e.code || 'NOT_ALLOWED' } }; }
    }
    log('--- ' + name + ' ---');
    const done = session.run(name, fn).then((r) => { lastResult = Object.assign({ action: name, at: Date.now() }, r); if (r.ok) log(name + ': done.'); return r; });
    if (opts.awaitActions) await done;
    return { status: 202, body: { ok: true, started: name } };
  }
  async function accountCall(name, fn) {
    try { const r = await fn(); const st = account.status(); log(name + ': ' + (r && r.message ? r.message : st.signedIn ? st.email + ' · ' + st.label : st.label)); return { body: Object.assign({ ok: true }, r && r.message ? { message: r.message } : {}, r && r.link ? { link: r.link } : {}, { account: st }) }; }
    catch (e) { log(name + ': ' + e.message); return { status: 400, body: { ok: false, error: e.message, code: e.code || '', account: account.status() } }; }
  }
  async function refreshCameras() {
    const { snapshot } = await session.snapshot();
    cameras = snapshot.tracks.map((t) => ({ index: t.index, name: t.name }));
    log('Timeline "' + snapshot.timelineName + '": ' + snapshot.duration.toFixed(1) + ' s at ' + snapshot.fps.toFixed(3) + ' fps, ' + cameras.length + ' camera track(s)' + (snapshot.skipped.length ? ' (skipped ' + snapshot.skipped.join(', ') + ')' : '') + '.');
    return cameras;
  }

  const routes = {
    'GET /api/status': async () => ({ body: { ok: true, version: VERSION, bridge: bridge.status(), account: account.status(), busy: session.busy, progress, lastResult, cameras,
      analysis: session.analysis ? session.analysis.summary : null } }),
    'POST /api/refresh': (b) => action('Read timeline', () => refreshCameras(), false),
    'POST /api/analyze': (b) => action('Analyze Music', async () => { session.analysis = null; return session.analyze(); }),
    'POST /api/multicam': (b) => action('Create Multicam Edit', async () => {
      const r = await session.multicam({ roles: b.roles, cadences: b.cadences, dropCamera: b.dropCamera === '' || b.dropCamera == null ? null : Number(b.dropCamera), vision: !!b.vision, budget: Number(b.budget) || 60 });
      return { name: r.name, placed: r.placed, failed: r.failed, mismatches: r.mismatches, gaps: r.gaps.length };
    }),
    'POST /api/drops': (b) => action('Render Best Drops', async () => {
      const r = await session.bestDrops(b.count, b.folder);
      return { complete: r.complete, jobs: r.jobs.length, folder: r.folder };
    }),
    'POST /api/account/signin': async (b) => accountCall('Sign in', () => account.signIn(b.email, b.password)),
    'POST /api/account/google': async () => accountCall('Google sign-in', () => account.startGoogle()),
    'POST /api/account/google/cancel': async () => accountCall('Google sign-in', () => account.cancelGoogle()),
    'POST /api/account/forgot': async (b) => accountCall('Forgot password', () => account.forgotPassword(b.email)),
    'POST /api/account/signout': async () => accountCall('Sign out', () => account.signOut()),
    'POST /api/account/check': async () => accountCall('License check', () => account.heartbeat().then(() => account.status())),
    'POST /api/disconnect': async () => { const sent = bridge.sendStopSync(); log(sent ? 'Asked the DaVinci bridge to stop.' : 'DaVinci bridge is not running.'); return { body: { ok: true, sent } }; },
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
    // Localhost only + token on every request (no DNS rebinding, no other local page can drive DaVinci).
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(403, { ok: false, error: 'Forbidden host.' });
    if (!tokenOk(url.searchParams.get('t')) && !tokenOk(req.headers['x-rp-token'])) return send(403, { ok: false, error: 'Missing or wrong token. Open the address printed by R Project Engine.' });
    // POST from a browser must come from this page (a foreign page would send its own Origin).
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
  log('Waiting for DaVinci: open DaVinci Resolve and choose Workspace > Scripts > R Project Multicam AI.');
  return {
    url, port, token, bridge, session, account, log, lines,
    close: () => new Promise((resolve) => { clearInterval(beat); bridge.stop(); for (const c of clients) c.end(); server.close(() => resolve()); }),
  };
}

function page(token) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>R Project Engine</title><style>
:root{--bg:#111418;--panel:#1b2027;--line:#2c333d;--text:#e8ecf1;--muted:#9aa5b1;--acc:#e0533d;--ok:#3fb27f;--warn:#e0a23d}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 system-ui,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:20px 16px}h1{font-size:20px;margin:0 0 4px}small{color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px;margin:12px 0}
.status{display:flex;gap:10px;align-items:center}.dot{width:10px;height:10px;border-radius:50%;background:var(--warn)}.dot.ok{background:var(--ok)}
label{display:block;margin:8px 0 4px;color:var(--muted)}textarea,input,select{width:100%;background:#0d1014;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}
.row{display:flex;gap:12px;flex-wrap:wrap}.row>*{flex:1;min-width:180px}.chk{display:inline-flex;gap:6px;align-items:center;margin-right:14px;color:var(--text)}
.chk input{width:auto}button{background:var(--acc);color:#fff;border:0;border-radius:6px;padding:10px 14px;font-weight:600;cursor:pointer}
button.sec{background:#38404b}button:disabled{opacity:.5;cursor:default}.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
#log{height:300px;overflow:auto;background:#0d1014;border:1px solid var(--line);border-radius:6px;padding:8px;font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap}
.bar{height:6px;background:#0d1014;border-radius:3px;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;width:0;background:var(--acc)}
.stats{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px}.stats b{display:block;font-size:18px}
a{color:#8ab4ff}.buy{display:inline-block;background:#2f9e6b;color:#fff;padding:10px 14px;border-radius:6px;text-decoration:none;font-weight:600}[hidden]{display:none!important}#acct small{display:block;margin-top:8px}
button.google{background:#fff;color:#1f1f1f;display:inline-flex;align-items:center;gap:10px;border:1px solid #dadce0}.or{margin-top:10px;color:#8b95a3;font-size:12px}
</style></head><body><main>
<h1>R Project Multicam AI <small>for DaVinci Resolve · v1.0.0</small></h1>
<div class="card" id="acct"><div class="status"><span class="dot" id="adot"></span><div><b id="alabel">Account</b><br><small id="adetail">Checking your account…</small></div></div>
<div id="signedOut"><div class="row"><div><label for="email">Email</label><input id="email" type="email" autocomplete="username"></div>
<div><label for="password">Password</label><input id="password" type="password" autocomplete="current-password"></div></div>
<div class="btns"><button id="signin">Sign in</button><button class="sec" id="forgot">Forgot password</button></div>
<div class="or">or</div><div class="btns"><button class="google" id="google"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.2l7.8 6.1C12.3 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.7-4-13.6-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</button><button class="sec" id="gcancel" hidden>Cancel Google sign-in</button></div>
<small id="glink" hidden>Browser tab did not open? <a id="glinkA" href="#" target="_blank" rel="noopener">Open the Google sign-in page</a></small>
<small>Use the same R Project account as the Premiere plugin (email or Google). No account yet? <a id="signupLink" href="https://r-multicam.pages.dev/?signup" target="_blank" rel="noopener noreferrer">Create one on the website</a>.</small></div>
<div id="signedIn" hidden><div class="btns"><button class="sec" id="signout">Sign out</button><button class="sec" id="check">Check license</button><a class="buy" id="buy" href="https://r-multicam.pages.dev/#pricing" target="_blank" rel="noopener noreferrer">Buy lifetime</a></div></div></div>
<div class="card status"><span class="dot" id="dot"></span><div><b id="conn">Waiting for DaVinci…</b><br><small id="connInfo">In DaVinci Resolve choose Workspace &gt; Scripts &gt; R Project Multicam AI. Keep this engine open.</small></div></div>
<div class="card"><div class="stats"><div><small>BPM</small><b id="bpm">—</b></div><div><small>DROPS</small><b id="drops">—</b></div><div><small>ENERGY</small><b id="energy">—</b></div><div><small>DROP SCORE</small><b id="score">—</b></div></div>
<div class="btns"><button id="analyze">Analyze Music</button><button class="sec" id="refresh">Read timeline</button></div></div>
<div class="card"><b>Auto Cut Multicam</b> <small>· builds a NEW timeline "&lt;name&gt; - Multicam AI"; the original is not changed</small>
<label for="roles">Camera Roles (one per line, line 1 = V1; blank = every video track)</label><textarea id="roles" rows="4" placeholder="Master Wide&#10;DJ Close-Up&#10;Crowd&#10;Drone"></textarea>
<label>Cut every</label><span class="chk"><input type="checkbox" id="c2">2</span><span class="chk"><input type="checkbox" id="c4" checked>4</span><span class="chk"><input type="checkbox" id="c6" checked>6</span><span class="chk"><input type="checkbox" id="c8" checked>8</span> beats
<div class="row"><div><label for="dropCam">Main Drop Camera</label><select id="dropCam"><option value="">Auto</option></select></div>
<div><label>&nbsp;</label><span class="chk"><input type="checkbox" id="vision">AI Vision (blur / shake / exposure, slower)</span></div></div>
<div class="btns"><button id="multicam">Create Multicam Edit</button></div></div>
<div class="card"><b>Best Drops</b> <small>· renders MP4 H.264 clips of the open timeline through the Deliver queue</small>
<div class="row"><div><label for="count">How many</label><input id="count" type="number" min="1" max="100" value="5"></div>
<div><label for="folder">Output folder (blank = Videos\\R Project Best Drops)</label><input id="folder"></div></div>
<div class="btns"><button id="render">Render Best Drops</button><button class="sec" id="disconnect">Stop DaVinci bridge</button></div></div>
<div class="card"><b id="state">Ready</b><div class="bar"><i id="bar"></i></div><div id="log" aria-live="polite"></div></div>
</main><script>
const T=${JSON.stringify(token)};const $=(id)=>document.getElementById(id);let last=0;
// Every click is logged with its HTTP result; buttons are never disabled from a (possibly stale) status:
// the server decides and answers 409/503 with a reason.
function pageLog(text){const d=$('log');const t=new Date().toTimeString().slice(0,8);d.textContent+=(d.textContent?'\\n':'')+t+'  [page] '+text;d.scrollTop=d.scrollHeight;}
async function api(p,b){const r=await fetch(p+'?t='+T,b?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}:{cache:'no-store'});let j={};try{j=await r.json();}catch(e){}return {status:r.status,body:j};}
async function act(label,p,b){pageLog(label+': sending…');try{const r=await api(p,b);pageLog(label+': HTTP '+r.status+(r.body.error?' — '+r.body.error:r.body.started?' — started':' — ok'));}catch(e){pageLog(label+': engine not reachable ('+e.message+')');}tick();}
function addLog(l){last=Math.max(last,l.n);const d=$('log');d.textContent+=(d.textContent?'\\n':'')+l.t+'  '+l.text;d.scrollTop=d.scrollHeight;}
let es=null;function connect(){if(es)es.close();es=new EventSource('/api/events?t='+T+'&since='+last);es.onmessage=(e)=>addLog(JSON.parse(e.data));es.onerror=()=>{es.close();es=null;setTimeout(connect,2000);};}
function setCams(cams){const sel=$('dropCam'),want=cams.map(c=>c.index).join(',');if(sel.dataset.k===want)return;const v=sel.value;while(sel.options.length)sel.remove(0);sel.add(new Option('Auto',''));for(const c of cams)sel.add(new Option('Camera '+(c.index+1)+' ('+c.name+')',String(c.index)));sel.value=v;sel.dataset.k=want;}
async function tick(){try{const s=(await api('/api/status')).body;const b=s.bridge;$('dot').className='dot'+(b.connected?' ok':'');
$('conn').textContent=b.connected?(b.busy?'DaVinci connected · working':'DaVinci connected'):(b.helloId?'DaVinci bridge not running':'Waiting for DaVinci…');
const i=b.info||{};$('connInfo').textContent=b.helloId?[i.product,i.resolve,i.project&&('project "'+i.project+'"'),i.timeline&&('timeline "'+i.timeline+'"')].filter(Boolean).join(' · ')+(b.connected?'':' — run Workspace > Scripts > R Project Multicam AI again'):'In DaVinci Resolve choose Workspace > Scripts > R Project Multicam AI. Keep this engine open.';
$('state').textContent=s.busy?s.busy+'…':(s.lastResult?(s.lastResult.action+': '+(s.lastResult.ok?'done':'failed — '+(s.lastResult.error||''))):'Ready');
$('bar').style.width=(s.progress&&s.busy?Math.round(100*Math.min(1,s.progress.p||0)):0)+'%';
const a=s.analysis;if(a){$('bpm').textContent=a.bpm||'—';$('drops').textContent=a.drops==null?'—':a.drops;$('energy').textContent=a.energy||'—';$('score').textContent=a.dropScore==null?'—':a.dropScore+'/100';}
setCams(s.cameras||[]);
if(b.error){$('conn').textContent='DaVinci connection problem';$('connInfo').textContent=b.error;}
const ac=s.account||{};$('adot').className='dot'+(ac.canUse?' ok':'');$('alabel').textContent=ac.signedIn?ac.email+' · '+ac.label:'Not signed in';$('adetail').textContent=ac.detail||'';$('signedOut').hidden=!!ac.signedIn;$('signedIn').hidden=!ac.signedIn;$('buy').hidden=ac.code==='LIFETIME';$('google').disabled=!!ac.googlePending;$('gcancel').hidden=!ac.googlePending;if(!ac.googlePending&&ac.signedIn)$('glink').hidden=true;
}catch(e){$('conn').textContent='Engine not reachable (closed?)';$('dot').className='dot';}}
$('signin').onclick=async()=>{await act('Sign in','/api/account/signin',{email:$('email').value,password:$('password').value});$('password').value='';};
// The tab is opened inside the click (no popup block), then pointed at the sign-in link from the engine.
$('google').onclick=async()=>{const w=window.open('about:blank','_blank');pageLog('Google sign-in: starting…');let r;try{r=await api('/api/account/google',{});}catch(e){if(w)w.close();pageLog('Google sign-in: engine not reachable ('+e.message+')');return;}
if(!r.body.link){if(w)w.close();pageLog('Google sign-in: HTTP '+r.status+' — '+(r.body.error||'failed'));tick();return;}
$('glinkA').href=r.body.link;$('glink').hidden=false;if(w){try{w.opener=null;w.location.href=r.body.link;}catch(e){}}pageLog('Google sign-in: continue in the browser tab that opened. This page updates automatically.');tick();};
$('gcancel').onclick=()=>act('Cancel Google sign-in','/api/account/google/cancel',{});
$('forgot').onclick=()=>act('Forgot password','/api/account/forgot',{email:$('email').value});$('signout').onclick=()=>act('Sign out','/api/account/signout',{});$('check').onclick=()=>act('Check license','/api/account/check',{});
$('analyze').onclick=()=>act('Analyze Music','/api/analyze',{});$('refresh').onclick=()=>act('Read timeline','/api/refresh',{});
$('multicam').onclick=()=>act('Create Multicam Edit','/api/multicam',{roles:$('roles').value,cadences:[2,4,6,8].filter(n=>$('c'+n).checked),dropCamera:$('dropCam').value,vision:$('vision').checked});
$('render').onclick=()=>act('Render Best Drops','/api/drops',{count:Number($('count').value)||5,folder:$('folder').value});$('disconnect').onclick=()=>act('Stop DaVinci bridge','/api/disconnect',{});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){tick();if(!es)connect();}});
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
    if (eng.bridge.sendStopSync()) console.log('Asked the DaVinci bridge to stop.');
    try { const l = JSON.parse(fs.readFileSync(lockFile, 'utf8')); if (l.pid === process.pid) fs.rmSync(lockFile, { force: true }); } catch (e) { /* gone */ }
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) { try { process.on(sig, shutdown); } catch (e) { /* not on this OS */ } }
}

if (require.main === module) main().catch((e) => { console.error('R Project Engine failed: ' + (e && e.stack || e)); process.exitCode = 1; });
module.exports = { start, page, VERSION, acquireLock, engineAnswers };
