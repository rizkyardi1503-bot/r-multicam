// rp-multicam-plan/1 — the host-neutral multicam "model" produced by the R Project engine.
// Premiere, Final Cut Pro (FCPXML) and any other host consume this same JSON.
// Times are seconds on the music timeline; every boundary also has an exact frame index.
import path from "node:path";

export const PLAN_FORMAT = "rp-multicam-plan";
export const PLAN_VERSION = 1;
export const SCHEMA_URL = "https://r-multicam.pages.dev/schema/rp-multicam-plan-1.json";

const r6 = (x) => Math.round(Number(x) * 1e6) / 1e6;
const r3 = (x) => Math.round(Number(x) * 1e3) / 1e3;

function musicSummary(result, duration, musicFile, cadences, info = {}) {
  const v12 = result.musicV12 || result.musicV10 || {};
  const events = (result.structure && result.structure.events) || [];
  const grid = result.musicGrid || [];
  return {
    file: musicFile,
    name: path.basename(musicFile),
    duration: r6(duration),
    audio_rate: info.audioRate || 48000,
    audio_channels: info.audioChannels || 2,
    bpm: result.bpm || null,
    bpm_confidence: result.tempoConfidence || "low",
    beat_interval: result.beatInterval || null,
    tempo_map: (result.tempoMap || []).map((t) => ({ time: r3(t.time), bpm: t.bpm, confidence: r3(t.confidence) })),
    beats: (result.beats || []).map(r3),
    downbeats: grid.filter((g) => g.is_downbeat).map((g) => r3(g.time)),
    sections: (v12.sections || []).map((s) => ({ start: r3(s.start_second), end: r3(s.end_second), label: s.section, energy: s.energy, trend: s.trend })),
    drops: events.filter((e) => Number.isFinite(Number(e.drop_time))).map((e) => ({
      time: r3(e.drop_time), build_start: e.build_start == null ? null : r3(e.build_start), impact_end: e.impact_end == null ? null : r3(e.impact_end),
      rank: e.rank, confidence: e.confidence, confidence_score: e.confidence_score, profile: e.impact_profile || null
    })),
    pacing: {
      summary: result.pacing ? result.pacing.summary : null,
      cadences,
      segments: ((result.pacing && result.pacing.segments) || []).map((s) => ({ start: r3(s.start_second), beats_per_cut: s.beats_per_cut, drop_pacing: !!s.drop_pacing, reason: s.reason }))
    }
  };
}

export function buildPlan({ engine, analysis, cameras, points, snapshot, director, fps, frame, duration, musicFile, cadences }) {
  const result = analysis.result;
  const toFrame = (t) => Math.round(t / frame);
  const durationFrames = toFrame(duration);
  const music = musicSummary(result, duration, musicFile, cadences, analysis.info);
  const beat = Number(result.beatInterval) || 0.5;
  const clipOut = (c) => ({
    file: c.file, offset: r6(c.offset), offset_frames: toFrame(c.offset), duration: r6(c.duration),
    has_audio: c.hasAudio, width: c.width, height: c.height, rotation: c.rotation || 0, display_width: c.displayWidth || c.width, display_height: c.displayHeight || c.height, fps: c.fps, timecode: c.timecode,
    audio_rate: c.audioRate, audio_channels: c.audioChannels, created: c.created ? new Date(c.created * 1000).toISOString() : null, sync: c.sync
  });
  const camOut = cameras.map((c, i) => ({
    index: i, angle_id: `cam${i + 1}`, name: c.name, role: c.role, clock: c.clock || null,
    clips: c.clips.map(clipOut),
    excluded_clips: (c.excluded || []).map((x) => ({ file: x.file, reason: x.reason, ...(x.offset != null ? { offset: r6(x.offset) } : {}), ...(x.sync ? { sync: x.sync } : {}) }))
  }));

  const decisions = director.choices.map((ch) => {
    const it = snapshot.intervals[ch.id];
    return { start: r6(it.start), end: r6(it.end), start_frame: toFrame(it.start), end_frame: toFrame(it.end), camera: ch.camera, reason: ch.reason, confidence: ch.confidence, structure_lock: ch.structureLock || "" };
  }).sort((a, b) => a.start_frame - b.start_frame);

  // Physical cuts only where the chosen camera changes (same rule as the Premiere apply step).
  const cuts = [];
  for (const d of decisions) {
    const last = cuts[cuts.length - 1];
    if (last && last.camera === d.camera && last.end_frame === d.start_frame) { last.end_frame = d.end_frame; last.end = d.end; continue; }
    cuts.push({ start: d.start, end: d.end, start_frame: d.start_frame, end_frame: d.end_frame, camera: d.camera, reason: d.reason, confidence: d.confidence, structure_lock: d.structure_lock });
  }
  cuts.forEach((c, i) => {
    c.index = i;
    c.angle_id = c.camera >= 0 ? camOut[c.camera].angle_id : null;
    const drop = music.drops.find((dp) => Math.abs(dp.time - c.start) <= Math.max(frame, beat * 0.36));
    c.drop = drop ? drop.time : null;
    c.duration = r6(c.end - c.start);
  });

  return {
    $schema: SCHEMA_URL,
    format: PLAN_FORMAT,
    version: PLAN_VERSION,
    generator: { name: "R Project Multicam AI Engine", model: director.model || "R Project Auto Music Map V14", plugin_version: engine.version, created_at: new Date().toISOString() },
    timeline: { fps: { num: fps.num, den: fps.den }, frame_duration: `${fps.den}/${fps.num}`, duration: r6(duration), duration_frames: durationFrames, width: (cameras.flatMap((c) => c.clips).find((c) => c.displayWidth) || {}).displayWidth || 1920, height: (cameras.flatMap((c) => c.clips).find((c) => c.displayHeight) || {}).displayHeight || 1080 },
    music,
    cameras: camOut,
    edit_points: points.map(r6),
    decisions,
    cuts: cuts.map(({ index, start, end, duration: d, start_frame, end_frame, camera, angle_id, drop, reason, confidence, structure_lock }) => ({ index, start, end, duration: d, start_frame, end_frame, camera, angle_id, drop, reason, confidence, structure_lock })),
    summary: director.summaries || []
  };
}

