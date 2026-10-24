// Lua tests, run with DaVinci's own script interpreter fuscript.exe (LuaJIT 2.1 / Lua 5.1, standalone: it does not
// start or control the Resolve application).
//  1. syntax: loadfile() on the bridge, the Lua mock and every generated command snippet (tricky strings included);
//     a deliberately broken file must be reported.
//  2. end to end: the REAL bridge "R Project Multicam AI.lua" runs under fuscript with a Lua mock of the Resolve API
//     (tests/mock-resolve.lua); forged command files are sent first (wrong nonce; top-level code with the right
//     nonce) and must be rejected without side effects; then R Project Engine drives Analyze -> Create Multicam Edit
//     -> Render Best Drops over the real file/prefs protocol; the mock's final state is dumped as JSON and checked.
// Usage: node tests/lua-tests.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), http = require('http'), assert = require('assert');
const snippets = require('../lib/lua-snippets');
const { allowAll } = require('./fake-account');
const B = require('../lib/bridge');
const { start } = require('../rp-davinci-engine.js');
const { druvaModel, T0, TL0, CAMS } = require('./druva-model');

const ROOT = path.join(__dirname, '..');
const FUSCRIPT = process.env.RP_FUSCRIPT || 'C:/Program Files/Blackmagic Design/DaVinci Resolve/fuscript.exe';
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-lua-'));
const fwd = (p) => p.replace(/\\/g, '/');
let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };

function fuscript(file, timeoutMs) {
  return cp.spawnSync(FUSCRIPT, ['-l', 'lua', file], { encoding: 'utf8', timeout: timeoutMs || 60000, windowsHide: true });
}

// ------------------------------------------------------------------ 1. syntax
const NONCE = '0123456789abcdef0123456789abcdef';
const tricky = 'He said "hi" \\ back\\slash\nnew line\ttab ]] [[ é ü 日本 --[[ not a comment';
const samples = {
  ping: {}, stop: {}, snapshot: {},
  create_timeline: { name: tricky + ' - Multicam AI', origId: 'tl-1', videoTracks: 4, settings: { timelineFrameRate: '29.97', timelineResolutionWidth: '1920', timelineResolutionHeight: '1080', timelineDropFrameTimecode: '1' } },
  delete_timeline: { id: 'tl-2', origId: 'tl-1' },
  append: { timelineId: 'tl-2', origId: 'tl-1', items: [{ mpiId: 'a"b', path: 'C:\\Media\\cam 2]\\x.mp4', startFrame: 0, endFrame: 49, trackIndex: 2, recordFrame: 86400, mediaType: 1 },
    { mpiId: null, path: 'H:/Druva Atlas/Wild ones atlas.wav', startFrame: 283650.5, endFrame: 286650.25, trackIndex: 1, recordFrame: 86400, mediaType: 2 }] },
  delete_items: { timelineId: 'tl-2', origId: 'tl-1', ids: ['x', 'y'] },
  render_save: { timelineId: 'tl-2' },
  render_start: { timelineId: 'tl-2', format: 'mp4', codec: 'H264', jobs: [{ SelectAllFrames: false, MarkIn: 87494, MarkOut: 88249, TargetDir: 'C:/Users/me/Videos/R Project Best Drops', CustomName: tricky, UseUniqueFilenames: false, ExportVideo: true, ExportAudio: true }] },
  render_poll: { jobs: ['job-1', 'job-2'] },
  render_cleanup: { timelineId: 'tl-2', deleteJobs: ['job-1'], saved: { format: { format: 'mov', codec: 'ProRes422' }, mode: 1, marks: { video: { in: 5, out: 50 }, audio: { in: 7 } } } },
};
ok(Object.keys(samples).sort().join() === snippets.OPS.slice().sort().join(), 'every snippet op has a sample');
const files = [path.join(ROOT, 'R Project Multicam AI.lua'), path.join(__dirname, 'mock-resolve.lua')];
for (const op of snippets.OPS) {
  const f = path.join(WORK, 'snippet-' + op + '.lua');
  fs.writeFileSync(f, snippets.build(op, samples[op], NONCE));
  files.push(f);
}
const rt = path.join(WORK, 'roundtrip.lua');
fs.writeFileSync(rt, 'local A = ' + snippets.toLua({ s: tricky, n: 283650.5, i: -3, b: false, list: [1, 'two', { in: 5 }] }) +
  '\nlocal o = assert(io.open(' + snippets.luaString(fwd(rt + '.out')) + ', "wb"))' +
  '\no:write(A.s, "|", A.n, "|", A.i, "|", tostring(A.b), "|", A.list[2], "|", A.list[3]["in"])\no:close()\n');
