// Unit tests for the DaVinci engine modules (no DaVinci, no media): resolve-logic, lua-snippets, bridge, workflow.
// Usage: node tests/unit-tests.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const L = require('../lib/resolve-logic');
const S = require('../lib/lua-snippets');
const B = require('../lib/bridge');
const { Session } = require('../lib/workflow');

let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };
const eq = (a, b, msg) => { checks++; assert.deepStrictEqual(a, b, msg); };
const throws = (fn, re, msg) => { checks++; assert.throws(fn, re, msg); };
const TL0 = 86400, EXISTS = () => true, NONCE = 'abcdef0123456789abcdef0123456789';

// ------------------------------------------------------------------ resolve-logic
{
  const n30 = 30000 / 1001, n24 = 24000 / 1001, n60 = 60000 / 1001;
  for (const [raw, want] of [['29.97 NDF', n30], ['29.97 DF', n30], ['29.97', n30], ['23.98', n24], ['23.976', n24], ['59.94', n60], ['25', 25], [24, 24], ['abc', null], ['', null], [null, null], ['0', null]])
    eq(L.parseFps(raw), want, 'parseFps(' + JSON.stringify(raw) + ')');
  eq([L.fpsString(n24), L.fpsString(n30), L.fpsString(n60), L.fpsString(25), L.fpsString(24)], ['23.976', '29.97', '59.94', '25', '24'], 'fpsString (L2)');
  console.log('PASS parseFps / fpsString: NDF/DF, NTSC snapping and formatting');
}

