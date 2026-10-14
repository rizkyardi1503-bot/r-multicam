// Headless version of the Premiere panel's "Agent AI Director" flow.
// The order of calls mirrors Plugin/panel.js (analyze -> enrich -> pace -> constrain ->
// applyPacing -> snapshot -> RPDirector.run), so the plan matches what the panel would make.
import path from "node:path";
import { loadEngine } from "./runtime.mjs";
import { probe, frameRate, syncByAudio } from "./media.mjs";
import { buildPlan } from "./plan-format.mjs";

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
  const state = { cancelled: false, process: null };
  const result = await engine.RPAudio.run(snapshot, ffmpeg, state, options.progress || noop);
  if (!result.beats || !result.beats.length) throw new Error("No clear beats detected in the music.");
  engine.RPMusic.enrich(result, duration, {
    sensitivity: options.sensitivity || "balanced",
    preBeats: clampInt(options.preBeats, 8, 64, 24),
    postBeats: clampInt(options.postBeats, 8, 64, 32),
    confidenceThreshold: options.confidenceThreshold == null ? null : Number(options.confidenceThreshold),
    minSpacingBeats: Number(options.minSpacingBeats) || 64,
    cutsBefore: 3,
    cutsAfter: 4
  });
  engine.RPBeatFirst.enrich(result, duration);
  result.snapshot = snapshot;
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
 * camera files placed on the music timeline instead of Premiere video tracks.
 */
export function directorSnapshot(cameras, points, duration, frame) {
  const bounds = [0, ...points, duration], tol = frame / 4;
  const tracks = cameras.map((cam, index) => {
    const start = Math.max(0, cam.offset), end = Math.min(duration, cam.offset + cam.duration);
    const clips = end > start ? [{ start, end, input: start - cam.offset, file: cam.file, supported: cam.hasVideo, disabled: !cam.hasVideo }] : [];
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

/**
 * Full plan: music analysis + pacing + camera decisions -> rp-multicam-plan/1.
 * cameras: [{ file, role?, name?, offset? (seconds on the music timeline) }]
 * sync: "audio" (default when offset is missing) | "none"
 */
export async function planMulticam(options) {
  if (!options || !options.music) throw new Error("music is required");
  if (!Array.isArray(options.cameras) || !options.cameras.length) throw new Error("at least one camera is required");
  const progress = options.progress || noop;
  const engine = loadEngine(options.pluginDir);
  const ffmpegPath = engine.RPAudio.executable(options.ffmpeg || process.env.RP_FFMPEG || "");

  // Probe cameras first so the timeline frame rate follows the footage.
  const probes = options.cameras.map((c) => probe(ffmpegPath, path.resolve(c.file)));
  const firstVideo = probes.find((p) => p.hasVideo) || {};
  const fpsValue = options.fps || firstVideo.fps || 30;

  progress(0.02, "Analyzing music");
  const analysis = await analyzeMusic(options.music, { ...options, engine, ffmpeg: ffmpegPath, fps: fpsValue, progress: (p, m) => progress(0.02 + 0.5 * p, m) });
  const { result, duration, fps } = analysis;
  const frame = fps.den / fps.num;

  // Place cameras on the music timeline.
  let musicEnvelope = null;
  const cameras = [];
  for (let i = 0; i < options.cameras.length; i++) {
    const src = options.cameras[i], info = probes[i];
    let offset = Number(src.offset), sync = { method: "manual", confidence: "high" };
    const wantAudio = src.sync === "audio" || (src.sync !== "none" && !Number.isFinite(offset));
    if (wantAudio && info.hasAudio) {
      progress(0.55 + 0.1 * i / options.cameras.length, `Syncing camera ${i + 1} by audio`);
      const s = await syncByAudio(ffmpegPath, path.resolve(options.music), info.file, { musicEnvelope });
      musicEnvelope = s.musicEnvelope;
      offset = s.offset; sync = { method: "audio", confidence: s.confidence, score: s.score, prominence: s.prominence, peak_ratio: s.peakRatio };
    } else if (!Number.isFinite(offset)) {
      offset = 0; sync = { method: "none", confidence: "low" };
    }
    offset = Math.round(offset / frame) * frame; // keep cameras frame-aligned
    cameras.push({ ...info, file: info.file, offset, role: src.role || src.name || `Camera ${i + 1}`, name: src.name || path.basename(info.file).replace(/\.[^.]+$/, ""), sync });
  }

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
  if (!enabledCameras.length) throw new Error("None of the cameras has a video stream.");
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
