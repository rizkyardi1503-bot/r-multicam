// Final Cut engine tests: the HTTP API (token, origin, license gate), the camera list, and a full run on synthetic
// media through the real engine (FFmpeg on PATH or RP_FFMPEG): music -> 2 cameras -> Analyze -> Create Multicam Edit ->
// .fcpxml with a multicam clip and a project, "opened" in Final Cut (stubbed).
'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), http = require('http');

const APP = path.join(__dirname, '..', 'app');
const { start, LICENSE_VERSION } = require(path.join(APP, 'rp-finalcut-engine.js'));
const { mediaIn, asText, safeName } = require(path.join(APP, 'lib', 'fcp-workflow.js'));
const { readTimeline, urlToPath } = require(path.join(APP, 'lib', 'xml-import.js'));
const FFMPEG = process.env.RP_FFMPEG || 'ffmpeg';
process.env.RP_FFMPEG = FFMPEG;

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok - ' + name); }

// ---------- synthetic media: 128 BPM, intro -> build -> drop, and two cameras that hear it from different offsets
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-fcp-test-'));
const SR = 44100, BPM = 128, BEAT = 60 / BPM, DUR = 48;
function song() {
  const y = new Float32Array(SR * DUR);
  let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const kick = (at, amp) => { let ph = 0; for (let i = 0; i < SR * 0.25; i++) { const t = i / SR, f = 50 + 120 * Math.exp(-t * 30); ph += 2 * Math.PI * f / SR; const k = Math.floor(at * SR) + i; if (k < y.length) y[k] += Math.sin(ph) * Math.exp(-t * 9) * amp; } };
  const hat = (at, amp) => { for (let i = 0; i < SR * 0.05; i++) { const k = Math.floor(at * SR) + i; if (k < y.length) y[k] += rnd() * amp * Math.exp(-(i / SR) * 40); } };
  for (let b = 0; b < DUR - 0.3; b += BEAT) {
    if (b < 16) { kick(b, 0.35); hat(b + BEAT / 2, 0.05); }
    else if (b < 26) { const p = (b - 16) / 10; kick(b, 0.3 + 0.3 * p); for (let k = 0; k < 4; k++) hat(b + k * BEAT / 4, 0.08 + 0.25 * p); }
    else { kick(b, 1); hat(b + BEAT / 2, 0.15); }
  }
  for (let i = 26 * SR; i < y.length; i++) y[i] += 0.3 * Math.sin(2 * Math.PI * 55 * i / SR);
  let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
  const buf = Buffer.alloc(44 + y.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + y.length * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) buf.writeInt16LE(Math.round(y[i] / peak / 1.05 * 32767), 44 + i * 2);
  return buf;
}
function ff(args) { const r = cp.spawnSync(FFMPEG, ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); }
const music = path.join(tmp, 'Set Night 1.wav');
fs.writeFileSync(music, song());
const camDirs = [];
[['Wide', 'red', [[0, 22], [24, 24]]], ['DJ', 'blue', [[3, DUR - 3]]]].forEach(([name, color, clips]) => {
  const dir = path.join(tmp, name); fs.mkdirSync(dir); camDirs.push(dir);
  clips.forEach(([at, len], j) => ff(['-f', 'lavfi', '-i', `color=c=${color}:size=320x180:rate=25`, '-ss', String(at), '-t', String(len), '-i', music,
    '-filter_complex', '[1:a]volume=0.6,aecho=0.6:0.3:40:0.2[a]', '-map', '0:v', '-map', '[a]', '-t', String(len),
    '-metadata', 'creation_time=' + new Date(Date.UTC(2026, 10, 20, 21, 0, 0) + at * 1000).toISOString(),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path.join(dir, `C${String(j + 1).padStart(4, '0')}.MP4`)]));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not media'); fs.writeFileSync(path.join(dir, '._C0001.MP4'), 'AppleDouble');
});