function rawTimeline() {
  const mpi = (id, p, extra) => Object.assign({ id, path: p, fps: '25', type: 'Video + Audio' }, extra || {});
  const item = (id, s, e, src, m, extra) => Object.assign({ id, name: id, type: 'video', start: TL0 + s, end: TL0 + e, duration: e - s, srcStart: src, srcEnd: src + (e - s), enabled: true, mpi: m }, extra || {});
  return {
    project: 'P', projectFps: '24',
    timeline: { id: 'tl-1', name: 'Unit', start: TL0, end: TL0 + 200, settings: { timelineFrameRate: '25', timelineResolutionWidth: '3840', timelineResolutionHeight: '2160', timelineDropFrameTimecode: '0' } },
    timelineNames: ['Unit', 'Unit - Multicam AI'], audioTracks: 1,
    audio: [item('m', 0, 200, 0, mpi('mm', 'C:/m.wav', { type: 'Audio' }), { type: 'audio' })],
    video: [
      { n: 1, enabled: true, locked: false, items: [item('a', 0, 200, 1000, mpi('ma', 'C:/a.mp4'))] },
      { n: 2, enabled: true, locked: false, items: [item('b1', 0, 100, 500, mpi('mb', 'C:/b.mp4')), item('b2', 100, 200, 9000, mpi('mb', 'C:/b.mp4'))] },
    ],
  };
}
const PLAN = { intervals: [{ id: 0, start: 0, end: 2 }, { id: 1, start: 2, end: 3 }, { id: 2, start: 3, end: 6 }, { id: 3, start: 6, end: 7 }, { id: 4, start: 7, end: 8 }],
  choices: [{ id: 0, camera: 0 }, { id: 1, camera: 0 }, { id: 2, camera: 1 }, { id: 3, camera: -1 }, { id: 4, camera: 0 }] };
{
  const { snapshot, refs } = L.buildSnapshot(rawTimeline(), { fileExists: EXISTS });
  eq([snapshot.fps, snapshot.tlStart, snapshot.duration], [25, TL0, 8], 'fps/start/duration');
  eq(snapshot.a1.clips, [{ file: 'C:/m.wav', start: 0, end: 8, input: 0 }], 'A1 clip in seconds');
  eq(snapshot.settings, { timelineFrameRate: '25', timelineResolutionWidth: '3840', timelineResolutionHeight: '2160', timelineDropFrameTimecode: '0' }, 'settings incl. drop-frame flag kept for the new timeline (L1)');
  const { infos, gaps } = L.planSegments(PLAN, snapshot, refs, 172800);
  eq(infos.map((i) => [i.trackIndex, i.recordFrame, i.startFrame, i.endFrame, i.mediaType]), [
    [1, 172800, 1000, 1075, 1],   // 0-3 s on V1, merged, EXCLUSIVE end (75 frames)
    [2, 172875, 575, 600, 1],     // 3-4 s on V2 clip b1
    [2, 172900, 9000, 9050, 1],   // 4-6 s on V2 clip b2: split at the clip edge
    [1, 172975, 1175, 1200, 1]], 'planSegments merge/split, exclusive endFrame');
  eq(infos[0]._intervals, [0, 1], 'merged intervals recorded');
  ok(gaps.length === 1 && gaps[0][0] === 6 && gaps[0][1] === 7, 'camera -1 interval left as a gap');
  eq(L.musicInfos(snapshot, refs, 172800).map(L.publicInfo), [{ mpiId: 'mm', path: 'C:/m.wav', startFrame: 0, endFrame: 200, recordFrame: 172800, trackIndex: 1, mediaType: 2 }], 'music info on A1');
  eq(L.defaultRoles(snapshot), 'V1: Camera 1\nV2: Camera 2', 'default roles by track number');
  eq(L.uniqueTimelineName(snapshot.timelineNames, 'Unit - Multicam AI'), 'Unit - Multicam AI (2)', 'unique timeline name');
  console.log('PASS buildSnapshot + planSegments + musicInfos (exclusive endFrame)');
}
{
  // L-4: WAV labelled 24 fps (project rate) on a 25 fps timeline; GetSourceEndFrame inclusive-looking at the media end.
  const raw = rawTimeline();
  Object.assign(raw.audio[0], { end: TL0 + 3000, duration: 3000, srcStart: 0, srcEnd: 2879 });
  raw.audio[0].mpi.fps = '24'; raw.timeline.end = TL0 + 3000;
  let r = L.buildSnapshot(raw, { fileExists: EXISTS });
  const mi = L.musicInfos(r.snapshot, r.refs, 86400)[0];
  ok(mi.startFrame === 0 && mi.endFrame === 2880 && mi._length === 3000, 'WAV at 24 fps: 3000 record frames -> source 0..2880 (exclusive), from duration not srcEnd: ' + JSON.stringify(L.publicInfo(mi)));
  raw.audio[0].srcEnd = 2880 * 1.1;           // stretched WAV
  throws(() => L.buildSnapshot(raw, { fileExists: EXISTS }), /speed changes/, 'stretched WAV detected with the clip\'s own fps');
  console.log('PASS L-4: clip FPS used for every item; lengths from GetDuration; inclusive srcEnd at media end tolerated');
}
{
  const logs = [], log = (x) => logs.push(x);
  let raw = rawTimeline();                                             // M4: transitions skipped
  raw.audio.push({ id: 't', type: 'transition', start: TL0 + 50, end: TL0 + 60 });
  raw.video[0].items.push({ id: 't2', type: 'transition', start: TL0 + 50, end: TL0 + 60 });
  let s = L.buildSnapshot(raw, { fileExists: EXISTS }).snapshot;
  ok(s.a1.clips.length === 1 && s.tracks[0].clips.length === 1, 'transitions skipped (M4)');
  raw = rawTimeline(); raw.video[1].items[0].srcEnd += 100;            // M5: 200 % speed
  s = L.buildSnapshot(raw, { fileExists: EXISTS, log }).snapshot;
  ok(!s.tracks[1].clips[0].supported && s.tracks[1].clips[1].supported && logs.some((x) => /speed change/.test(x)), 'speed-changed clip unsupported + logged (M5)');
  raw = rawTimeline(); raw.audio[0].srcEnd += 60;
  throws(() => L.buildSnapshot(raw, { fileExists: EXISTS }), /speed changes/, 'A1 speed change stops');
  raw = rawTimeline(); raw.video[0].items[0].mpi.fps = '50'; raw.video[0].items[0].srcEnd = 1000 + 400;
  s = L.buildSnapshot(raw, { fileExists: EXISTS }).snapshot;
  ok(s.tracks[0].clips[0].supported && s.tracks[0].clips[0].input === 20, '50 fps clip on 25 fps timeline: normal speed, input in clip fps');
  // Source frames are 0-based from the first frame of the file (verified live): a non-zero Start / start timecode
  // must never shift the analysis. Start = 10 s worth of frames (250 at 25 fps, 1000 at 100 fps).
  logs.length = 0; raw = rawTimeline();
  raw.video[0].items[0].mpi.start = '250'; raw.video[1].items.forEach((i) => { i.mpi.start = '250'; }); raw.audio[0].mpi.start = '250';
  s = L.buildSnapshot(raw, { fileExists: EXISTS, log }).snapshot;
  ok(s.tracks[0].clips[0].input === 1000 / 25 && s.tracks[1].clips[0].input === 500 / 25 && s.tracks[1].clips[1].input === 9000 / 25 && s.a1.clips[0].input === 0,
    'Start = 10 s of frames: inputs unchanged (source frame / clip fps), nothing subtracted');
  const r10 = L.buildSnapshot(raw, { fileExists: EXISTS });
  const seg10 = L.planSegments(PLAN, r10.snapshot, r10.refs, 172800).infos;
  ok(seg10[0].startFrame === 1000 && seg10[1].startFrame === 575, 'Start = 10 s: AppendToTimeline source frames unchanged too');
  raw = rawTimeline(); raw.video[0].items[0].mpi.start = '0';           // live: Start=0 for a 01:00:00:00 .mov
  s = L.buildSnapshot(raw, { fileExists: EXISTS, log }).snapshot;
  ok(s.tracks[0].clips[0].input === 40 && !logs.length, 'Start=0: no shift, nothing logged');
  raw = rawTimeline(); raw.video.push({ n: 3, enabled: false, items: raw.video[0].items }, { n: 4, enabled: true, locked: true, items: raw.video[0].items }, { n: 5, enabled: true, locked: false, items: [] });
  raw.video.push({ n: 6, enabled: true, locked: false, items: [{ id: 'c', type: 'video', start: TL0, end: TL0 + 200, srcStart: 0, srcEnd: 200, mpi: { id: 'cc', path: '', type: 'Compound Clip' } }] });
  s = L.buildSnapshot(raw, { fileExists: EXISTS }).snapshot;
  eq(s.skipped, ['V3 disabled', 'V4 locked', 'V5 empty'], 'disabled/locked/empty tracks skipped');
  ok(s.tracks.find((t) => t.index === 5).clips[0].supported === false, 'compound clip unsupported');
  raw = rawTimeline(); raw.audio.push(Object.assign({}, raw.audio[0], { start: TL0 + 100, end: TL0 + 300 }));
  throws(() => L.buildSnapshot(raw, { fileExists: EXISTS }), /overlap/, 'A1 overlap stops');
  raw = rawTimeline(); raw.audio[0].enabled = false;
  throws(() => L.buildSnapshot(raw, { fileExists: EXISTS }), /A1 is empty/, 'disabled A1 stops');
  raw = rawTimeline(); raw.audio[0].mpi = null;
  throws(() => L.buildSnapshot(raw, { fileExists: EXISTS }), /without a media file/, 'A1 compound stops');
  raw = rawTimeline(); raw.audioTracks = 0;
  throws(() => L.buildSnapshot(raw, { fileExists: EXISTS }), /No audio track/, 'no A1');
  raw = rawTimeline(); raw.audio = {}; raw.video = {};                 // Lua empty arrays arrive as {}
  throws(() => L.buildSnapshot(raw, { fileExists: EXISTS }), /A1 is empty/, 'empty Lua tables handled');
  console.log('PASS read rules: transitions (M4), speed (M5), Start never subtracted (10 s and 0), track rules, A1 errors');
}
{
  const snap = { fps: 25, tlStart: TL0 };
  eq(L.dropRenderSettings({ start: 43.76, end: 74, time: 58.88 }, 1, snap, 'C:\\Users\\me\\Videos\\R Project Best Drops'), { SelectAllFrames: false, MarkIn: 87494, MarkOut: 88249,
    TargetDir: 'C:/Users/me/Videos/R Project Best Drops', CustomName: 'Best Drop 01 - 000059', UseUniqueFilenames: false, ExportVideo: true, ExportAudio: true }, 'drop render settings (DaVinci suffix off, L-3)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-unit-names-'));
  fs.writeFileSync(path.join(dir, 'Best Drop 01 - 000059.mp4'), 'x'); fs.writeFileSync(path.join(dir, 'Best Drop 01 - 000059 (2).mp4'), 'x');
  const taken = new Set();
  eq([L.freeName(dir, 'Best Drop 01 - 000059', taken), L.freeName(dir, 'Best Drop 01 - 000059', taken), L.freeName(dir, 'Best Drop 02 - 000130', taken)],
    ['Best Drop 01 - 000059 (3)', 'Best Drop 01 - 000059 (4)', 'Best Drop 02 - 000130'], 'free file names: existing files and this batch (L-3)');
  eq(L.clockName(3725.4), '010205', 'clock name');
  ok(L.defaultDropFolder() === path.join(os.homedir(), 'Videos', 'R Project Best Drops'), 'default folder Videos');
  console.log('PASS Best Drops settings: Mark In/Out frames, engine-chosen free names, forward-slash folder');
}

