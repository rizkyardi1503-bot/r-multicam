// Engine side of the DaVinci bridge (file + Fusion.prefs protocol).
//   engine -> DaVinci : <Fusion profile>/RProjectBridge/cmd-<helloId>-<n>.lua   (tmp file + rename)
//                       content: return "<nonce>", function(resolve, RP) ... end   (nonce from Hello only)
//   DaVinci -> engine : Fusion.prefs  Global = { RProjectBridge = { Hello = "<id>:<hex json>",
//                                     Beat = "<id>:<next n>:<count>:<state>", Response = "<id>:<n>:<hex json>" } }
// The command folder is next to Fusion.prefs (per user). When that path is not plain ASCII (Lua's loadfile/fileexists
// use the ANSI code page), both sides use C:/ProgramData/RProjectMulticam/bridge-<hash of the profile path> instead,
// restricted to the current user. Public folders and links/junctions on the command folder are refused.
// L1: after reading a Response the engine writes ack-<id>-<n>; the bridge then clears the Response pref.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const snippets = require('./lua-snippets');

const OP_TIMEOUT_MS = { snapshot: 600000, append: 600000, create_timeline: 180000, render_start: 300000 };
const DEFAULT_TIMEOUT_MS = 120000;

function defaultPrefsPath() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appdata, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Profiles', 'Default', 'Fusion.prefs');
}
/** Profile path as the Lua side normalises it: forward slashes, no trailing slash, ASCII-only lower case. */
function profileKey(dir) { return String(dir).replace(/\\/g, '/').replace(/\/+$/, '').replace(/[A-Z]/g, (c) => c.toLowerCase()); }
function asciiSafe(s) { return /^[\x20-\x7e]*$/.test(String(s)); }
/** Same hash as the Lua bridge (two 32-bit multiplicative hashes over the UTF-8 bytes). */
function pathHash(str) {
  let h1 = 5381, h2 = 0;
  for (const b of Buffer.from(String(str), 'utf8')) { h1 = (h1 * 33 + b) % 4294967296; h2 = (h2 * 131 + b) % 4294967296; }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
function bridgeDirFor(prefsPath, programData) {
  const profile = path.dirname(prefsPath);
  if (asciiSafe(profile)) return path.join(profile, 'RProjectBridge');
  return path.join(programData || process.env.ProgramData || 'C:\\ProgramData', 'RProjectMulticam', 'bridge-' + pathHash(profileKey(profile)));
}
const sameDir = (a, b) => profileKey(a) === profileKey(b);

class BridgeError extends Error {}

/** Create (if needed) and validate the command folder: never a public folder; the folder itself and its parent
 *  (Profiles\\Default, or RProjectMulticam for the fallback) must not be links/junctions. Higher folders may be
 *  redirected (e.g. a profile on another drive). The ProgramData fallback is restricted to the current user. */
function secureDir(dir, { restrict = false } = {}) {
  const abs = path.resolve(dir);
  if (/[\\/]users[\\/]public([\\/]|$)/i.test(abs)) throw new BridgeError('Refusing a public command folder: ' + abs);
  fs.mkdirSync(abs, { recursive: true });
  for (const p of [abs, path.dirname(abs)]) {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new BridgeError('Refusing a linked or non-folder command path: ' + p);
  }
  if (restrict && process.platform === 'win32') {
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + (process.env.USERNAME || os.userInfo().username);
    const r = cp.spawnSync('icacls', [abs, '/inheritance:r', '/grant:r', user + ':(OI)(CI)F', '/grant:r', '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
    if (r.status !== 0) throw new BridgeError('Could not restrict the command folder ' + abs + ' to your user (' + String(r.stdout || r.stderr || '').trim() + ').');
  }
  return abs;
}

function hexToString(hex) {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2) throw new BridgeError('Bridge response is not valid hex.');
  return Buffer.from(hex, 'hex').toString('utf8');
}
// Returns the string values of the RProjectBridge block (Hello, Beat, Response), or null if absent.
function parsePrefs(text) {
  const at = text.indexOf('RProjectBridge');
  if (at < 0) return null;
  const open = text.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0, end = -1, inStr = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { end = i; break; } }
  }
  if (end < 0) return null;
  const block = text.slice(open, end + 1), out = {};
  const re = /\b(Hello|Beat|Response)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2];
  return out;
}
function parseHello(v) {
  const i = (v || '').indexOf(':');
  if (i < 0) return null;
  return { id: v.slice(0, i), info: JSON.parse(hexToString(v.slice(i + 1))) };   // throws on a torn write
}
function parseBeat(v) {
  const p = (v || '').split(':');
  return p.length >= 4 ? { id: p[0], next: Number(p[1]), count: Number(p[2]), state: p[3] } : null;
}
function parseResponse(v) {
  const p = (v || '').split(':');
  if (p.length !== 3 || !p[2]) return null;
  return { id: p[0], n: Number(p[1]), hex: p[2] };
}

