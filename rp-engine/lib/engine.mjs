// Headless version of the Premiere panel's "Agent AI Director" flow.
// The order of calls mirrors Plugin/panel.js (analyze -> enrich -> pace -> constrain ->
// applyPacing -> snapshot -> RPDirector.run), so the plan matches what the panel would make.
import path from "node:path";
import { loadEngine } from "./runtime.mjs";
import { probe, frameRate, syncByAudio } from "./media.mjs";
import { buildPlan } from "./plan-format.mjs";
import { fileKey, cacheGet, cachePut } from "./cache.mjs";

export const MODEL = "R Project Auto Music Map V14";
const CADENCES = [2, 4, 6, 8];

// Same mapping as panel.js musicContext().
export function musicContext(result) {
  if (!result) return null;
  const pacing = result.pacing || null, structure = result.structure || null;
  return {
    music_v12: result.musicV12 || null,
    estimated_bpm: result.tempo || result.bpm || null,
    bpm_confidence: result.tempoConfidence || "low",
    bpm_spread: result.tempoSpread == null ? null : result.tempoSpread,
    tempo_samples: result.tempoSamples || 0,
    beat_count: result.beatCount || 0,
    approx_beat_interval_seconds: result.beatInterval || null,
    edit_point_count: result.points ? result.points.length : 0,
    energy_samples: result.music ? result.music.length : 0,
    structure_drop_count: structure ? structure.drop_count || 0 : 0,
    structure_build_up_count: structure ? structure.build_up_count || 0 : 0,
    structure_summary: structure ? structure.summary : null,
    structure_events: structure && Array.isArray(structure.events) ? structure.events : null,
    structure_zones: structure && Array.isArray(structure.zones) ? structure.zones : null,
    music_intelligence: structure && structure.intelligence ? structure.intelligence : null,
    music_v4: result.musicV4 || null,
    music_v5: result.musicV5 || null,
    music_v6: result.musicV6 || null,
    music_v11: result.musicV11 || result.masterMusicMapV11 || null,
    music_v10: result.musicV11 || result.musicV10 || result.masterMusicMapV11 || result.masterMusicMapV10 || null,
    music_v8: result.musicV8 || result.masterMusicMapV8 || null,
    beat_first: result.beatFirst || null,
    pacing_summary: pacing ? pacing.summary : null,
    pacing_segments: pacing ? pacing.segments : null,
    pacing_capped: pacing ? !!pacing.capped : false,
    uncapped_edit_points: pacing ? pacing.uncapped_points : null
  };
}

// Same rules as panel.js constrainPacingToSelection(), with the cadences passed in.
export function constrainPacing(pacing, cadences) {
  pacing = pacing || { segments: [], config: {} };
  const allowed = normaliseCadences(cadences), fast = allowed[0], slow = allowed[allowed.length - 1];
  const nearest = (target) => {
    target = Number(target) || 6;
    let best = allowed[0], dist = Math.abs(best - target);
    for (const a of allowed.slice(1)) { const d = Math.abs(a - target); if (d < dist || (d === dist && a < best)) { best = a; dist = d; } }
    return best;
  };
  const segments = (pacing.segments || []).map((src) => {
    const x = { ...src }, reason = String(x.reason || "").toLowerCase();
    let target = Number(x.beats_per_cut) || 6;
    if (/drop|pre-drop|high-energy|build-up/.test(reason)) target = fast;
    else if (/breakdown|intro|outro|calm|low/.test(reason)) target = slow;
    x.beats_per_cut = nearest(target); x.max_hold_beats = 8;
    return x;
  });
  const cfg = { ...(pacing.config || {}), allowedCadences: allowed, minCadence: fast, maxCadence: slow, base: nearest(6), explicitCadence: allowed.length === 1, energyAdaptive: allowed.length > 1, userSelectedCadence: true, softPreference: false, maxHoldBeats: 8 };
  return { summary: `Auto Music Map V14 · selected pacing ${allowed.join("/")} beat · selected cut intervals`, segments, config: cfg };
}