const broken = path.join(WORK, 'broken.lua');
fs.writeFileSync(broken, 'local x = = 1\n');
const checker = path.join(WORK, 'check.lua');
// Each snippet must return (nonce, function) from an EMPTY environment, exactly as the bridge loads it.
fs.writeFileSync(checker, 'local files = {' + files.concat([broken]).map((f) => snippets.luaString(fwd(f))).join(', ') + '}\n' +
  'for _, p in ipairs(files) do local f, e = loadfile(p)\n' +
  '  if not f then print("ERR " .. tostring(e))\n' +
  '  elseif p:find("snippet%-") then setfenv(f, {}); local okc, tag, body = pcall(f)\n' +
  '    if okc and tag == ' + snippets.luaString(NONCE) + ' and type(body) == "function" then print("OK " .. p) else print("ERR shape " .. p .. " " .. tostring(tag)) end\n' +
  '  else print("OK " .. p) end end\n' +
  'print("LUA " .. _VERSION .. " " .. ((jit and jit.version) or "no jit"))\n');
let r = fuscript(checker);
if (r.error) { console.error('fuscript not available: ' + r.error.message); process.exit(1); }
const out = r.stdout.split(/\r?\n/).filter((l) => /^(OK|ERR|LUA) /.test(l));
const errs = out.filter((l) => l.startsWith('ERR'));
ok(errs.length === 1 && /broken\.lua/.test(errs[0]), 'only the deliberately broken file fails: ' + errs.join(' | '));
ok(out.filter((l) => l.startsWith('OK')).length === files.length, 'all ' + files.length + ' files parse');
console.log(out.find((l) => l.startsWith('LUA')));
console.log('PASS syntax: bridge + Lua mock + ' + snippets.OPS.length + ' snippets parse and return (nonce, function) from an empty environment; broken file detected');
r = fuscript(rt);
const want = [tricky, '283650.5', '-3', 'false', 'two', '5'].join('|');
const got = fs.readFileSync(rt + '.out', 'utf8');
ok(got === want, 'Lua literal round trip: ' + JSON.stringify(got));
console.log('PASS round trip: quotes, backslashes, newline, ]] and UTF-8 survive the JS -> Lua literal');

// ------------------------------------------------------------------ 2. end to end with the real bridge
function api(eng, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const q = http.request({ host: '127.0.0.1', port: eng.port, method: body ? 'POST' : 'GET', path: p + '?t=' + eng.token,
      headers: Object.assign({ Host: '127.0.0.1:' + eng.port }, data ? { 'Content-Type': 'application/json' } : {}) }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve(JSON.parse(s)));
    });
    q.on('error', reject); if (data) q.write(data); q.end();
  });
}
async function waitFor(fn, ms) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw Error('timeout'); await new Promise((r) => setTimeout(r, 50)); } }

