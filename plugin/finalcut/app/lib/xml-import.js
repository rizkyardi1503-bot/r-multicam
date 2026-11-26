// Reads a timeline exported as FCPXML (Final Cut Pro: File > Export XML; DaVinci Resolve: File > Export > Timeline >
// FCPXML) and finds the master music and the cameras on it. No dependencies: a small tolerant XML reader is enough for
// FCPXML (elements and attributes only; text content is not needed).
'use strict';
const fs = require('fs'), path = require('path');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m));
}

/** Element tree: {name, attrs, children, parent}. Comments, DOCTYPE, CDATA and text are skipped. */
function parseXml(text) {
  const root = { name: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  let m;
  while ((m = re.exec(text))) {
    if (!m[2]) continue;
    if (m[1]) { while (cur !== root && cur.name !== m[2]) cur = cur.parent; if (cur !== root) cur = cur.parent; continue; }
    const attrs = {};
    m[3].replace(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g, (x, k, v, d, s) => { attrs[k] = unescapeXml(d !== undefined ? d : s); return x; });
    const el = { name: m[2], attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!m[4]) cur = el;
  }
  if (!root.children.some((c) => c.name === 'fcpxml')) throw new Error('This is not an FCPXML file. In Final Cut Pro choose File > Export XML; in DaVinci Resolve choose File > Export > Timeline and pick FCPXML.');
  return root;
}
function* walk(el) { for (const c of el.children) { yield c; yield* walk(c); } }
const find = (el, name) => { for (const c of walk(el)) if (c.name === name) return c; return null; };

/** file:// URL (or a plain path) -> local path. Handles %20, file://localhost/ and Windows drive letters. */
function urlToPath(src) {
  let s = String(src || '').trim();
  if (!s) return '';
  if (/^file:/i.test(s)) {
    s = s.replace(/^file:\/\/(localhost)?/i, '');
    try { s = decodeURIComponent(s); } catch (e) { /* keep as is */ }
    if (/^\/[A-Za-z]:[\\/]/.test(s)) s = s.slice(1);                 // /C:/Users -> C:/Users
  }
  return s;
}

/** Seconds from an FCPXML time value ("3003/1000s", "12s", "0s"). */
function seconds(v) {
  const m = /^(-?\d+)(?:\/(\d+))?s$/.exec(String(v || '').trim());
  return m ? Number(m[1]) / Number(m[2] || 1) : 0;
}

const VIDEO_EXT = /\.(mov|mp4|m4v|mxf|mts|m2ts|avi|mkv|insv|lrv|3gp|braw|r3d|crm)$/i;
const AUDIO_EXT = /\.(wav|aif|aiff|mp3|m4a|aac|flac|caf|ogg)$/i;

/**
 * Reads the timeline. Returns {app, title, music, cameras:[{name, track, files}], missing:[path], skipped:[name]}.
 * Music: the audio-only file used on the timeline (the longest if there are several). Cameras: one per video track
 * (FCP connected lanes / Resolve tracks V1, V2, ...); when every clip sits on one track, one per source folder.
 */
function readTimeline(text, opts = {}) {
  const exists = opts.exists || fs.existsSync;
  const root = parseXml(text);
  const app = /davinci|resolve/i.test(text) ? 'resolve' : 'fcp';
  const assets = new Map();
  for (const el of walk(root)) {
    if (el.name !== 'asset' || !el.attrs.id) continue;
    const reps = el.children.filter((c) => c.name === 'media-rep');
    const rep = reps.find((r) => r.attrs.kind === 'original-media') || reps[0];
    const file = urlToPath(el.attrs.src || (rep && rep.attrs.src));
    const hasVideo = el.attrs.hasVideo === '1' || (el.attrs.hasVideo === undefined && VIDEO_EXT.test(file));
    const hasAudio = el.attrs.hasAudio === '1' || (el.attrs.hasAudio === undefined && AUDIO_EXT.test(file));
    assets.set(el.attrs.id, { id: el.attrs.id, name: el.attrs.name || path.basename(file), file, hasVideo, hasAudio, duration: seconds(el.attrs.duration) });
  }
  const project = find(root, 'project');
  const spine = find(project || root, 'spine');
  if (!spine) throw new Error('No timeline found in this XML. Export the project or timeline itself (not a single clip or the library).');
  const title = (project && project.attrs.name) || (find(root, 'event') || { attrs: {} }).attrs.name || 'Timeline';

  // Every clip on the timeline that points at an asset, with the track it sits on.
  const uses = [];
  const lane = (el) => { for (let e = el; e && e !== spine; e = e.parent) if (e.attrs.lane !== undefined) return Number(e.attrs.lane) || 0; return 0; };
  for (const el of walk(spine)) {
    const ref = el.attrs.ref;
    if (!ref || !assets.has(ref)) continue;
    if (!/^(asset-clip|video|audio)$/.test(el.name)) continue;
    uses.push({ asset: assets.get(ref), lane: lane(el), kind: el.name, audioOnly: el.name === 'audio' || el.attrs.srcEnable === 'audio' });
  }
  if (!uses.length) throw new Error('The timeline in this XML has no clips. Put the music and the cameras on the timeline, then export again.');

  const musicCands = [...new Set(uses.filter((u) => u.asset.hasAudio && !u.asset.hasVideo).map((u) => u.asset))];
  if (!musicCands.length) throw new Error('No music found on the timeline. Add the master music (an audio file such as WAV or MP3) under the cameras, then export again.');
  const music = musicCands.sort((a, b) => b.duration - a.duration)[0];

  const video = uses.filter((u) => u.asset.hasVideo && !u.audioOnly);
  const groups = new Map();
  for (const u of video) {
    const k = u.lane;
    if (!groups.has(k)) groups.set(k, []);
    if (!groups.get(k).includes(u.asset)) groups.get(k).push(u.asset);
  }
  let cameras = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([k, list]) => ({ track: k, name: 'V' + (k + 1), assets: list }));
  if (cameras.length === 1) {
    // Everything on one track: one camera per source folder.
    const byDir = new Map();
    for (const a of cameras[0].assets) { const d = path.dirname(a.file); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(a); }
    if (byDir.size > 1) cameras = [...byDir.entries()].map(([d, list], i) => ({ track: i, name: path.basename(d) || 'Camera ' + (i + 1), assets: list }));
  }
  if (!cameras.length) throw new Error('No camera clips found on the timeline. Put each camera on its own video track, then export again.');

  const missing = [];
  const check = (f) => { if (!f || !exists(f)) missing.push(f || '(no path)'); };
  check(music.file);
  const outCams = cameras.map((c) => {
    c.assets.forEach((a) => check(a.file));
    return { name: c.name, track: c.track, files: c.assets.map((a) => a.file).sort((x, y) => x.localeCompare(y, undefined, { numeric: true })) };
  });
  return { app, title, music: music.file, musicName: music.name, cameras: outCams, missing: [...new Set(missing)] };
}

module.exports = { readTimeline, parseXml, urlToPath, seconds };
