// Account / license gate tests with a mocked Supabase (no network). Usage: node tests/account-tests.cjs
//  - device id: same algorithm and file as the Premiere plugin's license.js (compared against the real file)
//  - sign-in, trial / lifetime / expired / update required / signed in on another device
//  - refresh-token rotation, rejected refresh -> signed out, 72 h offline grace, restore from session.json, forgot password
//  - engine API: actions blocked server-side (403) until signed in and allowed
//  - Continue with Google: real 127.0.0.1 callback listener + PKCE exchange (same flow as the Premiere plugin)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), http = require('http'), assert = require('assert');
const A = require('../lib/account');
const { start } = require('../rp-davinci-engine.js');
const G = require('../lib/google-auth');
const crypto = require('crypto');

let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };
const rejects = async (p, re, msg) => { checks++; await assert.rejects(p, re, msg); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'rp-acct-' + p + '-'));
const DAY = 86400000;

// ------------------------------------------------------------------ mocked Supabase
function fakeSupabase(clock) {
  const S = { users: { 'me@example.com': { id: 'u1', password: 'right-pass' } }, refresh: new Map(), access: new Map(), calls: [],
    profile: { user_id: 'u1', email: 'me@example.com', device_id: null, license_status: 'trial', trial_started_at: new Date(clock.t).toISOString(), trial_expires_at: new Date(clock.t + 3.5 * DAY).toISOString() },
    latest: '2.3.11.8', minimum: '2.3.11.2', offline: false, n: 0 };
  const issue = (user) => { const a = 'acc-' + (++S.n), r = 'ref-' + S.n; S.access.set(a, { user, exp: clock.t + 3600000 }); S.refresh.set(r, user); return { access_token: a, refresh_token: r, expires_at: Math.floor((clock.t + 3600000) / 1000), user: { id: user.id, email: user.email } }; };
  const ver = (v) => String(v).split(/[.-]/).slice(0, 4).map(Number);
  const ge = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 4; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return true; };
  async function fetch(url, opt) {
    const u = new URL(url), body = opt.body ? JSON.parse(opt.body) : {}, h = opt.headers || {};
    S.calls.push({ path: u.pathname + u.search, method: opt.method, body, headers: h });
    if (S.offline) throw new TypeError('fetch failed');
    const reply = (status, obj) => ({ ok: status < 300, status, text: async () => JSON.stringify(obj) });
    if (h.apikey !== A.SUPABASE_KEY) return reply(401, { message: 'No API key' });
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
      const usr = S.users[body.email];
      if (!usr || usr.password !== body.password) return reply(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
      return reply(200, issue({ id: usr.id, email: body.email }));
    }
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') {
      S.refreshCalls = (S.refreshCalls || 0) + 1;
      if (S.refreshDelay) await new Promise((r) => setTimeout(r, S.refreshDelay));
      const usr = S.refresh.get(body.refresh_token);
      if (!usr) return reply(400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' });
      S.refresh.delete(body.refresh_token);                     // single use (rotation)
      return reply(200, issue(usr));
    }
    if (u.pathname === '/auth/v1/recover') return reply(200, {});
    if (u.pathname === '/auth/v1/settings') return reply(200, { external: { email: true, google: S.googleEnabled !== false } });
    if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'pkce') {
      const g = S.google && S.google[body.auth_code];
      const b64 = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      if (!g || g.used || b64(crypto.createHash('sha256').update(String(body.code_verifier || '')).digest()) !== g.challenge) return reply(400, { error: 'invalid_grant', error_description: 'invalid flow state, no valid flow state found' });
      g.used = true;
      return reply(200, Object.assign(issue({ id: 'u1', email: 'me@example.com' }), { provider_token: 'google-secret', provider_refresh_token: 'google-refresh' }));
    }
    if (u.pathname === '/auth/v1/user') {
      const a = S.access.get(String(h.Authorization || '').replace(/^Bearer /, ''));
      if (!a) return reply(401, { message: 'invalid JWT' });
      return reply(200, { id: a.user.id, email: a.user.email, email_confirmed_at: '2026-10-01T00:00:00Z', identities: [{ provider: S.identity || 'google' }] });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const tok = String(h.Authorization || '').replace(/^Bearer /, ''), a = S.access.get(tok);
      if (!a || a.exp <= clock.t) return reply(401, { code: 'PGRST301', message: 'JWT expired' });
      if (h.Accept !== 'application/vnd.pgrst.object+json') return reply(406, { message: 'object header missing' });
      const name = u.pathname.split('/').pop(), P = S.profile;
      if (name === 'register_plugin_device') { P.device_id = body.p_device_id; return reply(200, Object.assign({}, P)); }
      if (name === 'plugin_heartbeat') { if (P.device_id !== body.p_device_id) return reply(400, { message: 'SIGNED_IN_ON_ANOTHER_DEVICE' }); return reply(200, Object.assign({}, P)); }
      if (name === 'plugin_entitlement') {
        if (P.device_id && P.device_id !== body.p_device_id) return reply(200, { allowed: false, license_status: P.license_status, session_replaced: true, reason: 'SIGNED_IN_ON_ANOTHER_DEVICE', server_time: new Date(clock.t).toISOString() });
        if (P.license_status === 'trial' && Date.parse(P.trial_expires_at) <= clock.t) P.license_status = 'expired';
        const isLatest = ge(body.p_plugin_version, S.latest), supported = isLatest || ge(body.p_plugin_version, S.minimum);
        const allowed = supported && (P.license_status === 'lifetime' || (P.license_status === 'trial' && Date.parse(P.trial_expires_at) > clock.t));
        return reply(200, { allowed, license_status: P.license_status, email: P.email, device_id: P.device_id, trial_started_at: P.trial_started_at, trial_expires_at: P.trial_expires_at,
          remaining_seconds: P.license_status === 'lifetime' ? null : Math.max(0, Math.floor((Date.parse(P.trial_expires_at) - clock.t) / 1000)), update_required: !isLatest,
          minimum_version: S.minimum, latest_version: S.latest, update_url: 'https://r-multicam.pages.dev/', reason: !supported ? 'UPDATE_REQUIRED' : !isLatest ? 'UPDATE_AVAILABLE' : null, server_time: new Date(clock.t).toISOString() });
      }
    }
    return reply(404, { message: 'not mocked: ' + u.pathname });
  }
  return { S, fetch };
}
function newAccount(dir, clock, sb, device = 'RP-AAAA-BBBB-CCCC-DDDD') {
  return new A.Account({ fetch: sb.fetch, now: () => clock.t, dataDir: dir, sessionFile: path.join(dir, 'davinci', 'session.json'), deviceId: () => device });
}