// ------------------------------------------------------------------ mixed frame rates: integer source frames, no drift
for (const [tlRate, clipRate] of [['29.97', '23.976'], ['23.976', '29.97']]) {
  const tlFps = L.parseFps(tlRate), ratio = L.parseFps(clipRate) / tlFps, N = 3000;
  const mk = (id, s, e, src, m) => ({ id, name: id, type: 'video', start: TL0 + s, end: TL0 + e, duration: e - s, srcStart: src, srcEnd: src + Math.round((e - s) * ratio), enabled: true, mpi: m });
  const ma = { id: 'ma', path: 'C:/a.mov', fps: clipRate, type: 'Video' }, mb = { id: 'mb', path: 'C:/b.mov', fps: clipRate, type: 'Video' };
  // V1: two clips meeting at record frame 1001 (an odd boundary); clip 2 continues the same media where clip 1 ends.
  const s1 = 5000, s2 = s1 + Math.round(1001 * ratio);
  const raw = { project: 'P', projectFps: '24', timeline: { id: 'tl-m', name: 'Mixed', start: TL0, end: TL0 + N, settings: { timelineFrameRate: tlRate } }, timelineNames: [], audioTracks: 1,
    audio: [Object.assign(mk('m', 0, N, 0, { id: 'mm', path: 'C:/m.wav', fps: clipRate, type: 'Audio' }), { type: 'audio' })],
    video: [{ n: 1, enabled: true, locked: false, items: [mk('a1', 0, 1001, s1, ma), mk('a2', 1001, N, s2, ma)] }, { n: 2, enabled: true, locked: false, items: [mk('b', 0, N, 777, mb)] }] };
  const { snapshot, refs } = L.buildSnapshot(raw, { fileExists: EXISTS });
  // irregular intervals (in seconds from frame boundaries), cameras alternating V1/V2 and a run of V1 across the clip edge
  const bounds = [0, 7, 18, 31, 44, 58, 333, 700, 999, 1003, 1500, 2222, 2999.5, N].map((f) => f / tlFps);
  const cams = [0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0];
  const plan = { intervals: cams.map((c, i) => ({ id: i, start: bounds[i], end: bounds[i + 1] })), choices: cams.map((c, i) => ({ id: i, camera: c })) };
  const { infos } = L.planSegments(plan, snapshot, refs, 0);
  ok(infos.every((i) => Number.isInteger(i.startFrame) && Number.isInteger(i.endFrame)), tlRate + '/' + clipRate + ': source frames are whole numbers');
  let rec = 0;
  for (const i of infos) {
    ok(i.recordFrame === rec, 'record positions contiguous'); rec += i._length;
    const clipStart = i.path === 'C:/b.mov' ? 0 : i.recordFrame >= 1001 ? 1001 : 0, src0 = i.path === 'C:/b.mov' ? 777 : i.recordFrame >= 1001 ? s2 : s1;
    const R = (x) => Math.round(x + 1e-9);   // exact .5 boundaries (e.g. 777 + 2222 * 1.25) round up, as in resolve-logic
    ok(i.startFrame === R(src0 + (i.recordFrame - clipStart) * ratio) && i.endFrame === R(src0 + (i.recordFrame + i._length - clipStart) * ratio),
      'boundaries rounded from their exact positions (no cumulative drift): ' + JSON.stringify([tlRate, i.path, i.recordFrame, i._length, i.startFrame, i.endFrame, src0, clipStart, ratio]));
  }
  ok(rec === N, 'whole timeline covered');
  const v1 = infos.filter((i) => i.trackIndex === 1);
  const edge = v1.findIndex((i) => i.recordFrame + i._length === 1001);
  ok(edge >= 0 && v1[edge + 1].recordFrame === 1001 && v1[edge].endFrame === v1[edge + 1].startFrame, 'adjacent clips on V1 meet exactly at the clip edge: no overlap, no gap (' + v1[edge].endFrame + ')');
  const music = L.musicInfos(snapshot, refs, 0)[0];
  ok(music.startFrame === 0 && music.endFrame === Math.round(N * ratio), 'music span rounded once from the exact length: ' + music.endFrame);
}
console.log('PASS mixed frame rates (29.97/23.976 and 23.976/29.97): integer source frames from exact boundaries, adjacent clips meet exactly');

