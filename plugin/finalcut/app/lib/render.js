// Renders ready-to-post MP4s straight from a multicam plan (rp-multicam-plan/1): one clip per drop or the full set,
// in 9:16, 4:5 or 16:9, with an optional punch-in on the drop and an optional .cube LUT. FFmpeg only, no other tools.
// Each camera shot is encoded to an intermediate file at a fixed size and frame rate (frame-exact, so there is no
// drift), the shots are joined without re-encoding, and the master music is laid underneath. Original media is only read.
'use strict';
const fs = require('fs'), path = require('path'), cp = require('child_process');

const FORMATS = { '9x16': [1080, 1920], '4x5': [1080, 1350], '16x9': [1920, 1080] };
const FPS = 30;
const ZOOM = 0.12, ZOOM_IN = 0.3;          // punch-in on the drop: +12 % over 0.3 s

function ffmpegBin() { return process.env.RP_FFMPEG || 'ffmpeg'; }

/** Runs ffmpeg; rejects with the last lines of its log. Stops it when the signal aborts. */
function ff(args, { cwd, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
    const p = cp.spawn(ffmpegBin(), ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...args], { cwd, windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    const stop = () => p.kill('SIGKILL');
    if (signal) signal.addEventListener('abort', stop, { once: true });
    p.on('error', (e) => reject(new Error('FFmpeg could not start (' + e.message + '). Run the installer again.')));
    p.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', stop);
      if (signal && signal.aborted) return reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
      code === 0 ? resolve() : reject(new Error('FFmpeg failed: ' + err.trim().split('\n').slice(-3).join(' ')));
    });
  });
}

/** The clip that films timeline second t: the cut's camera first, else any camera (no black when another angle has it). */
function sourceAt(plan, camera, t) {
  const inCam = (c) => c && (c.clips || []).find((k) => t >= k.offset - 1e-3 && t < k.offset + k.duration - 1 / FPS);
  const order = [camera, ...plan.cameras.map((_, i) => i).filter((i) => i !== camera)];
  for (const i of order) { const k = inCam(plan.cameras[i]); if (k) return { file: k.file, at: Math.max(0, t - k.offset), camera: i }; }
  return null;
}

/** Camera shots covering [start, end): [{start, end, file, at, drop}] (file null = no coverage). */
function shots(plan, start, end) {
  const out = [];
  for (const c of plan.cuts) {
    const s = Math.max(start, c.start), e = Math.min(end, c.end);
    if (e - s < 1 / FPS) continue;
    const src = sourceAt(plan, c.camera, s);
    out.push({ start: s, end: e, file: src ? src.file : null, at: src ? src.at : 0, drop: c.drop != null && Math.abs(c.start - s) < 1e-3 });
  }
  return out;
}

/** Drop windows: `length` seconds with the drop at 40 %, kept inside the set. */
function dropWindows(plan, length = 30) {
  const dur = plan.timeline.duration;
  return (plan.music.drops || []).map((d, i) => {
    let start = Math.max(0, d.time - length * 0.4);
    const end = Math.min(dur, start + length);
    start = Math.max(0, end - length);
    return { index: i, time: d.time, confidence: d.confidence, start, end };
  });
}

function videoFilter(w, h, punch) {
  const cover = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const zoom = punch ? `,scale=w='trunc(${w}*(1+${ZOOM}*min(t/${ZOOM_IN},1))/2)*2':h='trunc(${h}*(1+${ZOOM}*min(t/${ZOOM_IN},1))/2)*2':eval=frame,crop=${w}:${h}` : '';
  return `${cover}${zoom},setsar=1`;
}

/**
 * Renders [start, end) of the plan to `out`. opts: {format, zoom, lut (path to .cube), workDir, signal, progress(p, text)}.
 * Returns {file, duration, shots}.
 */
async function renderRange(plan, start, end, out, opts = {}) {
  const [w, h] = FORMATS[opts.format] || FORMATS['9x16'];
  const work = fs.mkdtempSync(path.join(opts.workDir || path.dirname(out), '.render-'));
  const progress = opts.progress || (() => {});
  try {
    let lutFilter = '';
    if (opts.lut) {
      if (!/\.cube$/i.test(opts.lut) || !fs.existsSync(opts.lut)) throw new Error('The LUT must be a .cube file.');
      fs.copyFileSync(opts.lut, path.join(work, 'look.cube'));             // relative name: no path escaping in the filter
      lutFilter = ',lut3d=look.cube';
    }
    const list = shots(plan, start, end);
    if (!list.length) throw new Error('Nothing to render in this part of the set.');
    const names = [];
    let frame0 = Math.round(start * FPS);
    for (let i = 0; i < list.length; i++) {
      const s = list[i], frame1 = Math.round(s.end * FPS), frames = frame1 - frame0;
      frame0 = frame1;
      if (frames <= 0) continue;
      const name = 'shot' + String(i).padStart(4, '0') + '.mp4';
      const input = s.file ? ['-ss', s.at.toFixed(3), '-i', s.file] : ['-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${FPS}`];
      const vf = (s.file ? videoFilter(w, h, opts.zoom && s.drop) + ',tpad=stop=-1:stop_mode=clone' : 'setsar=1') + lutFilter + `,fps=${FPS},format=yuv420p`;
      await ff([...input, '-an', '-vf', vf, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
        '-r', String(FPS), '-video_track_timescale', String(FPS * 1000), name], { cwd: work, signal: opts.signal });
      names.push(name);
      progress((i + 1) / (list.length + 1), 'Rendering ' + path.basename(out) + ' (' + (i + 1) + '/' + list.length + ')');
    }
    fs.writeFileSync(path.join(work, 'list.txt'), names.map((n) => "file '" + n + "'").join('\n') + '\n');
    const len = (Math.round(end * FPS) - Math.round(start * FPS)) / FPS;
    const fade = Math.min(1, len / 4);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await ff(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', plan.music.file,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-af', `afade=t=in:d=${fade / 2},afade=t=out:st=${(len - fade).toFixed(3)}:d=${fade}`,
      '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-t', len.toFixed(3), '-movflags', '+faststart', path.resolve(out)], { cwd: work, signal: opts.signal });
    progress(1, 'Rendered ' + path.basename(out));
    return { file: out, duration: len, shots: names.length };
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

/** A JPEG still of the set at timeline second t (the camera on air then). */
async function still(plan, t, out, opts = {}) {
  const cut = plan.cuts.find((c) => t >= c.start && t < c.end) || plan.cuts[plan.cuts.length - 1];
  const src = cut && sourceAt(plan, cut.camera, t);
  if (!src) return null;
  await ff(['-ss', src.at.toFixed(3), '-i', src.file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', path.resolve(out)], { signal: opts.signal });
  return out;
}

module.exports = { renderRange, still, dropWindows, shots, sourceAt, FORMATS, FPS };
