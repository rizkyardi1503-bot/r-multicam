// Engine benchmark: drives the REAL Premiere panel engine files (plain script evaluation with a cep_node shim, like
// the CEP panel) through the panel pipeline with real FFmpeg:
//   1 audio    RPAudio.run (A1 decode + features + v19 beat tracker)
//   2 music    enrichMusicMap (RPMusicV12.enrich + RPBeatFirst.enrich)
//   3 sync     RPSyncUI.analyze (probe + decode every camera clip, sync to A1)
//   4 visual   RPVisual.analyze per camera file (cold cache: a fresh cache dir per run)
//   5 director RPDirector.pace + applyPacing + host snapshot + RPDirector.run (vision on)
// Usage: node scripts/bench/engine-bench.cjs <Plugin dir> <synth|e2e|druva> [--out result.json] [--runs n] [--e2e dir]
//        add --cpu-prof (node flag) to profile: node --cpu-prof --cpu-prof-dir=%TEMP%\prof scripts/bench/engine-bench.cjs ...
// Outputs (beats, BPM, drops, sections, sync offsets, visual timelines, director plan) go to --out; compare two
// outputs with scripts/bench/compare.cjs. Media is generated once under %TEMP%/rp-bench (see datasets.cjs).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), realCp = require('child_process');
const datasets = require('./datasets.cjs');
const argv = process.argv.slice(2), dir = path.resolve(argv[0] || ''), which = argv[1];
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const RUNS = Number(opt('--runs', 1)), OUT = opt('--out', null);
if (!fs.existsSync(path.join(dir, 'audio-engine.js')) || !which) { console.error('usage: engine-bench.cjs <Plugin dir> <synth|e2e|druva> [--out f] [--runs n]'); process.exit(2); }
const FFMPEG = fs.readFileSync(path.join(process.env.LOCALAPPDATA, 'RProjectMulticam/tools/ffmpeg-path.txt'), 'utf8').replace(/^﻿/, '').trim();
const MODEL = 'R Project Auto Music Map V14';
// panel.js / rp-engine-cli.js helpers (host.jsx snapshot builder, pacing constraint, music context)
const CLI = require(path.resolve(__dirname, '../../plugin/davinci/rp-engine-cli.js'));

// ---- child_process shim: real spawn, timed (FFmpeg wall time per stage)
let ffLog = [];
const cpShim = Object.assign({}, realCp, {
  spawn(cmd, args, o) {
    const t0 = process.hrtime.bigint(), p = realCp.spawn(cmd, args, o), kind = args.includes('-discard:v') ? 'visual' : args.includes('pipe:1') ? 'decode' : 'probe';
    p.on('close', () => ffLog.push({ kind, ms: Number(process.hrtime.bigint() - t0) / 1e6, t0: Number(t0) / 1e6 }));
    return p;
  },
});
function loadEngine() {
  const mods = { fs, path, os, child_process: cpShim, buffer: require('buffer'), process, crypto: require('crypto') };
  const ctx = { cep_node: { require: (m) => mods[m] || require(m) } };
  for (const f of ['music-pacing-auto.js', 'audio-core.js', 'spectral-features.js', 'audio-engine.js', 'drone-sync.js', 'audio-sync.js', 'music-learning.js', 'music-intelligence-v10.js', 'visual-quality.js', 'ai-director.js', 'sync-ui.js'])
    (new Function('window', 'module', fs.readFileSync(path.join(dir, f), 'utf8') + '\n//# sourceURL=' + f))(ctx, undefined);
  return ctx;
}
const ms = (a) => Math.round(Number(process.hrtime.bigint() - a) / 1e6);