// ------------------------------------------------------------------ lua-snippets
{
  eq(S.luaString('a"b\\c\nd\u00e9'), '"a\\"b\\\\c\\nd\\195\\169"', 'luaString escapes (UTF-8 as byte escapes)');
  eq(S.toLua({ a: [1, 2.5, 'x'], b: null, c: NaN, d: { in: 5 } }), '{["a"]={1, 2.5, "x"}, ["b"]=nil, ["c"]=nil, ["d"]={["in"]=5}}', 'toLua');
  const text = S.build('append', { timelineId: 't', items: [{ path: 'C:\\x "y".mp4' }] }, NONCE);
  eq(S.parseHeader(text), { op: 'append', args: { timelineId: 't', items: [{ path: 'C:\\x "y".mp4' }] } }, 'header round trip');
  eq(S.parseNonce(text), NONCE, 'nonce line');
  const lines = text.trimEnd().split('\n');
  ok(lines[1] === 'return "' + NONCE + '", function(resolve, RP)' && /^local A = /.test(lines[2]) && lines[lines.length - 1] === 'end', 'snippet shape: return nonce, function ... end');
  ok(!/[^\x00-\x7f]/.test(S.toLua({ s: 'é' })), 'Lua literal is pure ASCII');
  throws(() => S.build('format_c', {}, NONCE), /Unknown bridge operation/, 'unknown op refused');
  throws(() => S.build('ping', {}, ''), /nonce missing/, 'no nonce, no command');
  for (const op of ['append', 'delete_items', 'delete_timeline']) ok(/origId/.test(S.build(op, {}, NONCE)), op + ' guards the original timeline');
  for (const op of ['append', 'render_save', 'render_start']) ok(/GetUniqueId\(\) ~= id/.test(S.build(op, {}, NONCE)), op + ' verifies the current timeline id (M5/H1)');
  ok(/GetCurrentRenderFormatAndCodec"\) or \{\}/.test(S.build('render_cleanup', {}, NONCE)), 'format restore verified by reading it back (L-2)');
  console.log('PASS lua-snippets: escaping, nonce shape, original/current-timeline guards (' + S.OPS.length + ' ops)');
}

// ------------------------------------------------------------------ bridge
(async () => {
  const hex = (s) => Buffer.from(s, 'utf8').toString('hex');
  const helloOf = (id, extra) => id + ':' + hex(JSON.stringify(Object.assign({ product: 'DaVinci Resolve', project: 'é', nonce: NONCE }, extra || {})));
  const prefsText = (o) => '{\n Global = {\n  Other = { Response = "not-me", X = "{" },\n  RProjectBridge = {\n' + Object.keys(o).map((k) => '   ' + k + ' = "' + o[k] + '",').join('\n') + '\n  },\n },\n}\n';
  const keys = B.parsePrefs(prefsText({ Beat: 's1xabc:7:12:idle', Hello: helloOf('s1xabc'), Response: 's1xabc:6:' + hex('{"ok":true,"result":{"a":"}{"}}') }));
  ok(keys.Beat === 's1xabc:7:12:idle' && keys.Response.startsWith('s1xabc:6:'), 'parsePrefs reads only the RProjectBridge block');
  eq(B.parseHello(keys.Hello), { id: 's1xabc', info: { product: 'DaVinci Resolve', project: 'é', nonce: NONCE } }, 'Hello decoded (UTF-8)');
  eq(B.parseBeat(keys.Beat), { id: 's1xabc', next: 7, count: 12, state: 'idle' }, 'Beat parsed');
  const r = B.parseResponse(keys.Response);
  eq([r.id, r.n, JSON.parse(B.hexToString(r.hex))], ['s1xabc', 6, { ok: true, result: { a: '}{' } }], 'Response decoded');
  eq(B.parseResponse(''), null, 'cleared Response ignored');
  eq(B.parsePrefs('{ Global = { } }'), null, 'no block -> null');
  throws(() => B.hexToString('zz'), /not valid hex/, 'bad hex rejected');

  // folder security
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-unit-bridge-'));
  throws(() => B.secureDir('C:\\Users\\Public\\RProjectMulticam\\bridge'), /public command folder/, 'public folder refused');
  const real = path.join(base, 'real'); fs.mkdirSync(real);
  fs.symlinkSync(real, path.join(base, 'Profiles'), 'junction');
  throws(() => B.secureDir(path.join(base, 'Profiles', 'RProjectBridge')), /linked|redirected/, 'junction in the path refused');
  fs.mkdirSync(path.join(base, 'p2'));
  fs.symlinkSync(real, path.join(base, 'p2', 'RProjectBridge'), 'junction');
  throws(() => B.secureDir(path.join(base, 'p2', 'RProjectBridge')), /linked|redirected/, 'junction as the command folder refused');
  // M4: a redirected folder higher up (e.g. the whole profile on another drive) is fine
  fs.mkdirSync(path.join(real, 'Default'), { recursive: true });
  ok(B.secureDir(path.join(base, 'Profiles', 'Default', 'RProjectBridge')) && fs.existsSync(path.join(real, 'Default', 'RProjectBridge')), 'junction above Profiles\\Default is accepted (M4)');
  // M2: non-ASCII profile path -> ProgramData fallback with the same hash as the Lua side
  const pdBase = path.join(base, 'PD');
  const fb = B.bridgeDirFor('C:\\Users\\Ádám Ödön\\AppData\\Roaming\\Blackmagic Design\\DaVinci Resolve\\Support\\Fusion\\Profiles\\Default\\Fusion.prefs', pdBase);
  ok(fb === path.join(pdBase, 'RProjectMulticam', 'bridge-' + B.pathHash('c:/users/Ádám Ödön/appdata/roaming/blackmagic design/davinci resolve/support/fusion/profiles/default')), 'non-ASCII profile -> ProgramData\\RProjectMulticam\\bridge-<hash>: ' + fb);
  ok(B.pathHash('abc') === '0b885c8b001998f2', 'path hash is stable: ' + B.pathHash('abc'));
  ok(B.sameDir('C:\\X\\Profiles\\Default\\RProjectBridge', 'c:/x/profiles/default/RProjectBridge/'), 'folder comparison ignores slashes and case');
  ok(B.bridgeDirFor('C:\\X\\Profiles\\Default\\Fusion.prefs') === path.join('C:\\X\\Profiles\\Default', 'RProjectBridge'), 'command folder = Fusion.prefs folder + RProjectBridge');

  // session handling
  const prefsPath = path.join(base, 'Default', 'Fusion.prefs'); fs.mkdirSync(path.dirname(prefsPath));
  const dir = B.bridgeDirFor(prefsPath);
  fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'cmd-old-1.lua'), 'x'); fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');
  const write = (o) => { fs.writeFileSync(prefsPath, prefsText(o)); };
  let st = { Hello: helloOf('s1xabc'), Beat: 's1xabc:7:12:idle', Response: '' };
  write(st);
  const br = new B.Bridge({ prefsPath, pollMs: 10, staleMs: 400, timeouts: { snapshot: 300 } });
  br.poll();
  ok(br.helloId === 's1xabc' && br.next === 7 && !br.status().connected, 'stale Hello at engine start: not connected until the heartbeat moves (M1)');
  await assert.rejects(br.call('ping', {}), /not connected/); checks++;
  br.started = true;
  st.Beat = 's1xabc:7:13:idle'; write(st); br.poll();
  ok(br.status().connected && !('nonce' in br.status().info), 'heartbeat moved -> connected; nonce not exposed');
  ok(!fs.existsSync(path.join(dir, 'cmd-old-1.lua')) && fs.existsSync(path.join(dir, 'keep.txt')), 'stale cmd files removed, other files kept');
  // answered call
  const answer = (n, payload, beatN) => setTimeout(() => { st.Response = 's1xabc:' + n + ':' + hex(JSON.stringify(payload)); st.Beat = 's1xabc:' + beatN + ':' + (++beatCount) + ':idle'; write(st); }, 40);
  let beatCount = 13;
  let p = br.call('snapshot', {});
  const file7 = path.join(dir, 'cmd-s1xabc-7.lua');
  ok(fs.existsSync(file7) && S.parseNonce(fs.readFileSync(file7, 'utf8')) === NONCE && br.next === 8, 'command written as cmd-<id>-7.lua with the session nonce');
  answer(7, { ok: true, result: { x: 1 } }, 8);
  eq(await p, { x: 1 }, 'call resolves with the decoded result'); checks++;
  ok(!fs.existsSync(file7), 'answered command file deleted');
  ok(fs.existsSync(path.join(dir, 'ack-s1xabc-7')), 'answer acknowledged with ack-<id>-<n> so the bridge can clear the Response (L1)');
  // torn Response (Q3): bad hex first, then the real answer
  p = br.call('snapshot', {});
  setTimeout(() => { st.Response = 's1xabc:8:7b22'; write(st); }, 20);
  answer(8, { ok: true, result: { y: 2 } }, 9);
  eq(await p, { y: 2 }, 'torn response retried, not failed (Q3)'); checks++;
  ok(!fs.existsSync(path.join(dir, 'ack-s1xabc-7')) && fs.existsSync(path.join(dir, 'ack-s1xabc-8')), 'previous ack removed with the next command');
  // error from Lua
  p = br.call('snapshot', {});
  answer(9, { ok: false, error: 'Open a timeline in DaVinci Resolve first.' }, 10);
  await assert.rejects(p, /DaVinci: Open a timeline/); checks++;
  // timeout without pickup -> number reused (H1)
  await assert.rejects(br.call('snapshot', {}), /did not answer/); checks++;
  ok(br.next === 10 && !fs.existsSync(path.join(dir, 'cmd-s1xabc-10.lua')), 'unanswered command removed, number 10 reused (H1)');
  // Beat is the source of truth when idle (H1)
  br.next = 25; st.Beat = 's1xabc:10:' + (++beatCount) + ':idle'; write(st); br.poll();
  ok(br.next === 10, 'counter re-synced from Beat');
  // same id restarted (Beat count down) -> reset (H2)
  st.Beat = 's1xabc:1:1:hello'; write(st); br.poll();
  ok(br.next === 1, 'restarted bridge with the same id -> numbering 1 (H2)');
  // new Hello -> new session
  st = { Hello: helloOf('s2xdef', { nonce: 'f'.repeat(32) }), Beat: 's2xdef:1:1:hello', Response: '' }; write(st); br.poll();
  ok(br.helloId === 's2xdef' && br.nonce === 'f'.repeat(32) && br.next === 1 && br.status().connected, 'new Hello -> new session, new nonce, numbering 1');
  // heartbeat stops
  await new Promise((res) => setTimeout(res, 500));
  ok(!br.status().connected, 'no heartbeat for staleMs -> not connected');
  // M2: DaVinci reports a different command folder -> clear error instead of timeouts
  st = { Hello: helloOf('s3xaaa', { dir: 'C:/Somewhere/Else/RProjectBridge' }), Beat: 's3xaaa:1:1:hello', Response: '' }; write(st); br.poll();
  ok(!br.status().connected && /command folder/.test(br.status().error), 'folder mismatch reported: ' + br.status().error);
  await assert.rejects(br.call('ping', {}), /command folder/); checks++;
  st = { Hello: helloOf('s4xbbb', { dir: dir.toUpperCase().replace(/\\/g, '/') }), Beat: 's4xbbb:1:1:hello', Response: '' }; write(st); br.poll();
  ok(br.status().connected && !br.status().error, 'same folder in another spelling (case, slashes) is accepted');
  // M3: Resolve closed while a command is pending -> fail fast
  const prefs3 = path.join(base, 'D3', 'Fusion.prefs'); fs.mkdirSync(path.dirname(prefs3));
  fs.writeFileSync(prefs3, prefsText({ Hello: helloOf('s5xccc'), Beat: 's5xccc:1:1:hello', Response: '' }));
  let procChecks = 0;
  const br3 = new B.Bridge({ prefsPath: prefs3, pollMs: 10, deadAfterMs: 200, isResolveRunning: async () => { procChecks++; return false; } });
  br3.started = true; br3.poll();
  const t3 = Date.now();
  await assert.rejects(br3.call('snapshot', {}), /DaVinci Resolve closed while "snapshot"/); checks++;
  ok(Date.now() - t3 < 3000 && procChecks >= 1, 'no prefs activity + no Resolve process -> failed after ' + (Date.now() - t3) + ' ms, not after the 600 s timeout');
  const br4 = new B.Bridge({ prefsPath: prefs3, pollMs: 10, deadAfterMs: 200, timeouts: { snapshot: 800 }, isResolveRunning: async () => true });
  fs.writeFileSync(prefs3, prefsText({ Hello: helloOf('s6xddd'), Beat: 's6xddd:1:1:hello', Response: '' }));
  br4.started = true; br4.poll();
  await assert.rejects(br4.call('snapshot', {}), /did not answer/); checks++;
  ok(true, 'a busy but running Resolve is not taken for closed (waits for the normal timeout)');
  console.log('PASS bridge: prefs parsing, folder security (public/junction/higher junction ok), non-ASCII fallback, M1 stale hello, nonce, ack (L1), call/answer/torn/error/timeout reuse, Beat re-sync, restarts, folder mismatch (M2), Resolve closed (M3)');

  // ------------------------------------------------------------------ workflow guards with a fake bridge
  const logs = [];
  const s = new Session({ bridge: { call: async () => ({}) }, log: (x) => logs.push(x) });
  s.busy = 'Analyze Music';
  const res = await s.run('Create Multicam Edit', async () => 1);
  ok(res.busy && logs.some((x) => /Busy/.test(x)), 'busy guard');
  const { snapshot, refs } = L.buildSnapshot(rawTimeline(), { fileExists: EXISTS });
  const calls = [];
  const fake = (answers) => ({ call: async (op, args) => { calls.push({ op, args }); const a = answers[op]; return typeof a === 'function' ? a(args) : a; } });
  const s2 = new Session({ bridge: fake({ create_timeline: { id: 'tl-2', start: 86400, fps: '24', setCurrent: true, currentId: 'tl-2', video: 2 }, delete_timeline: { deleted: true } }) });
  await assert.rejects(s2.apply(PLAN, snapshot, refs), /could not be set to 25/); checks++;
  ok(calls.map((c) => c.op).join() === 'create_timeline,delete_timeline' && calls[1].args.id === 'tl-2' && calls[1].args.origId === 'tl-1', 'H2: only the new timeline deleted');
  ok(calls[0].args.settings.timelineFrameRate === '25' && calls[0].args.settings.timelineDropFrameTimecode === '0', 'settings copied incl. drop frame (L1)');
  calls.length = 0;
  const s3 = new Session({ bridge: fake({ create_timeline: { id: 'tl-2', start: 86400, fps: '25', setCurrent: false, currentId: 'tl-1', video: 2 } }) });
  await assert.rejects(s3.apply(PLAN, snapshot, refs), /nothing was appended/); checks++;
  ok(!calls.some((c) => c.op === 'append'), 'H1: no append when the new timeline is not current');
  // render_start fails -> cleanup still runs with what render_save read (L6)
  calls.length = 0;
  const rawReal = rawTimeline(); rawReal.audio[0].mpi.path = __filename; rawReal.video.forEach((t) => t.items.forEach((i) => { i.mpi.path = __filename; }));
  const s4 = new Session({ bridge: fake({ snapshot: rawReal, render_save: { format: { format: 'mov', codec: 'ProRes422' }, mode: 0, marks: {} },
    render_start: () => { throw Error('DaVinci: boom'); }, render_cleanup: { deleted: 0, formatRestored: true, modeRestored: true, marksRestored: true, notRestored: [] } }), log: () => {} });
  s4.analysis = { signature: L.buildSnapshot(rawReal).snapshot.a1.signature, map: null };
  const cliDrops = require('../rp-engine-cli.js');
  const orig = cliDrops.cmdDrops; cliDrops.cmdDrops = async () => ({ total: 1, drops: [{ index: 1, time: 4, start: 2, end: 6 }] });
  try { await assert.rejects(s4.bestDrops(1, fs.mkdtempSync(path.join(os.tmpdir(), 'rp-unit-drops-'))), /boom/); checks++; }
  finally { cliDrops.cmdDrops = orig; }
  ok(calls.map((c) => c.op).join() === 'snapshot,render_save,render_start,render_cleanup' && calls[3].args.saved.format.format === 'mov', 'cleanup runs with the saved format even when render_start fails (L6)');
  console.log('PASS workflow: busy guard, H1/H2 guards, render cleanup always runs');
  console.log('ALL PASS (' + checks + ' checks)');
})().catch((e) => { console.error(e); process.exit(1); });
