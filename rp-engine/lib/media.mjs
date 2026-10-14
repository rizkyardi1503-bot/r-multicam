// Media helpers that only need the FFmpeg binary the plugin installer already ships
// (ffprobe is not required): probing, and audio-based camera synchronisation.
import { spawn, spawnSync } from "node:child_process";

/** Probe a media file using `ffmpeg -i` (works with the plugin's bundled FFmpeg). */
export function probe(ffmpeg, file) {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-nostdin", "-i", file], { encoding: "utf8", windowsHide: true });
  const text = String(r.stderr || "");
  if (/No such file|Invalid data found|does not exist/i.test(text)) throw new Error(`Cannot read media: ${file}`);
  const out = { file, duration: null, start: 0, hasVideo: false, hasAudio: false, width: null, height: null, fps: null, timecode: null, audioRate: null, audioChannels: null };
  const d = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (d) out.duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
  const s = text.match(/start:\s*(-?\d+(?:\.\d+)?)/);
  if (s) out.start = Number(s[1]);
  const tc = text.match(/timecode\s*:\s*(\d{2}:\d{2}:\d{2}[:;]\d{2})/);
  if (tc) out.timecode = tc[1];
  const video = text.split("\n").find((l) => /Stream #.*Video:/.test(l) && !/attached pic/.test(l));
  if (video) {
    out.hasVideo = true;
    const size = video.match(/,\s*(\d{2,5})x(\d{2,5})/);
    if (size) { out.width = Number(size[1]); out.height = Number(size[2]); }
    const fps = video.match(/,\s*(\d+(?:\.\d+)?)\s*fps/) || video.match(/,\s*(\d+(?:\.\d+)?)\s*tbr/);
    if (fps) out.fps = Number(fps[1]);
  }
  const audio = text.split("\n").find((l) => /Stream #.*Audio:/.test(l));
  if (audio) {
    out.hasAudio = true;
    const rate = audio.match(/(\d{4,6})\s*Hz/);
    if (rate) out.audioRate = Number(rate[1]);
    out.audioChannels = /mono/.test(audio) ? 1 : /5\.1/.test(audio) ? 6 : 2;
  }
  if (!out.duration) throw new Error(`Could not read the duration of ${file}`);
  return out;
}

/** Exact rational frame rate for common camera rates (NTSC rates become 1001-based). */
export function frameRate(fps) {
  const f = Number(fps) || 30;
  const ntsc = [[23.976, 24000], [29.97, 30000], [59.94, 60000], [47.952, 48000], [119.88, 120000]];
  for (const [approx, num] of ntsc) if (Math.abs(f - approx) < 0.01) return { num, den: 1001 };
  return { num: Math.round(f), den: 1 };
}

const ENV_RATE = 100; // 10 ms envelope, same hop as the plugin's analysis

function onsetEnvelope(ffmpeg, file, start, length) {
  return new Promise((resolve, reject) => {
    const args = ["-nostdin", "-hide_banner", "-v", "error", "-ss", String(start), "-i", file];
    if (length) args.push("-t", String(length));
    args.push("-map", "0:a:0", "-vn", "-ac", "1", "-ar", "8000", "-af", "highpass=f=30,lowpass=f=3500", "-f", "f32le", "pipe:1");
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    const hop = 8000 / ENV_RATE;
    const env = [];
    let carry = Buffer.alloc(0), acc = 0, n = 0, prev = 0, err = "";
    proc.stdout.on("data", (chunk) => {
      const b = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const end = b.length - (b.length % 4);
      for (let i = 0; i < end; i += 4) {
        const v = b.readFloatLE(i);
        acc += v * v;
        if (++n === hop) {
          const level = Math.log10(1e-6 + Math.sqrt(acc / hop));
          env.push(Math.max(0, level - prev));
          prev = level; acc = 0; n = 0;
        }
      }
      carry = Buffer.from(b.subarray(end));
    });
    proc.stderr.on("data", (d) => { err = (err + d).slice(-1000); });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(Float64Array.from(env)) : reject(new Error(`FFmpeg could not read audio from ${file}: ${err}`))));
  });
}

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI / len) * (inverse ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function zeroMean(a) {
  let m = 0; for (const v of a) m += v; m /= Math.max(1, a.length);
  let s = 0; const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) { out[i] = a[i] - m; s += out[i] * out[i]; }
  const k = 1 / Math.sqrt(s || 1); for (let i = 0; i < out.length; i++) out[i] *= k;
  return out;
}