async function once(ds, run) {
  // Cold AI Vision cache for every run (visual-quality.js keys its disk cache under LOCALAPPDATA).
  const cacheRoot = path.join(datasets.ROOT, 'cache-' + process.pid + '-' + run); fs.rmSync(cacheRoot, { recursive: true, force: true });
  const realLocal = process.env.LOCALAPPDATA; process.env.LOCALAPPDATA = cacheRoot;
  ffLog = [];
  const E = loadEngine(), T = {}, out = {}, state = { cancelled: false };
  const a1 = { name: ds.name, duration: ds.duration, frame: ds.frame, range: { start: 0, end: ds.duration, selected: false }, clips: [{ file: ds.master, start: 0, end: ds.duration, input: ds.input }] };
  const tAll = process.hrtime.bigint();
  // 1 audio
  let t = process.hrtime.bigint();
  const result = await E.RPAudio.run(a1, FFMPEG, state, () => {});
  T.audio = ms(t); result.snapshot = a1;
  out.audio = { tempo: result.tempo, tempoConfidence: result.tempoConfidence, beatCount: result.beatCount, beats: result.beats, beatMeta: result.beatMeta, tempoMap: result.tempoMap, musicGrid: result.musicGrid, music: result.music, dropSeries: result.dropSeries, onsetSeries: result.onsetSeries, lowSeries: result.lowSeries };
  // 2 music intelligence
  t = process.hrtime.bigint();
  E.RPMusicV12.enrich(result, a1.duration, CLI.musicOptions({})); E.RPBeatFirst.enrich(result, a1.duration);
  T.music = ms(t);
  const v = result.musicV12 || {};
  out.music = { structure: result.structure, accepted_drops: v.accepted_drops, ranked_drops: v.ranked_drops, drop_count: v.drop_count, sections: result.beatFirst && result.beatFirst.sections, beatFirst: result.beatFirst, musicV12: v };
  // 3 sync (A1 master + every camera clip through RPSyncUI.analyze)
  const sources = { sequence: { name: ds.name, frame: ds.frame, duration: ds.duration, a1: [{ file: ds.master, start: 0, end: ds.duration, input: ds.input }] } };
  const cameras = ds.cams.map((c) => ({ name: c.name, kind: 'bin', clips: c.clips.map((k, i) => ({ nodeId: c.name + i, name: path.basename(k.file), file: k.file, sourceIn: 0, sourceOut: null })) }));
  t = process.hrtime.bigint();
  const analysis = await E.RPSyncUI.analyze(sources, cameras, FFMPEG, state, () => {}, { learned: {} });
  T.sync = ms(t);
  out.sync = analysis.cameras.map((c) => ({ name: c.name, anchor: c.anchor, placed: c.placed, rows: c.rows.map((r) => ({ name: r.name, status: r.status, offset: r.offset, start: r.start, confidence: r.confidence, method: r.method, reason: r.reason, drift: r.drift })) }));
  // timeline tracks from the sync result (placed clips), like the synced sequence the user then cuts
  const tracks = [];
  analysis.cameras.forEach((c, ci) => {
    const clips = [];
    c.rows.forEach((r) => { if (r.status !== 'placed' || r.start == null) return; let start = r.start, input = r.sourceIn, end = start + (r.sourceOut - r.sourceIn); if (start < 0) { input -= start; start = 0; } end = Math.min(end, ds.duration); if (end - start > ds.frame) clips.push({ file: r.file, start, end, input, supported: true, disabled: false }); });
    if (clips.length) tracks.push({ index: ci, name: 'V' + (ci + 1), clips });
  });
  // 4 visual (inside RPDirector.run) + 5 director
  const vis = { files: {}, first: null, last: null }, origAnalyze = E.RPVisual.analyze;
  E.RPVisual.analyze = function (ffmpeg, file, st) { const s0 = Date.now(); if (vis.first == null) vis.first = s0; return origAnalyze(ffmpeg, file, st).then((tl) => { vis.last = Date.now(); vis.files[path.basename(file)] = tl; return tl; }); };
  t = process.hrtime.bigint();
  const roles = ['Master Wide', 'Crowd', 'DJ Close-Up', 'Drone', 'Extra'].slice(0, Math.max(1, ds.cams.length)).join('\n');
  const enabled = tracks.map((x) => x.index);
  let pacing = await E.RPDirector.pace({ key: 'agent-ai', model: MODEL, music: result.music, musicAnalysis: CLI_musicContext(result), duration: a1.duration }, state, () => {});
  pacing = CLI.constrainPacingToSelection(pacing, [4, 6, 8]);
  E.RPAudio.applyPacing(result, pacing, a1.duration, 6000);
  let plan = null;
  if (tracks.length) {
    let snap = CLI.buildSnapshot(parsePoints(result.points, a1.frame, a1.duration), tracks, a1.duration, a1.frame);
    const sw = E.RPBeatFirst.coverageSplits ? E.RPBeatFirst.coverageSplits(snap, enabled, result) : [], known = {};
    result.points.forEach((p) => { known[Number(p).toFixed(4)] = 1; });
    const switches = sw.filter((p) => !known[p.toFixed(4)]);
    if (switches.length) { result.points = result.points.concat(switches).sort((a, b) => a - b); snap = CLI.buildSnapshot(parsePoints(result.points, a1.frame, a1.duration), tracks, a1.duration, a1.frame); }
    const r = await E.RPDirector.run(snap, { key: 'agent-ai', model: MODEL, roles, enabledCameras: enabled, dropCamera: null, vision: true, budget: 60, ffmpeg: FFMPEG, music: result.music, musicAnalysis: CLI_musicContext(result) }, state, () => {});
    plan = { points: result.points, intervals: snap.intervals.map((it) => ({ id: it.id, start: it.start, end: it.end, candidates: it.candidates })), choices: r.choices, summaries: r.summaries, images: r.images, failedImages: r.failedImages, holdGuardChanges: r.holdGuardChanges };
  }
  const tDir = ms(t);
  T.visual = vis.first == null ? 0 : vis.last - vis.first; T.director = tDir - T.visual;
  out.visual = {}; Object.keys(vis.files).sort().forEach((k) => { out.visual[k] = vis.files[k]; }); out.director = { pacing: result.pacing, plan };
  T.total = ms(tAll);
  const ffSum = {}; ffLog.forEach((x) => { ffSum[x.kind] = ffSum[x.kind] || { n: 0, ms: 0 }; ffSum[x.kind].n++; ffSum[x.kind].ms += Math.round(x.ms); });
  process.env.LOCALAPPDATA = realLocal; fs.rmSync(cacheRoot, { recursive: true, force: true });
  return { T, ff: ffSum, out };
}
function parsePoints(points, frame, duration) { const o = []; let prev = -1; for (const raw of points) { const s = Math.round(Number(raw) / frame) * frame; if (s > 0 && s < duration && s > prev) { o.push(s); prev = s; } } return o; }
// rp-engine-cli.js musicContext is not exported; same fields the director reads.
function CLI_musicContext(result) {
  const pacing = result.pacing || null, structure = result.structure || null;
  return { music_v12: result.musicV12 || null, estimated_bpm: result.tempo || result.bpm || null, bpm_confidence: result.tempoConfidence || 'low', bpm_spread: result.tempoSpread == null ? null : result.tempoSpread, tempo_samples: result.tempoSamples || 0, beat_count: result.beatCount || 0, approx_beat_interval_seconds: result.beatInterval || null, edit_point_count: result.points ? result.points.length : 0, energy_samples: result.music ? result.music.length : 0, structure_drop_count: structure ? structure.drop_count || 0 : 0, structure_build_up_count: structure ? structure.build_up_count || 0 : 0, structure_summary: structure ? structure.summary : null, structure_events: structure && Array.isArray(structure.events) ? structure.events : null, structure_zones: structure && Array.isArray(structure.zones) ? structure.zones : null, music_intelligence: structure && structure.intelligence ? structure.intelligence : null, music_v11: result.musicV11 || null, music_v10: result.musicV11 || result.musicV10 || null, beat_first: result.beatFirst || null, pacing_summary: pacing ? pacing.summary : null, pacing_segments: pacing ? pacing.segments : null };
}

