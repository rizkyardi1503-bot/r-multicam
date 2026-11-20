// Final Cut workflow: the user picks the music file and one folder (or a set of files) per camera with the macOS file
// dialogs, the engine (rp-engine, the Premiere plugin's own code) syncs every clip by audio, paces the cuts to the music,
// and writes an FCPXML that Final Cut Pro imports as a multicam clip plus a project already cut on the beat.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const { pathToFileURL } = require('url');

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

/** Video files directly in a folder (not sub-folders), in name order. */
function mediaIn(folder) {
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isFile() && MEDIA.test(d.name) && !d.name.startsWith('._'))
    .map((d) => path.join(folder, d.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function outputRoot() { return path.join(os.homedir(), 'Movies', 'R Project Multicam'); }
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + '.' + p(d.getMinutes()) + '.' + p(d.getSeconds());
}
/** A file name that is safe in Finder and in FCP's import (no slashes or colons). */
function safeName(s) { return String(s).replace(/[\/:\\]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Multicam'; }

/** Opens the FCPXML in Final Cut Pro (falls back to the default app for .fcpxml). */
function openInFinalCut(file) {
  return new Promise((resolve) => {
    cp.execFile('open', ['-a', 'Final Cut Pro', file], (err) => {
      if (!err) return resolve('Final Cut Pro');
      cp.execFile('open', [file], (err2) => resolve(err2 ? '' : 'default app'));
    });
  });
}

class Studio {
  /** opts: {log, progress(p), picker, open(file), outDir, engineDir, ffmpeg, loadTools} */
  constructor(opts = {}) {
    this.log = opts.log || (() => {});
    this.onProgress = opts.progress || (() => {});
    this.picker = opts.picker || macPicker;
    this.open = opts.open || openInFinalCut;
    this.outDir = opts.outDir || outputRoot();
    this.loadTools = opts.loadTools || (() => import(pathToFileURL(path.join(__dirname, '..', 'rp-engine', 'lib', 'tools.mjs')).href).then((m) => m.TOOLS));
    this.music = null; this.cameras = []; this.analysis = null; this.result = null;
    this.busy = ''; this.abort = null;
  }

  state() {
    return { music: this.music, cameras: this.cameras.map((c) => ({ name: c.name, role: c.role, files: c.files.length, first: path.basename(c.files[0] || '') })),
      analysis: this.analysis, result: this.result };
  }

  async pickMusic() {
    const [file] = await this.picker.music();
    if (!file) return { message: 'No music chosen.' };
    if (!fs.statSync(file).isFile()) throw new Error('Not a file: ' + file);
    if (file !== this.music) { this.music = file; this.analysis = null; this.result = null; }
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
    this.cameras.push(cam); this.result = null;
    this.log('Camera ' + this.cameras.length + ' "' + cam.name + '": ' + files.length + ' clip' + (files.length === 1 ? '' : 's') + ' (role ' + cam.role + ').');
    return { message: 'Added ' + cam.name + ' (' + files.length + ' clips).' };
  }

  removeCamera(index) {
    const i = Number(index);
    if (!(i >= 0 && i < this.cameras.length)) throw new Error('No camera ' + (i + 1) + '.');
    const [c] = this.cameras.splice(i, 1); this.result = null;
    this.log('Removed camera "' + c.name + '".');
    return { message: 'Removed ' + c.name + '.' };
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

  /** opts: {cadences:[2|4|6|8], dropCamera: index|null, sensitivity} */
  async multicam(opts = {}) {
    if (!this.music) throw new Error('Choose the music first.');
    if (!this.cameras.length) throw new Error('Add at least one camera (one folder per camera).');
    const cadences = (opts.cadences || []).map(Number).filter((n) => [2, 4, 6, 8].includes(n));
    const dropCamera = opts.dropCamera === '' || opts.dropCamera == null ? undefined : Number(opts.dropCamera);
    if (dropCamera !== undefined && !(dropCamera >= 0 && dropCamera < this.cameras.length)) throw new Error('Main Drop Camera is not one of the cameras.');
    const title = safeName(path.basename(this.music).replace(/\.[^.]+$/, '')), dir = path.join(this.outDir, title + ' ' + stamp());
    const planFile = path.join(dir, title + '.rpplan.json'), fcpFile = path.join(dir, title + ' - Multicam AI.fcpxml');
    return this.run('Create Multicam Edit', async (tools, progress, ctx) => {
      const tool = (n) => tools.find((t) => t.name === n);
      const r = await tool('plan_multicam').run({
        music: this.music, output: planFile,
        cameras: this.cameras.map((c) => ({ name: c.name, role: c.role, files: c.files })),
        cadences: cadences.length ? cadences : undefined, drop_camera: dropCamera,
        sensitivity: ['conservative', 'balanced', 'aggressive'].includes(opts.sensitivity) ? opts.sensitivity : undefined,
        cache_dir: path.join(this.outDir, '.cache'),
      }, progress, ctx);
      await tool('export_fcpxml').run({ plan: planFile, output: fcpFile, project_name: title + ' - Multicam AI', event_name: 'R Project Multicam AI' });
      const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      const placed = plan.cameras.reduce((n, c) => n + (c.clips || []).length, 0), excluded = plan.cameras.reduce((n, c) => n + (c.excluded_clips || []).length, 0);
      plan.cameras.forEach((c) => {
        const ex = c.excluded_clips || [];
        this.log('  ' + (c.name || c.angle_id) + ': ' + (c.clips || []).length + ' clip(s) synced' + (ex.length ? ', ' + ex.length + ' left out (' + ex.slice(0, 3).map((x) => path.basename(x.file) + ': ' + (x.reason || '?')).join('; ') + (ex.length > 3 ? '; …' : '') + ')' : ''));
      });
      const app = await this.open(fcpFile);
      this.result = { fcpxml: fcpFile, folder: dir, cuts: r.cut_count ?? plan.cuts.length, placed, excluded, openedIn: app };
      this.log('Created ' + path.basename(fcpFile) + ': ' + this.result.cuts + ' cuts, ' + placed + ' clips synced' + (excluded ? ', ' + excluded + ' left out' : '') + '.');
      this.log(app ? 'Opened in ' + app + '. In Final Cut choose a library, then open the project "' + title + ' - Multicam AI".' : 'Double-click the .fcpxml in ' + dir + ' to import it into Final Cut Pro.');
      return { ok: true, ...this.result };
    });
  }
}

module.exports = { Studio, mediaIn, macPicker, asText, safeName, openInFinalCut, MEDIA };
