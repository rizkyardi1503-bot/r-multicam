#!/usr/bin/env node
// R Project Multicam AI - engine CLI for the DaVinci Resolve build (v1.0.0).
// Runs the unchanged Premiere engine files (engine/, copied by build-davinci.cjs) in a vm context and mirrors the
// panel.js orchestration (makeAIPlan, enrichMusicMap, analyzeBestDrops) with plain JSON in and out.
//
// Library only: there is no command-line entry in the shipped build, so the analysis cannot run without the
// engine's license check (rp-davinci-engine.js). The developer runner is tests/engine-cli.cjs (not packaged).
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ENGINE_DIR = process.env.RP_ENGINE_DIR || path.join(__dirname, 'engine');
const ENGINE_ORDER = ['music-pacing-auto.js', 'audio-core.js', 'spectral-features.js', 'audio-engine.js', 'music-learning.js',
  'music-intelligence-v10.js', 'visual-quality.js', 'ai-director.js'];
const MODEL = 'R Project Auto Music Map V14';

function emit(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
let lastEmit = 0, lastMessage = '';
function stdoutProgress(p, message) {
  const now = Date.now();
  if (message === lastMessage && now - lastEmit < 300) return;
  lastEmit = now; lastMessage = message;
  emit({ type: 'progress', p: Math.round(Math.max(0, Math.min(1, Number(p) || 0)) * 1000) / 1000, message: String(message || '') });
}

function loadEngine() {
  const ctx = { console: { log() {}, info() {}, warn() {}, error: console.error, debug() {} }, setTimeout, clearTimeout, setImmediate, clearImmediate,
    cep_node: { require, process }, require, process };
  ctx.globalThis = ctx; ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ENGINE_ORDER) {
    const p = path.join(ENGINE_DIR, f);
    if (!fs.existsSync(p)) throw Error('Engine file missing: ' + p + '. Run build-davinci.cjs or reinstall.');
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  for (const name of ['RPAudio', 'RPBeat', 'RPBeatFirst', 'RPMusicV12', 'RPDirector']) if (!ctx[name]) throw Error('Engine module ' + name + ' did not load.');
  return ctx;
}

// ---- panel.js equivalents (kept identical in behaviour; DOM reads replaced by explicit options) ----
const DEFAULT_CADENCES = [4, 6, 8];
function cadencesFrom(list) {
  const out = []; [2, 4, 6, 8].forEach((n) => { if ((list || []).map(Number).indexOf(n) >= 0) out.push(n); });
  return out.length ? out : DEFAULT_CADENCES.slice();
}
// panel.js musicOptions() with the panel defaults (blank threshold/spacing = sensitivity preset).
function musicOptions(o) {
  o = o || {};
  return {
    sensitivity: String(o.sensitivity || 'balanced'),
    preBeats: Math.max(8, Math.min(64, Number(o.preBeats) || 32)),
    postBeats: Math.max(8, Math.min(64, Number(o.postBeats) || 32)),
    confidenceThreshold: o.confidenceThreshold != null && o.confidenceThreshold !== '' ? Number(o.confidenceThreshold) : null,
    minSpacingBeats: o.minSpacingBeats != null && o.minSpacingBeats !== '' ? Number(o.minSpacingBeats) : undefined,
    cutsBefore: 3, cutsAfter: 4,
  };
}
function enrichMusicMap(E, result, duration, opts) {
  const engine = E.RPMusicV12 || E.RPMusicV10;
  if (!engine || !engine.enrich) throw Error('Auto Music Map V14 engine is unavailable. Reinstall this build.');
  engine.enrich(result, duration, musicOptions(opts));
  E.RPBeatFirst.enrich(result, duration);
  return result;
}
// panel.js constrainPacingToSelection, with the checked cadences passed in instead of read from checkboxes.
function constrainPacingToSelection(pacing, cadences) {
  pacing = pacing || { segments: [], config: {} };
  const allowed = cadencesFrom(cadences).slice().sort((a, b) => a - b), fast = allowed[0], slow = allowed[allowed.length - 1];
  function nearest(target) { target = Number(target) || 6; let best = allowed[0], dist = Math.abs(best - target); for (let i = 1; i < allowed.length; i++) { const d = Math.abs(allowed[i] - target); if (d < dist || (d === dist && allowed[i] < best)) { best = allowed[i]; dist = d; } } return best; }
  const seg = (pacing.segments || []).map((src) => { const x = {}; for (const k in src) x[k] = src[k]; const reason = String(x.reason || '').toLowerCase(); let target = Number(x.beats_per_cut) || 6; if (/drop|pre-drop|high-energy|build-up/.test(reason)) target = fast; else if (/breakdown|intro|outro|calm|low/.test(reason)) target = slow; x.beats_per_cut = nearest(target); x.max_hold_beats = 8; return x; });
  const cfg = {}; for (const key in (pacing.config || {})) cfg[key] = pacing.config[key];
  cfg.allowedCadences = allowed; cfg.minCadence = fast; cfg.maxCadence = slow; cfg.base = nearest(6); cfg.explicitCadence = allowed.length === 1; cfg.energyAdaptive = allowed.length > 1; cfg.userSelectedCadence = true; cfg.softPreference = false; cfg.maxHoldBeats = 8;
  return { summary: 'Auto Music Map V14 · selected pacing ' + allowed.join('/') + ' beat · selected cut intervals', segments: seg, config: cfg };
}
function musicContext(result) {
  if (!result) return null;
  const pacing = result.pacing || null, structure = result.structure || null;
  return { music_v12: result.musicV12 || null, estimated_bpm: result.tempo || result.bpm || null, bpm_confidence: result.tempoConfidence || 'low', bpm_spread: result.tempoSpread == null ? null : result.tempoSpread, tempo_samples: result.tempoSamples || 0, beat_count: result.beatCount || 0, approx_beat_interval_seconds: result.beatInterval || null, edit_point_count: result.points ? result.points.length : 0, energy_samples: result.music ? result.music.length : 0, structure_drop_count: structure ? structure.drop_count || 0 : 0, structure_build_up_count: structure ? structure.build_up_count || 0 : 0, structure_summary: structure ? structure.summary : null, structure_events: structure && Array.isArray(structure.events) ? structure.events : null, structure_zones: structure && Array.isArray(structure.zones) ? structure.zones : null, music_intelligence: structure && structure.intelligence ? structure.intelligence : null, music_v4: result.musicV4 || null, music_v5: result.musicV5 || null, music_v6: result.musicV6 || null, music_v11: result.musicV11 || result.masterMusicMapV11 || null, music_v10: result.musicV11 || result.musicV10 || result.masterMusicMapV11 || result.masterMusicMapV10 || null, music_v8: result.musicV8 || result.masterMusicMapV8 || null, beat_first: result.beatFirst || null, pacing_summary: pacing ? pacing.summary : null, pacing_segments: pacing ? pacing.segments : null, pacing_capped: pacing ? !!pacing.capped : false, uncapped_edit_points: pacing ? pacing.uncapped_points : null };
}
function parseCameraRoleEntries(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/;/g, '\n'), lines = src.split('\n'), out = [], used = {};
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').trim(); if (!line) continue;
    const legacy = line.match(/^\s*[Vv]\s*(\d{1,2})\s*(?:[:=\-–—]\s*)?(.*?)\s*$/); let role, number, index;
    if (legacy) { number = Math.max(1, Number(legacy[1])); index = number - 1; role = String(legacy[2] || '').replace(/^[:=\-–—]\s*/, '').trim(); }
    else { number = out.length + 1; while (used[number]) number++; index = number - 1; role = line.replace(/^\s*(?:camera|cam|angle)\s*\d*\s*[:=\-–—]?\s*/i, '').trim(); }
    if (used[number]) continue; used[number] = true; if (!role) role = 'Camera ' + number; out.push({ number, index, role });
  }
  return out;
}
function markCoverageSwitches(intervals, times, frame) { const tol = (Number(frame) || 1 / 30) / 4; (intervals || []).forEach((it) => { for (let i = 0; i < (times || []).length; i++) if (Math.abs(Number(it.start) - Number(times[i])) <= tol) { it.coverageSwitch = true; break; } }); }
// panel.js stripMusicMap (persisted fields only; raw_energy dropped).
const MAP_FIELDS = ['points', 'meta', 'beats', 'beatMeta', 'music', 'dropSeries', 'onsetSeries', 'lowSeries', 'fingerprint', 'tempo', 'bpm', 'tempoConfidence', 'tempoSpread', 'tempoSamples', 'beatInterval', 'beatCount', 'tempoMap', 'musicGrid', 'pacing', 'structure', 'musicV12', 'excludedDropTimes', 'dropFeatureCache', 'onlineReviewCache', 'hybridAI', 'dropSensitivity', 'bestDropWindow', 'beatFirst'];
function stripMusicMap(result, a1) {
  const x = {};
  for (const k of MAP_FIELDS) if (result && result[k] !== undefined) x[k] = result[k];
  if (Array.isArray(x.music)) x.music = x.music.map((m) => { if (!m || m.raw_energy === undefined) return m; const y = {}; for (const k in m) if (k !== 'raw_energy') y[k] = m[k]; return y; });
  x.snapshot = a1; return x;
}
// panel.js loadMasterMusicMap: aliases the engine expects on a reloaded map.
function restoreMap(map, a1) {
  const r = JSON.parse(JSON.stringify(map));
  r.musicV10 = r.musicV12; r.masterMusicMapV12 = r.musicV12; r.masterMusicMapV10 = r.musicV12; r.snapshot = a1 || r.snapshot; return r;
}
// Same numbers as compact-ui.js RPCompact.summary + the panel preview line.
function musicSummary(r) {
  const v = r.musicV12 || r.musicV10 || {}, series = r.music || [];
  let sum = 0; series.forEach((x) => { sum += Number(x.energy) || 0; });
  const energy = series.length ? sum / series.length : 0;
  const drops = (v.accepted_drops || []).map((d) => ({ time: Number(d.drop_time != null ? d.drop_time : d.time), confidence_score: d.confidence_score, confidence: d.confidence }));
  return {
    bpm: r.tempo || null, tempoConfidence: r.tempoConfidence || 'low', beatCount: r.beatCount || 0, beats: (r.beats || []).length,
    drops: v.drop_count == null ? null : v.drop_count, energy: energy >= 65 ? 'HIGH' : energy >= 30 ? 'MED' : 'LOW', energyMean: Math.round(energy * 10) / 10,
    dropScore: v.accepted_drops && v.accepted_drops.length ? Math.round(v.accepted_drops[0].confidence_score) : null,
    mainDrops: drops, rhythmRegions: r.beatFirst && r.beatFirst.sections ? r.beatFirst.sections.length : 0,
  };
}