(async () => {
  const ds = datasets.load(which, FFMPEG, { e2e: opt('--e2e') });
  const runs = [];
  for (let r = 0; r < RUNS; r++) { const x = await once(ds, r); runs.push(x); console.log(`${which} run ${r + 1}: ` + Object.entries(x.T).map(([k, v]) => `${k} ${v} ms`).join(' | ') + ' || ffmpeg ' + Object.entries(x.ff).map(([k, v]) => `${k} ${v.n}x ${v.ms} ms`).join(', ')); }
  const best = {}; for (const k of Object.keys(runs[0].T)) best[k] = Math.min(...runs.map((x) => x.T[k]));
  const med = {}; for (const k of Object.keys(runs[0].T)) { const a = runs.map((x) => x.T[k]).sort((p, q) => p - q); med[k] = a[a.length >> 1]; }
  const last = runs[runs.length - 1].out;
  // sanity: every run gives the same output (determinism)
  const s0 = JSON.stringify(runs[0].out); runs.forEach((x, i) => { if (JSON.stringify(x.out) !== s0) console.log('WARNING: run ' + (i + 1) + ' output differs from run 1'); });
  const a = last.audio, m = last.music, d = last.director.plan;
  console.log(`${which} summary: BPM ${a.tempo} (${a.tempoConfidence}) beats ${a.beatCount} drops ${m.drop_count} [${(m.accepted_drops || []).map((x) => (+(x.drop_time != null ? x.drop_time : x.time)).toFixed(2)).join(' ')}]`
    + ` | sync placed ${last.sync.map((c) => c.placed).join('/')} | visual files ${Object.keys(last.visual).length} | plan ${d ? d.choices.length + ' intervals' : 'none'}`);
  console.log(`${which} min ms: ` + JSON.stringify(best) + '  median: ' + JSON.stringify(med));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ dataset: which, plugin: dir, timings: runs.map((x) => x.T), ffmpeg: runs.map((x) => x.ff), min: best, median: med, out: last }));
})().catch((e) => { console.error(e); process.exit(1); });
