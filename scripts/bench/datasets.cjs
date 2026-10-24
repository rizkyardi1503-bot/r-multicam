// Benchmark datasets for engine-bench.cjs. Media is generated once into %TEMP%/rp-bench/<name> (never committed).
//   synth : 10-min synthetic EDM master (44.1 kHz stereo WAV, known drops) + 4 cameras x 5 small .mov clips
//   e2e   : the sync e2e set (10-min master.wav + 6 .mov clips), path via --e2e <dir> or RP_E2E_MEDIA
//   druva : real footage. 8-min A1 section of the Druva master + 4 cameras, each stream-copied (no re-encode)
//           into two files around the used range so a run reads ~5 GB instead of 100 GB. Source is read-only.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.join(os.tmpdir(), 'rp-bench');

function wav16(file, x, sr, channels) {
  channels = channels || 1;
  const n = x.length, b = Buffer.alloc(44 + n * 2 * channels);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2 * channels, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(channels, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2 * channels, 28); b.writeUInt16LE(2 * channels, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2 * channels, 40);
  for (let i = 0, o = 44; i < n; i++) { const v = Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))); for (let c = 0; c < channels; c++, o += 2) b.writeInt16LE(v, o); }
  fs.writeFileSync(file, b);
}
function ff(ffmpeg, args) { const r = cp.spawnSync(ffmpeg, ['-y', '-nostdin', '-hide_banner', '-v', 'error'].concat(args), { encoding: 'utf8', maxBuffer: 1 << 26 }); if (r.status !== 0) throw Error('ffmpeg ' + args.join(' ') + '\n' + r.stderr); }

