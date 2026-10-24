// Node stand-in for "DaVinci + R Project Multicam AI.lua": consumes <profile>/RProjectBridge/cmd-<id>-<n>.lua files
// (using the RPCMD header), checks the session nonce like the Lua bridge, applies the operation to an in-memory
// project and answers through a Fusion.prefs-style file with the same encoding (Hello / Beat / Response).
// Behaviour copied from the live probe (Resolve 21.1 Free): endFrame EXCLUSIVE; CreateEmptyTimeline makes the
// timeline current at the project frame rate (24) until SetSetting changes it; render mode 1; a WAV reports FPS 24.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const snippets = require('../lib/lua-snippets');

const hex = (s) => Buffer.from(s, 'utf8').toString('hex');

class MockDaVinci {
  constructor({ prefsPath, model, session = 1, options = {} }) {
    Object.assign(this, { prefsPath, model, options });
    this.dir = path.join(path.dirname(prefsPath), 'RProjectBridge');
    this.nonce = crypto.randomBytes(16).toString('hex');
    this.id = 's' + session + 'x' + this.nonce.slice(0, 6);
    this.next = 1; this.beats = 0; this.ops = []; this.appends = []; this.renders = []; this.cleanups = []; this.rejected = 0;
    this.origSnapshotJson = JSON.stringify(model.timelines[0]);
    this.uid = 0; this.prefs = {}; this.renderMode = 1;
  }
  writePrefs() {
    const lines = Object.keys(this.prefs).sort().map((k) => '\t\t\t' + k + ' = "' + this.prefs[k] + '",');
    const text = '{\n\tGlobal = {\n\t\tPaths = {\n\t\t\tMap = { ["Scripts:"] = "UserPaths:Scripts" },\n\t\t},\n\t\tRProjectBridge = {\n' + lines.join('\n') + '\n\t\t},\n\t},\n}\n';
    const tmp = this.prefsPath + '.tmp';
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, this.prefsPath);
  }
  beat(state) { this.prefs.Beat = this.id + ':' + this.next + ':' + (++this.beats) + ':' + (state || 'idle'); }
  start() {
    this.prefs.Hello = this.id + ':' + hex(JSON.stringify({ version: 'mock', id: this.id, nonce: this.nonce, product: 'DaVinci Resolve', resolve: '21.1.0.17', studio: false, project: this.model.projectName, timeline: 'Druva test' }));
    this.prefs.Response = '';
    this.beat('hello'); this.writePrefs();
    this.timer = setInterval(() => this.tick(), 20);
    this.beatTimer = setInterval(() => { if (!this.paused) { this.beat('idle'); this.writePrefs(); } }, 300);
    return this;
  }
  stop() { clearInterval(this.timer); clearInterval(this.beatTimer); this.prefs.Response = ''; this.beat('stopped'); this.writePrefs(); }
  tick() {
    if (this.paused) return;
    const file = path.join(this.dir, 'cmd-' + this.id + '-' + this.next + '.lua');
    if (!fs.existsSync(file)) return;
    const n = this.next++;
    const text = fs.readFileSync(file, 'utf8');
    const head = snippets.parseHeader(text);
    let payload;
    if (snippets.parseNonce(text) !== this.nonce) { this.rejected++; payload = { ok: false, error: 'Command rejected (not from this R Project Engine session).' }; }
    else { try { payload = { ok: true, result: this.exec(head.op, head.args) }; } catch (e) { payload = { ok: false, error: e.message }; } }
    this.prefs.Response = this.id + ':' + n + ':' + hex(JSON.stringify(payload));
    this.beat('idle'); this.writePrefs();
    if (head && head.op === 'stop' && payload.ok) this.stop();
  }
  tl(id) { return this.model.timelines.find((t) => t.id === id); }
  media(id, p) { return this.model.media.find((m) => m.id === id) || this.model.media.find((m) => m.path && m.path.toLowerCase() === String(p || '').replace(/\\/g, '/').toLowerCase()); }
  item(it) {
    const m = it.mpiId && this.media(it.mpiId);
    return { name: it.name, type: it.type, start: it.start, end: it.end, duration: it.end - it.start, srcStart: it.srcStart, srcEnd: it.srcEnd, enabled: it.enabled, id: it.id,
      mpi: m ? { id: m.id, path: m.path, fps: m.fps, type: m.type, start: m.start } : undefined };
  }
  open(id, what) {
    const t = this.tl(id);
    if (!t) throw Error('The ' + what + ' timeline was not found.');
    if (!this.options.noSwitch) this.model.current = t.id;
    if (this.model.current !== id) throw Error('The current timeline is not the ' + what + ' timeline; nothing was changed.');
    return t;
  }
  exec(op, A) {
    this.ops.push({ op, args: A });
    const M = this.model;
    switch (op) {
      case 'ping': return { project: M.projectName };
      case 'stop': return { stopping: true };
      case 'snapshot': {
        const t = this.tl(M.current);
        return { project: M.projectName, projectFps: M.projectFps,
          timeline: { id: t.id, name: t.name, start: t.start, end: t.video.concat(t.audio).flatMap((tr) => tr.items.map((i) => i.end)).reduce((a, b) => Math.max(a, b), t.start),
            settings: { timelineFrameRate: t.fps, timelineResolutionWidth: t.width, timelineResolutionHeight: t.height, timelineDropFrameTimecode: '0' } },
          timelineNames: M.timelines.map((x) => x.name), audioTracks: t.audio.length,
          audio: t.audio.length ? t.audio[0].items.map((i) => this.item(i)) : [],
          video: t.video.map((tr, k) => ({ n: k + 1, enabled: tr.enabled, locked: tr.locked, items: tr.items.map((i) => this.item(i)) })) };
      }
      case 'create_timeline': {
        if (M.timelines.some((t) => t.name === A.name)) throw Error('Could not create the timeline ' + A.name);
        const t = { id: 'tl-new-' + (++this.uid), name: A.name, start: 86400, fps: M.projectFps, width: '1920', height: '1080', custom: '1',
          video: [{ enabled: true, locked: false, items: [] }], audio: [{ items: [] }], marks: {} };
        M.timelines.push(t); M.current = t.id;
        const applied = {};
        for (const k of ['timelineFrameRate', 'timelineResolutionWidth', 'timelineResolutionHeight', 'timelineDropFrameTimecode']) {
          if (A.settings[k] == null) continue;
          if (k === 'timelineFrameRate') { applied[k] = !this.options.lockFps; if (!this.options.lockFps) t.fps = String(A.settings[k]); }
          else { applied[k] = true; if (k !== 'timelineDropFrameTimecode') t[k === 'timelineResolutionWidth' ? 'width' : 'height'] = String(A.settings[k]); }
        }
        if (this.options.noSwitch) M.current = 'tl-orig';
        while (t.video.length < A.videoTracks) t.video.push({ enabled: true, locked: false, items: [] });
        return { id: t.id, name: t.name, start: t.start, fps: t.fps, width: t.width, height: t.height, setCurrent: !this.options.noSwitch,
          currentId: M.current, video: t.video.length, audio: t.audio.length, applied };
      }
      case 'delete_timeline': {
        if (A.id === A.origId) throw Error('Refusing to delete the original timeline.');
        M.timelines = M.timelines.filter((t) => t.id !== A.id); this.deletedTimelines = (this.deletedTimelines || []).concat([A.id]);
        return { deleted: true };
      }
      case 'append': {
        if (A.timelineId === A.origId) throw Error('Refusing to append to the original timeline.');
        const t = this.open(A.timelineId, 'new');
        const out = [];
        A.items.forEach((x, k) => {
          const m = this.media(x.mpiId, x.path);
          if (!m) throw Error('Media pool item not found: ' + x.path);
          this.appends.push(Object.assign({ timelineId: t.id }, x));
          if (this.options.dropEvery && k % this.options.dropEvery === 1) return;          // partial batch
          const srcLen = x.endFrame - x.startFrame + (this.options.inclusive ? 1 : 0);     // live: endFrame exclusive
          const len = Math.round(srcLen * 25 / (Number(m.fps) || 25));                    // record frames from source frames
          const src = x.startFrame + (this.options.srcShift && x.mediaType === 1 ? this.options.srcShift : 0);
          const it = { id: 'it-' + (++this.uid), name: path.basename(m.path), type: x.mediaType === 2 ? 'audio' : 'video', start: x.recordFrame, end: x.recordFrame + len,
            srcStart: src, srcEnd: src + srcLen, enabled: true, mpiId: m.id };
          const tracks = x.mediaType === 2 ? t.audio : t.video;
          if (x.trackIndex > tracks.length) return;
          tracks[x.trackIndex - 1].items.push(it);
          out.push({ id: it.id, start: it.start, duration: len, srcStart: it.srcStart, trackType: it.type, trackIndex: x.trackIndex });
        });
        return { requested: A.items.length, count: out.length, items: out };
      }
      case 'render_save': {
        const t = this.open(A.timelineId, 'render');
        return { format: Object.assign({}, M.renderFormat), mode: this.renderMode, marks: JSON.parse(JSON.stringify(t.marks)) };
      }
      case 'render_start': {
        const t = this.open(A.timelineId, 'render');
        this.renderMode = 1;
        M.renderFormat = { format: A.format, codec: A.codec };
        const ids = A.jobs.map((s, i) => { this.renders.push(Object.assign({ timelineId: t.id }, s)); t.marks = { video: { in: s.MarkIn - t.start, out: s.MarkOut - t.start } }; return 'job-' + (i + 1); });
        this.jobs = ids.map((id) => ({ id, polls: 0 }));
        return { jobs: ids, rejected: [], started: true };
      }
      case 'render_poll': {
        const status = {};
        for (const id of A.jobs) { const j = this.jobs.find((x) => x.id === id); j.polls++; status[id] = this.options.stuck ? { JobStatus: 'Rendering', CompletionPercentage: 5 } : j.polls < 2 ? { JobStatus: 'Rendering', CompletionPercentage: 50 } : { JobStatus: 'Complete', CompletionPercentage: 100 }; }
        return { inProgress: !this.options.stuck && this.jobs.some((j) => j.polls < 2), status };
      }
      case 'render_cleanup': {
        this.cleanups.push(A);
        const s = A.saved || {};
        if (s.format && s.format.format) M.renderFormat = { format: s.format.format, codec: s.format.codec };
        if (s.mode != null) this.renderMode = s.mode;
        const t = this.tl(A.timelineId), notRestored = [];
        if (t && s.marks) {
          t.marks = {};
          for (const k of ['video', 'audio']) { const r = s.marks[k]; if (r && r.in != null && r.out != null) t.marks[k] = { in: r.in, out: r.out }; else if (r) notRestored.push(k + (r.in != null ? ' Mark In only' : ' Mark Out only')); }
        }
        this.deletedJobs = (this.deletedJobs || []).concat(A.deleteJobs || []);
        return { deleted: (A.deleteJobs || []).length, formatRestored: true, modeRestored: true, marksRestored: !notRestored.length, notRestored };
      }
      default: throw Error('Unknown op ' + op);
    }
  }
}

module.exports = { MockDaVinci };
