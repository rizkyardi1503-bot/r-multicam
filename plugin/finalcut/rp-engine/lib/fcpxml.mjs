// rp-multicam-plan/1 -> FCPXML 1.10 (Final Cut Pro 10.6 or later).
// Produces one multicam clip (one angle per camera + a music angle) and a project whose
// storyline is a run of mc-clips: video from the planned angle, audio always from the music.
// The cuts stay live multicam edits, so angles can still be switched in Final Cut Pro.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validatePlan } from "./plan-format.mjs";
import { frameRate } from "./media.mjs";

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
/**
 * File URL for FCP.
 * - `pathMap` {from, to}: replace a path prefix (e.g. plan made on another machine/mount).
 * - `mediaDir`: relink every file to one folder by file name.
 */
function mediaUrl(file, options) {
  let f = String(file);
  const map = options.pathMap;
  if (map && map.from && f.startsWith(map.from)) f = map.to + f.slice(map.from.length);
  const name = f.split(/[\\/]/).pop();
  if (options.mediaDir) f = path.posix.join(options.mediaDir.replace(/\\/g, "/"), name);
  if (/^[A-Za-z]:[\\/]/.test(f)) return "file:///" + f.replace(/\\/g, "/").split("/").map((p, i) => (i === 0 ? p : encodeURIComponent(p))).join("/");
  // A Mac/Linux target path written on Windows: pathToFileURL would prefix the current drive.
  if (process.platform === "win32" && f.startsWith("/")) return "file://" + f.split("/").map(encodeURIComponent).join("/");
  return pathToFileURL(f).href;
}

// Small exact rational arithmetic for FCPXML times ("n/ds").
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const rat = (n, d) => { const g = gcd(n, d); return { n: n / g, d: d / g }; };
const add = (x, y) => rat(x.n * y.d + y.n * x.d, x.d * y.d);
const ts = (x) => (x.n === 0 ? "0s" : x.d === 1 ? `${x.n}s` : `${x.n}/${x.d}s`);

/**
 * Frame count of a clip's start timecode at the clip's own frame rate. A ';' separator marks
 * drop-frame timecode, which only exists at 29.97/59.94: frame numbers 0-1 (0-3 at 59.94) are
 * skipped at the start of every minute except every tenth, so 01:00:00;00 @29.97 is frame 107892.
 */
export function timecodeFrames(tc, clipFps) {
  const m = String(tc || "").match(/^(\d+):(\d+):(\d+)([:;])(\d+)$/);
  if (!m) return { frames: 0, drop: false };
  const r = frameRate(clipFps || 25), nominal = Math.round(r.num / r.den);
  const dropPerMinute = r.den === 1001 ? { 30: 2, 60: 4 }[nominal] || 0 : 0;
  const drop = m[4] === ";" && dropPerMinute > 0;
  const totalMinutes = Number(m[1]) * 60 + Number(m[2]);
  let frames = (totalMinutes * 60 + Number(m[3])) * nominal + Number(m[5]);
  if (drop) frames -= dropPerMinute * (totalMinutes - Math.floor(totalMinutes / 10));
  return { frames, drop };
}

/** Start timecode of a clip as a rational of seconds. */
export function timecodeStart(tc, clipFps) {
  const r = frameRate(clipFps || 25);
  return rat(timecodeFrames(tc, clipFps).frames * r.den, r.num);
}

/** media_dir relinks by file name, so two different files with one name (C0001.MOV on two cards) cannot share it. */
function checkRelinkNames(plan, options) {
  if (!options.mediaDir) return;
  const seen = new Map();
  const files = [plan.music.file, ...plan.cameras.flatMap((c) => c.clips.map((k) => k.file))];
  for (const file of files) {
    const norm = String(file).replace(/\\/g, "/").toLowerCase(), name = norm.split("/").pop();
    if (!seen.has(name)) seen.set(name, { norm, file });
    else if (seen.get(name).norm !== norm) {
      throw new Error(`media_dir cannot relink two different files named "${name}" (${seen.get(name).file} and ${file}); use path_from/path_to instead, or rename one of them.`);
    }
  }
}