function normaliseCadences(list) {
  const out = (Array.isArray(list) ? list : []).map(Number).filter((n) => CADENCES.includes(n));
  return out.length ? [...new Set(out)].sort((a, b) => a - b) : [4, 6, 8];
}

function noop() {}

/** Analyze a music file: BPM, beat grid, tempo map, energy, sections, build-ups and drops. */
export async function analyzeMusic(musicFile, options = {}) {
  const engine = options.engine || loadEngine(options.pluginDir);
  const ffmpeg = engine.RPAudio.executable(options.ffmpeg || process.env.RP_FFMPEG || "");
  const info = probe(ffmpeg, musicFile);
  if (!info.hasAudio) throw new Error(`No audio stream in ${musicFile}`);
  const fps = frameRate(options.fps || 30);
  const frame = fps.den / fps.num;
  // Exact decoded length is required by the engine's "media shorter than clip" guard.
  const duration = Math.floor(info.duration * 100) / 100;
  const snapshot = { clips: [{ file: path.resolve(musicFile), input: 0, start: 0, end: duration }], duration, frame, signature: "headless" };
  const enrichOptions = {
    sensitivity: options.sensitivity || "balanced",
    preBeats: clampInt(options.preBeats, 8, 64, 24),
    postBeats: clampInt(options.postBeats, 8, 64, 32),
    confidenceThreshold: options.confidenceThreshold == null ? null : Number(options.confidenceThreshold),
    minSpacingBeats: Number(options.minSpacingBeats) || 64,
    cutsBefore: 3,
    cutsAfter: 4
  };
  const cacheName = `music-${fileKey(musicFile, enrichOptions, fps, engine.version)}.v8`;
  const cached = cacheGet(options.cacheDir, cacheName);
  if (cached) { (options.progress || noop)(1, "Reusing cached music analysis"); return { engine, ffmpeg, info, duration, fps, result: cached }; }
  const state = { cancelled: false, process: null };
  // Two resumable steps for long sets: raw decode/beat analysis, then music intelligence.
  const rawName = `raw-${fileKey(musicFile, fps, engine.version)}.v8`;
  let result = cacheGet(options.cacheDir, rawName);
  if (!result) {
    result = await engine.RPAudio.run(snapshot, ffmpeg, state, options.progress || noop);
    cachePut(options.cacheDir, rawName, result);
  }
  const t0 = Date.now();
  if (!result.beats || !result.beats.length) throw new Error("No clear beats detected in the music.");
  engine.RPMusic.enrich(result, duration, enrichOptions);
  engine.RPBeatFirst.enrich(result, duration);
  if (process.env.RP_ENGINE_TIMING) console.error(`music intelligence: ${Date.now() - t0} ms`);
  result.snapshot = snapshot;
  cachePut(options.cacheDir, cacheName, result);
  return { engine, ffmpeg, info, duration, fps, result };
}

function clampInt(v, lo, hi, d) { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; }

function mergeCoverage(clips, tol) {
  const ranges = clips.filter((c) => !c.disabled && c.end > c.start).map((c) => ({ start: c.start, end: c.end })).sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  for (const r of ranges) { const last = out[out.length - 1]; if (last && r.start <= last.end + tol) last.end = Math.max(last.end, r.end); else out.push({ ...r }); }
  return out;
}

/**
 * Build the same director snapshot host.jsx rp_buildAISnapshot() produces, but from
 * camera clips placed on the music timeline instead of Premiere video tracks.
 * Each camera is one "track"; each of its clips is one timeline clip.
 */