/**
 * Find where a camera sits on the music timeline from its own scratch audio.
 * Returns { offset, confidence }: timeline time = camera time + offset
 * (offset 12.5 means the camera's first frame lands at 12.5 s on the music timeline).
 */
export async function syncByAudio(ffmpeg, musicFile, cameraFile, opts = {}) {
  const excerptStart = Number(opts.excerptStart) || 0;
  const excerpt = Number(opts.excerptSeconds) || 120;
  const [music, cam] = await Promise.all([
    opts.musicEnvelope ? Promise.resolve(opts.musicEnvelope) : onsetEnvelope(ffmpeg, musicFile, 0, 0),
    onsetEnvelope(ffmpeg, cameraFile, excerptStart, excerpt)
  ]);
  if (cam.length < ENV_RATE * 3) throw new Error(`Camera audio too short to sync: ${cameraFile}`);
  const a = zeroMean(music), b = zeroMean(cam);
  let size = 1; while (size < a.length + b.length) size <<= 1;
  const ar = new Float64Array(size), ai = new Float64Array(size), br = new Float64Array(size), bi = new Float64Array(size);
  ar.set(a); br.set(b);
  fft(ar, ai, false); fft(br, bi, false);
  for (let i = 0; i < size; i++) { // conj(B) * A
    const r = ar[i] * br[i] + ai[i] * bi[i], im = ai[i] * br[i] - ar[i] * bi[i];
    ar[i] = r; ai[i] = im;
  }
  fft(ar, ai, true);
  let best = -Infinity, bestLag = 0;
  for (let i = 0; i < size; i++) {
    const lag = i < size - b.length ? i : i - size; // circular index -> signed lag
    if (lag > a.length - 1 || lag < -(b.length - 1)) continue;
    if (ar[i] > best) { best = ar[i]; bestLag = lag; }
  }
  let second = -Infinity;
  for (let i = 0; i < size; i++) {
    const lag = i < size - b.length ? i : i - size;
    if (Math.abs(lag - bestLag) < ENV_RATE / 2 || lag > a.length - 1 || lag < -(b.length - 1)) continue;
    if (ar[i] > second) second = ar[i];
  }
  // Peak prominence over all candidate lags (z-score) plus margin over the best rival
  // lag more than 0.5 s away. Very repetitive music gives small margins (rival peaks one
  // beat apart), so both numbers are reported and the confidence uses both.
  let sum = 0, sq = 0, count = 0;
  for (let i = 0; i < size; i++) {
    const lag = i < size - b.length ? i : i - size;
    if (lag > a.length - 1 || lag < -(b.length - 1)) continue;
    sum += ar[i]; sq += ar[i] * ar[i]; count++;
  }
  const mean = sum / Math.max(1, count), sd = Math.sqrt(Math.max(1e-12, sq / Math.max(1, count) - mean * mean));
  const z = (best - mean) / sd;
  const ratio = second > 0 ? best / second : 10;
  const confidence = z >= 12 && ratio >= 1.05 ? "high" : z >= 7 ? "medium" : "low";
  return { offset: Math.round((bestLag / ENV_RATE - excerptStart) * 1000) / 1000, confidence, score: Math.round(best * 1000) / 1000, prominence: Math.round(z * 10) / 10, peakRatio: Math.round(ratio * 100) / 100, musicEnvelope: music };
}
