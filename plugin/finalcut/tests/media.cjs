// Generated test media, same recipe as rp-engine/test/run-tests.mjs: a 96 s 128 BPM track (intro, build, drop at 30 s,
// break, build, drop at 75 s) made of kicks and noise hits, and camera clips whose sound is a quieter copy of the music
// (with room echo) recorded from a known position. Needs ffmpeg on PATH.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');
const SR = 44100, BPM = 128, BEAT = 60 / BPM, DUR = 96, DROPS = [30, 75];
const SECTIONS = [[0, 16, 'intro'], [16, 30, 'build'], [30, 60, 'drop'], [60, 70, 'break'], [70, 75, 'build'], [75, 96, 'drop']];

function writeTrack(file) {
  const y = new Float32Array(SR * DUR);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const kick = (at, amp) => { let ph = 0; for (let i = 0; i < SR * 0.25; i++) { const t = i / SR, f = 50 + 120 * Math.exp(-t * 30); ph += 2 * Math.PI * f / SR; const k = Math.floor(at * SR) + i; if (k < y.length) y[k] += Math.sin(ph) * Math.exp(-t * 9) * amp; } };
  const noise = (at, len, amp) => { for (let i = 0; i < SR * len; i++) { const k = Math.floor(at * SR) + i; if (k < y.length) y[k] += rnd() * amp * Math.exp(-(i / SR) * 25); } };
  for (let b = 0; b < DUR - 0.3; b += BEAT) {
    const [s, , sec] = SECTIONS.find(([s0, e]) => b >= s0 && b < e);
    if (sec === 'intro') { kick(b, 0.35); noise(b + BEAT / 2, 0.05, 0.05); }
    else if (sec === 'build') { const p = (b - s) / 14, n = p > 0.5 ? 4 : 2; kick(b, 0.3 + 0.3 * p); for (let k = 0; k < n; k++) noise(b + k * BEAT / n, 0.06, 0.08 + 0.25 * p); }
    else if (sec === 'drop') { kick(b, 1); noise(b + BEAT / 2, 0.08, 0.15); }
    else noise(b, 0.1, 0.04);
  }
  for (const [s, e, n] of SECTIONS) if (n === 'drop') for (let i = s * SR; i < e * SR; i++) { const t = i / SR; y[i] += 0.35 * Math.sin(2 * Math.PI * 55 * t) * (0.6 + 0.4 * Math.abs(Math.sin(Math.PI * t / BEAT))); }
  let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
  const buf = Buffer.alloc(44 + y.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + y.length * 2, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) buf.writeInt16LE(Math.round(y[i] / peak / 1.05 * 32767), 44 + i * 2);
  fs.writeFileSync(file, buf);
}

/** A camera clip: test pattern video + the music from `from` seconds for `len` seconds (quieter, with room echo). */
function cameraClip(file, music, from, len, hue) {
  cp.execFileSync('ffmpeg', ['-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=25:duration=' + len,
    '-ss', String(from), '-t', String(len), '-i', music,
    '-filter_complex', '[0:v]hue=h=' + hue + '[v];[1:a]volume=0.6,aecho=0.6:0.3:40:0.2[a]',
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-ar', '48000', '-shortest', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  return file;
}

/** Returns { music, cameras: [{ role, files, expect: [offset, ...] }] } in dir (reused when already there). */
function makeMedia(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const music = path.join(dir, 'Synthetic Set.wav');
  if (!fs.existsSync(music)) writeTrack(music);
  const spec = [
    { role: 'Master Wide', clips: [[0, 96]] },
    { role: 'DJ Close-Up', clips: [[10, 80]] },
    { role: 'Crowd', clips: [[2, 40], [50, 46]] },             // one camera, two clips (stopped and restarted)
    { role: 'Drone', clips: [[20, 70]] },
  ];
  const cameras = spec.map((c, i) => ({ role: c.role, expect: c.clips.map((x) => x[0]),
    files: c.clips.map(([from, len], k) => { const f = path.join(dir, 'cam' + (i + 1) + '-clip' + (k + 1) + '.mp4'); return fs.existsSync(f) ? f : cameraClip(f, music, from, len, i * 90); }) }));
  return { music, cameras, duration: DUR, bpm: BPM, drops: DROPS };
}

module.exports = { makeMedia, writeTrack };