export function planToFcpxml(plan, options = {}) {
  const problems = validatePlan(plan);
  if (problems.length) throw new Error("Invalid plan: " + problems.join("; "));
  checkRelinkNames(plan, options);
  const musicName = plan.music.name || path.basename(String(plan.music.file).replace(/\\/g, "/"));
  const fps = plan.timeline.fps, frameSec = fps.den / fps.num;
  const F = (frames) => rat(frames * fps.den, fps.num);          // timeline frames -> rational
  const t = (frames) => ts(F(frames));
  const toFrames = (sec) => Math.round(sec / frameSec);
  const floorFrames = (sec) => Math.floor(sec / frameSec + 1e-6);
  const title = options.projectName || `RP Multicam - ${musicName.replace(/\.[^.]+$/, "")}`;
  const eventName = options.eventName || "R Project Multicam AI";
  const width = plan.timeline.width, height = plan.timeline.height;
  const total = plan.timeline.duration_frames;

  const res = [];
  let nextId = 1;
  const formats = new Map();
  const formatId = (w, h, rate) => {
    const key = `${w}x${h}@${rate.num}/${rate.den}`;
    if (!formats.has(key)) {
      const id = `r${nextId++}`, name = formatName(w, h, rate);
      formats.set(key, id);
      res.push(`    <format id="${id}"${name ? ` name="${name}"` : ""} frameDuration="${ts(rat(rate.den, rate.num))}" width="${w}" height="${h}" colorSpace="1-1-1 (Rec. 709)"/>`);
    }
    return formats.get(key);
  };
  const timelineFormat = formatId(width, height, fps);

  // One asset per camera clip, each with its own native format.
  const angles = plan.cameras.map((cam) => ({
    cam,
    clips: cam.clips.map((clip) => {
      const id = `r${nextId++}`;
      // Asset format = the media's stored size; Final Cut applies the file's rotation itself.
      const clipFormat = formatId(clip.width || width, clip.height || height, frameRate(clip.fps || fps.num / fps.den));
      // Final Cut reads the start timecode of QuickTime/MXF files but not of MP4 (e.g. Sony
      // XAVC S), so the asset start must follow the container or the clip is rejected.
      const mode = options.assetStart || "auto";
      const useTc = mode === "timecode" || (mode === "auto" && /\.(mov|mxf)$/i.test(String(clip.file)));
      const start = useTc ? timecodeStart(clip.timecode, clip.fps) : rat(0, 1);
      const tcFormat = timecodeFrames(clip.timecode, clip.fps).drop ? "DF" : "NDF";
      const name = String(clip.file).split(/[\\/]/).pop().replace(/\.[^.]+$/, "");
      const audio = clip.has_audio ? ` hasAudio="1" audioSources="1" audioChannels="${clip.audio_channels || 2}" audioRate="${clip.audio_rate || 48000}"` : "";
      res.push(`    <asset id="${id}" name="${esc(name)}" start="${ts(start)}" duration="${t(floorFrames(clip.duration))}" hasVideo="1" format="${clipFormat}" videoSources="1"${audio}>`,
        `      <media-rep kind="original-media" src="${esc(mediaUrl(clip.file, options))}"/>`, `    </asset>`);
      return { id, clip, name, start, tcFormat, offsetFr: toFrames(clip.offset), durFr: floorFrames(clip.duration) };
    })
  }));
  const musicId = `r${nextId++}`, mcId = `r${nextId++}`;
  const musicFr = Math.min(floorFrames(plan.music.duration), total);
  res.push(`    <asset id="${musicId}" name="${esc(musicName)}" start="0s" duration="${t(floorFrames(plan.music.duration))}" hasAudio="1" audioSources="1" audioChannels="${plan.music.audio_channels || 2}" audioRate="${plan.music.audio_rate || 48000}">`,
    `      <media-rep kind="original-media" src="${esc(mediaUrl(plan.music.file, options))}"/>`, `    </asset>`);

  // Multicam: every angle is laid out on the music timeline (gaps between its clips).
  res.push(`    <media id="${mcId}" name="${esc(title)} Multicam">`, `      <multicam format="${timelineFormat}" tcStart="0s" tcFormat="NDF">`);
  for (const { cam, clips } of angles) {
    res.push(`        <mc-angle name="${esc(cam.role || cam.name)}" angleID="${esc(cam.angle_id)}">`);
    let cursor = 0;
    for (const a of clips.slice().sort((x, y) => x.offsetFr - y.offsetFr)) {
      let at = a.offsetFr, inFr = 0, dur = a.durFr;
      if (at < cursor) { inFr = cursor - at; dur -= inFr; at = cursor; } // starts before the angle is free
      if (at + dur > total) dur = total - at;
      if (dur <= 0) continue;
      if (at > cursor) res.push(`          <gap name="Gap" offset="${t(cursor)}" start="0s" duration="${t(at - cursor)}"/>`);
      res.push(`          <asset-clip ref="${a.id}" name="${esc(a.name)}" offset="${t(at)}" start="${ts(add(a.start, F(inFr)))}" duration="${t(dur)}" tcFormat="${a.tcFormat}"/>`);
      cursor = at + dur;
    }
    if (cursor === 0) res.push(`          <gap name="Gap" offset="0s" start="0s" duration="${t(total)}"/>`);
    res.push(`        </mc-angle>`);
  }
  res.push(`        <mc-angle name="Music" angleID="music">`,
    `          <asset-clip ref="${musicId}" name="${esc(musicName)}" offset="0s" start="0s" duration="${t(musicFr)}" audioRole="music"/>`,
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
      `            <mc-source angleID="${esc(plan.cameras[cut.camera].angle_id)}" srcEnable="video"/>`,
      `            <mc-source angleID="music" srcEnable="audio"/>`, ...marks, `          </mc-clip>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<!-- Generated by R Project Multicam AI Engine (${esc(plan.generator?.model || "unknown")}) from ${esc(plan.format)}/${plan.version}. -->`,
    `<fcpxml version="1.10">`,
    `  <resources>`, ...res, `  </resources>`,
    `  <library>`,
    `    <event name="${esc(eventName)}">`,
    `      <project name="${esc(title)}">`,
    `        <sequence format="${timelineFormat}" duration="${t(total)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
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