(async () => {
  const prefsPath = path.join(WORK, 'Profiles', 'Default', 'Fusion.prefs'), dump = path.join(WORK, 'dump.json');
  fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  const dir = B.bridgeDirFor(prefsPath);
  const model = druvaModel();
  fs.writeFileSync(path.join(WORK, 'model.lua'), 'return ' + snippets.toLua(model) + '\n');
  const marker = path.join(WORK, 'forged-side-effect.txt');
  const harness = path.join(WORK, 'harness.lua');
  fs.writeFileSync(harness, [
    '_G.RP_PREFS_PATH = ' + snippets.luaString(fwd(prefsPath)),
    '_G.MOCK_MODEL = dofile(' + snippets.luaString(fwd(path.join(WORK, 'model.lua'))) + ')',
    'dofile(' + snippets.luaString(fwd(path.join(__dirname, 'mock-resolve.lua'))) + ')',
    'dofile(' + snippets.luaString(fwd(path.join(ROOT, 'R Project Multicam AI.lua'))) + ')',
    'local f = assert(io.open(' + snippets.luaString(fwd(dump)) + ', "wb")); f:write(MOCK.json(MOCK.dump())); f:close()',
    'print("BRIDGE ENDED " .. tostring(rawget(_G, "RP")))',
  ].join('\n') + '\n');
  const eng = await start({ account: allowAll(), prefsPath, pollMs: 50, quiet: true, awaitActions: true, renderPollMs: 50 });   // creates the folder
  const lua = cp.spawn(FUSCRIPT, ['-l', 'lua', harness], { windowsHide: true });
  let luaOut = '';
  lua.stdout.on('data', (c) => { luaOut += c; }); lua.stderr.on('data', (c) => { luaOut += c; });
  const exited = new Promise((res) => lua.on('exit', res));
  const readResponse = () => { const k = B.parsePrefs(fs.readFileSync(prefsPath, 'utf8')); const x = B.parseResponse(k.Response); return x && Object.assign(x, { payload: JSON.parse(B.hexToString(x.hex)) }); };
  try {
    await waitFor(async () => (await api(eng, '/api/status')).bridge.connected, 30000);
    const st0 = await api(eng, '/api/status');
    ok(st0.bridge.info.product === 'DaVinci Resolve (mock)' && st0.bridge.info.version === 'davinci-bridge-2' && st0.bridge.info.dir === fwd(dir), 'Hello decoded; bridge uses the per-user folder next to Fusion.prefs: ' + JSON.stringify(st0.bridge.info));
    ok(!('nonce' in st0.bridge.info) && /^[0-9a-f]{32}$/.test(eng.bridge.nonce) && !fs.readdirSync(dir).some((f) => f.includes(eng.bridge.nonce)), 'nonce: 32 hex, kept out of the status API and file names');
    // forged command 1: wrong nonce
    const id = eng.bridge.helloId;
    let n = eng.bridge.next;
    fs.writeFileSync(path.join(dir, 'cmd-' + id + '-' + n + '.lua'), snippets.build('stop', {}, 'f'.repeat(32)));
    await waitFor(async () => { const x = readResponse(); return x && x.n === n; }, 10000);
    ok(/rejected/.test(readResponse().payload.error), 'wrong nonce rejected: ' + readResponse().payload.error);
    // forged command 2: right nonce but code in the outer chunk (runs with an empty environment -> fails, no side effect)
    n++;
    fs.writeFileSync(path.join(dir, 'cmd-' + id + '-' + n + '.lua'), 'local f = io.open(' + snippets.luaString(fwd(marker)) + ', "w") f:write("x") f:close()\nreturn "' + eng.bridge.nonce + '", function() end\n');
    await waitFor(async () => { const x = readResponse(); return x && x.n === n; }, 10000);
    ok(/rejected/.test(readResponse().payload.error) && !fs.existsSync(marker), 'top-level code in a command file cannot reach io (rejected, no file written)');
    await waitFor(async () => eng.bridge.next === n + 1, 5000);
    ok(true, 'engine counter followed the bridge Beat after the forged commands (H1)');
    console.log('PASS security: forged commands rejected (wrong nonce; outer-chunk code has no environment); engine re-synced numbering');

    await api(eng, '/api/refresh', {});
    let s = await api(eng, '/api/status');
    ok(s.lastResult.ok && JSON.stringify(s.cameras.map((c) => c.index)) === '[0,1,2,3,4]', 'snapshot through Lua: ' + JSON.stringify(s.lastResult));
    await api(eng, '/api/analyze', {});
    s = await api(eng, '/api/status');
    ok(s.lastResult.ok && s.analysis.bpm === 127, 'analyze: ' + JSON.stringify(s.lastResult));
    await api(eng, '/api/multicam', { roles: 'Master Wide\nCrowd\nDJ Close-Up\nDrone', cadences: [4, 6, 8], dropCamera: '', vision: false });
    s = await api(eng, '/api/status');
    ok(s.lastResult.ok && s.lastResult.result.mismatches === 0 && s.lastResult.result.failed === 0 && s.lastResult.result.placed === 45, 'multicam through Lua: ' + JSON.stringify(s.lastResult));
    const folder = path.join(WORK, 'drops');
    await api(eng, '/api/drops', { count: 2, folder });
    s = await api(eng, '/api/status');
    ok(s.lastResult.ok && s.lastResult.result.complete === 1, 'drops through Lua: ' + JSON.stringify(s.lastResult));
    // L1: after the engine's ack the bridge clears the Response from Fusion.prefs
    await waitFor(async () => { const k = B.parsePrefs(fs.readFileSync(prefsPath, 'utf8')); return k && k.Response === ''; }, 5000);
    ok(fs.statSync(prefsPath).size < 2000, 'Response cleared after the ack; Fusion.prefs stays small (' + fs.statSync(prefsPath).size + ' bytes)');
    ok(eng.lines.some((l) => /Render format restored \(mov \/ ProRes422\), render mode restored, Mark In\/Out restored/.test(l.text)), 'restore reported (format checked by reading it back)');
    await api(eng, '/api/disconnect', {});
    const code = await Promise.race([exited, new Promise((res) => setTimeout(() => res('timeout'), 20000))]);
    ok(code === 0 && /BRIDGE ENDED nil/.test(luaOut), 'bridge loop ended on stop; no global RP left behind (exit ' + code + ', ' + luaOut.trim().split(/\r?\n/).pop() + ')');
  } finally { await eng.close(); if (lua.exitCode === null) lua.kill(); }

  const d = JSON.parse(fs.readFileSync(dump, 'utf8'));
  const arr = (x) => Array.isArray(x) ? x : x ? Object.values(x) : [];
  const orig = arr(d.timelines).find((t) => t.id === 'tl-orig'), neu = arr(d.timelines).find((t) => t.name === 'Druva test - Multicam AI');
  ok(neu && neu.fps === '25', 'new timeline exists at 25 fps (project is 24): ' + (neu && neu.fps));
  const origItems = arr(orig.video).map((t) => arr(t.items).map((i) => [i.id, i.start, i.end, i.srcStart].join()).join(';')).join('|');
  const modelItems = model.timelines[0].video.map((t) => t.items.map((i) => [i.id, i.start, i.end, i.srcStart === undefined ? '' : i.srcStart].join()).join(';')).join('|');
  ok(origItems === modelItems && arr(orig.audio)[0].items.length === 1, 'original timeline items unchanged');
  ok(orig.marks.video.in === 10 && orig.marks.video.out === 200 && Object.keys(orig.marks).length === 1, 'original Mark In/Out unchanged: ' + JSON.stringify(orig.marks));
  const appends = arr(d.appends);
  ok(appends.every((a) => a.timelineId === neu.id), 'every AppendToTimeline went into the new timeline');
  const music = appends.filter((a) => a.mediaType === 2), video = appends.filter((a) => a.mediaType === 1);
  ok(music.length === 1 && music[0].mpiId === 'mpi-wav' && music[0].startFrame === T0 * 24 && music[0].endFrame === T0 * 24 + 2880 && music[0].recordFrame === TL0,
    'music in the WAV\'s 24 fps source frames, exclusive endFrame: ' + JSON.stringify(music[0]));
  ok(arr(neu.audio)[0].items[0].end - arr(neu.audio)[0].items[0].start === 3000, 'music clip is 3000 record frames on the new timeline');
  let cursor = TL0;
  for (const v of video) {
    const cam = v.trackIndex - 1;
    ok(v.mpiId === 'mpi-cam' + (v.trackIndex) && v.recordFrame === cursor && v.startFrame === Math.round((T0 - CAMS[cam][1]) * 25) + (v.recordFrame - TL0), 'video info ' + JSON.stringify(v));
    cursor += v.endFrame - v.startFrame;
  }
  ok(cursor === TL0 + 3000, 'video covers 3000 frames');
  const placed = arr(neu.video).reduce((n, t) => n + arr(t.items).length, 0);
  ok(placed === video.length && arr(neu.audio)[0].items.length === 1, 'all clips placed on the new timeline (' + placed + ')');
  const renders = arr(d.renders);
  ok(renders.length === 1 && renders[0].timelineId === neu.id && renders[0].CustomName === 'Best Drop 01 - 000059' && renders[0].UseUniqueFilenames === false && renders[0].renderMode === 1,
    'render job: ' + JSON.stringify(renders[0]));
  ok(d.renderFormat.format === 'mov' && d.renderFormat.codec === 'ProRes422' && d.renderMode === 0, 'render format and render mode restored');
  ok(arr(d.deletedJobs).length === 1, 'render job deleted');
  ok(JSON.stringify(neu.marks) === '{}', 'new timeline Mark In/Out restored (none before the render): ' + JSON.stringify(neu.marks));
  ok(arr(d.deletedTimelines).length === 0 && arr(d.deletedItems).length === 0, 'nothing deleted');
  ok(String(d.session) === '1', 'session counter persisted in the prefs (Session = ' + d.session + ')');
  console.log('PASS Lua end to end: real bridge + Lua mock Resolve; ' + video.length + ' camera clips + 1 music clip (24 fps WAV) with exclusive endFrame; ' +
    'original timeline + marks unchanged; Best Drop rendered in mode 1 with DaVinci suffix off; format, mode and marks restored; job deleted; bridge stopped cleanly');
  // ---------------------------------------------------------------- M2: non-ASCII profile path -> ProgramData fallback
  // Lua (real bridge code) and the engine must derive the same bridge-<hash> folder from the profile path.
  {
    const W2 = path.join(WORK, 'nonascii'), pd = path.join(W2, 'ProgramData');
    const prefs2 = path.join(W2, 'Profiles', 'Default', 'Fusion.prefs');
    fs.mkdirSync(path.dirname(prefs2), { recursive: true }); fs.mkdirSync(pd, { recursive: true });
    const fakeProfile = 'C:\\Users\\Ádám Ödön\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Profiles\\Default\\';
    fs.writeFileSync(path.join(W2, 'model.lua'), 'return ' + snippets.toLua(druvaModel()) + '\n');
    const h2 = path.join(W2, 'harness.lua');
    fs.writeFileSync(h2, [
      '_G.RP_PREFS_PATH = ' + snippets.luaString(fwd(prefs2)),
      '_G.RP_MOCK_PROFILE = ' + snippets.luaString(fakeProfile),
      '_G.MOCK_MODEL = dofile(' + snippets.luaString(fwd(path.join(W2, 'model.lua'))) + ')',
      'dofile(' + snippets.luaString(fwd(path.join(__dirname, 'mock-resolve.lua'))) + ')',
      'dofile(' + snippets.luaString(fwd(path.join(ROOT, 'R Project Multicam AI.lua'))) + ')',
      'print("BRIDGE ENDED")',
    ].join('\n') + '\n');
    const eng2 = await start({ account: allowAll(), prefsPath: prefs2, profileDir: fakeProfile, programData: pd, pollMs: 50, quiet: true, awaitActions: true });
    const lua2 = cp.spawn(FUSCRIPT, ['-l', 'lua', h2], { windowsHide: true, env: Object.assign({}, process.env, { ProgramData: pd }) });
    const exited2 = new Promise((res) => lua2.on('exit', res));
    try {
      await waitFor(async () => (await api(eng2, '/api/status')).bridge.connected, 30000);
      const st = await api(eng2, '/api/status');
      const expected = B.bridgeDirFor(fakeProfile + 'Fusion.prefs', pd);
      ok(fwd(st.bridge.info.dir).toLowerCase() === fwd(expected).toLowerCase() && !st.bridge.error, 'Lua and engine chose the same fallback folder: ' + st.bridge.info.dir);
      ok(/[\\/]RProjectMulticam[\\/]bridge-[0-9a-f]{16}$/.test(expected), 'fallback is ProgramData\\RProjectMulticam\\bridge-<hash>');
      await api(eng2, '/api/refresh', {});
      ok((await api(eng2, '/api/status')).lastResult.ok, 'commands run through the fallback folder');
      const acl = cp.spawnSync('icacls', [expected], { encoding: 'utf8' }).stdout;
      ok(!/BUILTIN\\Users|Everyone|Authenticated Users/i.test(acl) && /\(OI\)\(CI\)\(F\)/.test(acl), 'fallback folder restricted to this user + SYSTEM: ' + acl.split(/\r?\n/).slice(0, 3).join(' | '));
      await api(eng2, '/api/disconnect', {});
      await Promise.race([exited2, new Promise((res) => setTimeout(res, 15000))]);
    } finally { await eng2.close(); if (lua2.exitCode === null) lua2.kill(); }
    console.log('PASS non-ASCII profile: real bridge + engine agree on ProgramData\\RProjectMulticam\\bridge-<hash> (same hash in Lua and JS), folder restricted to the user');
  }
  console.log('ALL PASS (' + checks + ' checks) · work folder ' + WORK);
})().catch((e) => { console.error(e); process.exit(1); });