(async () => {
  // ---------------------------------------------------------------- device id = Premiere's license.js
  {
    const seed = 'win32|x64|MG:1234-5678';
    ok(A.legacyDeviceId(seed) === A.legacyDeviceId(seed) && A.validId(A.legacyDeviceId(seed)), 'legacy id format RP-XXXX-XXXX-XXXX-XXXX');
    const premiereDir = tmp('prem'), oursDir = tmp('ours');
    const oldLocal = process.env.LOCALAPPDATA;
    process.env.LOCALAPPDATA = premiereDir;                     // license.js derives its folder from LOCALAPPDATA
    try {
      const ctx = { require, process, Buffer, console }; ctx.window = ctx;
      vm.createContext(ctx);
      vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures', 'license-premiere.js'), 'utf8').replace(/\}\(window\)\);\s*$/, '}(window));'), ctx);
      const premiereId = ctx.RPLicense.deviceId();
      const ours = A.getDeviceId(path.join(oursDir, 'RProjectMulticam'));
      ok(premiereId === ours && A.validId(ours), 'same machine -> same device id as the Premiere plugin: ' + ours + ' / ' + premiereId);
      ok(fs.readFileSync(path.join(premiereDir, 'RProjectMulticam', 'device-id.txt'), 'utf8').trim() === ours, 'Premiere wrote the same id');
    } finally { process.env.LOCALAPPDATA = oldLocal; }
    const d = tmp('dev');
    fs.writeFileSync(path.join(d, 'device-id.txt'), 'RP-1111-2222-3333-4444\n');
    ok(A.getDeviceId(d, () => 'x') === 'RP-1111-2222-3333-4444', 'existing device-id.txt reused (Premiere already set it)');
    fs.writeFileSync(path.join(d, 'device-id.txt'), 'garbage');
    ok(A.getDeviceId(d, () => seed) === A.legacyDeviceId(seed) && fs.readFileSync(path.join(d, 'device-id.txt'), 'utf8').trim() === A.legacyDeviceId(seed), 'invalid file replaced by the legacy id, written atomically');
    console.log('PASS device id: same algorithm and file as Premiere license.js; existing id reused; invalid replaced');
  }

  // ---------------------------------------------------------------- sign in: trial, rpc bodies, session file
  const clock = { t: Date.parse('2026-10-24T10:00:00Z') };
  let sb = fakeSupabase(clock), dir = tmp('a'), acc = newAccount(dir, clock, sb);
  await rejects(acc.ensureAllowed(), /Sign in/, 'signed out -> refused');
  await rejects(acc.signIn('me@example.com', 'wrong'), /Email or password is incorrect/, 'wrong password -> friendly message');
  ok(!acc.session && !fs.existsSync(acc.sessionFile), 'nothing saved after a failed sign-in');
  let st = await acc.signIn('me@example.com', 'right-pass');
  ok(st.canUse && st.label === 'Trial: 4 days left' && st.code === 'TRIAL', 'trial: ' + st.label);
  const rpcs = sb.S.calls.filter((c) => c.path.startsWith('/rest/v1/rpc/'));
  ok(rpcs.map((c) => c.path.split('/').pop()).join() === 'register_plugin_device,plugin_entitlement', 'register_plugin_device then plugin_entitlement');
  ok(rpcs.every((c) => c.body.p_device_id === 'RP-AAAA-BBBB-CCCC-DDDD' && c.body.p_platform === 'Windows' && c.body.p_plugin_version === '2.3.11.8-public-v18'), 'rpc body: device, Windows, 2.3.11.8-public-v18');
  const saved = JSON.parse(fs.readFileSync(acc.sessionFile, 'utf8'));
  ok(saved.schema === 1 && saved.session.refresh_token && saved.entitlement.allowed === true && !JSON.stringify(saved).includes('right-pass'), 'session.json saved (tokens + entitlement, never the password)');
  await acc.ensureAllowed();
  ok(true, 'trial allows actions');
  console.log('PASS sign-in: trial "' + st.label + '", device registered, entitlement checked, session saved without the password');

  // ---------------------------------------------------------------- restore in a new engine run; access token expiry -> refresh rotation
  clock.t += 2 * 3600000;                                       // access token expired
  let acc2 = newAccount(dir, clock, sb);
  st = await acc2.restore();
  ok(st.canUse && acc2.session.refresh_token !== saved.session.refresh_token, 'restore: expired access token refreshed (rotated) and license re-checked');
  ok(JSON.parse(fs.readFileSync(acc2.sessionFile, 'utf8')).session.refresh_token === acc2.session.refresh_token, 'rotated refresh token saved');
  ok(!sb.S.refresh.has(saved.session.refresh_token), 'old refresh token is single-use');
  // rpc 401 mid-session -> refresh + retry
  clock.t += 2 * 3600000;
  const before = acc2.session.refresh_token;
  await acc2.syncEntitlement();
  ok(acc2.session.refresh_token !== before && acc2.canUse(), 'JWT expired on rpc -> refresh and retry');
  // refresh rejected (token used elsewhere) -> signed out
  clock.t += 2 * 3600000;
  sb.S.refresh.clear();
  await rejects(acc2.syncEntitlement(), /JWT expired/, 'rejected refresh surfaces the error');
  ok(!acc2.session && !fs.existsSync(acc2.sessionFile), 'rejected refresh -> signed out, session file removed');
  console.log('PASS tokens: restore, refresh rotation, retry after JWT expiry, rejected refresh signs out');

  // ---------------------------------------------------------------- lifetime, expired, update required, another device
  sb = fakeSupabase(clock); dir = tmp('b'); acc = newAccount(dir, clock, sb);
  sb.S.profile.license_status = 'lifetime';
  st = await acc.signIn('me@example.com', 'right-pass');
  ok(st.canUse && st.label === 'Lifetime' && st.remainingMs === null, 'lifetime');
  sb.S.profile.license_status = 'trial'; sb.S.profile.trial_expires_at = new Date(clock.t - 1000).toISOString();
  clock.t += A.VERIFY_EVERY_MS + 1000;
  await rejects(acc.ensureAllowed(), /trial has ended/, 'expired trial refused');
  ok(acc.status().code === 'EXPIRED' && acc.status().label === 'Trial expired', 'status: Trial expired');
  sb.S.profile.license_status = 'lifetime'; sb.S.latest = '2.4.0'; sb.S.minimum = '2.4.0';
  await rejects(acc.syncEntitlement().then(() => acc.ensureAllowed()), /no longer supported/, 'update required refused');
  ok(acc.status().code === 'UPDATE_REQUIRED', 'status: Update required');
  sb.S.latest = '2.3.12.0'; sb.S.minimum = '2.3.11.2';
  await acc.syncEntitlement();
  ok(acc.canUse() && /update is available/.test(acc.status().detail), 'older-but-supported version allowed with "update available"');
  sb.S.profile.device_id = 'RP-9999-9999-9999-9999';             // signed in on another device
  await rejects(acc.syncEntitlement(), /signed in on another device/, 'session replaced');
  ok(!acc.session && !fs.existsSync(acc.sessionFile) && /another device/.test(acc.status().detail), 'replaced -> signed out with a clear message');
  console.log('PASS license states: lifetime, trial expired, update required, update available, signed in on another device');

  // ---------------------------------------------------------------- offline grace (72 h after the last verification)
  sb = fakeSupabase(clock); dir = tmp('c'); acc = newAccount(dir, clock, sb);
  await acc.signIn('me@example.com', 'right-pass');
  sb.S.offline = true;
  clock.t += 3600000;
  await acc.ensureAllowed();
  ok(acc.status().offline && /Offline/.test(acc.status().detail), 'offline 1 h after the check: allowed (grace)');
  acc2 = newAccount(dir, clock, sb);
  await acc2.restore();
  await acc2.ensureAllowed();
  ok(true, 'engine restarted offline: saved verification still allows actions within 72 h');
  clock.t += 72 * 3600000;
  await rejects(acc2.ensureAllowed(), /Connect to the internet/, 'offline beyond 72 h refused');
  sb.S.offline = false;
  await acc2.ensureAllowed();
  ok(acc2.canUse(), 'back online: allowed again');
  console.log('PASS offline grace: allowed within 72 h of the last check (also after an engine restart), refused after');

  // ---------------------------------------------------------------- forgot password
  const n0 = sb.S.calls.length;
  const fr = await acc2.forgotPassword('me@example.com');
  const rc = sb.S.calls[n0];
  ok(/reset email/.test(fr.message) && rc.path.startsWith('/auth/v1/recover?redirect_to=') && rc.body.email === 'me@example.com', 'recover request sent');
  await rejects(acc2.forgotPassword('me@example.com'), /Please wait/, 'cooldown');
  await rejects(acc2.forgotPassword(''), /Enter your email/, 'email required');
  console.log('PASS forgot password: /auth/v1/recover with redirect, 65 s cooldown');

  // ---------------------------------------------------------------- engine API gate (server-side)
  sb = fakeSupabase(clock); dir = tmp('d'); acc = newAccount(dir, clock, sb);
  const prefsPath = path.join(tmp('e'), 'Default', 'Fusion.prefs'); fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  const eng = await start({ account: acc, prefsPath, quiet: true });
  const call = (p, body) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const q = http.request({ host: '127.0.0.1', port: eng.port, method: body ? 'POST' : 'GET', path: p + '?t=' + eng.token, headers: Object.assign({ Host: '127.0.0.1:' + eng.port }, data ? { 'Content-Type': 'application/json' } : {}) },
      (res) => { let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(s) })); });
    q.on('error', reject); if (data) q.write(data); q.end();
  });
  try {
    for (const p of ['/api/analyze', '/api/multicam', '/api/drops']) {
      const r = await call(p, {});
      ok(r.status === 403 && r.body.code === 'SIGNED_OUT', p + ' blocked while signed out: ' + JSON.stringify(r.body));
    }
    ok((await call('/api/refresh', {})).status === 202, 'Read timeline is not license-gated');
    let r = await call('/api/account/signin', { email: 'me@example.com', password: 'wrong' });
    ok(r.status === 400 && /incorrect/.test(r.body.error), 'sign-in error returned');
    r = await call('/api/account/signin', { email: 'me@example.com', password: 'right-pass' });
    ok(r.status === 200 && r.body.account.canUse && r.body.account.label === 'Trial: 4 days left', 'sign-in through the engine: ' + JSON.stringify(r.body.account));
    ok(!eng.lines.some((l) => /right-pass|wrong/.test(l.text)), 'passwords never logged');
    const s = (await call('/api/status')).body;
    ok(s.account.signedIn && s.account.email === 'me@example.com' && !JSON.stringify(s).includes('refresh_token'), 'status shows the account, never tokens');
    r = await call('/api/analyze', {});
    ok(r.status === 202, 'allowed account passes the gate (analysis then waits for DaVinci)');
    await new Promise((res) => setTimeout(res, 300));
    sb.S.profile.license_status = 'expired';
    clock.t += A.VERIFY_EVERY_MS + 1000;
    r = await call('/api/drops', { count: 1 });
    ok(r.status === 403 && /trial has ended/.test(r.body.error), 'expired account blocked server-side: ' + r.body.error);
    r = await call('/api/account/signout', {});
    ok(r.status === 200 && !r.body.account.signedIn && !fs.existsSync(acc.sessionFile), 'sign out removes the saved session');
    console.log('PASS engine gate: Analyze / Multicam / Best Drops return 403 until signed in and allowed; sign-in/out via API; no secrets in logs or status');
  } finally { await eng.close(); }

  // ---------------------------------------------------------------- M6: one shared refresh; a newer session wins
  sb = fakeSupabase(clock); dir = tmp('f'); acc = newAccount(dir, clock, sb);
  await acc.signIn('me@example.com', 'right-pass');
  sb.S.refreshDelay = 100; sb.S.refreshCalls = 0;
  const [r1, r2, r3] = await Promise.all([acc.refresh(), acc.refresh(), acc.refresh()]);
  ok(r1 && r2 && r3 && sb.S.refreshCalls === 1, 'three parallel refreshes share one request (single-use refresh tokens): ' + sb.S.refreshCalls);
  const pending = acc.refresh();
  await new Promise((r) => setTimeout(r, 20));
  sb.S.refreshDelay = 0;
  await acc.signIn('me@example.com', 'right-pass');               // a new sign-in while the refresh is in flight
  const newSession = acc.session;
  sb.S.refresh.clear();                                           // ...and the in-flight refresh then fails as rejected
  ok(await pending === true && acc.session === newSession && acc.canUse(), 'refresh that finishes after a new sign-in returns true and does not sign out');
  sb.S.refreshDelay = 50;
  const p2 = acc.refresh();
  await new Promise((r) => setTimeout(r, 10));
  acc.signOut();
  ok(await p2 === false && !acc.session, 'refresh during sign-out returns false and does not resurrect the session');
  console.log('PASS refresh: one shared in-flight refresh; a newer session wins; clear() only for the session being refreshed (M6)');

  // ---------------------------------------------------------------- Continue with Google (PKCE, real local callback)
  {
    const get = (url) => new Promise((resolve, reject) => http.get(url, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); }).on('error', reject));
    const parse = (link) => { ok(link.startsWith('https://r-multicam.pages.dev/#plugin-google='), 'link goes to the website Google page'); return JSON.parse(decodeURIComponent(link.split('#plugin-google=')[1])); };
    const gclock = { t: Date.parse('2026-10-24T10:00:00Z') }, gsb = fakeSupabase(gclock), gdir = tmp('google');
    gsb.S.google = {};
    const gacc = newAccount(gdir, gclock, gsb);
    let r = await gacc.startGoogle(); const gdone = gacc.google.done;
    const f = parse(r.link);
    ok(Number.isInteger(f.port) && f.port >= 1024 && /^[0-9a-f]{64}$/.test(f.state) && /^[A-Za-z0-9_-]{43}$/.test(f.challenge) && f.host === 'davinci', 'link carries port/state/challenge in the format plugin-google.js validates');
    ok(!/verifier/i.test(r.link), 'the PKCE verifier never leaves the engine');
    ok(gacc.status().googlePending && gacc.status().busy, 'status shows Google sign-in pending');
    await rejects(gacc.startGoogle(), /already running/, 'second Google sign-in refused while one runs');
    await rejects(gacc.signIn('me@example.com', 'right-pass'), /already running/, 'email sign-in refused while Google runs');
    const base = 'http://127.0.0.1:' + f.port + '/rproject-auth/';
    ok((await get(base + 'f'.repeat(64) + '?code=x')).status === 404, 'wrong state -> 404');
    ok((await get(base + f.state)).status === 400, 'missing code -> 400, listener stays open');
    gsb.S.google['auth-1'] = { challenge: f.challenge };
    const cb = await get(base + f.state + '?code=auth-1');
    ok(cb.status === 200 && /Return to R Project Engine/.test(cb.text), 'callback answered');
    let st = await gdone;
    ok(st && st.signedIn && st.canUse && st.email === 'me@example.com' && st.code === 'TRIAL', 'Google sign-in -> trial active: ' + (st && st.label));
    ok(!gacc.status().googlePending && !gacc.status().busy, 'pending cleared');
    const saved = JSON.parse(fs.readFileSync(path.join(gdir, 'davinci', 'session.json'), 'utf8'));
    ok(!saved.session.provider_token && !saved.session.provider_refresh_token, 'Google provider tokens are not stored');
    ok(gsb.S.profile.device_id === 'RP-AAAA-BBBB-CCCC-DDDD', 'Google sign-in registers this device (same as email sign-in)');
    const calls = gsb.S.calls.map((c) => c.path.split('?')[0] + (c.path.includes('grant_type=pkce') ? '?pkce' : ''));
    ok(calls.indexOf('/auth/v1/token?pkce') < calls.indexOf('/auth/v1/user') && calls.indexOf('/auth/v1/user') < calls.indexOf('/rest/v1/rpc/register_plugin_device'), 'order: pkce exchange, verify user, register device, entitlement');
    await rejects(get(base + f.state + '?code=again'), /ECONNREFUSED|socket hang up|ECONNRESET/, 'listener closed after one use');
    // restore after restart uses the same session file as email sign-in
    const gacc2 = newAccount(gdir, gclock, gsb);
    ok((await gacc2.restore()).canUse, 'Google login restored after an engine restart');

    // denied in the browser
    const d2 = newAccount(tmp('g2'), gclock, gsb);
    r = await d2.startGoogle(); let f2 = parse(r.link), dd = d2.google.done;
    await get('http://127.0.0.1:' + f2.port + '/rproject-auth/' + f2.state + '?error=cancelled');
    ok(await dd === null && !d2.status().signedIn && /cancelled or access was denied/.test(d2.status().detail), 'browser cancel -> clear message, signed out');
    // cancel from the engine page
    r = await d2.startGoogle(); f2 = parse(r.link); dd = d2.google.done;
    const done = d2.google.done;
    ok(/cancelled/.test(d2.cancelGoogle().message) && await done === null && !d2.status().googlePending, 'Cancel Google sign-in stops the flow');
    await rejects(get('http://127.0.0.1:' + f2.port + '/rproject-auth/' + f2.state + '?code=x'), /ECONNREFUSED|socket hang up|ECONNRESET/, 'cancelled listener closed');
    // wrong verifier (code from another flow) -> expired message
    r = await d2.startGoogle(); f2 = parse(r.link); dd = d2.google.done;
    gsb.S.google['auth-2'] = { challenge: 'A'.repeat(43) };
    await get('http://127.0.0.1:' + f2.port + '/rproject-auth/' + f2.state + '?code=auth-2');
    ok(await dd === null && /expired or was already used/.test(d2.status().detail), 'PKCE mismatch -> clear retry message');
    // account without a Google identity
    r = await d2.startGoogle(); f2 = parse(r.link); dd = d2.google.done;
    gsb.S.google['auth-3'] = { challenge: f2.challenge }; gsb.S.identity = 'email';
    await get('http://127.0.0.1:' + f2.port + '/rproject-auth/' + f2.state + '?code=auth-3');
    ok(await dd === null && /Could not verify the Google account/.test(d2.status().detail) && !d2.session, 'no Google identity -> refused');
    gsb.S.identity = null;
    // timeout
    const tacc = new A.Account({ fetch: gsb.fetch, now: () => gclock.t, dataDir: tmp('g3'), deviceId: () => 'RP-AAAA-BBBB-CCCC-DDDD', startGoogle: () => G.startGoogle({ timeoutMs: 150 }) });
    await tacc.startGoogle(); const tdone = tacc.google.done;
    ok(await tdone === null && /timed out/.test(tacc.status().detail), 'timeout -> clear message');
    // Google disabled on the server
    gsb.S.googleEnabled = false;
    await rejects(d2.startGoogle(), /Google login is unavailable/, 'Google disabled -> refused before opening a listener');
    ok(!d2.status().busy, 'not left busy');
    gsb.S.googleEnabled = true;
    // sign-out while pending cancels the flow
    r = await d2.startGoogle();
    const pend = d2.google.done; d2.signOut();
    ok(await pend === null && !d2.status().googlePending, 'sign-out cancels a pending Google sign-in');
    // the engine API
    const gprefs = path.join(tmp('gp'), 'Default', 'Fusion.prefs'); fs.mkdirSync(path.dirname(gprefs), { recursive: true });
    const geng = await start({ account: newAccount(tmp('ge'), gclock, gsb), prefsPath: gprefs, quiet: true });
    try {
      const post = (p) => fetch('http://127.0.0.1:' + geng.port + p + '?t=' + geng.token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(async (x) => ({ status: x.status, body: await x.json() }));
      const s1 = await post('/api/account/google');
      ok(s1.status === 200 && s1.body.link && s1.body.account.googlePending, 'POST /api/account/google returns the link');
      const s2 = await post('/api/account/google/cancel');
      ok(s2.status === 200 && /cancelled/.test(s2.body.message), 'POST /api/account/google/cancel');
      const html = await fetch(geng.url).then((x) => x.text());
      ok(/id="google"/.test(html) && /Continue with Google/.test(html), 'engine page has Continue with Google');
      const ids = (html.match(/ id="[^"]+"/g) || []).map((x) => x.slice(5, -1)), dup = ids.filter((x, i) => ids.indexOf(x) !== i);
      ok(dup.length === 0, 'engine page has no duplicate element ids: ' + dup.join(','));
      const script = html.split('<script>')[1].split('</script>')[0];
      // A duplicate id once bound Render Best Drops to the DROPS stat instead of the button.
      const handled = [...script.matchAll(/\$\('([a-zA-Z0-9]+)'\)\.onclick/g)].map((m) => m[1]);
      ok(handled.length >= 11 && handled.every((id) => new RegExp('<button[^>]* id="' + id + '"').test(html)), 'every click handler is attached to a button: ' + handled.join(','));
      new vm.Script(script);
      ok(true, 'engine page script parses');
    } finally { await geng.close(); }
    console.log('PASS Google: PKCE via the website page, local one-use callback, device + license check, no provider tokens stored, cancel/deny/timeout/mismatch/no-identity/disabled handled, engine API + page');
  }

  // ---------------------------------------------------------------- H2: engine.lock (atomic, verified by the status API)
  const { acquireLock } = require('../rp-davinci-engine.js');
  const lockDir = tmp('lock'), lockFile = path.join(lockDir, 'engine.lock');
  let l = await acquireLock(lockFile);
  ok(l.fd !== undefined && fs.existsSync(lockFile), 'fresh lock created atomically');
  fs.writeSync(l.fd, JSON.stringify({ pid: process.pid, url: 'http://127.0.0.1:1/?t=abc' })); fs.closeSync(l.fd);
  l = await acquireLock(lockFile);
  ok(l.fd !== undefined, 'lock whose engine does not answer is stale and replaced, although its pid is alive');
  fs.closeSync(l.fd);
  const prefs2 = path.join(tmp('g'), 'Default', 'Fusion.prefs'); fs.mkdirSync(path.dirname(prefs2), { recursive: true });
  const live = await start({ account: newAccount(tmp('h'), clock, fakeSupabase(clock)), prefsPath: prefs2, quiet: true });
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: 999999, url: live.url }));
    l = await acquireLock(lockFile);
    ok(l.running === live.url, 'running engine (answers /api/status with its token) is reused, whatever the pid');
  } finally { await live.close(); }
  fs.writeFileSync(lockFile, '');
  l = await acquireLock(lockFile);
  ok(l.fd !== undefined, 'empty/corrupt lock replaced');
  fs.closeSync(l.fd);
  console.log('PASS engine.lock: atomic create; stale lock (no answer) replaced; running engine detected via its status API');

  console.log('ALL PASS (' + checks + ' checks)');
})().catch((e) => { console.error(e); process.exit(1); });