class Bridge {
  constructor(opts = {}) {
    this.prefsPath = opts.prefsPath || defaultPrefsPath();
    // opts.profileDir: tests only (the folder Fusion reports as Profile:, normally the folder of Fusion.prefs).
    const profile = opts.profileDir || path.dirname(this.prefsPath);
    this.dir = secureDir(bridgeDirFor(path.join(profile, 'Fusion.prefs'), opts.programData), { restrict: !asciiSafe(profile) });
    this.isResolveRunning = opts.isResolveRunning || resolveRunning;
    this.deadAfterMs = opts.deadAfterMs || 15000;
    this.lastChangeAt = Date.now(); this.dirError = '';
    this.pollMs = opts.pollMs || 100;
    this.staleMs = opts.staleMs || 10000;
    this.timeouts = Object.assign({}, OP_TIMEOUT_MS, opts.timeouts || {});
    this.log = opts.log || (() => {});
    this.helloRaw = null; this.helloId = null; this.nonce = null; this.info = {}; this.next = 1;
    this.lastBeat = null; this.aliveAt = 0; this.state = 'waiting';
    this.response = null; this.mtime = 0; this.size = -1; this.timer = null; this.started = false;
  }
  start() { if (!this.timer) { this.poll(); this.started = true; this.timer = setInterval(() => this.poll(), this.pollMs); } return this; }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  newSession(raw, hello, beat, live) {
    this.helloRaw = raw; this.helloId = hello.id; this.info = hello.info || {}; this.nonce = this.info.nonce || null;
    this.next = beat && beat.id === hello.id && beat.next > 0 ? beat.next : 1;
    this.lastBeat = beat && beat.id === hello.id ? beat : null; this.response = null;
    this.state = beat && beat.id === hello.id ? beat.state : 'hello';
    // A Hello that was already in the prefs when the engine started may be left over from a closed DaVinci:
    // it only counts as alive once its heartbeat moves (M1).
    this.aliveAt = live ? Date.now() : 0;
    if (this.info.error) this.log('DaVinci bridge problem: ' + this.info.error);
    // Both sides must use the same command folder (M2); otherwise every command would just time out.
    this.dirError = this.info.dir && !sameDir(this.info.dir, this.dir)
      ? 'DaVinci uses the command folder "' + this.info.dir + '" but R Project Engine uses "' + this.dir + '". Run DaVinci and R Project Engine as the same Windows user, then reinstall.' : '';
    if (this.dirError) this.log('ERROR: ' + this.dirError);
    if (live) this.log('DaVinci connected: ' + [this.info.product, this.info.resolve, this.info.project && 'project "' + this.info.project + '"'].filter(Boolean).join(' · '));
    this.cleanup();
  }

  poll() {
    let st;
    try { st = fs.statSync(this.prefsPath); } catch (e) { return; }
    if (st.mtimeMs === this.mtime && st.size === this.size) return;
    let keys, hello = null;
    try {
      keys = parsePrefs(fs.readFileSync(this.prefsPath, 'utf8'));
      if (keys && keys.Hello) hello = parseHello(keys.Hello);
    } catch (e) { return; }                       // torn write: mtime not stored, read again next poll (Q3)
    this.mtime = st.mtimeMs; this.size = st.size; this.lastChangeAt = Date.now();
    if (!keys) return;
    const beat = parseBeat(keys.Beat);
    if (hello && keys.Hello !== this.helloRaw) this.newSession(keys.Hello, hello, beat, this.started);
    else if (beat && beat.id === this.helloId && this.lastBeat && (beat.count < this.lastBeat.count || (beat.state === 'hello' && this.lastBeat.state !== 'hello'))) {
      this.log('DaVinci bridge restarted.');           // same id, restarted loop (H2)
      this.newSession(keys.Hello, hello || { id: this.helloId, info: this.info }, beat, true);
    }
    if (beat && beat.id === this.helloId) {
      if (!this.lastBeat || beat.count !== this.lastBeat.count || beat.state !== this.lastBeat.state) {
        if (this.lastBeat || this.started) this.aliveAt = Date.now();
        this.lastBeat = beat; this.state = beat.state;
      }
      if (!this.pending && beat.next > 0) this.next = beat.next;   // the bridge's own counter is the truth (H1)
    }
    const r = parseResponse(keys.Response);
    this.response = r && r.id === this.helloId ? r : null;
  }

  status() {
    const alive = !!this.helloId && this.state !== 'stopped' && this.aliveAt > 0 && Date.now() - this.aliveAt < this.staleMs;
    return { connected: (alive || !!this.pending) && !this.dirError, busy: !!this.pending, helloId: this.helloId, info: publicInfo(this.info), state: this.state,
      error: this.dirError || (this.info && this.info.error) || '',
      lastBeatAgoMs: this.aliveAt ? Date.now() - this.aliveAt : null };
  }

  cmdPath(id, n) { return path.join(this.dir, 'cmd-' + id + '-' + n + '.lua'); }

