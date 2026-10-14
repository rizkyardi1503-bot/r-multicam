// rp-multicam-plan/1 -> FCPXML 1.10 (Final Cut Pro 10.6 or later).
// Produces one multicam clip (one angle per camera + a music angle) and a project whose
// storyline is a run of mc-clips: video from the planned angle, audio always from the music.
// The cuts stay live multicam edits, so angles can still be switched in Final Cut Pro.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validatePlan } from "./plan-format.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function rateCode(fps) {
  const f = fps.num / fps.den;
  const known = { 23.976: "2398", 24: "24", 25: "25", 29.97: "2997", 30: "30", 50: "50", 59.94: "5994", 60: "60" };
  for (const [k, v] of Object.entries(known)) if (Math.abs(Number(k) - f) < 0.01) return v;
  return null;
}

function formatName(width, height, fps) {
  const rate = rateCode(fps);
  const size = { "1280x720": "720p", "1920x1080": "1080p", "3840x2160": "2160p", "4096x2160": "4096x2160p" }[`${width}x${height}`];
  return rate && size ? `FFVideoFormat${size}${rate}` : null;
}

/** File URL for FCP. `mediaDir` relinks every file to one folder (e.g. plan made on Windows, opened on a Mac). */
function mediaUrl(file, mediaDir) {
  const name = String(file).split(/[\\/]/).pop();
  if (mediaDir) return pathToFileURL(path.posix.join(mediaDir.replace(/\\/g, "/"), name)).href;
  if (/^[A-Za-z]:[\\/]/.test(file)) return "file:///" + file.replace(/\\/g, "/").split("/").map((p, i) => (i === 0 ? p : encodeURIComponent(p))).join("/");
  return pathToFileURL(file).href;
}

function timecodeSeconds(tc, fps) {
  if (!tc) return 0;
  const m = String(tc).match(/^(\d+):(\d+):(\d+)[:;](\d+)$/);
  if (!m) return 0;
  const nominal = Math.round(fps.num / fps.den);
  const frames = ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * nominal + Number(m[4]);
  return frames * fps.den / fps.num; // NDF interpretation
}

export function planToFcpxml(plan, options = {}) {
  const problems = validatePlan(plan);
  if (problems.length) throw new Error("Invalid plan: " + problems.join("; "));
  const fps = plan.timeline.fps, frameSec = fps.den / fps.num;
  const t = (frames) => (frames === 0 ? "0s" : `${frames * fps.den}/${fps.num}s`);
  const toFrames = (sec) => Math.round(sec / frameSec);
  const floorFrames = (sec) => Math.floor(sec / frameSec + 1e-6);
  const title = options.projectName || `RP Multicam - ${plan.music.name.replace(/\.[^.]+$/, "")}`;
  const eventName = options.eventName || "R Project Multicam AI";
  const width = plan.timeline.width, height = plan.timeline.height;
  const fmtName = formatName(width, height, fps);
  const total = plan.timeline.duration_frames;

  const res = [];
  res.push(`    <format id="r1"${fmtName ? ` name="${fmtName}"` : ""} frameDuration="${t(1)}" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>`);
  const assets = plan.cameras.map((cam, i) => {
    const id = `r${i + 2}`;
    const startSec = timecodeSeconds(cam.timecode, fps);
    const startFr = toFrames(startSec);
    const durFr = floorFrames(cam.duration);
    const audio = cam.has_audio ? ` hasAudio="1" audioSources="1" audioChannels="${cam.audio_channels || 2}" audioRate="${cam.audio_rate || 48000}"` : "";
    res.push(`    <asset id="${id}" name="${esc(cam.name)}" start="${t(startFr)}" duration="${t(durFr)}" hasVideo="1" format="r1" videoSources="1"${audio}>`,
      `      <media-rep kind="original-media" src="${esc(mediaUrl(cam.file, options.mediaDir))}"/>`, `    </asset>`);
    return { id, cam, startFr, durFr };
  });
  const musicId = `r${plan.cameras.length + 2}`, mcId = `r${plan.cameras.length + 3}`;
  res.push(`    <asset id="${musicId}" name="${esc(plan.music.name)}" start="0s" duration="${t(floorFrames(plan.music.duration))}" hasAudio="1" audioSources="1" audioChannels="${plan.music.audio_channels || 2}" audioRate="${plan.music.audio_rate || 48000}">`,
    `      <media-rep kind="original-media" src="${esc(mediaUrl(plan.music.file, options.mediaDir))}"/>`, `    </asset>`);

  // Multicam: every angle is laid out on the music timeline (gap, then the camera clip).
  res.push(`    <media id="${mcId}" name="${esc(title)} Multicam">`, `      <multicam format="r1" tcStart="0s" tcFormat="NDF">`);
  for (const a of assets) {
    const cam = a.cam, lead = cam.offset_frames;
    res.push(`        <mc-angle name="${esc(cam.role || cam.name)}" angleID="${cam.angle_id}">`);
    let clipOffset = 0, srcIn = a.startFr, dur = a.durFr;
    if (lead > 0) { res.push(`          <gap name="Gap" offset="0s" start="0s" duration="${t(lead)}"/>`); clipOffset = lead; }
    else if (lead < 0) { srcIn += -lead; dur += lead; }
    if (dur > 0) res.push(`          <asset-clip ref="${a.id}" name="${esc(cam.name)}" offset="${t(clipOffset)}" start="${t(srcIn)}" duration="${t(dur)}" format="r1" tcFormat="NDF"/>`);
    res.push(`        </mc-angle>`);
  }
  res.push(`        <mc-angle name="Music" angleID="music">`,
    `          <asset-clip ref="${musicId}" name="${esc(plan.music.name)}" offset="0s" start="0s" duration="${t(floorFrames(plan.music.duration))}" audioRole="music"/>`,
    `        </mc-angle>`, `      </multicam>`, `    </media>`);

  // Storyline: one mc-clip per planned shot.
  const drops = (plan.music.drops || []).map((d) => ({ frame: toFrames(d.time), label: `Drop ${d.rank || ""}`.trim() + (d.confidence ? ` (${d.confidence})` : "") }));
  const spine = [];
  for (const cut of plan.cuts) {
    const len = cut.end_frame - cut.start_frame;
    const marks = drops.filter((d) => d.frame >= cut.start_frame && d.frame < cut.end_frame)
      .map((d) => `            <marker start="${t(d.frame)}" duration="${t(1)}" value="${esc(d.label)}"/>`);
    if (cut.camera < 0) {
      spine.push(`          <gap name="No camera coverage" offset="${t(cut.start_frame)}" start="${t(cut.start_frame)}" duration="${t(len)}"/>`);
      continue;
    }
    spine.push(`          <mc-clip ref="${mcId}" name="${esc(title)}" offset="${t(cut.start_frame)}" start="${t(cut.start_frame)}" duration="${t(len)}">`,
      `            <mc-source angleID="${cut.angle_id}" srcEnable="video"/>`,
      `            <mc-source angleID="music" srcEnable="audio"/>`, ...marks, `          </mc-clip>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<!-- Generated by R Project Multicam AI Engine (${esc(plan.generator.model)}) from ${esc(plan.format)}/${plan.version}. -->`,
    `<fcpxml version="1.10">`,
    `  <resources>`, ...res, `  </resources>`,
    `  <library>`,
    `    <event name="${esc(eventName)}">`,
    `      <project name="${esc(title)}">`,
    `        <sequence format="r1" duration="${t(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `          <spine>`,
    ...spine.map((l) => "  " + l),
    `          </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    ""
  ].join("\n");
}
