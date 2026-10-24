// R Project account + license gate for the DaVinci engine. Same account system as the Premiere plugin
// (plugin/windows/Plugin/account-auth.js + license.js): Supabase email/password or Google (PKCE) sign-in, refresh-token rotation,
// register_plugin_device + plugin_entitlement with the same device id, one active device per account,
// 72 h offline grace after the last server verification (network/timeouts/5xx only).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), cp = require('child_process');
const { startGoogle, googleMessage } = require('./google-auth');

const SUPABASE_URL = 'https://ngotkvqtzqiotztnqwaw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_aBJ_h2Gaearwl5nG2Xo75g_j7YAUOxS';     // publishable key, same as the Premiere plugin
const PLUGIN_VERSION = '2.3.11.8-public-v18';                               // the engine is the 2.3.11.8 engine
const EMAIL_REDIRECT = 'https://r-multicam.pages.dev/auth/confirmed/';
const SIGNUP_URL = 'https://r-multicam.pages.dev/?signup';
const BUY_URL = 'https://r-multicam.pages.dev/#pricing';
const GRACE_MS = 72 * 3600000, CLOCK_SLACK_MS = 300000;
const VERIFY_EVERY_MS = 10 * 60000;          // an action re-checks online when the last check is older than this
const RESET_COOLDOWN_MS = 65000;

// ------------------------------------------------------------------ device id (license.js, same PC = same device)
function dataDir() {
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'RProjectMulticam');
  return path.join(home, 'Library', 'Application Support', 'RProjectMulticam');
}
function sha(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function machineSeed() {
  const parts = [];
  try { parts.push(os.platform()); parts.push(os.arch()); } catch (e) { /* as license.js */ }
  try {
    if (process.platform === 'win32') {
      const r = String(cp.execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
      const m = r.match(/MachineGuid\s+REG_SZ\s+([^\r\n]+)/i);
      if (m && m[1]) parts.push('MG:' + m[1].trim());
    }
  } catch (e1) { /* as license.js */ }
  try {
    if (parts.length < 3 && process.platform === 'win32') {
      const x = String(cp.execSync('wmic csproduct get uuid', { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }));
      parts.push('UUID:' + x.replace(/\s+/g, ' ').trim());
    }
  } catch (e2) { /* as license.js */ }
  try {
    if (process.platform === 'darwin') {
      const y = String(cp.execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
      const mm = y.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (mm && mm[1]) parts.push('IOPlatformUUID:' + mm[1].trim());
    }
  } catch (eMac) { /* as license.js */ }
  try { if (parts.length < 3) parts.push('HOST:' + os.hostname()); } catch (e3) { /* as license.js */ }
  return parts.join('|');
}
function legacyDeviceId(seed) {
  const h = sha(seed === undefined ? machineSeed() : seed).toUpperCase().replace(/[^A-F0-9]/g, '');
  return 'RP-' + h.slice(0, 4) + '-' + h.slice(4, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16);
}
function validId(v) { return /^RP-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/i.test(String(v || '').trim()); }
function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + String(Date.now());
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(file); } catch (x) { /* none */ } fs.renameSync(tmp, file); }
}
/** device-id.txt shared with the Premiere plugin; migrated once from the legacy machine fingerprint. */
function getDeviceId(dir = dataDir(), seedFn = machineSeed) {
  const f = path.join(dir, 'device-id.txt');
  let v = '';
  try { v = String(fs.readFileSync(f, 'utf8')).trim(); } catch (e) { /* missing */ }
  if (!validId(v)) v = legacyDeviceId(seedFn());
  try { atomicWrite(f, v + '\n'); } catch (e2) { /* read-only profile: the id still works this run */ }
  return v;
}

// ------------------------------------------------------------------ account
class AccountError extends Error {
  constructor(message, code, status) { super(message); this.code = code || ''; this.status = status || 0; }
}

function friendly(e) {
  const m = e && e.message ? e.message : String(e || '');
  if (/invalid login credentials/i.test(m)) return 'Email or password is incorrect, or the email is not confirmed yet. Created your account with Google? Use Continue with Google instead. Never type your Google password here.';
  if (/email not confirmed/i.test(m)) return 'Email not confirmed yet. Open the verification email first, then sign in.';
  if (/failed to fetch|fetch failed|network|timed out|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(m)) return 'Cannot reach the account server. Check your internet connection and retry.';
  return m;
}

