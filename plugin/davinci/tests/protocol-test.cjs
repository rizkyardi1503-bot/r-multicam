// Protocol test: R Project Engine (HTTP API + bridge + workflow + real music engine) against a Node mock DaVinci that
// reads the cmd files (checking the session nonce) and answers through a Fusion.prefs-style file. Druva 120 s timeline.
// Usage: node tests/protocol-test.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), assert = require('assert');
const { start } = require('../rp-davinci-engine.js');
const { MockDaVinci } = require('./mock-davinci');
const { druvaModel, T0, CAMS, TL0 } = require('./druva-model');
const snippets = require('../lib/lua-snippets');
const { allowAll } = require('./fake-account');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-protocol-'));
let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };

function req(eng, method, p, body, headers, raw) {
  return new Promise((resolve, reject) => {
    const data = raw != null ? raw : body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: eng.port, method, path: p, headers: Object.assign({ Host: '127.0.0.1:' + eng.port },
      data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers || {}) }, (res) => {
      let s = ''; res.on('data', (c) => { s += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: s.startsWith('{') ? JSON.parse(s) : s }));
    });
    r.on('error', (e) => resolve({ status: 0, error: e.code }));
    if (data) r.write(data); r.end();
  });
}
const api = (eng, p, body) => req(eng, body ? 'POST' : 'GET', p + '?t=' + eng.token, body);
const status = async (eng) => (await api(eng, '/api/status')).body;
async function waitFor(fn, ms = 20000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw Error('timeout waiting'); await new Promise((r) => setTimeout(r, 30)); } }
const paths = (name) => { const prefsPath = path.join(ROOT, name, 'Profiles', 'Default', 'Fusion.prefs'); fs.mkdirSync(path.dirname(prefsPath), { recursive: true }); return { prefsPath, dir: path.join(path.dirname(prefsPath), 'RProjectBridge') }; };