export function directorSnapshot(cameras, points, duration, frame) {
  const bounds = [0, ...points, duration], tol = frame / 4;
  const tracks = cameras.map((cam, index) => {
    const clips = [];
    for (const c of cam.clips) {
      const start = Math.max(0, c.offset + c.trim), end = Math.min(duration, c.offset + c.duration);
      if (end > start) clips.push({ start, end, input: start - c.offset, file: c.file, supported: c.hasVideo, disabled: !c.hasVideo });
    }
    return { index, clips, coverageRanges: mergeCoverage(clips, tol) };
  });
  const intervals = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const candidates = [], coverageNotes = [];
    for (const t of tracks) {
      const full = t.coverageRanges.some((r) => r.start <= bounds[i] + tol && r.end >= bounds[i + 1] - tol);
      coverageNotes.push(`V${t.index + 1}: ${full ? "covered" : "gap or disabled clips"}`);
      if (full) candidates.push(t.index);
    }
    intervals.push({ id: i, start: bounds[i], end: bounds[i + 1], candidates, coverageNotes });
  }
  return { sequenceID: "headless", projectPath: "", duration, frame, tracks, intervals, points, a1Signature: "headless", boundaryMode: "internal", signature: "headless" };
}

const RANK = { high: 2, medium: 1, low: 0 };

/** Audio excerpt used for syncing: the whole clip if short, otherwise 2 minutes from ~20% in. */
function excerptFor(duration) {
  if (duration <= 150) return { excerptStart: 0, excerptSeconds: duration };
  return { excerptStart: Math.min(duration * 0.2, duration - 120), excerptSeconds: 120 };
}

/**
 * Full plan: music analysis + pacing + camera decisions -> rp-multicam-plan/1.
 * cameras: [{ files: [path, ...] | file: path, role?, name?, offset? }]
 *   - every clip of a camera is synced to the music from its own audio unless `offset`
 *     is given (only allowed for single-clip cameras) or sync is "none";
 *   - clips whose sync confidence is below `minSyncConfidence` (default "medium") or that
 *     do not overlap the music are left out and listed in `excluded_clips`.
 */
