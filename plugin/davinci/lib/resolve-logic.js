// Pure DaVinci-side logic (no I/O): timeline snapshot -> engine input, plan -> AppendToTimeline infos, render settings.
// Input is the raw table returned by the bridge 'snapshot' command (frames, as Resolve reports them).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');

const SPEED_TOLERANCE = 0.01;
const NTSC = [24000 / 1001, 30000 / 1001, 48000 / 1001, 60000 / 1001, 120000 / 1001];

class LogicError extends Error {}

// Lua sends empty arrays as {} : normalise.
function arr(x) { return Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []; }

/** '25', '29.97 DF', '29.97 NDF', '23.98' -> fps (NTSC rates exact), or null. */
function parseFps(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase().replace(/\s*N?DF\s*$/, '').trim();
  if (!text) return null;
  const fps = Number(text);
  if (!Number.isFinite(fps) || fps <= 0) return null;
  for (const exact of NTSC) if (Math.abs(fps - exact) <= 0.01) return exact;
  return fps;
}

function sourceFps(mpi, tlFps) { return parseFps(mpi && mpi.fps) || tlFps; }

function isSupported(mpi, fileExists) {
  if (!mpi) return false;
  const p = String(mpi.path || ''), kind = String(mpi.type || '').toLowerCase();
  if (!p || /compound|fusion|timeline|multicam/.test(kind)) return false;
  return fileExists(p);
}

/** Speed != 100 %: source frames used vs record frames, against clip fps / timeline fps (1 %, at least 1.5 frames). */
function speedChanged(item, tlFps) {
  const rec = Number(item.end) - Number(item.start), src = Number(item.srcEnd) - Number(item.srcStart);
  if (!(rec > 0) || !Number.isFinite(src)) return false;
  const expected = rec * sourceFps(item.mpi, tlFps) / tlFps;
  return Math.abs(src - expected) > Math.max(SPEED_TOLERANCE * expected, 1.5);
}

const isTransition = (it) => String(it.type || '').toLowerCase() === 'transition';

/**
 * Raw bridge snapshot -> { snapshot (engine JSON: a1, tracks, ...), refs (frame data for apply) }.
 * Rules as the Premiere host: A1 = audio track 1, no overlaps, not empty; disabled/locked V tracks skipped.
 */