// ---- host.jsx equivalents (rp_parseInternalPoints, rp_mergeCameraCoverage, rp_buildAISnapshot) ----
function parsePoints(points, frame, duration) {
  const out = []; let prev = -1;
  for (const raw of points) {
    const t = Number(raw), snap = Math.round(t / frame) * frame;
    if (!isFinite(t) || !(snap > 0 && snap < duration) || snap <= prev) throw Error('Internal edit points must be ordered, unique and inside the sequence.');
    out.push(snap); prev = snap;
  }
  return out;
}
function mergeCameraCoverage(clips, tol) {
  const ranges = [], out = [];
  // Resolve port: a clip only counts as coverage when it can be re-appended from its media (supported).
  for (const c of clips) if (!c.disabled && c.supported !== false && isFinite(c.start) && isFinite(c.end) && c.end > c.start) ranges.push({ start: c.start, end: c.end });
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  for (const r of ranges) { const last = out.length ? out[out.length - 1] : null; if (last && r.start <= last.end + tol) last.end = Math.max(last.end, r.end); else out.push(r); }
  return out;
}
function buildSnapshot(points, tracksIn, duration, frame) {
  const bounds = [0].concat(points).concat([duration]);
  if (bounds.length > 100002) throw Error('Maximum 100,000 edit points per AI plan. The AI pacing plan is too dense for this timeline.');
  const tracks = [], intervals = [], tol = frame / 4;
  for (const t of tracksIn || []) {
    const clips = (t.clips || []).map((c) => ({ start: Number(c.start), end: Number(c.end), input: Number(c.input) || 0, file: String(c.file || ''), supported: c.supported !== false, disabled: !!c.disabled, pluginDisabled: false }));
    if (!clips.length) continue;
    tracks.push({ index: Number(t.index), name: t.name || 'V' + (Number(t.index) + 1), clips, coverageRanges: mergeCameraCoverage(clips, tol) });
  }
  if (!tracks.length) throw Error('No unlocked camera tracks.');
  for (let i = 0; i < bounds.length - 1; i++) {
    const candidates = [], coverageNotes = [];
    for (const tr of tracks) {
      const full = tr.coverageRanges.some((cc) => cc.start <= bounds[i] + tol && cc.end >= bounds[i + 1] - tol);
      coverageNotes.push('V' + (tr.index + 1) + ': ' + (full ? 'covered' : 'gap or disabled clips'));
      if (full) candidates.push(tr.index);
    }
    intervals.push({ id: i, start: bounds[i], end: bounds[i + 1], candidates, coverageNotes });
  }
  return { duration, frame, tracks, intervals, points, boundaryMode: 'internal' };
}