// ---- synth: same generator as harness/music-bench.cjs (seed 7, 128 BPM, drops every 72 bars)
function synthMaster(seconds, SR) {
  const BPM = 128, BEAT = 60 / BPM, BAR = 4 * BEAT; let s = 7 >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const n = Math.floor(seconds * SR), x = new Float32Array(n), plan = [], drops = [];
  const parts = [['intro', 16], ['groove', 16], ['breakdown', 8], ['build', 8], ['drop', 16], ['groove', 8]];
  let t = 0; while (t < seconds) for (const [name, bars] of parts) { if (t >= seconds) break; plan.push({ name, start: t, end: Math.min(seconds, t + bars * BAR) }); if (name === 'drop') drops.push(t); t += bars * BAR; }
  // Per-bar chords and vocal glides (own RNG) so camera excerpts are unique enough to sync, as in a real set.
  let s2 = 19 >>> 0; const rnd2 = () => ((s2 = (s2 * 1664525 + 1013904223) >>> 0) / 4294967296), bars = [];
  for (let b = 0; b * BAR < seconds + BAR; b++) bars.push({ chord: [110, 123, 98, 147, 131][Math.floor(rnd2() * 5)], vocal: rnd2() < .45, vf: 300 + rnd2() * 400 });
  let lp = 0;
  for (const p of plan) {
    const a = Math.floor(p.start * SR), b = Math.floor(p.end * SR), len = p.end - p.start;
    for (let i = a; i < b; i++) {
      const tt = i / SR, rel = tt - p.start, inBeat = rel % BEAT, prog = rel / len; let v = 0;
      const kick = p.name === 'drop' ? 0.9 : p.name === 'groove' ? 0.55 : p.name === 'intro' ? 0.4 : 0;
      if (kick) v += kick * Math.sin(2 * Math.PI * (55 + 90 * Math.exp(-inBeat * 40)) * inBeat) * Math.exp(-inBeat * 9);
      if (p.name === 'drop') v += 0.35 * Math.sin(2 * Math.PI * 82 * tt) * (inBeat > BEAT * 0.25 ? 1 : 0.2);
      const off = (rel + BEAT / 2) % BEAT, hatAmp = p.name === 'drop' ? 0.18 : p.name === 'groove' ? 0.12 : 0.05;
      lp += 0.5 * (rnd() - lp); const noise = rnd() - lp; v += hatAmp * noise * Math.exp(-off * 60);
      if (p.name === 'breakdown' || p.name === 'build' || p.name === 'drop') v += 0.12 * Math.sin(2 * Math.PI * 440 * tt) + 0.08 * Math.sin(2 * Math.PI * 554 * tt);
      if (p.name === 'build') { v += prog * 0.35 * noise; const rate = prog < 0.5 ? 1 : prog < 0.75 ? 2 : 4, sub = BEAT / rate, ph = rel % sub; v += 0.25 * prog * noise * Math.exp(-ph * 30); }
      const bb = bars[Math.floor(tt / BAR)]; v += .07 * (Math.sin(2 * Math.PI * bb.chord * tt) + .6 * Math.sin(2 * Math.PI * bb.chord * 1.5 * tt));
      if (bb.vocal) v += .08 * Math.sin(2 * Math.PI * (bb.vf + 50 * Math.sin(tt * 3)) * tt);
      x[i] = Math.max(-1, Math.min(1, v * 0.8));
    }
  }
  return { x, drops };
}
function buildSynth(ffmpeg) {
  const dir = path.join(ROOT, 'synth'), done = path.join(dir, 'dataset.json');
  if (fs.existsSync(done)) return JSON.parse(fs.readFileSync(done, 'utf8'));
  fs.mkdirSync(dir, { recursive: true });
  const SR = 16000, DUR = 600, { x, drops } = synthMaster(DUR, SR);
  const tmp = path.join(dir, 'master16k.wav'), master = path.join(dir, 'master.wav');
  wav16(tmp, x, SR); ff(ffmpeg, ['-i', tmp, '-ar', '44100', '-ac', '2', '-c:a', 'pcm_s16le', master]); fs.unlinkSync(tmp);
  let s = 3; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296), sym = () => rnd() * 2 - 1;
  const clock0 = Date.UTC(2026, 9, 14, 21, 0, 0) / 1000, cams = [];
  const names = ['Wide', 'DJ', 'Crowd', 'Phone'], lens = [12, 30, 55, 90, 160];
  names.forEach((name, ci) => {
    const clips = []; let at = 8 + ci * 7;
    lens.forEach((len, k) => {
      if (at + len > DUR - 5) at = 10 + k * 3;
      const file = path.join(dir, `${name}_${k}.mov`), y = new Float32Array(Math.floor(len * SR)), a = Math.floor(at * SR), g = .3 + rnd() * .6;
      for (let i = 0; i < y.length; i++) y[i] = (x[a + i] || 0) * g + .04 * sym();
      const w = file + '.wav'; wav16(w, y, SR);
      const args = ['-f', 'lavfi', '-i', `testsrc2=s=320x180:r=25:d=${len}`, '-i', w, '-shortest', '-c:v', 'mpeg4', '-q:v', '8', '-c:a', 'aac', '-ar', '48000', '-b:a', '128k'];
      if (ci < 3) args.push('-metadata', 'creation_time=' + new Date((clock0 + at + ci * 1000) * 1000).toISOString());
      ff(ffmpeg, args.concat([file])); fs.unlinkSync(w);
      clips.push({ file, truth: at, len }); at += len + 20 + rnd() * 30;
    });
    cams.push({ name, clips });
  });
  const ds = { name: 'synth', master, input: 0, duration: DUR, frame: 1 / 25, drops, cams };
  fs.writeFileSync(done, JSON.stringify(ds, null, 1)); return ds;
}
function buildE2E(dir) {
  const truth = { Wide: [30.0, 140.52, 260.04, 400.0], DJ: [90.2, 330.8] }, lens = { Wide: [60, 40, 8, 2], DJ: [45, 30] };
  const cams = Object.keys(truth).map((name) => ({ name, clips: truth[name].map((t, k) => ({ file: path.join(dir, `${name}_${k}.mov`), truth: t, len: lens[name][k] })) }));
  return { name: 'e2e', master: path.join(dir, 'master.wav'), input: 0, duration: 600, frame: 1 / 25, cams };
}
// Druva: anchors (master time of camera media 0) from plugin/davinci/tests/druva-e2e.cjs.
function buildDruva(ffmpeg) {
  const dir = path.join(ROOT, 'druva'), done = path.join(dir, 'dataset.json');
  if (fs.existsSync(done)) return JSON.parse(fs.readFileSync(done, 'utf8'));
  fs.mkdirSync(dir, { recursive: true });
  const T0 = 11146, DUR = 480, H = 'H:/Druva Atlas/';
  const CAMS = [['Cam4', H + 'cam 4/DAV3618.MP4', -238.605], ['Cam2', H + 'cam 2]/Cam A_1990.MP4', 10477.2], ['Cam1', H + 'Cam 1/C0018.MP4', 10111.101], ['Cam3', H + 'cam 3/DJI_20261004005334_0003_D.MP4', 8498.523]];
  const cams = CAMS.map(([name, src, anchor]) => {
    const clips = [], half = DUR / 2, info = cp.spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', src], { encoding: 'utf8' }).stderr;
    const created = Date.parse(/creation_time\s*:\s*(\S+)/.exec(info)[1]) / 1000;
    // Two files per camera like a card split (3 s apart, no overlap); stream copy keeps the camera codec and GOP.
    for (let k = 0; k < 2; k++) {
      const from = T0 - anchor + (k ? half + 1 : -10), len = k ? half + 10 : half + 8, file = path.join(dir, `${name}_${k}.mp4`);
      ff(ffmpeg, ['-ss', from.toFixed(3), '-i', src, '-t', String(len), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero',
        '-metadata', 'creation_time=' + new Date(Math.floor(created + from) * 1000).toISOString(), file]);
      clips.push({ file, truth: anchor - T0 + from, len }); // approximate: the copy starts at the keyframe before `from`
    }
    return { name, clips };
  });
  const ds = { name: 'druva', master: H + 'Wild ones atlas.wav', input: T0, duration: DUR, frame: 1 / 25, cams };
  fs.writeFileSync(done, JSON.stringify(ds, null, 1)); return ds;
}
function load(name, ffmpeg, opts) {
  opts = opts || {};
  if (name === 'synth') return buildSynth(ffmpeg);
  if (name === 'e2e') return buildE2E(opts.e2e || process.env.RP_E2E_MEDIA || path.resolve(__dirname, '../../../e2e-media'));
  if (name === 'druva') return buildDruva(ffmpeg);
  throw Error('unknown dataset ' + name);
}
module.exports = { load, ROOT };