function buildSnapshot(raw, { log = () => {}, fileExists = (p) => fs.existsSync(p) } = {}) {
  const tl = raw.timeline || {};
  const fps = parseFps(tl.settings && tl.settings.timelineFrameRate) || parseFps(raw.projectFps);
  if (!fps) throw new LogicError('Could not read the timeline frame rate.');
  const frame = 1 / fps, tlStart = Number(tl.start), duration = Math.round((Number(tl.end) - tlStart) / fps * 1e6) / 1e6;
  if (!(duration > 0)) throw new LogicError('The timeline is empty.');
  if (!(Number(raw.audioTracks) >= 1)) throw new LogicError('No audio track A1. Put the music mix on A1 (the first audio track).');

  const a1Raw = [];
  for (const it of arr(raw.audio)) {
    if (isTransition(it) || it.enabled === false) continue;
    const mpi = it.mpi, p = mpi && mpi.path;
    if (!mpi || !p) throw new LogicError('A1 contains a clip without a media file (compound clip?). Use a WAV/MP3 file on A1: ' + it.name);
    if (!fileExists(p)) throw new LogicError('A1 media unavailable: ' + p);
    if (speedChanged(it, fps)) throw new LogicError('A1 has speed changes (' + it.name + '). Render A1 to WAV first.');
    a1Raw.push({ it, mpi, path: p, srcStart: Number(it.srcStart) });
  }
  const vRaw = new Map(), skipped = [];
  for (const tr of arr(raw.video)) {
    const n = Number(tr.n);
    if (tr.enabled === false) { skipped.push('V' + n + ' disabled'); continue; }
    if (tr.locked === true) { skipped.push('V' + n + ' locked'); continue; }
    const rows = [];
    for (const it of arr(tr.items)) {
      if (isTransition(it)) continue;
      let supported = isSupported(it.mpi, fileExists);
      if (supported && speedChanged(it, fps)) { log('V' + n + ': "' + it.name + '" has a speed change; it is not used as camera footage.'); supported = false; }
      rows.push({ it, mpi: it.mpi || null, path: it.mpi && it.mpi.path || '', supported, disabled: it.enabled === false, srcStart: supported ? Number(it.srcStart) : 0 });
    }
    if (!rows.length) { skipped.push('V' + n + ' empty'); continue; }
    vRaw.set(n, rows);
  }
  // Source frames are 0-based from the first frame of the file, whatever the clip's start timecode or 'Start'
  // property (verified live in Resolve 21.1), so nothing is subtracted: seconds = source frame / clip fps.
  const secondsIn = (r) => r.srcStart / sourceFps(r.mpi, fps);
  const r3 = (x) => Math.round(x * 1000) / 1000, r6 = (x) => Math.round(x * 1e6) / 1e6;

  let a1 = [];
  for (const r of a1Raw) {
    const start = r3((r.it.start - tlStart) / fps), end = r3((r.it.end - tlStart) / fps);
    if (end <= start) continue;
    const input = r3(secondsIn(r));
    if (input < 0) throw new LogicError('Invalid audio In point on A1: ' + r.it.name);
    a1.push({ clip: { file: r.path.replace(/\\/g, '/'), start, end, input }, ref: { mpiId: r.mpi.id, path: r.path, mpi: r.mpi, start: r.it.start, end: r.it.end, duration: r.it.duration, srcStart: r.srcStart } });
  }
  a1.sort((x, y) => x.clip.start - y.clip.start);
  if (!a1.length) throw new LogicError('A1 is empty or all A1 clips are disabled. The plugin reads the music only from A1 (the first audio track).');
  for (let i = 1; i < a1.length; i++) if (a1[i].clip.start < a1[i - 1].clip.end - 0.001) throw new LogicError('A1 clips overlap. Render the A1 mix to WAV for accurate analysis.');

  const tracks = [], trackRefs = {};
  for (const n of [...vRaw.keys()].sort((a, b) => a - b)) {
    const clips = [], refs = [];
    for (const r of vRaw.get(n)) {
      clips.push({ file: r.path.replace(/\\/g, '/'), start: r6((r.it.start - tlStart) / fps), end: r6((r.it.end - tlStart) / fps),
        input: r.supported ? r6(secondsIn(r)) : 0, supported: r.supported, disabled: r.disabled });
      refs.push({ mpiId: r.mpi && r.mpi.id, path: r.path, mpi: r.mpi, supported: r.supported, disabled: r.disabled,
        startFrame: Number(r.it.start), endFrame: Number(r.it.end), sourceStart: r.srcStart });
    }
    tracks.push({ index: n - 1, name: 'V' + n, clips });
    trackRefs[n - 1] = refs;
  }
  const a1Clips = a1.map((x) => x.clip);
  const a1Snap = { name: tl.name, duration, frame, clips: a1Clips, range: { start: 0, end: duration, selected: false } };
  a1Snap.signature = JSON.stringify([a1Clips, Math.round(frame * 1e6) / 1e6]);
  const settings = {};
  for (const k of ['timelineFrameRate', 'timelineResolutionWidth', 'timelineResolutionHeight', 'timelineDropFrameTimecode']) if (tl.settings && tl.settings[k] != null && tl.settings[k] !== '') settings[k] = String(tl.settings[k]);
  const snapshot = { timelineId: tl.id, timelineName: tl.name, fps, tlStart, duration, frame, a1: a1Snap, tracks, skipped, settings,
    timelineNames: arr(raw.timelineNames) };
  return { snapshot, refs: { a1: a1.map((x) => x.ref), tracks: trackRefs } };
}

/** Blank Camera Roles: one 'Vn: Camera n' per readable track, so roles map by track number. */
function defaultRoles(snapshot) { return snapshot.tracks.map((t) => 'V' + (t.index + 1) + ': Camera ' + (t.index + 1)).join('\n'); }

/** AppendToTimeline endFrame. Verified live in Resolve 21.1: endFrame is EXCLUSIVE (inclusive = false). */
// Source frames are integers: every boundary is rounded from its EXACT position (sourceStart + offset * fps ratio), so a
// clip that ends at boundary X and the next one that starts at X get the same integer: no overlap, no gap.
const frameAt = (x) => Math.round(x + 1e-9);
function endFrame(start, srcLen, inclusive) { return frameAt(start + srcLen) - (inclusive ? 1 : 0); }

/** Engine plan -> video AppendToTimeline infos for a NEW timeline (merged, split at clip edges, gaps logged). */
function planSegments(plan, snapshot, refs, newStart, { inclusive = false, log = () => {} } = {}) {
  const fps = snapshot.fps, tlStart = snapshot.tlStart, byId = new Map(plan.intervals.map((it) => [it.id, it]));
  const pieces = [], gaps = [];
  for (const choice of plan.choices) {
    const it = byId.get(choice.id), cam = Number(choice.camera);
    const sF = Math.round(it.start * fps), eF = Math.round(it.end * fps);
    if (eF <= sF) continue;
    if (cam < 0) { gaps.push([it.start, it.end, 'no camera chosen']); continue; }
    const track = refs.tracks[cam];
    if (!track) { gaps.push([it.start, it.end, 'V' + (cam + 1) + ' not readable']); continue; }
    let covered = 0;
    for (const ref of track.slice().sort((a, b) => a.startFrame - b.startFrame)) {
      if (!ref.supported || ref.disabled) continue;
      const a = Math.max(sF, ref.startFrame - tlStart), b = Math.min(eF, ref.endFrame - tlStart);
      if (b <= a) continue;
      const ratio = sourceFps(ref.mpi, fps) / fps;
      pieces.push({ camera: cam, ref, record: a, length: b - a, src: ref.sourceStart + (tlStart + a - ref.startFrame) * ratio, ratio, id: it.id });
      covered += b - a;
    }
    if (covered < eF - sF) gaps.push([it.start, it.end, 'V' + (cam + 1) + ' has no usable footage for ' + (eF - sF - covered) + ' frame(s)']);
  }
  const merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.camera === p.camera && last.ref === p.ref && last.record + last.length === p.record && Math.abs(last.src + last.length * last.ratio - p.src) < 1e-6) {
      last.length += p.length; last.ids.push(p.id);
    } else merged.push(Object.assign({}, p, { ids: [p.id] }));
  }
  const infos = merged.map((m) => {
    const srcLen = m.length * m.ratio;
    return { mpiId: m.ref.mpiId, path: m.ref.path, startFrame: frameAt(m.src), endFrame: endFrame(m.src, srcLen, inclusive),
      recordFrame: newStart + m.record, trackIndex: m.camera + 1, mediaType: 1, _length: m.length, _srcLen: srcLen, _ratio: m.ratio, _intervals: m.ids };
  });
  for (const g of gaps) log('Gap left at ' + g[0].toFixed(2) + '-' + g[1].toFixed(2) + ' s: ' + g[2]);
  return { infos, gaps };
}