class Account {
  constructor(opts = {}) {
    this.fetch = opts.fetch || ((...a) => fetch(...a));
    this.now = opts.now || (() => Date.now());
    this.dataDir = opts.dataDir || dataDir();
    this.sessionFile = opts.sessionFile || path.join(this.dataDir, 'davinci', 'session.json');
    this.deviceIdFn = opts.deviceId || (() => getDeviceId(this.dataDir));
    this.platform = opts.platform || 'Windows';
    this.log = opts.log || (() => {});
    this.timeoutMs = opts.timeoutMs || 30000;
    this.startGoogleFlow = opts.startGoogle || startGoogle;
    this.google = null;
    this.session = null; this.profile = null; this.entitlement = null; this.verifiedMeta = null;
    this.verified = false; this.offline = false; this.offlineReason = ''; this.message = ''; this.busy = false;
    this.resetUntil = 0; this.device = null; this.generation = 0; this.refreshFlight = null;
  }

  deviceId() { if (!this.device) this.device = this.deviceIdFn(); return this.device; }

  // ---------------- storage (user-only file inside %LOCALAPPDATA%)
  load() {
    try {
      const x = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
      if (x && x.schema === 1 && x.session && x.session.access_token && x.session.refresh_token) {
        this.session = x.session; this.profile = x.profile || null; this.entitlement = x.entitlement || null; this.verifiedMeta = x.verified_meta || null;
        return true;
      }
    } catch (e) { /* none or unreadable */ }
    return false;
  }
  save() {
    if (!this.session) { try { fs.rmSync(this.sessionFile, { force: true }); } catch (e) { /* gone */ } return; }
    atomicWrite(this.sessionFile, JSON.stringify({ schema: 1, saved_at: this.now(), session: this.session, profile: this.profile, entitlement: this.entitlement, verified_meta: this.verifiedMeta }));
  }
  clear(message) {
    this.generation++;
    if (this.google) this.google.cancel();
    this.session = null; this.profile = null; this.entitlement = null; this.verifiedMeta = null; this.verified = false; this.offline = false;
    this.message = message || '';
    this.save();
  }

