// The panel refreshes its access token shortly before it expires, so plugin_entitlement / plugin_heartbeat are not
// first sent with an expired JWT (the 401s seen in the server logs). A failed refresh never blocks the call.
// Usage: node scripts/test-plugin-token-refresh.cjs   (checks plugin/windows and plugin/macos)
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-token-'));
for (const k of ['LOCALAPPDATA', 'APPDATA', 'HOME', 'USERPROFILE']) process.env[k] = tmp;
const cacheFile = path.join(tmp, 'RProjectMulticam', 'account-session-v4.json');
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;

let net;
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const lifetime = () => ({ allowed: true, license_status: 'lifetime', remaining_seconds: null, trial_expires_at: null, server_time: new Date(Date.now()).toISOString() });
global.fetch = async (url, opt = {}) => {
  url = String(url);
  const auth = Object.entries(opt.headers || {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1] || '';
  net.calls.push({ url, auth });
  if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
    if (!net.refreshOk) return json({ msg: 'temporarily unavailable' }, 503);
    return json({ access_token: 'at-new', refresh_token: 'rt-new', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'user-1', email: 'u@x.test' } });
  }
  if (url.endsWith('/auth/v1/user')) return json({ id: 'user-1' });
  if (url.endsWith('/rest/v1/rpc/plugin_entitlement') || url.endsWith('/rest/v1/rpc/plugin_heartbeat')) {
    return auth === 'Bearer at-old' && net.oldExpired ? json({ message: 'JWT expired' }, 401) : json(lifetime());
  }
  return json({}, 200);
};

function load(dir) {
  const store = {};
  global.window = global; global.cep_node = { require };
  global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  global.RPLicense = { deviceId: () => 'DEV-1' };
  vm.runInThisContext(fs.readFileSync(path.join(dir, 'account-auth.js'), 'utf8'), { filename: 'account-auth.js' });
  return global.RPAccountAuth;
}
function writeCache(expiresInS) {
  fs.rmSync(path.dirname(cacheFile), { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const sess = { access_token: 'at-old', refresh_token: 'rt-old', expires_at: Math.floor(Date.now() / 1000) + expiresInS, user: { id: 'user-1', email: 'u@x.test' } };
  fs.writeFileSync(cacheFile, JSON.stringify({ schema: 4, saved_at: Date.now(), session: sess, profile: null, entitlement: lifetime(),
    verified_meta: { at: Date.now(), server_at: Date.now(), skew: 0, user: 'user-1', device: 'DEV-1', allowed: true }, signed_entitlement: null }));
}
const rpcCalls = () => net.calls.filter((c) => c.url.includes('/rest/v1/rpc/plugin_entitlement'));
const refreshCalls = () => net.calls.filter((c) => c.url.includes('grant_type=refresh_token'));

(async () => {
  for (const plat of ['windows', 'macos']) {
    const dir = path.join(__dirname, '..', 'plugin', plat, 'Plugin');

    // Token expires in 10 minutes: restore uses it as is.
    offset = 0; net = { calls: [], refreshOk: true, oldExpired: false }; writeCache(600);
    let A = load(dir); await A.restore();
    assert.equal(refreshCalls().length, 0, plat + ': fresh token is not refreshed');
    // 9.5 minutes later (30 s left) the next entitlement check refreshes first and uses the new token.
    offset = 570000; net.calls = []; net.oldExpired = true;
    await A.refreshEntitlement();
    assert.equal(refreshCalls().length, 1, plat + ': refresh before the call');
    assert(net.calls.indexOf(refreshCalls()[0]) < net.calls.indexOf(rpcCalls()[0]), plat + ': refresh happens before the RPC');
    assert.equal(rpcCalls()[0].auth, 'Bearer at-new', plat + ': RPC uses the refreshed token');
    assert(!rpcCalls().some((c) => c.auth === 'Bearer at-old'), plat + ': no request with the expired token');

    // Refresh server down: the call still goes out (old behaviour, no lock-out from the pre-refresh).
    offset = 0; net = { calls: [], refreshOk: false, oldExpired: false }; writeCache(600);
    A = load(dir); await A.restore();
    offset = 570000; net.calls = [];
    await A.refreshEntitlement();
    assert(rpcCalls().length >= 1, plat + ': RPC still sent when refresh fails');
    assert(A.canUse(), plat + ': still usable');
  }
  Date.now = realNow;
  console.log('PASS token refresh: refreshed before an expiring token is used (Windows + macOS), failed refresh does not block the call');
})().catch((e) => { console.error(e); process.exitCode = 1; });