// ---- commands ----
function checkA1(a1) {
  if (!a1 || !Array.isArray(a1.clips) || !a1.clips.length) throw Error('A1 is empty or all A1 clips are disabled. Put the music mix on A1 (the first audio track).');
  if (!(Number(a1.duration) > 0) || !(Number(a1.frame) > 0)) throw Error('A1 snapshot needs duration and frame (seconds per frame).');
  a1.range = a1.range || { start: 0, end: Number(a1.duration), selected: false };
  return a1;
}
async function cmdAnalyze(E, input, progress = stdoutProgress) {
  const a1 = checkA1(input.a1), state = { cancelled: false };
  const result = await E.RPAudio.run(a1, input.ffmpeg || '', state, (p, m) => progress(p * 0.9, m));
  if (!result.beats || !result.beats.length) throw Error('No clear A1 beats detected.');
  progress(0.92, 'Validating BPM, beats, structure and main drops…');
  enrichMusicMap(E, result, a1.duration, input.options);
  result.snapshot = a1;
  progress(1, 'Music analysis ready');
  return { kind: 'rp-davinci-music-map', version: 1, a1, options: musicOptions(input.options), summary: musicSummary(result), map: stripMusicMap(result, a1) };
}
async function cmdPlan(E, input, progress = stdoutProgress) {
  const a1 = checkA1(input.a1 || (input.map && input.map.snapshot)), o = input.options || {}, state = { cancelled: false };
  if (!input.map || !input.map.beats || !input.map.beats.length) throw Error('No clear A1 beats detected. Analyze A1 again.');
  const duration = Number(input.duration || a1.duration), frame = Number(input.frame || a1.frame);
  let suggestion = restoreMap(input.map, a1);
  if (!E.RPAudio.fresh(suggestion.snapshot, suggestion.fingerprint)) throw Error('A1 audio changed. Analyze again.');
  suggestion = enrichMusicMap(E, suggestion, a1.duration, o.music);
  // Blank roles: one 'Vn: Camera n' line per non-empty track, so roles map by track number (V1 + V3 -> cameras 0 and 2).
  const roles = String(o.roles || '').trim() || (input.tracks || []).filter((t) => (t.clips || []).length).map((t) => 'V' + (Number(t.index) + 1) + ': Camera ' + (Number(t.index) + 1)).join('\n');
  const music = suggestion.music || [], roleEntries = parseCameraRoleEntries(roles);
  if (!roleEntries.length) throw Error('Enter Camera Roles first, one role per line (for example: Master Wide, Crowd Reaction, DJ Close-Up).');
  let enabledCameras = Array.isArray(o.enabledCameras) && o.enabledCameras.length ? o.enabledCameras.map(Number) : roleEntries.map((e) => e.index);
  if (!enabledCameras.length) throw Error('Enable at least one camera in Camera Selection.');
  let pacing = await E.RPDirector.pace({ key: 'agent-ai', model: MODEL, music, musicAnalysis: musicContext(suggestion), duration: a1.duration }, state, (p, m) => progress(0.18 * p, m));
  pacing = constrainPacingToSelection(pacing, o.cadences);
  E.RPAudio.applyPacing(suggestion, pacing, a1.duration, 6000);
  if (!suggestion.points.length) throw Error('Auto Music Map produced no usable beat-aligned edit points. Try a clearer A1 music track.');
  const notes = [];
  if (suggestion.pacing && suggestion.pacing.capped) notes.push('Long-set safety: ' + suggestion.pacing.uncapped_points + ' requested edit points were reduced to ' + suggestion.points.length + '.');
  let snapshot = buildSnapshot(parsePoints(suggestion.points, frame, duration), input.tracks, duration, frame);
  const available = {}; snapshot.tracks.forEach((t) => { available[t.index] = true; });
  const requested = enabledCameras.slice(), unavailableCameras = requested.filter((c) => !available[c]);
  enabledCameras = requested.filter((c) => available[c]);
  if (!enabledCameras.length) throw Error('None of the enabled cameras has usable footage. Make sure at least one selected V track is unlocked, enabled and contains clips.');
  if (unavailableCameras.length) notes.push('Camera Selection auto-skip: ' + unavailableCameras.map((c) => 'V' + (c + 1)).join(', ') + ' is missing, empty, locked or disabled.');
  let switches = E.RPBeatFirst.coverageSplits ? E.RPBeatFirst.coverageSplits(snapshot, enabledCameras, suggestion) : [];
  const known = {}; suggestion.points.forEach((p) => { known[Number(p).toFixed(4)] = 1; });
  switches = switches.filter((p) => !known[p.toFixed(4)]);
  if (switches.length) {
    suggestion.points = suggestion.points.concat(switches).sort((a, b) => a - b);
    suggestion.meta = (suggestion.meta || []).concat(switches.map((p) => ({ time: p, reason: 'Coverage switch', beats_per_cut: 0 }))).sort((a, b) => a.time - b.time);
    snapshot = buildSnapshot(parsePoints(suggestion.points, frame, duration), input.tracks, duration, frame);
    notes.push('Coverage switch: ' + switches.length + ' shot(s) cut over to the camera that continues.');
  }
  markCoverageSwitches(snapshot.intervals, switches, snapshot.frame);
  const dropCamera = o.dropCamera === null || o.dropCamera === undefined || o.dropCamera === 'auto' ? null : Number(o.dropCamera);
  const result = await E.RPDirector.run(snapshot, { key: 'agent-ai', model: MODEL, roles, enabledCameras, dropCamera, vision: !!o.vision, budget: Number(o.budget) || 60, ffmpeg: o.ffmpeg || input.ffmpeg || '', music, musicAnalysis: musicContext(suggestion) }, state, (p, m) => progress(0.18 + 0.82 * p, m));
  if (unavailableCameras.length) result.summaries.unshift('Camera Selection Auto-Skip: ' + unavailableCameras.map((c) => 'V' + (c + 1)).join(', ') + ' unavailable; continued with ' + enabledCameras.map((c) => 'V' + (c + 1)).join(', ') + '.');
  progress(1, 'Plan ready');
  return {
    kind: 'rp-davinci-plan', version: 1, duration, frame,
    intervals: snapshot.intervals.map((it) => ({ id: it.id, start: it.start, end: it.end, candidates: it.candidates, coverageSwitch: !!it.coverageSwitch })),
    choices: result.choices.map((c) => ({ id: c.id, camera: c.camera, confidence: c.confidence, reason: c.reason })),
    summaries: result.summaries, notes, pacing: suggestion.pacing, points: suggestion.points,
    steadyGrid: suggestion.beatFirst && suggestion.beatFirst.steady_grid || [], musicGrid: (suggestion.musicGrid || []).map((g) => g.time),
    roles: roleEntries, enabledCameras, unavailableCameras, dropCamera,
    images: result.images, failedImages: result.failedImages, holdGuardChanges: result.holdGuardChanges,
    musicSummary: musicSummary(suggestion),
  };
}
async function cmdDrops(E, input, progress = stdoutProgress) {
  if (!input.map || !input.map.beats || !input.map.beats.length) throw Error('No clear A1 beat grid was detected. Analyze Music first.');
  const a1 = input.a1 || input.map.snapshot || {}, duration = Number(input.duration || a1.duration), frame = Number(input.frame || a1.frame) || 0;
  let result = restoreMap(input.map, a1);
  result = enrichMusicMap(E, result, duration, input.options);
  result.snapshot = a1;
  const engine = E.RPMusicV12 || E.RPMusicV10;
  const candidates = engine.candidates(result, duration, 100);
  if (!candidates.length) throw Error('No valid drop candidates passed the sensitivity for the selected beat window.');
  const ranked = { selections: candidates.map((c) => ({ candidate_id: c.id, reason: 'Auto Music Map confidence ' + c.confidence_score + '%' })) };
  const windows = engine.windows(result, ranked.selections, candidates, duration, frame);
  if (!windows.length) throw Error('No valid Best Drop windows remained after beat-grid validation.');
  const count = Math.max(1, Math.min(100, Math.round(Number(input.count) || 5), windows.length));
  progress(1, 'Best Drops ready');
  return {
    kind: 'rp-davinci-drops', version: 1, total: windows.length, structureCount: result.structure && result.structure.drop_count ? result.structure.drop_count : 0,
    drops: windows.slice(0, count).map((w, i) => ({ index: i + 1, time: w.drop_time, start: w.start, end: w.end, score: w.confidence_score, rawScore: w.score, confidence: w.confidence, preBeats: w.pre_beats, postBeats: w.post_beats })),
  };
}

module.exports = { emit, cmdAnalyze, cmdPlan, cmdDrops, loadEngine, constrainPacingToSelection, buildSnapshot, parseCameraRoleEntries, musicOptions };