  // ---------------- HTTP
  headers(auth) {
    const h = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (auth && this.session && this.session.access_token) h.Authorization = 'Bearer ' + this.session.access_token;
    return h;
  }
  async request(p, { method = 'GET', auth = false, body, headers } = {}) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res, text;
    try {
      res = await this.fetch(SUPABASE_URL + p, { method, headers: headers || this.headers(auth), body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
      text = await res.text();
    } catch (e) {
      throw new AccountError(e && e.name === 'AbortError' ? 'Account server timed out. Please retry.' : 'Cannot reach the account server: ' + (e && e.message || e), 'NETWORK', 0);
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { message: text }; }
    if (!res.ok) throw new AccountError(data.msg || data.message || data.error_description || data.error || ('HTTP ' + res.status), data.code || '', res.status);
    return data;
  }
  static transient(e) {
    if (!e || e.code === 'SESSION_REPLACED' || Account.authRejected(e)) return false;
    const s = Number(e.status || 0);
    return s ? s >= 500 || s === 408 || s === 429 : true;
  }
  static authRejected(e) {
    const m = String(e && e.message || '').toLowerCase();
    return !!(e && e.status === 401) || (/refresh[_ ]?token/.test(m) && /(invalid|expired|revoked|not found|already used)/.test(m)) || /invalid[_ ]?grant/.test(m);
  }

  rpcBody() { return { p_device_id: this.deviceId(), p_platform: this.platform, p_plugin_version: PLUGIN_VERSION }; }
  async rpc(name) {
    const call = () => this.request('/rest/v1/rpc/' + name, { method: 'POST', auth: true, headers: Object.assign(this.headers(true), { Accept: 'application/vnd.pgrst.object+json' }), body: this.rpcBody() });
    try { return await call(); }
    catch (e) {
      if ((/jwt|token|expired/i.test(e.message) || e.status === 401) && await this.refresh()) return call();
      throw e;
    }
  }

  /** Refresh-token rotation (tokens are single-use). An explicit rejection signs out; a network problem keeps the session. */
  refresh() {
    // One refresh at a time: refresh tokens are single-use, so parallel callers share the same request (M6).
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = this.refreshOnce().finally(() => { this.refreshFlight = null; });
    return this.refreshFlight;
  }
  async refreshOnce() {
    if (!this.session || !this.session.refresh_token) return false;
    const prior = this.session;
    try {
      const d = await this.request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: prior.refresh_token } });
      if (!d || !d.access_token || !d.refresh_token) throw new AccountError('Refresh response missing session tokens');
      // Signed in again / signed out meanwhile: the new state wins; a newer session counts as refreshed.
      if (this.session !== prior) return !!this.session;
      if (!d.user && prior.user) d.user = prior.user;
      this.session = d; this.save();
      return true;
    } catch (e) {
      if (this.session !== prior) return !!this.session;
      if (Account.authRejected(e)) this.clear('Your sign-in expired. Please sign in again.');   // only for the session we refreshed
      return false;
    }
  }

  markVerified() {
    const srv = Date.parse(this.entitlement && this.entitlement.server_time || '');
    this.verifiedMeta = { at: this.now(), skew: Number.isFinite(srv) ? srv - this.now() : 0, user: this.userKey(), device: this.deviceId(), allowed: !!(this.entitlement && this.entitlement.allowed === true) };
  }
  userKey() { return this.session && this.session.user ? String(this.session.user.id || this.session.user.email || '') : ''; }

  async syncEntitlement() {
    if (!this.session) return null;
    const gen = this.generation;
    let ent;
    try { ent = await this.rpc('plugin_entitlement'); }
    catch (e) {
      if (/SIGNED_IN_ON_ANOTHER_DEVICE|SESSION_REPLACED/i.test(e.message)) { this.clear(REPLACED); throw new AccountError(REPLACED, 'SESSION_REPLACED'); }
      if (Account.transient(e)) { this.offline = true; this.offlineReason = e.message; } else this.offline = false;
      throw e;
    }
    if (gen !== this.generation || !this.session) return null;
    if (ent && ent.session_replaced) { this.clear(REPLACED); throw new AccountError(REPLACED, 'SESSION_REPLACED'); }
    this.entitlement = ent; this.verified = true; this.offline = false; this.offlineReason = ''; this.message = '';
    this.markVerified(); this.save();
    return ent;
  }

  async heartbeat() {
    if (!this.session) return null;
    try { this.profile = await this.rpc('plugin_heartbeat'); }
    catch (e) {
      if (/SIGNED_IN_ON_ANOTHER_DEVICE|SESSION_REPLACED/i.test(e.message)) { this.clear(REPLACED); throw new AccountError(REPLACED, 'SESSION_REPLACED'); }
      if (Account.transient(e)) { this.offline = true; this.offlineReason = e.message; return null; }
      throw e;
    }
    return this.syncEntitlement();
  }

  async signIn(email, password) {
    email = String(email || '').trim();
    if (!email || !password) throw new AccountError('Enter your email and password.');
    if (this.busy) throw new AccountError('An account request is already running.');
    this.busy = true;
    const gen = ++this.generation;
    try {
      let d;
      try { d = await this.request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } }); }
      catch (e) { throw new AccountError(friendly(e), e.code, e.status); }
      if (!d || !d.access_token || !d.refresh_token) throw new AccountError('The account server did not return a valid session.');
      return await this.commitLogin(d, gen);
    } finally { this.busy = false; }
  }

  /** Shared by email and Google sign-in: take over the one active device (latest login wins), then check the license. */
  async commitLogin(d, gen) {
    this.session = d; this.profile = null; this.entitlement = null; this.verifiedMeta = null; this.verified = false; this.offline = false; this.message = '';
    try {
      this.profile = await this.rpc('register_plugin_device');
      await this.syncEntitlement();
      if (gen !== this.generation || !this.session) throw new AccountError('Sign-in was cancelled.');
    } catch (e) {
      if (gen === this.generation) this.clear();
      throw new AccountError(friendly(e), e.code, e.status);
    }
    this.save();
    return this.status();
  }

  /**
   * Continue with Google: the same website + PKCE flow as the Premiere plugin. Returns the link to open in a browser;
   * the sign-in finishes in the background (status().googlePending, then status() shows the result).
   */
  async startGoogle() {
    if (this.busy || this.google) throw new AccountError('An account request is already running.');
    this.busy = true;
    let flow;
    try {
      let settings;
      try { settings = await this.request('/auth/v1/settings'); }
      catch (e) { if (Account.transient(e)) throw new AccountError(friendly(e), e.code, e.status); settings = { external: {} }; }
      if (!(settings.external || {}).google) throw new AccountError('Google login is unavailable. Use email login.');
      try { flow = await this.startGoogleFlow(); }
      catch (e) { throw new AccountError(googleMessage(e), e.code); }
    } catch (e) { this.busy = false; throw e; }
    const gen = ++this.generation;
    this.google = flow; this.message = '';
    flow.done = flow.result.then((cb) => this.finishGoogle(cb, gen)).then(
      (st) => { this.log('Google sign-in: ' + st.email + ' · ' + st.label); return st; },
      (e) => {
        const msg = /^GOOGLE_/.test(e && e.code || '') ? googleMessage(e) : friendly({ message: googleMessage(e) });
        if (gen === this.generation) this.message = msg;
        this.log('Google sign-in: ' + msg);
        return null;
      }).finally(() => { if (this.google === flow) { this.google = null; this.busy = false; } });
    return { link: flow.link, message: 'Continue with Google in your browser. Keep R Project Engine open; the login returns here automatically.' };
  }

  async finishGoogle(cb, gen) {
    let d;
    try { d = await this.request('/auth/v1/token?grant_type=pkce', { method: 'POST', body: { auth_code: cb.code, code_verifier: cb.verifier } }); }
    finally { cb.verifier = ''; }
    if (!d || !d.access_token || !d.refresh_token) throw new AccountError('Google did not return a valid account session.');
    const user = await this.request('/auth/v1/user', { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + d.access_token } });
    if (!user || !user.id || !user.email || !user.email_confirmed_at || !(user.identities || []).some((i) => i && i.provider === 'google')) throw new AccountError('Could not verify the Google account. Please retry.');
    if (gen !== this.generation) throw new AccountError('Google sign-in cancelled.', 'GOOGLE_CANCELLED');
    delete d.provider_token; delete d.provider_refresh_token;
    d.user = { id: user.id, email: user.email };
    d.expires_at = Number(d.expires_at) || Math.floor(this.now() / 1000) + Number(d.expires_in || 3600);
    return this.commitLogin(d, gen);
  }

  cancelGoogle() {
    if (!this.google) return { message: 'No Google sign-in is running.' };
    this.google.cancel();
    return { message: 'Google sign-in cancelled. You can retry or use email login.' };
  }

  signOut() { this.clear('Signed out.'); return this.status(); }

  async forgotPassword(email) {
    email = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError('Enter your email first.');
    const wait = this.resetUntil - this.now();
    if (wait > 0) throw new AccountError('Please wait ' + Math.ceil(wait / 1000) + ' seconds before requesting another password reset email.');
    try { await this.request('/auth/v1/recover?redirect_to=' + encodeURIComponent(EMAIL_REDIRECT), { method: 'POST', body: { email } }); }
    catch (e) { throw new AccountError(friendly(e), e.code, e.status); }
    this.resetUntil = this.now() + RESET_COOLDOWN_MS;
    return { ok: true, message: 'If an account exists for ' + email + ', a password reset email is on its way.' };
  }

  /** Restore the saved sign-in at engine start (network problems keep it; explicit rejections sign out). */
  async restore() {
    if (!this.load()) return this.status();
    try {
      const exp = Number(this.session.expires_at || 0);
      if (exp && exp * 1000 <= this.now() + 120000) await this.refresh();
      if (this.session) await this.syncEntitlement();
    } catch (e) {
      if (this.session && Account.authRejected(e) && await this.refresh()) { try { await this.syncEntitlement(); } catch (e2) { /* status shows it */ } }
    }
    return this.status();
  }

  graceLeftMs() {
    const m = this.verifiedMeta, e = this.entitlement;
    if (!this.session || !e || e.allowed !== true || !m || m.allowed === false) return 0;
    if (String(m.user || '') !== this.userKey() || (m.device && m.device !== this.deviceId())) return 0;
    const age = this.now() - Number(m.at || 0);
    if (!(age >= -CLOCK_SLACK_MS && age <= GRACE_MS)) return 0;
    return GRACE_MS - Math.max(0, age);
  }
  remainingMs() {
    const e = this.entitlement;
    if (!e) return 0;
    if (e.license_status === 'lifetime') return null;
    const exp = Date.parse(e.trial_expires_at || '');
    if (Number.isFinite(exp)) return Math.max(0, exp - (this.now() + Number(this.verifiedMeta && this.verifiedMeta.skew || 0)));
    const since = this.verifiedMeta ? this.now() - Number(this.verifiedMeta.at || 0) : 0;
    return Math.max(0, Number(e.remaining_seconds || 0) * 1000 - since);
  }
  canUse() {
    const e = this.entitlement;
    if (!this.session || !e || e.allowed !== true) return false;
    if (!this.verified && !(this.offline && this.graceLeftMs() > 0)) return false;
    if (this.offline && this.graceLeftMs() <= 0) return false;
    return e.license_status === 'lifetime' || this.remainingMs() > 0;
  }

  /** Called by every engine action: re-verify online when due, then allow or refuse with a clear reason. */
  async ensureAllowed() {
    if (!this.session) throw new AccountError('Sign in with your R Project account first (the same account as the Premiere plugin).', 'SIGNED_OUT');
    const last = this.verifiedMeta ? Number(this.verifiedMeta.at || 0) : 0;
    if (!this.verified || this.offline || this.now() - last > VERIFY_EVERY_MS) {
      try { await this.syncEntitlement(); }
      catch (e) {
        if (e.code === 'SESSION_REPLACED') throw e;
        if (!Account.transient(e)) throw new AccountError(friendly(e), e.code, e.status);
      }
    }
    if (this.canUse()) return this.status();
    const s = this.status();
    throw new AccountError(s.detail || 'This account cannot use R Project Multicam AI right now.', s.code);
  }

  status() {
    const e = this.entitlement || {}, signed = !!this.session, ok = this.canUse(), life = e.license_status === 'lifetime';
    const reason = String(e.reason || '').toUpperCase(), rem = this.remainingMs();
    let label = 'Signed out', detail = this.message || 'Sign in with your R Project account (the same account as the Premiere plugin).', code = 'SIGNED_OUT';
    if (signed) {
      if (ok && life) { label = 'Lifetime'; detail = 'Lifetime license active.'; code = 'LIFETIME'; }
      else if (ok) { const days = Math.max(1, Math.ceil(rem / 86400000)); label = 'Trial: ' + days + ' day' + (days === 1 ? '' : 's') + ' left'; detail = 'Free trial active. Buy Lifetime to keep using it after the trial.'; code = 'TRIAL'; }
      else if (reason === 'UPDATE_REQUIRED') { label = 'Update required'; detail = 'This version is no longer supported. Download v' + (e.minimum_version || e.latest_version || 'latest') + ' or newer from ' + (e.update_url || 'https://r-multicam.pages.dev/') + '.'; code = 'UPDATE_REQUIRED'; }
      else if (e.license_status === 'expired' || (e.license_status === 'trial' && rem === 0)) { label = 'Trial expired'; detail = 'Your trial has ended. Buy Lifetime to continue.'; code = 'EXPIRED'; }
      else if (this.offline && this.graceLeftMs() <= 0) { label = 'Online check required'; detail = 'Offline for more than 72 h since the last check. Connect to the internet to continue.'; code = 'OFFLINE_EXPIRED'; }
      else if (!this.verified && !this.offline) { label = 'Checking license…'; detail = 'Checking your license with the account server.'; code = 'CHECKING'; }
      else { label = 'Not allowed'; detail = 'This account cannot use R Project Multicam AI right now.'; code = 'NOT_ALLOWED'; }
      if (ok && this.offline) detail = 'Offline · last check ' + Math.round((this.now() - Number(this.verifiedMeta && this.verifiedMeta.at || 0)) / 3600000) + ' h ago. Reconnect within ' + Math.floor(this.graceLeftMs() / 3600000) + ' h.';
      if (ok && reason === 'UPDATE_AVAILABLE') detail += ' An update is available' + (e.latest_version ? ' (v' + e.latest_version + ')' : '') + '.';
    }
    return { signedIn: signed, email: this.session && this.session.user ? this.session.user.email : '', canUse: ok, label, detail, code,
      licenseStatus: e.license_status || null, remainingMs: rem, offline: this.offline, busy: this.busy, googlePending: !!this.google, deviceId: this.deviceId(),
      buyUrl: BUY_URL, signupUrl: SIGNUP_URL };
  }
}
const REPLACED = 'Your account was signed in on another device. Only one device can use this account at a time. Sign in again to use it here.';

module.exports = { Account, AccountError, getDeviceId, legacyDeviceId, machineSeed, validId, friendly, PLUGIN_VERSION, SUPABASE_URL, SUPABASE_KEY, BUY_URL, SIGNUP_URL, GRACE_MS, VERIFY_EVERY_MS };