export async function planMulticam(options) {
  if (!options || !options.music) throw new Error("music is required");
  if (!Array.isArray(options.cameras) || !options.cameras.length) throw new Error("at least one camera is required");
  const progress = options.progress || noop;
  const engine = loadEngine(options.pluginDir);
  const ffmpegPath = engine.RPAudio.executable(options.ffmpeg || process.env.RP_FFMPEG || "");
  const minRank = RANK[options.minSyncConfidence || "medium"] ?? 1;

  // Probe every clip first so the timeline frame rate follows the footage.
  const specs = options.cameras.map((c, i) => {
    const files = (Array.isArray(c.files) && c.files.length ? c.files : [c.file]).filter(Boolean);
    if (!files.length) throw new Error(`camera ${i + 1} has no files`);
    if (Number.isFinite(Number(c.offset)) && files.length > 1) throw new Error(`camera ${i + 1}: offset can only be given for a single-file camera`);
    return { src: c, probes: files.map((f) => probe(ffmpegPath, path.resolve(f))) };
  });
  const firstVideo = specs.flatMap((s) => s.probes).find((p) => p.hasVideo) || {};
  const fpsValue = options.fps || firstVideo.fps || 30;

  progress(0.02, "Analyzing music");
  const analysis = await analyzeMusic(options.music, { ...options, engine, ffmpeg: ffmpegPath, fps: fpsValue, progress: (p, m) => progress(0.02 + 0.45 * p, m) });
  const { result, duration, fps } = analysis;
  const frame = fps.den / fps.num;

  // Place every clip on the music timeline.
  const cache = {};
  const totalClips = specs.reduce((n, s) => n + s.probes.length, 0);
  let done = 0;
  const cameras = [], syncOnly = [];
  const syncClip = async (info, extra, version) => {
    const name = `sync-${fileKey(options.music, info.file, excerptFor(info.duration), extra || null, version)}.v8`;
    let s = cacheGet(options.cacheDir, name);
    if (!s) {
      try { s = await syncByAudio(ffmpegPath, path.resolve(options.music), info.file, { cache, cacheDir: options.cacheDir, ...excerptFor(info.duration), ...(extra || {}) }); }
      catch (e) { s = { error: String(e.message || e) }; }
      cachePut(options.cacheDir, name, s);
    }
    return s;
  };
  for (let i = 0; i < specs.length; i++) {
    const { src, probes } = specs[i];
    const excluded = [], candidates = [];
    // Pass 1: every clip against the whole music.
    for (const info of probes) {
      progress(0.48 + 0.12 * done++ / totalClips, `Syncing camera ${i + 1}: ${path.basename(info.file)}`);
      if (!info.hasVideo) { excluded.push({ file: info.file, reason: "no video stream" }); continue; }
      let offset = Number(src.offset);
      const wantAudio = src.sync === "audio" || (src.sync !== "none" && !Number.isFinite(offset));
      if (!wantAudio) { candidates.push({ info, offset: Number.isFinite(offset) ? offset : 0, sync: { method: Number.isFinite(offset) ? "manual" : "none", confidence: Number.isFinite(offset) ? "high" : "low" } }); continue; }
      if (!info.hasAudio) { excluded.push({ file: info.file, reason: "no audio to sync" }); continue; }
      const s = await syncClip(info, null, 4);
      if (s.error) { excluded.push({ file: info.file, reason: s.error }); continue; }
      candidates.push({ info, offset: s.offset, sync: { method: "audio", confidence: s.confidence, score: s.score, prominence: s.prominence, peak_ratio: s.peakRatio } });
    }
    if (options.syncOnly) {
      syncOnly.push(candidates.map((c) => ({ file: c.info.file, created: c.info.created, duration: c.info.duration, offset: c.offset, sync: c.sync })));
      continue;
    }
    // Pass 2: a camera has one clock, so (creation time - timeline offset) is the same for
    // all its clips. Find that anchor from confident matches, then search every clip only
    // near where the clock puts it. Matches the clock disagrees with are rejected.
    const weight = (c) => (c.sync.confidence === "high" ? 3 : c.sync.confidence === "medium" ? 1 : 0);
    const timed = candidates.filter((c) => c.sync.method === "audio" && Number.isFinite(c.info.created) && weight(c) > 0);
    const forced = options.clockAnchors && options.clockAnchors[i];
    let anchor = null, anchorWeight = 0;
    if (forced) { anchor = forced.anchor; anchorWeight = forced.weight || 0; }
    else for (const c of timed) {
      const a0 = c.info.created - c.offset;
      const support = timed.filter((d) => Math.abs(d.info.created - d.offset - a0) <= 2.5);
      const w = support.reduce((n, d) => n + weight(d), 0);
      if (w > anchorWeight) { anchorWeight = w; anchor = support.reduce((n, d) => n + (d.info.created - d.offset) * weight(d), 0) / w; }
    }
    const confirmedByClock = forced ? true : anchor !== null && (anchorWeight >= 3 && timed.filter((d) => Math.abs(d.info.created - d.offset - anchor) <= 2.5).length >= 2);
    const radius = forced ? forced.radius || 4 : 3;
    const placed = [];
    for (const c of candidates) {
      if (c.sync.method !== "audio") { placed.push(c); continue; }
      if (confirmedByClock && Number.isFinite(c.info.created)) {
        const expected = c.info.created - anchor;
        if (expected >= duration + 2 || expected + c.info.duration <= -2) { excluded.push({ file: c.info.file, reason: "camera clock places it outside this music", offset: expected, sync: c.sync }); continue; }
        progress(0.6 + 0.07 * done / totalClips, `Clock-guided sync: ${path.basename(c.info.file)}`);
        const s = await syncClip(c.info, { expectedOffset: Math.round(expected * 100) / 100, searchRadius: radius }, 4);
        if (s.error) { excluded.push({ file: c.info.file, reason: s.error }); continue; }
        const sync = { method: "audio+clock", confidence: s.confidence, score: s.score, prominence: s.prominence, peak_ratio: s.peakRatio, clock_offset: Math.round(expected * 1000) / 1000 };
        if (RANK[s.confidence] < minRank) { excluded.push({ file: c.info.file, reason: `sync confidence ${s.confidence} near the clock position`, offset: s.offset, sync }); continue; }
        placed.push({ info: c.info, offset: s.offset, sync });
      } else if (RANK[c.sync.confidence] >= minRank) placed.push(c);
      else excluded.push({ file: c.info.file, reason: `sync confidence ${c.sync.confidence}`, offset: c.offset, sync: c.sync });
    }
    // A camera records one clip at a time: drop the weaker of two clips that overlap.
    const clips = [];
    for (const c of placed.sort((x, y) => weight(y) - weight(x) || y.sync.score - x.sync.score)) {
      const s0 = c.offset, e0 = c.offset + c.info.duration;
      const clash = clips.find((k) => Math.min(e0, k.offset + k.duration) - Math.max(s0, k.offset) > 1);
      if (clash) { excluded.push({ file: c.info.file, reason: `overlaps ${path.basename(clash.file)} of the same camera`, offset: c.offset, sync: c.sync }); continue; }
      let offset = Math.round(c.offset / frame) * frame; // frame-aligned
      if (offset >= duration || offset + c.info.duration <= 0) { excluded.push({ file: c.info.file, reason: "outside the music", offset, sync: c.sync }); continue; }
      clips.push({ ...c.info, offset, trim: 0, sync: c.sync });
    }
    clips.sort((x, y) => x.offset - y.offset);
    for (let k = 1; k < clips.length; k++) {
      const prev = clips[k - 1];
      if (clips[k].offset < prev.offset + prev.duration) prev.duration = Math.max(0, clips[k].offset - prev.offset);
    }
    const kept = clips.filter((c) => c.duration > frame);
    cameras.push({ role: src.role || src.name || `Camera ${i + 1}`, name: src.name || src.role || `Camera ${i + 1}`, clips: kept, excluded, hasVideo: kept.length > 0, clock: confirmedByClock ? { anchor_utc: new Date(anchor * 1000).toISOString(), support: anchorWeight, source: forced ? forced.source || "session" : "this part" } : null });
  }


  if (options.syncOnly) return { duration, cameras: syncOnly };

  // Pacing exactly like makeAIPlan() in panel.js.
  progress(0.67, "Building section-aware pacing");
  const state = { cancelled: false, process: null };
  let pacing = await engine.RPDirector.pace({ key: "agent-ai", model: MODEL, music: result.music || [], musicAnalysis: musicContext(result), duration }, state, noop);
  pacing = constrainPacing(pacing, options.cadences);
  engine.RPAudio.applyPacing(result, pacing, duration, 6000);
  if (!result.points || !result.points.length) throw new Error("Auto Music Map produced no usable beat-aligned edit points.");

  // Frame-snap like rp_parseInternalPoints().
  const points = [];
  for (const t of result.points) { const snap = Math.round(t / frame) * frame; if (snap > 0 && snap < duration && (!points.length || snap > points[points.length - 1] + frame / 2)) points.push(snap); }

  const enabledCameras = (options.enabledCameras || cameras.map((_, i) => i)).map(Number).filter((i) => i >= 0 && i < cameras.length && cameras[i].hasVideo);
  if (!enabledCameras.length) throw new Error("No camera clip could be placed on this music (check that the cameras recorded sound during this set).");
  const snapshot = directorSnapshot(cameras, points, duration, frame);
  progress(0.7, "Choosing cameras");
  const roles = cameras.map((c, i) => `V${i + 1}: ${c.role}`).join("\n");
  const dropCamera = options.dropCamera == null || options.dropCamera === "auto" ? null : Number(options.dropCamera);
  const director = await engine.RPDirector.run(snapshot, {
    key: "agent-ai", model: MODEL, roles, enabledCameras, dropCamera,
    vision: !!options.vision, budget: Number(options.visionBudget) || 120, ffmpeg: ffmpegPath,
    music: result.music || [], musicAnalysis: musicContext(result)
  }, state, (p, m) => progress(0.7 + 0.28 * p, m));

  progress(1, "Plan ready");
  return buildPlan({ engine, analysis, cameras, points, snapshot: director.snapshot || snapshot, director, fps, frame, duration, musicFile: path.resolve(options.music), cadences: normaliseCadences(options.cadences), musicContext: musicContext(result) });
}