  // Remove command files of earlier bridge sessions (Lua cannot delete files).
  cleanup() {
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (/^(cmd|ack)-/.test(f) && !f.startsWith('cmd-' + this.helloId + '-') && !f.startsWith('ack-' + this.helloId + '-')) fs.rmSync(path.join(this.dir, f), { force: true });
      }
    } catch (e) { /* folder busy: next time */ }
  }

  writeCommand(op, args) {
    if (!this.helloId || !this.nonce) throw new BridgeError('DaVinci is not connected. In DaVinci Resolve choose Workspace > Scripts > R Project Multicam AI.');
    const n = this.next, file = this.cmdPath(this.helloId, n), tmp = file + '.tmp';
    fs.rmSync(path.join(this.dir, 'ack-' + this.helloId + '-' + (n - 1)), { force: true });
    fs.writeFileSync(tmp, snippets.build(op, args, this.nonce), 'utf8');
    fs.renameSync(tmp, file);
    this.next = n + 1;                            // only after the file is in place
    return { id: this.helloId, n, file };
  }

  async call(op, args, { timeoutMs } = {}) {
    this.poll();
    if (this.dirError) throw new BridgeError(this.dirError);
    if (!this.status().connected) throw new BridgeError('DaVinci is not connected. In DaVinci Resolve choose Workspace > Scripts > R Project Multicam AI (R Project Engine must stay open).');
    if (this.pending) throw new BridgeError('Another DaVinci command is still running.');
    timeoutMs = timeoutMs || this.timeouts[op] || DEFAULT_TIMEOUT_MS;
    const cmd = this.writeCommand(op, args);
    this.pending = cmd;
    const started = Date.now();
    let consumed = false, lastProcCheck = 0;
    try {
      for (;;) {
        this.poll();
        const r = this.response;
        if (r && r.id === cmd.id && r.n === cmd.n) {
          let payload;
          try { payload = JSON.parse(hexToString(r.hex)); } catch (e) { this.mtime = 0; await this.sleep(); continue; }   // Q3
          consumed = true;
          this.ack(cmd);
          if (!payload.ok) throw new BridgeError('DaVinci: ' + payload.error);
          return payload.result;
        }
        if (this.helloId !== cmd.id) { consumed = true; throw new BridgeError('The DaVinci bridge was restarted while "' + op + '" was running. Try again.'); }
        if (this.state === 'stopped') { consumed = true; throw new BridgeError('The DaVinci bridge stopped.'); }
        // M3: no prefs activity for a while and no Resolve process -> it was closed; don't wait for the timeout.
        // (A busy Resolve still has its process, and the bridge writes a beat with every answer between batches.)
        if (Date.now() - this.lastChangeAt > this.deadAfterMs && Date.now() - lastProcCheck > 5000) {
          lastProcCheck = Date.now();
          if (!(await this.isResolveRunning())) { consumed = true; throw new BridgeError('DaVinci Resolve closed while "' + op + '" was running.'); }
        }
        if (Date.now() - started > timeoutMs) {
          consumed = !!(this.lastBeat && this.lastBeat.id === cmd.id && this.lastBeat.next > cmd.n);
          throw new BridgeError('DaVinci did not answer "' + op + '" within ' + Math.round(timeoutMs / 1000) + ' s.');
        }
        await this.sleep();
      }
    } finally {
      this.pending = null;
      fs.rmSync(cmd.file, { force: true });
      if (!consumed && this.helloId === cmd.id && this.next === cmd.n + 1) this.next = cmd.n;   // never picked up: reuse n
    }
  }
  sleep() { return new Promise((res) => setTimeout(res, this.pollMs)); }
  /** Tell the bridge its answer arrived so it clears the (possibly large) Response from Fusion.prefs (L1). */
  ack(cmd) { try { fs.writeFileSync(path.join(this.dir, 'ack-' + cmd.id + '-' + cmd.n), ''); } catch (e) { /* only housekeeping */ } }

  // Best effort, synchronous (used on engine exit): ask the Lua loop to end so it does not block the script queue.
  sendStopSync() {
    if (!this.helloId || this.state === 'stopped') return false;
    try { this.writeCommand('stop', {}); return true; } catch (e) { return false; }
  }
}
function resolveRunning() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(true);
    cp.execFile('tasklist', ['/FI', 'IMAGENAME eq Resolve.exe', '/NH'], { windowsHide: true, timeout: 4000 }, (err, out) => resolve(err ? true : /resolve\.exe/i.test(String(out))));
  });
}
function publicInfo(info) { const o = Object.assign({}, info || {}); delete o.nonce; return o; }

module.exports = { Bridge, BridgeError, parsePrefs, parseHello, parseBeat, parseResponse, hexToString, secureDir, bridgeDirFor, profileKey, pathHash, asciiSafe, sameDir, resolveRunning, defaultPrefsPath, OP_TIMEOUT_MS };
