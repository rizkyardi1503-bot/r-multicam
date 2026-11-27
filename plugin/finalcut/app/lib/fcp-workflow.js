// Final Cut Pro and DaVinci Resolve workflow. The user drops the timeline they exported as FCPXML (or picks the music and
// one folder per camera); the engine (rp-engine, the Premiere plugin's own code) syncs every clip by audio, paces the
// cuts to the music and writes an FCPXML: a multicam clip plus a project cut on the beat for Final Cut Pro, or a flat
// timeline (camera clips on V1, music on A1) for DaVinci Resolve, which does not take multicam clips from FCPXML.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { pathToFileURL } = require('url');
const { readTimeline } = require('./xml-import');
const render = require('./render');

const MEDIA = /\.(mov|mp4|m4v|mxf|mts|m2ts|avi|mkv|insv|lrv|3gp)$/i;
const MUSIC_TYPES = ['public.audio', 'public.movie'];

/** AppleScript string literal. */
function asText(v) { return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

/** Runs osascript and returns its stdout lines; a cancelled dialog (error -128) returns []. */
function osascript(script) {
  return new Promise((resolve, reject) => {
    cp.execFile('osascript', ['-e', script], { timeout: 15 * 60000 }, (err, stdout, stderr) => {
      if (err) {
        if (/-128/.test(String(stderr)) || /User canceled/i.test(String(stderr))) return resolve([]);
        return reject(new Error('macOS file dialog failed: ' + String(stderr || err.message).trim()));
      }
      resolve(String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    });
  });
}

/** macOS dialogs (choose file / choose folder). Each returns POSIX paths, [] when cancelled. */
const macPicker = {
  music: () => osascript('set f to choose file with prompt ' + asText('Choose the master music (the DJ set or song on the edit)') +
    ' of type {' + MUSIC_TYPES.map(asText).join(', ') + '}\nreturn POSIX path of f'),
  folder: () => osascript('set f to choose folder with prompt ' + asText('Choose the folder with the clips of ONE camera') + '\nreturn POSIX path of f'),
  files: () => osascript('set fs to choose file with prompt ' + asText('Choose the clips of ONE camera') + ' of type {"public.movie"} with multiple selections allowed\n' +
    'set out to ""\nrepeat with f in fs\nset out to out & POSIX path of f & linefeed\nend repeat\nreturn out'),
};

/** Windows dialogs (PowerShell + Windows Forms, on top of the browser). Each returns paths, [] when cancelled. */
function psDialog(body) {
  const script = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;Add-Type -AssemblyName System.Windows.Forms;' +
    '$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true};' + body;
  return new Promise((resolve, reject) => {
    cp.execFile('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout: 15 * 60000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error('Windows file dialog failed: ' + String(stderr || err.message).trim()));
      resolve(String(stdout).split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
    });
  });
}
const psq = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const winFile = (title, filter, multi) => psDialog('$d=New-Object System.Windows.Forms.OpenFileDialog;$d.Title=' + psq(title) + ';$d.Filter=' + psq(filter) +
  ';$d.Multiselect=$' + (multi ? 'true' : 'false') + ';if($d.ShowDialog($o) -eq "OK"){$d.FileNames}');
const winPicker = {
  music: () => winFile('Choose the master music (the DJ set or song)', 'Audio or video|*.wav;*.aif;*.aiff;*.mp3;*.m4a;*.aac;*.flac;*.mov;*.mp4|All files|*.*'),
  folder: () => psDialog('$d=New-Object System.Windows.Forms.FolderBrowserDialog;$d.Description=' + psq('Choose the folder with the clips of ONE camera') + ';if($d.ShowDialog($o) -eq "OK"){$d.SelectedPath}'),
  files: () => winFile('Choose the clips of ONE camera', 'Video|*.mov;*.mp4;*.m4v;*.mxf;*.mts;*.m2ts;*.avi;*.mkv|All files|*.*', true),
  lut: () => winFile('Choose a LUT', 'LUT (.cube)|*.cube'),
  xml: () => winFile('Choose the FCPXML exported from Final Cut Pro or DaVinci Resolve', 'FCPXML|*.fcpxml;*.xml'),
};
macPicker.xml = () => osascript('set f to choose file with prompt ' + asText('Choose the FCPXML exported from Final Cut Pro or DaVinci Resolve') + '\nreturn POSIX path of f');
macPicker.lut = () => osascript('set f to choose file with prompt ' + asText('Choose a LUT (.cube)') + '\nreturn POSIX path of f');

/** Video files directly in a folder (not sub-folders), in name order. */
function mediaIn(folder) {
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isFile() && MEDIA.test(d.name) && !d.name.startsWith('._'))
    .map((d) => path.join(folder, d.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function outputRoot() { return path.join(os.homedir(), process.platform === 'win32' ? 'Videos' : 'Movies', 'R Project Multicam'); }
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '.' + p(d.getMinutes()) + '.' + p(d.getSeconds());
}
/** A file name that is safe in Finder and in FCP's import (no slashes or colons). */
/** 3725.4 -> '1:02:05' */
function clock(t) { t = Math.max(0, Math.floor(Number(t) || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, x = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); }
function safeName(s) { return String(s).replace(/[\/:\\]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Multicam'; }

/** Final Cut Pro: opens the FCPXML in it (imports it). DaVinci Resolve has no "open this file" import, so the file is
 *  shown in Finder / Explorer for File > Import > Timeline. Returns what was done ('' when nothing could be opened). */
function openResult(file, target) {
  return new Promise((resolve) => {
    if (target === 'fcp' && process.platform === 'darwin') {
      return cp.execFile('open', ['-a', 'Final Cut Pro', file], (err) => {
        if (!err) return resolve('Final Cut Pro');
        cp.execFile('open', ['-R', file], (e2) => resolve(e2 ? '' : 'Finder'));
      });
    }
    revealFile(file).then(resolve);
  });
}
function revealFile(file) {
  return new Promise((resolve) => {
    if (process.platform === 'darwin') return cp.execFile('open', ['-R', file], (e) => resolve(e ? '' : 'Finder'));
    if (process.platform === 'win32') return cp.execFile('explorer.exe', ['/select,', file], () => resolve('Explorer'));
    cp.execFile('xdg-open', [path.dirname(file)], (e) => resolve(e ? '' : 'file manager'));
  });
}

class Studio {
  /** opts: {log, progress(p), picker, open(file), outDir, engineDir, ffmpeg, loadTools} */
  constructor(opts = {}) {
    this.log = opts.log || (() => {});
    this.onProgress = opts.progress || (() => {});
    this.picker = opts.picker || (process.platform === 'win32' ? winPicker : macPicker);
    this.open = opts.open || openResult;
    this.outDir = opts.outDir || outputRoot();
    this.loadTools = opts.loadTools || (() => import(pathToFileURL(path.join(__dirname, '..', 'rp-engine', 'lib', 'tools.mjs')).href).then((m) => m.TOOLS));
    this.music = null; this.cameras = []; this.analysis = null; this.result = null; this.timeline = null;
    this.plan = null; this.planFile = ''; this.project = ''; this.drops = []; this.exports = []; this.lut = '';
    this.encoders = opts.encoders || null; this.encoderLabel = ''; this.overrides = {}; this.previews = new Map();
    this.busy = ''; this.abort = null;
  }

  state() {
    return { timeline: this.timeline, music: this.music, cameras: this.cameras.map((c) => ({ name: c.name, role: c.role, files: c.files.length, first: path.basename(c.files[0] || '') })),
      analysis: this.analysis, result: this.result, lut: this.lut ? path.basename(this.lut) : '',
      drops: this.drops.map((d) => ({ index: d.index, time: d.time, confidence: d.confidence, thumb: !!d.thumb })),
      set: this.plan ? { duration: this.plan.timeline.duration, cuts: this.plan.cuts.length, bpm: this.plan.music.bpm || null, edits: Object.keys(this.overrides).length } : null,
      exports: this.exports.map((e) => ({ name: path.basename(e.file), format: e.format, duration: e.duration })), encoder: this.encoderLabel };
  }

  /** Loads an FCPXML exported from Final Cut Pro or DaVinci Resolve: its music and one camera per video track. */
  loadTimeline(text, fileName) {
    if (!text || typeof text !== 'string') throw new Error('Empty file.');
    const t = readTimeline(text);
    if (t.missing.length) throw new Error('These files are not on this computer: ' + t.missing.slice(0, 3).map((f) => path.basename(f)).join(', ') + (t.missing.length > 3 ? ' and ' + (t.missing.length - 3) + ' more' : '') + '. Connect the drive that holds the footage, then try again.');
    this.music = t.music;
    this.cameras = t.cameras.map((c, i) => ({ name: c.name, role: 'Camera ' + (i + 1), files: c.files }));
    this.timeline = { file: String(fileName || 'timeline.fcpxml'), title: t.title, app: t.app };
    this.analysis = null; this.result = null; this.forget();
    this.log('Timeline "' + t.title + '" from ' + (t.app === 'resolve' ? 'DaVinci Resolve' : 'Final Cut Pro') + ': music ' + path.basename(t.music) + ', ' + t.cameras.length + ' camera' + (t.cameras.length === 1 ? '' : 's') + ' (' + t.cameras.map((c) => c.name + ' ' + c.files.length).join(', ') + ').');
    return { message: 'Loaded ' + t.title + '.', app: t.app };
  }

  async pickMusic() {
    const [file] = await this.picker.music();
    if (!file) return { message: 'No music chosen.' };
    if (!fs.statSync(file).isFile()) throw new Error('Not a file: ' + file);
    if (file !== this.music) { this.music = file; this.analysis = null; this.result = null; this.forget(); }
    this.log('Music: ' + file);
    return { message: 'Music: ' + path.basename(file) };
  }

  /** mode 'folder' (default) or 'files'. One camera per call. */
  async addCamera(mode, role) {
    let files, name;
    if (mode === 'files') {
      files = (await this.picker.files()).filter((f) => MEDIA.test(f));
      if (!files.length) return { message: 'No clips chosen.' };
      name = path.basename(path.dirname(files[0]));
    } else {
      const [folder] = await this.picker.folder();
      if (!folder) return { message: 'No folder chosen.' };
      files = mediaIn(folder);
      name = path.basename(folder.replace(/\/+$/, ''));
      if (!files.length) throw new Error('No video files in "' + name + '". Choose the folder that holds the clips of one camera (for example the card folder with .MP4 or .MOV files).');
    }
    const taken = new Set(this.cameras.map((c) => c.name));
    let unique = name, n = 2;
    while (taken.has(unique)) unique = name + ' ' + n++;
    const cam = { name: unique, role: String(role || '').trim() || 'Camera ' + (this.cameras.length + 1), files };
    this.cameras.push(cam); this.result = null; this.forget();
    this.log('Camera ' + this.cameras.length + ' "' + cam.name + '": ' + files.length + ' clip' + (files.length === 1 ? '' : 's') + ' (role ' + cam.role + ').');
    return { message: 'Added ' + cam.name + ' (' + files.length + ' clips).' };
  }

  removeCamera(index) {
    const i = Number(index);
    if (!(i >= 0 && i < this.cameras.length)) throw new Error('No camera ' + (i + 1) + '.');
    const [c] = this.cameras.splice(i, 1); this.result = null; this.forget();
    this.log('Removed camera "' + c.name + '".');
    return { message: 'Removed ' + c.name + '.' };
  }

  forget() { this.plan = null; this.planFile = ''; this.drops = []; this.exports = []; this.overrides = {}; this.previews = new Map(); }

  /** The plan with the camera changes made in the timeline. */
  edited() {
    const o = this.overrides;
    if (!this.plan || !Object.keys(o).length) return this.plan;
    return Object.assign({}, this.plan, { cuts: this.plan.cuts.map((c, i) => (o[i] != null ? Object.assign({}, c, { camera: o[i] }) : c)) });
  }

  /** Shots of one drop for the timeline: [{start, end, camera, cut, drop}] in seconds from the clip start. */
  dropTimeline(i, length) {
    if (!this.plan) throw new Error('Find the drops first.');
    const w = render.dropWindows(this.plan, [15, 30, 60].includes(Number(length)) ? Number(length) : 30)[Number(i)];
    if (!w) throw new Error('No drop ' + (Number(i) + 1) + '.');
    const shots = render.shots(this.edited(), w.start, w.end).map((s) => ({ start: s.start - w.start, end: s.end - w.start, camera: s.camera, cut: s.cut, drop: s.drop,
      changed: this.overrides[s.cut] != null }));
    return { index: w.index, start: w.start, end: w.end, drop: w.time - w.start, length: w.end - w.start, shots,
      cameras: this.plan.cameras.map((c) => ({ name: c.name, role: c.role, has: (c.clips || []).length > 0 })) };
  }

  /** Puts another camera on one cut (camera -1 = back to the engine's choice). */
  setCamera(cut, camera) {
    if (!this.plan) throw new Error('Find the drops first.');
    const c = Number(cut), k = Number(camera);
    if (!this.plan.cuts[c]) throw new Error('No such cut.');
    if (k === -1 || k === this.plan.cuts[c].camera) delete this.overrides[c];
    else if (k >= 0 && k < this.plan.cameras.length) this.overrides[c] = k;
    else throw new Error('No such camera.');
    this.log('Cut ' + (c + 1) + ': ' + (this.overrides[c] != null ? this.plan.cameras[k].name : 'engine choice') + '.');
    return { message: 'Camera changed.' };
  }

  /** A small, fast MP4 of one drop for the preview player (cached per settings). Resolves to its path. */
  preview(i, opts = {}) {
    if (!this.plan) return Promise.reject(new Error('Find the drops first.'));
    const format = render.FORMATS[opts.format] ? opts.format : '9x16', length = [15, 30, 60].includes(Number(opts.length)) ? Number(opts.length) : 30;
    const w = render.dropWindows(this.plan, length)[Number(i)];
    if (!w) return Promise.reject(new Error('No such drop.'));
    const zoom = opts.zoom !== false, key = [w.index, format, length, zoom ? 1 : 0, this.lut, JSON.stringify(this.overrides)].join('|');
    if (this.previews.has(key)) return this.previews.get(key);
    const size = { '9x16': [360, 640], '4x5': [432, 540], '16x9': [640, 360] }[format];
    const out = path.join(this.project, '.preview', 'p' + require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 16) + '.mp4');
    const job = (fs.existsSync(out) ? Promise.resolve() : render.renderRange(this.edited(), w.start, w.end, out, { size, zoom, lut: this.lut, parallel: 3, audioBitrate: '128k',
      encoder: { id: 'preview', label: 'Preview', gpu: false, pix: 'yuv420p', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28'] } })).then(() => out);
    job.catch(() => this.previews.delete(key));
    this.previews.set(key, job);
    return job;
  }

  async pickXml() {
    let [file] = await this.picker.xml();
    if (!file) return { message: 'No file chosen.' };
    if (fs.statSync(file).isDirectory()) { const inner = path.join(file, 'Info.fcpxml'); if (fs.existsSync(inner)) file = inner; }   // .fcpxmld bundle
    return this.loadTimeline(fs.readFileSync(file, 'utf8'), path.basename(file));
  }

  async pickLut() {
    const [file] = await this.picker.lut();
    if (!file) { this.lut = ''; return { message: 'No LUT.' }; }
    if (!/\.cube$/i.test(file)) throw new Error('Choose a .cube LUT file.');
    this.lut = file; this.log('LUT: ' + file);
    return { message: 'LUT: ' + path.basename(file) };
  }

  /** Path of a drop's still (for the page), or '' when there is none. */
  thumb(i) { const d = this.drops[Number(i)]; return d && d.thumb && fs.existsSync(d.thumb) ? d.thumb : ''; }

  /** Syncs the cameras and finds every drop: one plan, reused by every export. */
  async findDrops(opts = {}) {
    if (!this.music) throw new Error('Choose the music first.');
    if (!this.cameras.length) throw new Error('Add at least one camera (one folder per camera).');
    const cadences = (opts.cadences || []).map(Number).filter((n) => [2, 4, 6, 8].includes(n));
    const title = safeName(this.timeline ? this.timeline.title : path.basename(this.music).replace(/\.[^.]+$/, ''));
    const dir = path.join(this.outDir, title + ' ' + stamp()), planFile = path.join(dir, title + '.rpplan.json');
    return this.run('Find drops', async (tools, progress, ctx) => {
      await tools.find((t) => t.name === 'plan_multicam').run({
        music: this.music, output: planFile, cameras: this.cameras.map((c) => ({ name: c.name, role: c.role, files: c.files })),
        cadences: cadences.length ? cadences : undefined, cache_dir: path.join(this.outDir, '.cache'),
      }, (p, text) => progress(typeof p === 'object' ? p : { p: Number(p) * 0.9, text }), ctx);
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const thumbs = path.join(dir, '.thumbs'); fs.mkdirSync(thumbs, { recursive: true });
      const drops = render.dropWindows(plan);
      for (const d of drops) {
        try { d.thumb = await render.still(plan, d.time + 0.2, path.join(thumbs, 'drop' + d.index + '.jpg'), ctx); } catch (e) { d.thumb = ''; }
        progress(0.9 + 0.1 * (d.index + 1) / drops.length, 'Drop ' + (d.index + 1) + ' of ' + drops.length);
      }
      this.plan = plan; this.planFile = planFile; this.project = dir; this.drops = drops; this.exports = [];
      this.encoderLabel = render.encoderLabel(await (this.encoders ? this.encoders() : render.encoders()));
      this.log('Found ' + drops.length + ' drop' + (drops.length === 1 ? '' : 's') + ' in ' + Math.round(plan.timeline.duration / 60) + ' min, ' + plan.cuts.length + ' camera cuts.');
      return { ok: true, drops: drops.length };
    });
  }

  /** opts: {drops:[index], full, format '9x16'|'4x5'|'16x9', length 15|30|60, zoom, lut}. Writes MP4s next to the plan. */
  async exportVideos(opts = {}) {
    if (!this.plan) throw new Error('Find the drops first.');
    const format = render.FORMATS[opts.format] ? opts.format : '9x16';
    const length = [15, 30, 60].includes(Number(opts.length)) ? Number(opts.length) : 30;
    const wins = render.dropWindows(this.plan, length);
    const jobs = [...new Set((opts.drops || []).map(Number))].filter((i) => wins[i]).sort((a, b) => a - b)
      .map((i) => ({ start: wins[i].start, end: wins[i].end, name: 'Drop ' + (i + 1) + ' ' + clock(wins[i].time).replace(/:/g, '.') }));
    if (opts.full) jobs.push({ start: 0, end: this.plan.timeline.duration, name: 'Full set' });
    if (!jobs.length) throw new Error('Pick at least one drop (or the full set).');
    const title = safeName(path.basename(this.project).replace(/ \d{4}-\d\d-\d\d .*$/, ''));
    const tag = { '9x16': '9x16', '4x5': '4x5', '16x9': '16x9' }[format];
    return this.run('Export', async (tools, progress, ctx) => {
      // Hybrid encoding: a GPU worker and a CPU worker take whole videos from one queue (a video is never split between
      // encoders, so every file is consistent). A GPU failure redoes that video on the CPU and the GPU is not used again.
      let list = this.encoders ? await this.encoders() : await render.encoders();
      this.encoderLabel = render.encoderLabel(list);
      this.log('Encoding with ' + this.encoderLabel + '.');
      const share = jobs.map(() => 0), report = (text) => progress(share.reduce((a, b) => a + b, 0) / jobs.length, text);
      const done = [];
      const one = async (job, j, enc) => {
        const out = path.join(this.project, title + ' - ' + job.name + ' (' + tag + ').mp4');
        const go = (e) => render.renderRange(this.edited(), job.start, job.end, out, { format, zoom: opts.zoom !== false, lut: opts.lut === false ? '' : this.lut,
          encoder: e, parallel: e.gpu ? 2 : Math.max(1, Math.min(3, Math.floor(os.cpus().length / 4))), signal: ctx.signal, progress: (p, text) => { share[j] = p; report(text); } });
        let r;
        try { r = await go(enc); }
        catch (e) {
          if (!enc.gpu || e.name === 'AbortError') throw e;
          this.log(enc.label + ' failed (' + e.message + '); using the CPU for this video.');
          list = list.filter((x) => !x.gpu); this.encoderLabel = render.encoderLabel(list);
          r = await go(render.CPU);
        }
        done[j] = { file: out, format, duration: r.duration };
        this.log('Exported ' + path.basename(out) + ' (' + Math.round(r.duration) + ' s) · ' + enc.label + '.');
      };
      let next = 0;
      await Promise.all(list.map(async (enc) => {
        while (next < jobs.length) {
          const j = next++;
          if (!list.includes(enc)) { await one(jobs[j], j, render.CPU); continue; }
          await one(jobs[j], j, enc);
        }
      }));
      this.exports.push(...done.filter(Boolean));
      return { ok: true, exported: done.filter(Boolean).length, folder: this.project, encoders: this.encoderLabel };
    });
  }

  /** FCPXML of the same plan for Final Cut Pro or DaVinci Resolve (no new analysis). */
  async exportXml(target) {
    if (!this.plan) throw new Error('Find the drops first.');
    const t = target === 'resolve' ? 'resolve' : 'fcp';
    const title = safeName(path.basename(this.project).replace(/ \d{4}-\d\d-\d\d .*$/, ''));
    const fcpFile = path.join(this.project, title + ' - Multicam AI' + (t === 'resolve' ? ' (DaVinci)' : '') + '.fcpxml');
    return this.run('Export XML', async (tools) => {
      let planFile = this.planFile;
      if (Object.keys(this.overrides).length) { planFile = this.planFile.replace(/\.rpplan\.json$/, '.edited.rpplan.json'); fs.writeFileSync(planFile, JSON.stringify(this.edited(), null, 1)); }
      await tools.find((x) => x.name === 'export_fcpxml').run({ plan: planFile, output: fcpFile, project_name: title + ' - Multicam AI', event_name: 'R Project Multicam AI', flat: t === 'resolve' });
      const app = await this.open(fcpFile, t);
      this.result = { fcpxml: fcpFile, name: path.basename(fcpFile), folder: this.project, target: t, cuts: this.plan.cuts.length, openedIn: app };
      this.log('Created ' + path.basename(fcpFile) + '.');
      return { ok: true, ...this.result };
    });
  }

  setRoles(roles) {
    (Array.isArray(roles) ? roles : []).forEach((r, i) => { if (this.cameras[i] && String(r || '').trim()) this.cameras[i].role = String(r).trim().slice(0, 60); });
  }

  /** Runs one engine job with progress and a stop button. */
  async run(name, fn) {
    if (this.busy) throw new Error('Busy: ' + this.busy + ' is still running.');
    this.busy = name; this.abort = new AbortController(); this.onProgress({ p: 0, text: name });
    const progress = (p, text) => {
      const v = typeof p === 'object' && p ? p : { p, text };
      this.onProgress({ p: Math.max(0, Math.min(1, Number(v.p ?? v.progress ?? 0))), text: v.text || v.message || name });
    };
    try { return await fn(await this.loadTools(), progress, { signal: this.abort.signal }); }
    finally { this.busy = ''; this.abort = null; this.onProgress(null); }
  }

  stop() { if (this.abort) { this.abort.abort(); this.log('Stopping…'); return true; } return false; }

  async analyze() {
    if (!this.music) throw new Error('Choose the music first.');
    return this.run('Analyze Music', async (tools, progress, ctx) => {
      const r = await tools.find((t) => t.name === 'analyze_music').run({ music: this.music }, progress, ctx);
      const drops = Array.isArray(r.drops) ? r.drops : [];
      const energy = Array.isArray(r.sections) && r.sections.length ? r.sections.reduce((n, s) => n + (Number(s.energy) || 0), 0) / r.sections.length : null;
      this.analysis = { bpm: r.bpm ? Math.round(r.bpm * 10) / 10 : null, confidence: r.bpm_confidence || '', drops: drops.length,
        energy: energy == null ? '' : energy >= 0.65 ? 'HIGH' : energy >= 0.3 ? 'MED' : 'LOW', duration: r.duration || null };
      this.log('Music: ' + (this.analysis.bpm || '?') + ' BPM (' + (this.analysis.confidence || 'n/a') + '), ' + drops.length + ' drop' + (drops.length === 1 ? '' : 's') + '.');
      return { ok: true, analysis: this.analysis };
    });
  }

  /** opts: {cadences:[2|4|6|8], dropCamera: index|null, sensitivity, target: 'fcp' | 'resolve'} */
  async multicam(opts = {}) {
    if (!this.music) throw new Error('Choose the music first.');
    if (!this.cameras.length) throw new Error('Add at least one camera (one folder per camera).');
    const cadences = (opts.cadences || []).map(Number).filter((n) => [2, 4, 6, 8].includes(n));
    const dropCamera = opts.dropCamera === '' || opts.dropCamera == null ? undefined : Number(opts.dropCamera);
    if (dropCamera !== undefined && !(dropCamera >= 0 && dropCamera < this.cameras.length)) throw new Error('Main Drop Camera is not one of the cameras.');
    const target = opts.target === 'resolve' ? 'resolve' : 'fcp';
    const title = safeName(this.timeline ? this.timeline.title : path.basename(this.music).replace(/\.[^.]+$/, '')), dir = path.join(this.outDir, title + ' ' + stamp());
    const planFile = path.join(dir, title + '.rpplan.json'), fcpFile = path.join(dir, title + ' - Multicam AI' + (target === 'resolve' ? ' (DaVinci)' : '') + '.fcpxml');
    return this.run('Create Multicam Edit', async (tools, progress, ctx) => {
      const tool = (n) => tools.find((t) => t.name === n);
      const r = await tool('plan_multicam').run({
        music: this.music, output: planFile,
        cameras: this.cameras.map((c) => ({ name: c.name, role: c.role, files: c.files })),
        cadences: cadences.length ? cadences : undefined, drop_camera: dropCamera,
        sensitivity: ['conservative', 'balanced', 'aggressive'].includes(opts.sensitivity) ? opts.sensitivity : undefined,
        cache_dir: path.join(this.outDir, '.cache'),
      }, progress, ctx);
      await tool('export_fcpxml').run({ plan: planFile, output: fcpFile, project_name: title + ' - Multicam AI', event_name: 'R Project Multicam AI', flat: target === 'resolve' });
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const placed = plan.cameras.reduce((n, c) => n + (c.clips || []).length, 0), excluded = plan.cameras.reduce((n, c) => n + (c.excluded_clips || []).length, 0);
      plan.cameras.forEach((c) => {
        const ex = c.excluded_clips || [];
        this.log('  ' + (c.name || c.angle_id) + ': ' + (c.clips || []).length + ' clip(s) synced' + (ex.length ? ', ' + ex.length + ' left out (' + ex.slice(0, 3).map((x) => path.basename(x.file) + ': ' + (x.reason || '?')).join('; ') + (ex.length > 3 ? '; …' : '') + ')' : ''));
      });
      const app = await this.open(fcpFile, target);
      this.result = { fcpxml: fcpFile, name: path.basename(fcpFile), folder: dir, target, cuts: r.cut_count ?? plan.cuts.length, placed, excluded, openedIn: app };
      this.log('Created ' + path.basename(fcpFile) + ': ' + this.result.cuts + ' cuts, ' + placed + ' clips synced' + (excluded ? ', ' + excluded + ' left out' : '') + '.');
      this.log(target === 'resolve' ? 'In DaVinci Resolve choose File > Import > Timeline and pick ' + path.basename(fcpFile) + '.' : app === 'Final Cut Pro' ? 'Opened in Final Cut Pro: choose a library, then open "' + title + ' - Multicam AI".' : 'In Final Cut Pro choose File > Import > XML and pick ' + path.basename(fcpFile) + '.');
      return { ok: true, ...this.result };
    });
  }
}

module.exports = { Studio, mediaIn, macPicker, winPicker, asText, safeName, clock, openResult, revealFile, MEDIA };