async function scenario(name, model, options, fn, engOpts) {
  const { prefsPath, dir } = paths(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cmd-oldsession-1.lua'), 'error("stale")');      // left over from an earlier session
  const dv = new MockDaVinci({ prefsPath, model, options }).start();
  const eng = await start(Object.assign({ account: allowAll(), prefsPath, pollMs: 20, quiet: true, awaitActions: true, renderPollMs: 10 }, engOpts || {}));
  try { await waitFor(async () => (await status(eng)).bridge.connected); await fn(eng, dv, dir); }
  finally { await eng.close(); dv.stop(); }
}

(async () => {
  // ---------------------------------------------------------------- full flow
  await scenario('main', druvaModel(), {}, async (eng, dv, dir) => {
    ok(!fs.existsSync(path.join(dir, 'cmd-oldsession-1.lua')), 'stale cmd file of an earlier bridge session removed');
    // security
    ok((await req(eng, 'GET', '/api/status')).status === 403, 'no token -> 403');
    ok((await req(eng, 'GET', '/api/status?t=' + eng.token, null, { Host: 'evil.example:80' })).status === 403, 'foreign Host header -> 403');
    ok((await req(eng, 'POST', '/api/refresh?t=' + eng.token, {}, { Origin: 'http://evil.example' })).status === 403, 'foreign Origin on POST -> 403');
    const big = await req(eng, 'POST', '/api/refresh?t=' + eng.token, null, null, JSON.stringify({ x: 'y'.repeat(1100000) }));
    ok(big.status === 413 || big.status === 0, '1.1 MB body -> 413 / connection closed (' + (big.status || big.error) + ')');
    const pageRes = await req(eng, 'GET', '/?t=' + eng.token);
    ok(pageRes.body.includes('Create Multicam Edit') && pageRes.headers['referrer-policy'] === 'no-referrer', 'UI page served with Referrer-Policy: no-referrer');
    ok(!/innerHTML/.test(pageRes.body) && /new Option\(/.test(pageRes.body) && /\[page\]/.test(pageRes.body), 'page builds the camera list with new Option and logs every click');
    ok(!JSON.stringify((await status(eng)).bridge.info).includes(dv.nonce), 'nonce never leaves the engine (status API)');
    // read timeline
    await api(eng, '/api/refresh', {});
    let s = await status(eng);
    ok(s.lastResult.ok, 'refresh ok: ' + JSON.stringify(s.lastResult));
    ok(JSON.stringify(s.cameras.map((c) => c.index)) === '[0,1,2,3,4]', 'cameras V1-V5 (V6 locked skipped): ' + JSON.stringify(s.cameras));
    ok(s.lastResult.ok && !eng.lines.some((l) => /speed change/.test(l.text)), 'WAV labelled 24 fps on a 25 fps timeline is not a speed change');
    // analyze
    await api(eng, '/api/analyze', {});
    s = await status(eng);
    ok(s.lastResult.ok && s.analysis.bpm === 127, 'Analyze Music: BPM ' + (s.analysis && s.analysis.bpm));
    console.log('PASS analyze via bridge: BPM ' + s.analysis.bpm + ', drops ' + s.analysis.drops + ', energy ' + s.analysis.energy + ', drop score ' + s.analysis.dropScore);
    // multicam
    const nOps = dv.ops.length;
    await api(eng, '/api/multicam', { roles: 'Master Wide\nCrowd\nDJ Close-Up\nDrone', cadences: [4, 6, 8], dropCamera: '', vision: false });
    s = await status(eng);
    ok(s.lastResult.ok, 'Create Multicam Edit ok: ' + JSON.stringify(s.lastResult));
    const r = s.lastResult.result;
    ok(r.name === 'Druva test - Multicam AI' && r.failed === 0 && r.mismatches === 0 && r.gaps === 0, 'result: ' + JSON.stringify(r));
    const ops = dv.ops.slice(nOps).map((o) => o.op);
    ok(JSON.stringify(ops) === JSON.stringify(['snapshot', 'create_timeline', 'append']), 'command sequence (one batched append, no calibration): ' + ops.join(','));
    const created = dv.ops.find((o) => o.op === 'create_timeline').args;
    ok(created.settings.timelineFrameRate === '25' && created.settings.timelineDropFrameTimecode === '0' && created.origId === 'tl-orig' && created.videoTracks === 4, 'new timeline settings (H2, L1): ' + JSON.stringify(created));
    const newTl = dv.model.timelines.find((t) => t.name === 'Druva test - Multicam AI');
    ok(newTl.fps === '25', 'new timeline at 25 fps although the project is 24 fps');
    const app = dv.appends.filter((a) => a.timelineId === newTl.id);
    ok(dv.appends.every((a) => a.timelineId !== 'tl-orig'), 'no append into the original timeline');
    const music = app.filter((a) => a.mediaType === 2), video = app.filter((a) => a.mediaType === 1);
    ok(music.length === 1 && music[0].trackIndex === 1 && music[0].recordFrame === TL0 && music[0].startFrame === T0 * 24 && music[0].endFrame === T0 * 24 + 2880,
      'music on A1 in the WAV\'s 24 fps source frames, EXCLUSIVE endFrame (2880 = 3000 record frames): ' + JSON.stringify(music[0]));
    let cursor = TL0, total = 0;
    for (const v of video) {
      const cam = v.trackIndex - 1, len = v.endFrame - v.startFrame;
      ok(cam >= 0 && cam <= 3, 'trackIndex on V1-V4 (never compound V5): ' + v.trackIndex);
      ok(v.recordFrame === cursor, 'video infos contiguous');
      ok(v.startFrame === Math.round((T0 - CAMS[cam][1]) * 25) + (v.recordFrame - TL0), 'startFrame = source start + offset');
      ok(len > 0 && Number.isInteger(len), 'endFrame exclusive: length = endFrame - startFrame');
      ok(v.mpiId === 'mpi-cam' + (cam + 1), 'media pool item id passed');
      cursor += len; total += len;
    }
    ok(total === 3000, 'video covers 3000 frames');
    ok(newTl.video.flatMap((t) => t.items).length === video.length && newTl.audio[0].items.length === 1 && newTl.audio[0].items[0].end - newTl.audio[0].items[0].start === 3000, 'all clips on the new timeline, music 3000 frames');
    ok(JSON.stringify(dv.model.timelines[0]) === dv.origSnapshotJson, 'original timeline unchanged (deep compare)');
    console.log('PASS multicam via bridge: ' + video.length + ' camera clips + 1 music clip in 1 append command; endFrame exclusive; WAV in 24 fps source frames; original unchanged');
    // best drops: renders the CURRENT timeline (now the new one), free file name, restores format + mode + marks, deletes jobs
    newTl.marks = { video: { in: 5, out: 50 } };
    dv.renderMode = 0;
    const folder = path.join(ROOT, 'drops');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'Best Drop 01 - 000059.mp4'), 'earlier render');
    const n0 = dv.ops.length;
    await api(eng, '/api/drops', { count: 3, folder });
    s = await status(eng);
    ok(s.lastResult.ok && s.lastResult.result.complete === 1, 'Best Drops ok: ' + JSON.stringify(s.lastResult));
    ok(JSON.stringify(dv.ops.slice(n0).map((o) => o.op)) === JSON.stringify(['snapshot', 'render_save', 'render_start', 'render_poll', 'render_poll', 'render_cleanup']), 'render steps: ' + dv.ops.slice(n0).map((o) => o.op).join(','));
    const job = dv.renders[0];
    ok(job.timelineId === newTl.id && job.MarkIn === TL0 + Math.round(43.76 * 25) && job.MarkOut === TL0 + Math.round(74 * 25) - 1, 'render range: ' + JSON.stringify(job));
    ok(job.CustomName === 'Best Drop 01 - 000059 (2)' && job.UseUniqueFilenames === false && job.TargetDir === folder.replace(/\\/g, '/') && job.SelectAllFrames === false,
      'free file name chosen by the engine, DaVinci suffix off (L-3): ' + job.CustomName);
    ok(JSON.stringify(dv.model.renderFormat) === JSON.stringify({ format: 'mov', codec: 'ProRes422' }) && dv.renderMode === 0, 'render format and render mode restored (L-2)');
    ok(JSON.stringify(newTl.marks) === JSON.stringify({ video: { in: 5, out: 50 } }), 'Mark In/Out restored: ' + JSON.stringify(newTl.marks));
    ok(JSON.stringify(dv.deletedJobs) === '["job-1"]', 'finished job removed from the render queue');
    ok(eng.lines.some((l) => /Deliver page now keeps Best Drops values/.test(l.text)), 'page log names the Deliver settings that stay changed (M4)');
    ok(JSON.stringify(dv.model.timelines[0]) === dv.origSnapshotJson, 'original timeline still unchanged');
    console.log('PASS Best Drops via bridge: ' + job.CustomName + ' MarkIn ' + job.MarkIn + ' MarkOut ' + job.MarkOut + '; format + mode + marks restored; job deleted');
    // busy guard
    const both = await Promise.all([api(eng, '/api/analyze', {}), api(eng, '/api/analyze', {})]);
    ok(both.some((x) => x.status === 409), 'second action while busy -> 409');
    await waitFor(async () => !fs.readdirSync(dir).some((f) => f.endsWith('.lua')));
    ok(true, 'processed cmd files removed');
    // SSE cap
    const streams = [];
    for (let i = 0; i < 9; i++) streams.push(await new Promise((res) => { const q = http.get({ host: '127.0.0.1', port: eng.port, path: '/api/events?t=' + eng.token, headers: { Host: '127.0.0.1:' + eng.port } }, (rs) => res({ q, rs })); }));
    ok(streams.filter((x) => x.rs.statusCode === 200).length === 8 && streams[8].rs.statusCode === 429, 'at most 8 live log streams');
    streams.forEach((x) => x.q.destroy());
    // disconnect
    await api(eng, '/api/disconnect', {});
    await waitFor(async () => dv.ops.some((o) => o.op === 'stop'));
    await waitFor(async () => !(await status(eng)).bridge.connected);
    ok(true, 'stop command ends the bridge; status shows disconnected');
  });

  // ---------------------------------------------------------------- sessions and numbering
  {
    const { prefsPath, dir } = paths('sessions');
    const dv = new MockDaVinci({ prefsPath, model: druvaModel() }).start();
    let eng = await start({ account: allowAll(), prefsPath, pollMs: 20, quiet: true, awaitActions: true, timeouts: { snapshot: 400 } });
    await waitFor(async () => (await status(eng)).bridge.connected);
    await api(eng, '/api/refresh', {}); await api(eng, '/api/refresh', {});
    await eng.close();
    eng = await start({ account: allowAll(), prefsPath, pollMs: 20, quiet: true, awaitActions: true, timeouts: { snapshot: 400 } });
    await waitFor(async () => (await status(eng)).bridge.connected);
    ok(eng.bridge.next === 3, 'restarted engine continues at command 3 (from Beat): ' + eng.bridge.next);
    // H1: a command the bridge never picked up (timeout) is not counted; its number is reused
    dv.paused = true;
    await api(eng, '/api/refresh', {});
    ok(/did not answer/.test((await status(eng)).lastResult.error) && eng.bridge.next === 3 && !fs.existsSync(path.join(dir, 'cmd-' + dv.id + '-3.lua')), 'timed-out command removed and number 3 reused (H1)');
    dv.paused = false;
    await api(eng, '/api/refresh', {});
    ok((await status(eng)).lastResult.ok && dv.ops.length === 3, 'command 3 answered after the timeout');
    // H1: engine counter ahead of the bridge -> Beat wins
    eng.bridge.next = 9;
    await waitFor(async () => eng.bridge.next === 4, 3000);
    ok(true, 'engine counter re-synced from Beat (9 -> 4)');
    // H2: same id, restarted loop (Beat count goes down) -> numbering restarts at 1
    dv.stop();
    const dv2 = new MockDaVinci({ prefsPath, model: druvaModel() });
    dv2.nonce = dv.nonce; dv2.id = dv.id;
    dv2.start();
    await waitFor(async () => eng.bridge.next === 1, 5000);
    await api(eng, '/api/refresh', {});
    ok((await status(eng)).lastResult.ok && dv2.ops.length === 1, 'restarted bridge with the same id: numbering restarts at 1 (H2)');
    // new session (Session counter in the id) -> numbering restarts at 1, stale files cleaned
    dv2.stop();
    const dv3 = new MockDaVinci({ prefsPath, model: druvaModel(), session: 2 }).start();
    await waitFor(async () => eng.bridge.helloId === dv3.id);
    ok(eng.bridge.next === 1, 'new bridge session restarts numbering at 1');
    await api(eng, '/api/refresh', {});
    ok((await status(eng)).lastResult.ok && dv3.ops.length === 1, 'new session answers command 1');
    // forged command (wrong nonce) is rejected by the bridge
    fs.writeFileSync(path.join(dir, 'cmd-' + dv3.id + '-2.lua'), snippets.build('ping', {}, '0'.repeat(32)));
    await waitFor(async () => dv3.rejected === 1);
    ok(dv3.ops.length === 1, 'command with a wrong nonce rejected, not executed');
    await eng.close(); dv3.stop();
    // M1: stale Hello/Beat left in the prefs (DaVinci closed) is not "connected"
    fs.writeFileSync(prefsPath, fs.readFileSync(prefsPath, 'utf8').replace(/:stopped"/, ':idle"'));   // looks alive, never moves
    const eng2 = await start({ account: allowAll(), prefsPath, pollMs: 20, quiet: true });
    await new Promise((r) => setTimeout(r, 700));
    ok(!(await status(eng2)).bridge.connected, 'stale Hello/Beat without a moving heartbeat is not connected (M1)');
    await eng2.close();
    console.log('PASS sessions: restart resumes from Beat; timeout reuses n; Beat re-syncs counter; same-id restart and new session reset to 1; wrong nonce rejected; stale prefs not connected');
  }

  // ---------------------------------------------------------------- H2: frame rate cannot be set -> only the new timeline is deleted
  await scenario('fpslock', druvaModel(), { lockFps: true }, async (eng, dv) => {
    await api(eng, '/api/multicam', { roles: '', cadences: [4, 6, 8] });
    const s = await status(eng);
    ok(!s.lastResult.ok && /could not be set to 25/.test(s.lastResult.error), 'fps mismatch stops with a clear error: ' + s.lastResult.error);
    ok(JSON.stringify(dv.deletedTimelines) === '["tl-new-1"]' && dv.model.timelines.length === 1 && dv.appends.length === 0, 'only the new timeline deleted, nothing appended');
    console.log('PASS H2: fps mismatch -> new timeline deleted, original kept, nothing appended');
  });
  // ---------------------------------------------------------------- H1: new timeline did not become current
  await scenario('noswitch', druvaModel(), { noSwitch: true }, async (eng, dv) => {
    await api(eng, '/api/multicam', { roles: '' });
    const s = await status(eng);
    ok(!s.lastResult.ok && /nothing was appended/.test(s.lastResult.error) && dv.appends.length === 0, 'not current -> stop, no append: ' + s.lastResult.error);
    console.log('PASS H1: new timeline not current -> nothing appended');
  });
  // ---------------------------------------------------------------- M2: an inclusive endFrame is reported, never auto-flipped
  await scenario('inclusive', druvaModel(), { inclusive: true }, async (eng, dv) => {
    await api(eng, '/api/multicam', { roles: '' });
    const s = await status(eng);
    ok(s.lastResult.ok && s.lastResult.result.mismatches > 0 && !dv.ops.some((o) => o.op === 'delete_items'), 'mismatches reported, no flip/delete: ' + JSON.stringify(s.lastResult.result));
    ok(eng.lines.some((l) => /MISMATCH on V\d .*length/.test(l.text)), 'mismatch lines in the log');
    console.log('PASS M2: wrong lengths are logged as mismatches; no automatic endFrame flip');
  });
  // ---------------------------------------------------------------- Q1: source in-point differs -> loud mismatch
  await scenario('srcshift', druvaModel(), { srcShift: 3 }, async (eng) => {
    await api(eng, '/api/multicam', { roles: '' });
    const s = await status(eng);
    ok(s.lastResult.ok && s.lastResult.result.mismatches > 0 && eng.lines.some((l) => /SOURCE IN/.test(l.text)), 'source in-point mismatch counted and logged (Q1)');
    console.log('PASS Q1: placed clip with a different source in-point -> "SOURCE IN" mismatch');
  });
  // ---------------------------------------------------------------- L4: partial batch matched by (track, start)
  await scenario('partial', druvaModel(), { dropEvery: 2 }, async (eng) => {
    await api(eng, '/api/multicam', { roles: '' });
    const s = await status(eng);
    const res = s.lastResult.result;
    ok(s.lastResult.ok && res.failed > 0 && res.mismatches === 0 && res.placed + res.failed === 45, 'partial batch: placed clips matched by track/start, no false mismatches: ' + JSON.stringify(res));
    console.log('PASS L4: partial AppendToTimeline result matched by (track, start)');
  });
  // ---------------------------------------------------------------- H3: blank roles, V1 and V3 only
  {
    const m = druvaModel(), t = m.timelines[0];
    t.video = [t.video[0], { enabled: true, locked: false, items: [] }, t.video[2]];
    await scenario('roles', m, {}, async (eng, dv) => {
      await api(eng, '/api/multicam', { roles: '   ' });
      const s = await status(eng);
      ok(s.lastResult.ok, 'multicam ok: ' + JSON.stringify(s.lastResult));
      const tracks = [...new Set(dv.appends.filter((a) => a.mediaType === 1).map((a) => a.trackIndex))].sort();
      ok(JSON.stringify(tracks) === '[1,3]', 'blank roles use V1 and V3 (V2 empty): ' + JSON.stringify(tracks));
      console.log('PASS H3: blank roles -> clips on V1 and V3');
    });
  }
  // ---------------------------------------------------------------- M3 + L7: render never finishes; an in-only mark cannot be restored
  await scenario('stuck', druvaModel(), { stuck: true }, async (eng, dv) => {
    dv.model.timelines[0].marks = { video: { in: 10 } };
    await api(eng, '/api/drops', { count: 1, folder: path.join(ROOT, 'drops2') });
    const polls = dv.ops.filter((o) => o.op === 'render_poll').length;
    ok(polls === 3 && dv.cleanups.length === 1 && JSON.stringify(dv.model.renderFormat) === '{"format":"mov","codec":"ProRes422"}', 'idle render: 3 polls then cleanup (' + polls + ')');
    ok(eng.lines.some((l) => /Could not restore video Mark In only/.test(l.text)), 'in-only mark that cannot be restored is logged (L7)');
    console.log('PASS M3/L7: idle render queue -> stopped after 3 polls, format restored; in-only mark reported');
  });
  // ---------------------------------------------------------------- M3: DaVinci closed during a command -> fast, clear error
  await scenario('closed', druvaModel(), {}, async (eng, dv) => {
    dv.paused = true; clearInterval(dv.beatTimer);                    // Resolve is gone: no answers, no beats
    const t = Date.now();
    await api(eng, '/api/refresh', {});
    const s = (await api(eng, '/api/status')).body;
    ok(!s.lastResult.ok && /DaVinci Resolve closed while "snapshot"/.test(s.lastResult.error) && Date.now() - t < 5000, 'closed Resolve detected in ' + (Date.now() - t) + ' ms: ' + s.lastResult.error);
    console.log('PASS M3: DaVinci closed while a command runs -> "DaVinci Resolve closed while ..." after ' + (Date.now() - t) + ' ms');
  }, { isResolveRunning: async () => false, deadAfterMs: 500 });
  console.log('ALL PASS (' + checks + ' checks) · work folder ' + ROOT);
})().catch((e) => { console.error(e); process.exit(1); });