// ---------- helpers
function fakeAccount(allowed = true) {
  return { session: null, restore: async () => ({ signedIn: true, email: 'test@example.com', label: allowed ? 'Lifetime' : 'Trial expired' }),
    heartbeat: async () => {}, ensureAllowed: async () => { if (!allowed) { const e = new Error('Your trial has ended. Buy Lifetime to continue.'); e.code = 'EXPIRED'; throw e; } },
    status: () => ({ signedIn: true, email: 'test@example.com', canUse: allowed, label: allowed ? 'Lifetime' : 'Trial expired', licenseStatus: allowed ? 'lifetime' : 'expired' }) };
}
function picker(queue) { return { music: async () => queue.music.splice(0, 1), folder: async () => queue.folder.splice(0, 1), files: async () => queue.files.splice(0, 1)[0] || [] }; }
function call(eng, method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request({ host: '127.0.0.1', port: eng.port, path: p + (p.includes('?') ? '' : '?t=' + eng.token), method,
      headers: Object.assign({ Host: '127.0.0.1:' + eng.port }, body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers) }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch (e) { /* html */ } resolve({ status: res.statusCode, body: j, text: t }); });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

(async () => {
  await test('unit: camera folders keep only video files, in name order, without macOS ._ files', async () => {
    assert.deepEqual(mediaIn(camDirs[0]).map((f) => path.basename(f)), ['C0001.MP4', 'C0002.MP4']);
    assert.equal(asText('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
    assert.equal(safeName('DJ: set/1'), 'DJ- set-1');
  });

  await test('license version reports the bundled engine version (accepted by the minimum-version rule)', async () => {
    assert.match(LICENSE_VERSION, /^2\.3\.\d+\.\d+-finalcut-v\d+\.\d+\.\d+$/);
  });

  const opened = [], queue = { music: [music], folder: [camDirs[0]], files: [] };
  const outDir = path.join(tmp, 'out');
  const eng = await start({ quiet: true, awaitActions: true, account: fakeAccount(true), picker: picker(queue), open: async (f) => { opened.push(f); return 'Final Cut Pro'; }, outDir });
  try {
    await test('API refuses a wrong token, a foreign Host and a foreign Origin', async () => {
      assert.equal((await call(eng, 'GET', '/api/status?t=wrong')).status, 403);
      assert.equal((await call(eng, 'GET', '/api/status', null, { Host: 'evil.example:80' })).status, 403);
      assert.equal((await call(eng, 'POST', '/api/music', {}, { Origin: 'http://evil.example' })).status, 403);
      const page = await call(eng, 'GET', '/');
      assert.equal(page.status, 200); assert.match(page.text, /From set to Reels\./); assert.match(page.text, /drop an \.fcpxml/); assert.doesNotMatch(page.text, /\$\{/);
    });

    await test('nothing chosen yet: Create Multicam Edit explains what is missing', async () => {
      const r = await call(eng, 'POST', '/api/multicam', { cadences: [4, 8] });
      assert.equal(r.status, 202);
      const s = (await call(eng, 'GET', '/api/status')).body;
      assert.equal(s.lastResult.ok, false); assert.match(s.lastResult.error, /music first/);
    });

    await test('choose music and two camera folders; remove and re-add keeps names unique', async () => {
      assert.equal((await call(eng, 'POST', '/api/music', {})).body.ok, true);
      assert.equal((await call(eng, 'POST', '/api/camera/add', { mode: 'folder' })).body.ok, true);
      queue.folder.push(camDirs[0]);
      const twice = (await call(eng, 'POST', '/api/camera/add', { mode: 'folder' })).body;
      assert.deepEqual(twice.studio.cameras.map((c) => c.name), ['Wide', 'Wide 2']);
      assert.equal((await call(eng, 'POST', '/api/camera/remove', { index: 1 })).body.studio.cameras.length, 1);
      queue.folder.push(camDirs[1]);
      const r = (await call(eng, 'POST', '/api/camera/add', { mode: 'folder' })).body;
      assert.deepEqual(r.studio.cameras.map((c) => [c.name, c.files]), [['Wide', 2], ['DJ', 1]]);
      assert.equal((await call(eng, 'POST', '/api/camera/remove', { index: 9 })).status, 400);
      const cancelled = (await call(eng, 'POST', '/api/camera/add', { mode: 'folder' })).body;   // dialog cancelled
      assert.equal(cancelled.ok, true); assert.equal(cancelled.studio.cameras.length, 2);
    });

    await test('Analyze Music finds 128 BPM and the drop', async () => {
      assert.equal((await call(eng, 'POST', '/api/analyze', {})).status, 202);
      const s = (await call(eng, 'GET', '/api/status')).body;
      assert.notEqual(s.lastResult.ok, false, s.lastResult.error);
      assert.ok(Math.abs(s.studio.analysis.bpm - BPM) <= 1, 'bpm ' + s.studio.analysis.bpm);
      assert.ok(s.studio.analysis.drops >= 1, 'drops ' + s.studio.analysis.drops);
    });

    await test('Create Multicam Edit syncs every clip and writes an FCPXML with a multicam clip and a project', async () => {
      const r = await call(eng, 'POST', '/api/multicam', { roles: ['Master Wide', 'DJ Close-Up'], cadences: [4, 6, 8], dropCamera: '1', sensitivity: 'balanced' });
      assert.equal(r.status, 202);
      const s = (await call(eng, 'GET', '/api/status')).body;
      assert.notEqual(s.lastResult.ok, false, s.lastResult.error);
      const res = s.studio.result;
      assert.equal(res.placed, 3, 'all three clips synced'); assert.equal(res.excluded, 0);
      assert.ok(res.cuts >= 4, 'cuts ' + res.cuts);
      assert.deepEqual(opened, [res.fcpxml]);
      assert.ok(res.fcpxml.startsWith(outDir) && /Set Night 1 - Multicam AI\.fcpxml$/.test(res.fcpxml));
      const xml = fs.readFileSync(res.fcpxml, 'utf8');
      assert.match(xml, /<fcpxml version="1\.\d+"/); assert.match(xml, /<mc-clip /); assert.match(xml, /<multicam /);
      assert.match(xml, /<project name="Set Night 1 - Multicam AI"/); assert.match(xml, /<event name="R Project Multicam AI"/);
      for (const dir of camDirs) for (const f of mediaIn(dir)) assert.ok(xml.includes(encodeURI('file://' + f).replace(/#/g, '%23')) || xml.includes('file://' + f), 'media ref ' + f);
      const plan = JSON.parse(fs.readFileSync(res.fcpxml.replace(/ - Multicam AI\.fcpxml$/, '.rpplan.json'), 'utf8'));
      assert.deepEqual(plan.cameras.map((c) => c.role), ['Master Wide', 'DJ Close-Up']);
      const offsets = plan.cameras.map((c) => c.clips.map((k) => Math.round(k.offset * 25) / 25));
      assert.deepEqual(offsets, [[0, 24], [3]], 'sync offsets ' + JSON.stringify(offsets));
      const xmllint = cp.spawnSync('xmllint', ['--noout', res.fcpxml], { encoding: 'utf8' });
      if (!xmllint.error) assert.equal(xmllint.status, 0, xmllint.stderr);
    });

    await test('a second run while one is running is refused (409)', async () => {
      eng.studio.busy = 'Create Multicam Edit';
      try { assert.equal((await call(eng, 'POST', '/api/analyze', {})).status, 409); assert.equal((await call(eng, 'POST', '/api/music', {})).status, 409); }
      finally { eng.studio.busy = ''; }
    });

    // ---------- timeline import (FCPXML exported from Final Cut Pro / DaVinci Resolve)
    const url = (f) => 'file://' + encodeURI(f);
    const cams = camDirs.map((d) => mediaIn(d));
    const fcpExport = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.11"><resources>
<format id="r1" frameDuration="1/25s" width="1920" height="1080"/>
<asset id="m" name="Set Night 1" start="0s" duration="${DUR}s" hasAudio="1"><media-rep kind="original-media" src="${url(music)}"/></asset>
${cams.flat().map((f, i) => `<asset id="c${i}" name="${path.basename(f)}" start="0s" duration="20s" hasVideo="1" hasAudio="1" format="r1"><media-rep kind="original-media" src="${url(f)}"/></asset>`).join('')}
</resources><library><event name="Night"><project name="Druva &amp; friends"><sequence format="r1"><spine>
<asset-clip ref="m" offset="0s" duration="${DUR}s">
${cams[0].map((f) => `<asset-clip ref="c${cams.flat().indexOf(f)}" lane="1" offset="0s" duration="10s"/>`).join('')}
${cams[1].map((f) => `<clip lane="2" offset="0s" duration="10s"><video ref="c${cams.flat().indexOf(f)}" offset="0s" duration="10s"/></clip>`).join('')}
</asset-clip></spine></sequence></project></event></library></fcpxml>`;
    const resolveExport = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<!-- Exported from DaVinci Resolve -->\n<fcpxml version="1.10"><resources>
<format id="r0" frameDuration="1/25s" width="1920" height="1080"/>
<asset id="a1" name="music" src="${url(music)}" start="0s" duration="${DUR}s" hasAudio="1"/>
${cams.flat().map((f, i) => `<asset id="v${i}" name="${path.basename(f)}" src="${url(f)}" start="0s" duration="20s" hasVideo="1" hasAudio="1" format="r0"/>`).join('')}
</resources><library><event name="Timeline 1"><project name="Timeline 1"><sequence format="r0"><spine>
${cams[0].map((f) => `<asset-clip ref="v${cams.flat().indexOf(f)}" offset="0s" duration="10s">${f === cams[0][0] ? `<asset-clip ref="a1" lane="-1" offset="0s" duration="${DUR}s"/>${cams[1].map((g) => `<asset-clip ref="v${cams.flat().indexOf(g)}" lane="1" offset="0s" duration="10s"/>`).join('')}` : ''}</asset-clip>`).join('')}
</spine></sequence></project></event></library></fcpxml>`;

    await test('unit: timeline reader finds the music and one camera per track, in FCP and Resolve exports', async () => {
      assert.equal(urlToPath('file:///Users/me/My%20Shoot/A.MP4'), '/Users/me/My Shoot/A.MP4');
      assert.equal(urlToPath('file:///C:/Shoot/A.MP4'), 'C:/Shoot/A.MP4');
      assert.equal(urlToPath('file://localhost/Volumes/SSD/a.mov'), '/Volumes/SSD/a.mov');
      const f = readTimeline(fcpExport);
      assert.equal(f.app, 'fcp'); assert.equal(f.title, 'Druva & friends'); assert.equal(f.music, music);
      assert.deepEqual(f.cameras.map((c) => [c.name, c.files.length]), [['V2', 2], ['V3', 1]]); assert.deepEqual(f.missing, []);
      const r = readTimeline(resolveExport);
      assert.equal(r.app, 'resolve'); assert.deepEqual(r.cameras.map((c) => [c.name, c.files.length]), [['V1', 2], ['V2', 1]]);
      assert.throws(() => readTimeline('<html></html>'), /not an FCPXML/);
      assert.throws(() => readTimeline(fcpExport.replace(/<asset id="m"[\s\S]*?<\/asset>/, '').replace('<asset-clip ref="m"', '<gap')), /No music/);
    });

    await test('Final Cut timeline: drop the XML, Create edit, multicam project back', async () => {
      opened.length = 0;
      const r = await call(eng, 'POST', '/api/xml', { name: 'night.fcpxml', text: fcpExport });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.app, 'fcp');
      assert.deepEqual(r.body.studio.cameras.map((c) => [c.name, c.files]), [['V2', 2], ['V3', 1]]);
      assert.equal((await call(eng, 'POST', '/api/multicam', { target: 'fcp', cadences: [4, 8] })).status, 202);
      const s = (await call(eng, 'GET', '/api/status')).body, res = s.studio.result;
      assert.notEqual(s.lastResult.ok, false, s.lastResult.error);
      assert.equal(res.target, 'fcp'); assert.equal(res.placed, 3); assert.deepEqual(opened, [res.fcpxml]);
      assert.match(res.name, /^Druva & friends - Multicam AI\.fcpxml$/);
      const xml = fs.readFileSync(res.fcpxml, 'utf8'); assert.match(xml, /<mc-clip /); assert.match(xml, /<multicam /);
      const dl = await call(eng, 'GET', '/api/result');
      assert.equal(dl.status, 200); assert.equal(dl.text, xml);
    });

    await test('DaVinci timeline: flat FCPXML, camera clips cut on V1 at the synced position, music on A1', async () => {
      const r = await call(eng, 'POST', '/api/xml', { name: 'Timeline 1.fcpxml', text: resolveExport });
      assert.equal(r.body.app, 'resolve');
      assert.equal((await call(eng, 'POST', '/api/multicam', { target: 'resolve', cadences: [4, 6, 8] })).status, 202);
      const s = (await call(eng, 'GET', '/api/status')).body, res = s.studio.result;
      assert.notEqual(s.lastResult.ok, false, s.lastResult.error);
      assert.equal(res.target, 'resolve'); assert.match(res.name, /\(DaVinci\)\.fcpxml$/);
      const xml = fs.readFileSync(res.fcpxml, 'utf8');
      assert.doesNotMatch(xml, /<mc-clip|<multicam|<media /);
      const xmllint = cp.spawnSync('xmllint', ['--noout', res.fcpxml], { encoding: 'utf8' });
      if (!xmllint.error) assert.equal(xmllint.status, 0, xmllint.stderr);
      const plan = JSON.parse(fs.readFileSync(path.join(res.folder, path.basename(res.folder).replace(/ \d{4}-.*$/, '') + '.rpplan.json'), 'utf8'));
      const sec = (v) => { const m = /^(\d+)(?:\/(\d+))?s$/.exec(v); return Number(m[1]) / Number(m[2] || 1); };
      const assets = Object.fromEntries([...xml.matchAll(/<asset id="(r\d+)"[^>]*>\s*<media-rep kind="original-media" src="([^"]+)"/g)].map((m) => [m[1], decodeURI(m[2].replace('file://', ''))]));
      const offsetOf = Object.fromEntries(plan.cameras.flatMap((c) => c.clips.map((k) => [k.file, k.offset])));
      const shots = [...xml.matchAll(/<asset-clip ref="(r\d+)" name="[^"]*" offset="([^"]+)" start="([^"]+)" duration="([^"]+)" tcFormat="[A-Z]+" srcEnable="video"/g)];
      assert.equal(shots.length, plan.cuts.filter((c) => c.camera >= 0).length);
      for (const [, ref, off, start] of shots) assert.ok(Math.abs(sec(off) - sec(start) - offsetOf[assets[ref]]) < 0.05, 'shot ' + ref + ' at ' + off + ' is in sync');
      let t = 0; for (const [, , off, , dur] of shots) { assert.ok(Math.abs(sec(off) - t) < 1e-6 || sec(off) > t, 'shots in order'); t = sec(off) + sec(dur); }
      assert.match(xml, /<asset-clip ref="r\d+" lane="-1" name="Set Night 1\.wav" offset="[^"]+" start="0s"/);
    });

    await test('Find drops, then export a 9:16 drop clip, the full set in 16:9 and a DaVinci XML from the same plan', async () => {
      assert.equal((await call(eng, 'POST', '/api/export', { drops: [0] })).status, 202);
      assert.match((await call(eng, 'GET', '/api/status')).body.lastResult.error, /Find the drops first/);
      assert.equal((await call(eng, 'POST', '/api/drops', { cadences: [4, 8] })).status, 202);
      let s = (await call(eng, 'GET', '/api/status')).body;
      assert.notEqual(s.lastResult.ok, false, s.lastResult.error);
      assert.ok(s.studio.drops.length >= 1, 'drops ' + s.studio.drops.length);
      const drop = s.studio.drops.find((d) => Math.abs(d.time - 26) < 2);
      assert.ok(drop, 'the drop at 26 s: ' + JSON.stringify(s.studio.drops));
      assert.ok(drop.thumb);
      const jpg = await call(eng, 'GET', '/api/thumb?i=' + drop.index + '&t=' + eng.token);
      assert.equal(jpg.status, 200);
      assert.equal((await call(eng, 'POST', '/api/export', { drops: [drop.index], full: true, format: '9x16', length: 15 })).status, 202);
      s = (await call(eng, 'GET', '/api/status')).body;
      assert.notEqual(s.lastResult.ok, false, s.lastResult.error);
      assert.equal(s.studio.exports.length, 2);
      const probe = (f) => JSON.parse(cp.spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1'), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', f], { encoding: 'utf8' }).stdout);
      const dir = path.dirname(s.lastResult.folder ? path.join(s.lastResult.folder, 'x') : '');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).sort();
      assert.equal(files.length, 2, files.join(', '));
      const clip = probe(path.join(dir, files.find((f) => /Drop 1 /.test(f) || /Drop \d+ 0\.2/.test(f)) || files.find((f) => /Drop/.test(f))));
      assert.deepEqual(clip.streams.map((x) => x.codec_type).sort(), ['audio', 'video']);
      const v = clip.streams.find((x) => x.codec_type === 'video');
      assert.deepEqual([v.width, v.height], [1080, 1920]);
      assert.ok(Math.abs(Number(clip.format.duration) - 15) < 0.15, 'clip ' + clip.format.duration);
      const full = probe(path.join(dir, files.find((f) => /Full set/.test(f))));
      assert.ok(Math.abs(Number(full.format.duration) - DUR) < 0.3, 'full ' + full.format.duration);
      assert.equal((await call(eng, 'POST', '/api/export', { full: true, format: '16x9' })).status, 202);
      s = (await call(eng, 'GET', '/api/status')).body;
      const wide = probe(path.join(dir, fs.readdirSync(dir).find((f) => /Full set \(16x9\)/.test(f))));
      assert.deepEqual(wide.streams.filter((x) => x.codec_type === 'video').map((x) => [x.width, x.height]), [[1920, 1080]]);
      assert.equal((await call(eng, 'POST', '/api/export-xml', { target: 'resolve' })).status, 202);
      s = (await call(eng, 'GET', '/api/status')).body;
      assert.notEqual(s.lastResult.ok, false, s.lastResult.error);
      assert.match(fs.readFileSync(s.studio.result.fcpxml, 'utf8'), /lane="-1"/);
    });

    await test('timeline with footage that is not on this computer: clear error, nothing loaded', async () => {
      const r = await call(eng, 'POST', '/api/xml', { name: 'x.fcpxml', text: fcpExport.split(camDirs[1]).join('/Volumes/Gone/DJ') });
      assert.equal(r.status, 400); assert.match(r.body.error, /not on this computer/);
      assert.equal((await call(eng, 'POST', '/api/xml', { name: 'x.fcpxml', text: '<html/>' })).status, 400);
    });
  } finally { await eng.close(); }

  const locked = await start({ quiet: true, awaitActions: true, account: fakeAccount(false), picker: picker({ music: [music], folder: [], files: [] }), open: async () => '', outDir });
  try {
    await test('license gate: an expired trial cannot analyze or create an edit (403), choosing files still works', async () => {
      assert.equal((await call(locked, 'POST', '/api/music', {})).status, 200);
      const r = await call(locked, 'POST', '/api/analyze', {});
      assert.equal(r.status, 403); assert.equal(r.body.code, 'EXPIRED');
      assert.equal((await call(locked, 'POST', '/api/multicam', {})).status, 403);
    });
  } finally { await locked.close(); }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS Final Cut engine: ' + passed + ' tests');
})().catch((e) => { console.error(e); process.exit(1); });