/** Slack (seconds) allowed when checking that a camera covers a cut; the director and the validator share it. */
export const coverageTolerance = (frame) => frame / 2 + 1e-6;

/** True when [start, end] is fully inside the union of the clips' timeline ranges. */
function covered(clips, start, end, tol) {
  const ranges = clips.map((k) => [k.offset, k.offset + k.duration]).sort((a, b) => a[0] - b[0]);
  let reach = start;
  for (const [s, e] of ranges) { if (s > reach + tol) break; if (e > reach) reach = e; if (reach >= end - tol) return true; }
  return reach >= end - tol;
}

/** Structural validation shared by every exporter. Returns a list of problems (empty = valid). */
export function validatePlan(plan) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(plan && plan.format === PLAN_FORMAT, `format must be "${PLAN_FORMAT}"`);
  need(plan && plan.version === PLAN_VERSION, `version must be ${PLAN_VERSION}`);
  if (errors.length) return errors;
  const tl = plan.timeline || {};
  need(tl.fps && Number.isInteger(tl.fps.num) && Number.isInteger(tl.fps.den) && tl.fps.num > 0 && tl.fps.den > 0, "timeline.fps must be integer num/den");
  need(Number.isInteger(tl.duration_frames) && tl.duration_frames > 0, "timeline.duration_frames must be a positive integer");
  const music = plan.music || {};
  need(typeof music.file === "string" && music.file.length > 0, "music.file is required");
  need(music.name === undefined || (typeof music.name === "string" && music.name.length > 0), "music.name must be a non-empty string");
  need(Number.isFinite(music.duration) && music.duration > 0, "music.duration must be a positive number");
  need(Array.isArray(plan.cameras) && plan.cameras.length > 0, "cameras must be a non-empty array");
  need(Array.isArray(plan.cuts) && plan.cuts.length > 0, "cuts must be a non-empty array");
  if (errors.length) return errors;
  const frame = tl.fps.den / tl.fps.num;
  const angleIds = new Set();
  plan.cameras.forEach((c, i) => {
    need(c.index === i, `cameras[${i}].index must be ${i}`);
    need(typeof c.angle_id === "string" && c.angle_id.length > 0, `cameras[${i}].angle_id is required`);
    need(c.angle_id !== "music", `cameras[${i}].angle_id must not be "music" (reserved for the music angle)`);
    need(!angleIds.has(c.angle_id), `cameras[${i}].angle_id "${c.angle_id}" is used by another camera`);
    angleIds.add(c.angle_id);
    need(Array.isArray(c.clips), `cameras[${i}].clips must be an array`);
    (c.clips || []).forEach((k, j) => {
      need(typeof k.file === "string" && k.file.length > 0, `cameras[${i}].clips[${j}].file is required`);
      need(Number.isFinite(k.offset) && Number.isFinite(k.duration) && k.duration > 0, `cameras[${i}].clips[${j}] needs numeric offset and positive duration`);
    });
  });
  let cursor = 0;
  plan.cuts.forEach((c, i) => {
    need(Number.isInteger(c.start_frame) && Number.isInteger(c.end_frame) && c.end_frame > c.start_frame, `cuts[${i}] needs integer start_frame < end_frame`);
    need(c.start_frame === cursor, `cuts[${i}] starts at frame ${c.start_frame}, expected ${cursor} (cuts must be contiguous)`);
    cursor = c.end_frame;
    need(c.camera === -1 || (Number.isInteger(c.camera) && c.camera >= 0 && c.camera < plan.cameras.length), `cuts[${i}].camera ${c.camera} is not a camera index`);
    if (c.camera >= 0 && plan.cameras[c.camera]) {
      const cam = plan.cameras[c.camera], tol = coverageTolerance(frame);
      need(c.angle_id == null || c.angle_id === cam.angle_id, `cuts[${i}].angle_id "${c.angle_id}" does not match cameras[${c.camera}].angle_id "${cam.angle_id}"`);
      need(covered(cam.clips || [], c.start_frame * frame, c.end_frame * frame, tol), `cuts[${i}] uses ${cam.angle_id || "camera " + c.camera} outside its recorded range`);
    }
    if (i > 0) need(plan.cuts[i - 1].camera !== c.camera, `cuts[${i}] repeats the previous camera (merge it)`);
  });
  need(cursor === tl.duration_frames, `cuts end at frame ${cursor}, timeline has ${tl.duration_frames}`);
  return errors;
}