function musicInfos(snapshot, refs, newStart, { inclusive = false } = {}) {
  const fps = snapshot.fps, tlStart = snapshot.tlStart;
  return refs.a1.map((r) => {
    // Length from the timeline duration and the clip's own fps (never from GetSourceEndFrame, which is inclusive at
    // the end of the media). A 24 fps-labelled WAV on a 25 fps timeline: 3000 record frames -> 2880 source frames.
    const length = Number(r.duration) > 0 ? Number(r.duration) : r.end - r.start, srcLen = length * sourceFps(r.mpi, fps) / fps;
    return { mpiId: r.mpiId, path: r.path, startFrame: frameAt(r.srcStart), endFrame: endFrame(r.srcStart, srcLen, inclusive),
      recordFrame: newStart + (r.start - tlStart), trackIndex: 1, mediaType: 2, _length: length, _srcLen: srcLen, _ratio: sourceFps(r.mpi, fps) / fps, _intervals: [] };
  });
}

/** Bridge payload: drop the private (_) fields. */
function publicInfo(info) { const o = {}; for (const k of Object.keys(info)) if (!k.startsWith('_')) o[k] = info[k]; return o; }

function uniqueTimelineName(names, base) {
  const set = new Set(arr(names));
  let name = base, n = 2;
  while (set.has(name)) name = base + ' (' + (n++) + ')';
  return name;
}

function clockName(seconds) {
  const s = Math.round(seconds), p = (x) => String(x).padStart(2, '0');
  return p(Math.floor(s / 3600)) + p(Math.floor((s % 3600) / 60)) + p(s % 60);
}

/** A file name not yet in the folder (or in `taken`): "Best Drop 01 - 000059", then " (2)", " (3)"... */
function freeName(folder, base, taken, ext = '.mp4', exists = (p) => fs.existsSync(p)) {
  let name = base, n = 2;
  const lower = (x) => x.toLowerCase();
  while (taken.has(lower(name)) || exists(path.join(folder, name + ext))) name = base + ' (' + (n++) + ')';
  taken.add(lower(name));
  return name;
}

/** Render settings for one drop. DaVinci's unique-filename suffix is off; the engine picks a free name itself. */
function dropRenderSettings(drop, index, snapshot, targetDir, customName) {
  return { SelectAllFrames: false, MarkIn: snapshot.tlStart + Math.round(drop.start * snapshot.fps), MarkOut: snapshot.tlStart + Math.round(drop.end * snapshot.fps) - 1,
    TargetDir: String(targetDir).replace(/\\/g, '/'), CustomName: customName || 'Best Drop ' + String(index).padStart(2, '0') + ' - ' + clockName(drop.time),
    UseUniqueFilenames: false, ExportVideo: true, ExportAudio: true };
}

/** Frame rate as DaVinci writes it (23.976, 29.97, 59.94 ...). */
function fpsString(fps) {
  for (const [exact, s] of [[24000 / 1001, '23.976'], [30000 / 1001, '29.97'], [48000 / 1001, '47.952'], [60000 / 1001, '59.94'], [120000 / 1001, '119.88']])
    if (Math.abs(fps - exact) < 1e-6) return s;
  return String(Math.round(fps * 1000) / 1000);
}

function defaultDropFolder() {
  return path.join(os.homedir(), process.platform === 'darwin' ? 'Movies' : 'Videos', 'R Project Best Drops');
}

const FINAL_STATES = ['Complete', 'Failed', 'Cancelled', 'Background Render Cancelled', 'Remote Render Cancelled'];

module.exports = { LogicError, arr, parseFps, sourceFps, speedChanged, buildSnapshot, defaultRoles, endFrame, planSegments,
  musicInfos, publicInfo, uniqueTimelineName, clockName, dropRenderSettings, freeName, fpsString, defaultDropFolder, FINAL_STATES };
