// R Project Engine for Final Cut Pro: HTTP API, license gate, validation, and a real end-to-end run
// (generated media -> audio sync -> music analysis -> camera plan -> FCPXML). Needs ffmpeg. No network, no Final Cut.
// Usage: node tests/engine-tests.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), cp = require('child_process'), assert = require('assert');
const E = require('../rp-finalcut-engine.js');
const { makeMedia } = require('./media.cjs');

let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'rp-fcp-' + p + '-'));
const allow = () => ({ session: null, restore: async () => ({}), ensureAllowed: async () => ({}), heartbeat: async () => null,
  status: () => ({ signedIn: true, email: 'test@example.com', canUse: true, label: 'Lifetime', detail: 'test', code: 'LIFETIME' }) });
const deny = () => Object.assign(allow(), { ensureAllowed: async () => { const e = new Error('Your trial has ended. Buy Lifetime to continue.'); e.code = 'EXPIRED'; throw e; } });

function req(eng, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    const h = Object.assign({ Host: '127.0.0.1:' + eng.port }, data ? { 'Content-Type': 'application/json' } : {}, headers);
    const r = http.request({ host: '127.0.0.1', port: eng.port, method, path: p, headers: h }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { j = t; } resolve({ status: res.statusCode, body: j }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const api = (eng, method, p, body) => req(eng, method, p + (p.includes('?') ? '&' : '?') + 't=' + eng.token, body);
async function waitIdle(eng, ms = 300000) {
  const t0 = Date.now();
  for (;;) { const s = (await api(eng, 'GET', '/api/status')).body; if (!s.busy) return s; if (Date.now() - t0 > ms) throw Error('job did not finish'); await new Promise((r) => setTimeout(r, 200)); }
}
/** The live server's version rule: plugin_release_internal.version_parts(v) >= version_parts('2.3.11.11'). */
function serverAccepts(v) {
  const m = /^([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})(-[A-Za-z0-9][A-Za-z0-9.-]*)?$/.exec(v);
  if (!m) return false;
  const a = m.slice(1, 5).map(Number), b = [2, 3, 11, 11];
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

(async () => {
  const media = makeMedia(path.join(os.tmpdir(), 'rp-fcp-media-v2'));
  const cams = media.cameras.map((c) => ({ role: c.role, files: c.files }));

  // ---------------------------------------------------------------- account settings for this build
  {
    ok(serverAccepts(E.PLUGIN_VERSION) && /^2\.3\.11\.19-finalcut-v1\.0\.0$/.test(E.PLUGIN_VERSION), 'version ' + E.PLUGIN_VERSION + ' passes the server minimum 2.3.11.11');
    ok(!serverAccepts('2.3.11.8-public-v18'), 'sanity: the old DaVinci version is refused by the same rule');
    let started = null;
    const A = require('../lib/account');
    const acc = E.makeAccount(() => {}, { deviceId: () => 'RP-AAAA-BBBB-CCCC-DDDD', dataDir: tmp('acct') });
    const body = acc.rpcBody();
    ok(body.p_platform === 'macOS' && body.p_plugin_version === E.PLUGIN_VERSION, 'license RPCs send platform macOS + ' + E.PLUGIN_VERSION);
    ok(/RProjectMulticam[\\/]finalcut[\\/]session\.json$/.test(acc.sessionFile), 'own session file: ' + acc.sessionFile);
    const G = require('../lib/google-auth');
    const orig = G.startGoogle;
    const flow = await orig({ timeoutMs: 100, host: 'finalcut' }).catch((e) => e);
    ok(flow && flow.link && /%22host%22%3A%22finalcut%22/.test(flow.link), 'Google relay link names the Final Cut host');
    if (flow && flow.cancel) flow.cancel();
    ok(typeof A.Account === 'function' && started === null, 'account module loads');
    console.log('PASS account: macOS, ' + E.PLUGIN_VERSION + ', own session file, Google wording host "finalcut"');
  }

  // ---------------------------------------------------------------- HTTP guards, validation, license gate
  const outDir = tmp('out');
  const opened = [];
  let eng = await E.start({ account: deny(), quiet: true, cacheDir: tmp('cache'), pickFiles: async (kind) => (kind === 'camera' ? cams[0].files : [media.music]), openInFinalCut: async (f) => { opened.push(f); return 'Final Cut Pro'; } });
  try {
    ok((await req(eng, 'GET', '/api/status')).status === 403, 'no token -> 403');
    ok((await req(eng, 'GET', '/api/status?t=' + eng.token, undefined, { Host: 'evil.example:80' })).status === 403, 'foreign Host (DNS rebinding) -> 403');
    ok((await req(eng, 'POST', '/api/analyze?t=' + eng.token, { music: [media.music] }, { Origin: 'http://evil.example' })).status === 403, 'foreign Origin -> 403');
    ok((await req(eng, 'POST', '/api/analyze?t=' + eng.token, 'x', { 'Content-Type': 'text/plain' })).status === 415, 'non-JSON body -> 415');
    ok((await req(eng, 'POST', '/api/analyze?t=' + eng.token, '{bad')).status === 400, 'broken JSON -> 400');
    const st = (await api(eng, 'GET', '/api/status')).body;
    ok(st.ok && st.version === E.VERSION && /Final Cut v1\.0\.0 \(engine 2\.3\.11\.19\)/.test(st.version), 'status: ' + st.version);
    ok((await api(eng, 'GET', '/')).body.includes('for Final Cut Pro'), 'control page served');
    let r = await api(eng, 'POST', '/api/pick', { kind: 'camera' });
    ok(r.status === 200 && r.body.files.length === 1, 'file chooser result returned');
    ok((await api(eng, 'POST', '/api/pick', { kind: 'do shell script' })).status === 400, 'unknown chooser refused (constant scripts only)');
    ok(Object.values(E.PICK_SCRIPTS).every((l) => !/do shell script|tell application/.test(l.join('\n'))), 'chooser scripts: no shell commands, no Automation permission needed');
    r = await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: cams, outputDir: outDir });
    ok(r.status === 403 && /trial has ended/.test(r.body.error) && r.body.code === 'EXPIRED', 'expired license -> 403 before any work');
    ok(!(await api(eng, 'GET', '/api/status')).body.busy && fs.readdirSync(outDir).length === 0, 'nothing started or written while not licensed');
    r = await api(eng, 'POST', '/api/analyze', { music: ['relative.wav'] });
    ok(r.status === 400 && /full path/.test(r.body.error), 'relative path refused');
    r = await api(eng, 'POST', '/api/analyze', { music: ['/no/such/file.wav'] });
    ok(r.status === 400 && /not found/.test(r.body.error), 'missing file refused');
    r = await api(eng, 'POST', '/api/analyze', { music: ['http://example.com/a.wav'] });
    ok(r.status === 400, 'URL refused');
    ok((await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: [] })).status === 400, 'no cameras refused');
    ok((await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: [{ role: 'x', files: [] }] })).status === 400, 'camera without clips refused');
    ok((await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: cams, dropCamera: 9 })).status === 400, 'drop camera out of range refused');
    ok((await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: cams, outputDir: 'Movies' })).status === 400, 'relative output folder refused');
    ok((await api(eng, 'POST', '/api/reveal', {})).status === 400, 'Show in Finder before anything was made -> 400');
    ok(E.safeName('a/b:c*?"<>|\u0001d') === 'a-b-c-------d', 'output names are safe for the file system');
    console.log('PASS guards: token, Host, Origin, JSON; validation; license gate (403, nothing written); constant file chooser');
  } finally { await eng.close(); }

  // ---------------------------------------------------------------- analyze + create multicam edit (real engine)
  eng = await E.start({ account: allow(), quiet: true, cacheDir: tmp('cache2'), openInFinalCut: async (f) => { opened.push(f); return 'Final Cut Pro'; } });
  try {
    let t0 = Date.now();
    let r = await api(eng, 'POST', '/api/analyze', { music: [media.music] });
    ok(r.status === 202, 'analyze started');
    let s = await waitIdle(eng);
    ok(s.lastResult.ok, 'analyze ok: ' + (s.lastResult.error || ''));
    ok(Math.abs(s.analysis.bpm - media.bpm) <= 1.5, 'BPM ' + s.analysis.bpm);
    ok(media.drops.every((x) => s.analysis.mainDrops.some((d) => Math.abs(d - x) <= 1)), 'main drops near 30 s and 75 s: ' + s.analysis.mainDrops);
    console.log('PASS analyze: BPM ' + s.analysis.bpm + ', main drops ' + s.analysis.mainDrops.join(', ') + ' (' + (Date.now() - t0) + ' ms)');

    t0 = Date.now();
    r = await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: cams, cadences: [4, 6, 8], dropCamera: '0', outputDir: outDir, open: true });
    ok(r.status === 202, 'multicam started: ' + JSON.stringify(r.body));
    ok((await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: cams, outputDir: outDir })).status === 409, 'second job while busy -> 409');
    s = await waitIdle(eng);
    ok(s.lastResult.ok, 'multicam ok: ' + (s.lastResult.error || ''));
    const fcpxml = s.lastResult.files[0], planFile = fcpxml.replace(/\.fcpxml$/, '.rpplan.json');
    ok(path.basename(fcpxml) === 'Synthetic Set - Multicam AI.fcpxml' && fs.existsSync(fcpxml) && fs.existsSync(planFile), 'wrote ' + fcpxml + ' + plan');
    ok(opened.length === 1 && opened[0][0] === fcpxml, 'opened in Final Cut Pro');
    const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
    plan.cameras.forEach((c, i) => {
      const want = media.cameras[i].expect;
      ok(c.clips.length === want.length, c.role + ': ' + c.clips.length + '/' + want.length + ' clips synced');
      c.clips.forEach((k, j) => ok(Math.abs(k.offset - want[j]) <= 0.05, c.role + ' clip ' + (j + 1) + ' synced at ' + k.offset + ' s (expected ' + want[j] + ')'));
    });
    ok(plan.cuts.length >= 10, plan.cuts.length + ' cuts');
    const frame = plan.timeline.fps.den / plan.timeline.fps.num;
    const covered = (cam, a, b) => plan.cameras[cam].clips.some((k) => k.offset <= a + frame && k.offset + k.duration >= b - frame);
    ok(plan.cuts.every((c) => c.camera < 0 || covered(c.camera, c.start_frame * frame, c.end_frame * frame)), 'every cut uses a camera that has footage there');
    const xml = fs.readFileSync(fcpxml, 'utf8');
    ok(/^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<!DOCTYPE fcpxml>\s*(<!--[^>]*-->\s*)?<fcpxml version="1\.10">/.test(xml), 'FCPXML 1.10 header');
    ok((xml.match(/<mc-angle /g) || []).length === 5, '4 camera angles + music angle');
    ok((xml.match(/<mc-clip /g) || []).length >= plan.cuts.length - 1, 'project cut into mc-clips');
    ok(media.cameras.every((c) => c.files.every((f) => xml.includes('src="' + require('url').pathToFileURL(f).href + '"'))), 'every camera clip referenced by its file URL');
    const lint = cp.spawnSync('xmllint', ['--noout', fcpxml], { encoding: 'utf8' });
    if (!lint.error) ok(lint.status === 0, 'xmllint: well-formed ' + lint.stderr);
    console.log('PASS multicam: ' + plan.cuts.length + ' cuts, every clip synced within 50 ms, FCPXML well-formed, opened in Final Cut (' + (Date.now() - t0) + ' ms)');

    r = await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: cams, outputDir: outDir, open: false });
    s = await waitIdle(eng);
    ok(s.lastResult.ok && path.basename(s.lastResult.files[0]) === 'Synthetic Set - Multicam AI 2.fcpxml' && opened.length === 1, 'second run: new file name, earlier file kept, not opened when unticked');
    ok(fs.existsSync(fcpxml), 'first file untouched');

    // Cancel: the job process and its FFmpeg stop, the engine is free again.
    r = await api(eng, 'POST', '/api/multicam', { music: [media.music], cameras: cams, outputDir: tmp('out2'), open: false });
    await new Promise((res) => setTimeout(res, 150));
    ok((await api(eng, 'POST', '/api/cancel', {})).body.cancelled === true, 'cancel accepted');
    s = await waitIdle(eng, 15000);
    ok(!s.lastResult.ok && /Cancel|stopped/.test(s.lastResult.error), 'cancelled job reported: ' + s.lastResult.error);
    console.log('PASS output naming (never overwrites), Open in Final Cut option, cancel');
  } finally { await eng.close(); }

  // ---------------------------------------------------------------- job file is not a CLI
  const direct = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'rp-finalcut-job.mjs')], { encoding: 'utf8' });
  ok(direct.status === 2 && /started by R Project Engine/.test(direct.stderr), 'rp-finalcut-job.mjs refuses to run without the engine');
  // ---------------------------------------------------------------- one engine at a time
  const lockFile = path.join(tmp('lock'), 'engine.lock');
  let l = await E.acquireLock(lockFile); fs.writeSync(l.fd, JSON.stringify({ pid: 1, url: 'http://127.0.0.1:1/?t=x' })); fs.closeSync(l.fd);
  l = await E.acquireLock(lockFile); ok(l.fd !== undefined, 'stale lock replaced'); fs.closeSync(l.fd);
  console.log('PASS job file has no CLI entry; engine.lock');
  console.log('ALL PASS (' + checks + ' checks)');
})().catch((e) => { console.error(e); process.exit(1); });
