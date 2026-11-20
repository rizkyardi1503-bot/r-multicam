// Portable end-to-end test of rp-engine-cli.js (analyze -> plan -> drops) on generated media: no Resolve, no H: drive.
// A 120 s 128 BPM track (quiet intro, riser from 48 s, drop at 60 s) and 4 small test-pattern cameras.
// Catches engine/vm-context mismatches after build-davinci.cjs copies a newer Premiere engine (e.g. a missing timer global).
// Needs ffmpeg on PATH (or in the R Project tools folder).  Usage: node tests/synthetic-e2e.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), assert = require('assert');
const CLI = path.join(__dirname, 'engine-cli.cjs');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-davinci-synth-'));
const SR = 44100, DUR = 120, BPM = 128, FRAME = 1 / 25, DROP = 60;

function writeTrack(file) {
  const n = SR * DUR, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const spb = 60 / BPM;
  for (let i = 0; i < n; i++) {
    const t = i / SR, ph = t % spb, loud = t >= DROP ? 1 : (t >= 48 ? 0.15 + 0.25 * (t - 48) / 12 : 0.3);
    let v = 0;
    if (t < 48 || t >= DROP) v += Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-ph * 30)) * ph) * Math.exp(-ph * 12) * 0.8 * loud;   // kick
    v += rnd() * Math.exp(-((t + spb / 2) % spb) * 60) * 0.15 * loud;                                                              // off-beat hat
    v += Math.sin(2 * Math.PI * 110 * t) * 0.1 * (t >= DROP ? 1 : 0.3);                                                            // bass
    if (t >= 48 && t < DROP) v += rnd() * 0.2 * ((t - 48) / 12);                                                                    // riser
    b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 20000))), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}

function run(cmd, input) {
  const inPath = path.join(WORK, cmd + '-in.json'), outPath = path.join(WORK, cmd + '-out.json');
  fs.writeFileSync(inPath, JSON.stringify(input));
  const r = cp.spawnSync(process.execPath, [CLI, cmd, inPath, outPath], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 120000 });
  const lines = String(r.stdout || '').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const last = lines[lines.length - 1] || {};
  if (r.status !== 0 || last.type !== 'done') throw Error(cmd + ' failed: ' + (last.message || r.stderr || (r.error && r.error.message) || 'exit ' + r.status));
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

const wav = path.join(WORK, 'track.wav');
writeTrack(wav);
const cams = [0, 1, 2, 3].map((i) => {
  const f = path.join(WORK, 'cam' + i + '.mp4');
  cp.execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=25:duration=' + DUR, '-vf', 'hue=h=' + i * 90, '-c:v', 'libx264', '-preset', 'ultrafast', f], { windowsHide: true });
  return f;
});
const a1 = { name: 'Synthetic', duration: DUR, frame: FRAME, range: { start: 0, end: DUR, selected: false }, clips: [{ file: wav, start: 0, end: DUR, input: 0 }] };
const tracks = cams.map((file, index) => ({ index, name: 'V' + (index + 1), clips: [{ file, start: 0, end: DUR, input: 0, supported: true, disabled: false }] }));

const analyzed = run('analyze', { a1, ffmpeg: '', options: {} }), s = analyzed.summary;
assert(Math.abs(s.bpm - BPM) <= 1.5, 'BPM about ' + BPM + ', got ' + s.bpm);
const nearDrop = s.mainDrops.map((d) => d.time).sort((a, b) => Math.abs(a - DROP) - Math.abs(b - DROP))[0];
assert(nearDrop != null && Math.abs(nearDrop - DROP) <= 2 * 60 / BPM, 'main drop near ' + DROP + ' s, got ' + nearDrop);
console.log(`PASS analyze: BPM ${s.bpm}, ${s.beats} beats, main drop ${nearDrop.toFixed(2)} s`);

const plan = run('plan', { a1, map: analyzed.map, tracks, duration: DUR, frame: FRAME,
  options: { cadences: [4, 6, 8], roles: 'Master Wide\nCrowd\nDJ Close-Up\nDrone', dropCamera: null, vision: false, budget: 60, ffmpeg: '' } });
assert.equal(plan.choices.length, plan.intervals.length, 'one choice per interval');
const byId = {}; plan.intervals.forEach((it) => { byId[it.id] = it; });
let prev = -1, changes = 0;
for (const c of plan.choices) {
  assert(c.camera >= 0 && c.camera <= 3 && byId[c.id].candidates.includes(c.camera), 'covered, valid camera: ' + c.camera);
  if (prev >= 0 && c.camera !== prev) changes++;
  prev = c.camera;
}
const cuts = plan.intervals.slice(1).map((it) => it.start), steady = plan.steadyGrid.map(Number);
const maxOff = Math.max(...cuts.map((t) => Math.min(...steady.map((g) => Math.abs(g - t)))));
assert(cuts.length >= 10 && changes >= 5, 'enough edit points and camera changes');
assert(maxOff <= FRAME / 2 + 1e-6, 'edit points on the steady beat grid (max ' + maxOff + ')');
console.log(`PASS plan: ${plan.intervals.length} intervals, ${changes} camera changes, edit points on the beat grid`);

const drops = run('drops', { map: analyzed.map, a1, duration: DUR, frame: FRAME, count: 5 });
assert(drops.drops.length >= 1, 'at least one Best Drop');
drops.drops.forEach((d) => assert(d.start < d.time && d.time < d.end && d.start >= 0 && d.end <= DUR, 'window valid'));
console.log(`PASS drops: ${drops.drops.map((d) => d.time.toFixed(2) + ' s').join(', ')}`);
fs.rmSync(WORK, { recursive: true, force: true });
console.log('ALL PASS');
