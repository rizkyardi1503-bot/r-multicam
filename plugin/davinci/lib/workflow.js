// The three actions (Analyze Music, Create Multicam Edit, Render Best Drops) on top of the bridge and the engine.
// Never edits the original timeline: the edit is built in a new timeline; Best Drops only queues renders and
// restores the render format, render mode and the timeline Mark In/Out afterwards.
'use strict';
const fs = require('fs');
const L = require('./resolve-logic');
const cli = require('../rp-engine-cli.js');

const APPEND_BATCH = 400;        // clips per AppendToTimeline command (keeps each Lua file small)
const END_INCLUSIVE = false;     // verified live in Resolve 21.1: AppendToTimeline endFrame is exclusive

class Session {
  constructor({ bridge, log = () => {}, progress = () => {}, sleep, pollMs = 1000, idlePolls = 3, renderTimeoutMs = 6 * 3600 * 1000 }) {
    this.bridge = bridge; this.log = log; this.progress = progress;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.pollMs = pollMs; this.idlePolls = idlePolls; this.renderTimeoutMs = renderTimeoutMs;
    this.analysis = null; this.busy = null; this.lastSnapshot = null;
  }

  /** Run one action; a second request while one is running is refused. */
  async run(name, fn) {
    if (this.busy) { this.log('Busy: "' + this.busy + '" is still running; request ignored.'); return { ok: false, busy: true }; }
    this.busy = name;
    try { return { ok: true, result: await fn() }; }
    catch (e) { this.log('ERROR: ' + (e && e.message || e)); return { ok: false, error: String(e && e.message || e) }; }
    finally { this.busy = null; this.progress(null); }
  }

  async snapshot() {
    const raw = await this.bridge.call('snapshot', {});
    const { snapshot, refs } = L.buildSnapshot(raw, { log: this.log });
    this.lastSnapshot = snapshot;
    return { raw, snapshot, refs };
  }

  engineProgress(base, span) { return (p, m) => this.progress({ p: base + span * (Number(p) || 0), message: m }); }

  async analyze(snap, musicOptions) {
    if (!snap) snap = (await this.snapshot()).snapshot;
    this.log('Analyzing A1 music (' + snap.a1.clips.length + ' clip(s), ' + snap.duration.toFixed(1) + ' s)...');
    const out = await cli.cmdAnalyze(cli.loadEngine(), { a1: snap.a1, ffmpeg: '', options: musicOptions || {} }, this.engineProgress(0, 1));
    const s = out.summary;
    this.log('BPM ' + s.bpm + ' (' + s.tempoConfidence + ') | drops ' + s.drops + ' | energy ' + s.energy + ' | drop score ' + (s.dropScore == null ? '-' : s.dropScore + '/100'));
    for (const d of s.mainDrops || []) this.log('  main drop at ' + d.time.toFixed(2) + ' s (score ' + d.confidence_score + ')');
    this.analysis = { signature: snap.a1.signature, map: out.map, summary: s };
    return s;
  }

  async ensureAnalysis(snap) {
    if (!this.analysis || this.analysis.signature !== snap.a1.signature) await this.analyze(snap);
    return this.analysis;
  }

  async multicam({ roles = '', cadences = [4, 6, 8], dropCamera = null, vision = false, budget = 60 } = {}) {
    const { snapshot: snap, refs } = await this.snapshot();
    if (snap.skipped.length) this.log('Skipped tracks: ' + snap.skipped.join(', '));
    if (!snap.tracks.length) throw new L.LogicError('No usable video tracks (all empty, disabled or locked).');
    const analysis = await this.ensureAnalysis(snap);
    const roleText = String(roles || '').trim() || L.defaultRoles(snap);
    this.log('Planning camera cuts...');
    const plan = await cli.cmdPlan(cli.loadEngine(), { a1: snap.a1, map: analysis.map, tracks: snap.tracks, duration: snap.duration, frame: snap.frame, ffmpeg: '',
      options: { cadences, roles: roleText, dropCamera, vision: !!vision, budget, ffmpeg: '' } }, this.engineProgress(0, 0.8));
    for (const line of (plan.notes || []).concat(plan.summaries || [])) this.log('  ' + line);
    this.log(plan.intervals.length + ' intervals, ' + (plan.points || []).length + ' edit points.');
    const applied = await this.apply(plan, snap, refs);
    return Object.assign({ plan }, applied);
  }

  /** Build '<name> - Multicam AI' as a NEW timeline (H1, H2), then check every placed clip. */
  async apply(plan, snap, refs) {
    const origId = snap.timelineId;
    const name = L.uniqueTimelineName(snap.timelineNames, snap.timelineName + ' - Multicam AI');
    const probe = L.planSegments(plan, snap, refs, 0, { inclusive: END_INCLUSIVE });
    const need = probe.infos.reduce((m, i) => Math.max(m, i.trackIndex), 1);
    const settings = Object.assign({ timelineFrameRate: L.fpsString(snap.fps) }, snap.settings);
    const created = await this.bridge.call('create_timeline', { name, origId, videoTracks: need, settings });
    const gotFps = L.parseFps(created.fps);
    if (!gotFps || Math.abs(gotFps - snap.fps) > 1e-3) {
      await this.bridge.call('delete_timeline', { id: created.id, origId });
      throw new L.LogicError('The new timeline could not be set to ' + settings.timelineFrameRate + ' fps (got ' + created.fps + '). It was removed; the original timeline is unchanged.');
    }
    if (!created.setCurrent || created.currentId !== created.id) throw new L.LogicError('Could not open the new timeline "' + name + '"; nothing was appended.');
    if (created.video < need) throw new L.LogicError('The new timeline has ' + created.video + ' video tracks; ' + need + ' are needed.');
    const newStart = Number(created.start);
    const { infos: video, gaps } = L.planSegments(plan, snap, refs, newStart, { inclusive: END_INCLUSIVE, log: this.log });
    const music = L.musicInfos(snap, refs, newStart, { inclusive: END_INCLUSIVE });
    const all = music.concat(video);
    if (!all.length) throw new L.LogicError('Nothing to place on the new timeline.');
    const base = { timelineId: created.id, origId };
    const results = [];
    let failed = 0;
    for (let i = 0; i < all.length; i += APPEND_BATCH) {
      const batch = all.slice(i, i + APPEND_BATCH);
      const r = await this.bridge.call('append', Object.assign({ items: batch.map(L.publicInfo) }, base));
      const items = L.arr(r.items);
      if (items.length === batch.length) results.push(...items);
      else {
        // Partial batch: match returned clips by (track, start) instead of by position (L4).
        failed += batch.length - items.length;
        this.log('AppendToTimeline placed ' + items.length + ' of ' + batch.length + ' clips in a batch.');
        const key = (kind, track, start) => kind + ':' + track + ':' + start;
        const byKey = new Map(items.map((it) => [key(it.trackType || '', it.trackIndex, Number(it.start)), it]));
        results.push(...batch.map((b) => byKey.get(key(b.mediaType === 2 ? 'audio' : 'video', b.trackIndex, b.recordFrame)) || null));
      }
      this.progress({ p: 0.8 + 0.2 * Math.min(1, (i + batch.length) / all.length), message: 'Placing clips ' + Math.min(all.length, i + batch.length) + ' / ' + all.length });
    }
    // Verify position, length and source in-point of every clip (Q1: a start-timecode or fps mix-up shows up here).
    let mismatches = 0;
    all.forEach((info, k) => {
      const got = results[k];
      if (!got) return;
      const where = info.mediaType === 2 ? 'A1' : 'V' + info.trackIndex;
      const problems = [];
      if (Number(got.start) !== info.recordFrame) problems.push('start ' + got.start + ' (wanted ' + info.recordFrame + ')');
      // Mixed frame rates: source frames are whole numbers, so the placed length may differ by one record frame.
      const tol = Math.abs(Number(info._ratio || 1) - 1) > 1e-9 ? 1 : 0;
      if (Math.abs(Number(got.duration) - info._length) > tol) problems.push('length ' + got.duration + ' (wanted ' + info._length + ')');
      if (got.srcStart != null && Math.abs(Number(got.srcStart) - info.startFrame) > 1) problems.push('SOURCE IN ' + got.srcStart + ' (wanted ' + info.startFrame + ')');
      if (problems.length) { mismatches++; this.log('MISMATCH on ' + where + ' at ' + info.recordFrame + ': ' + problems.join(', ') + '.'); }
    });
    const placed = results.filter(Boolean).length;
    this.log('New timeline "' + name + '": ' + music.length + ' music clip(s), ' + video.length + ' camera clip(s) requested, ' + placed + ' placed, ' + failed + ' failed, ' + mismatches + ' size/position mismatch(es), ' + gaps.length + ' gap(s). The original timeline was not changed.');
    return { timelineId: created.id, name, video, music, gaps, placed, failed, mismatches };
  }

  async bestDrops(count, targetDir) {
    const { snapshot: snap } = await this.snapshot();
    const analysis = await this.ensureAnalysis(snap);
    const out = await cli.cmdDrops(cli.loadEngine(), { map: analysis.map, a1: snap.a1, duration: snap.duration, frame: snap.frame, count: Number(count) || 5 }, () => {});
    this.log(out.total + ' valid Best Drops found; rendering ' + out.drops.length + '.');
    const folder = String(targetDir || '').trim() || L.defaultDropFolder();
    fs.mkdirSync(folder, { recursive: true });
    const taken = new Set();
    const jobs = out.drops.map((d, i) => L.dropRenderSettings(d, i + 1, snap, folder,
      L.freeName(folder, 'Best Drop ' + String(i + 1).padStart(2, '0') + ' - ' + L.clockName(d.time), taken)));
    // Save first, in its own step, so cleanup always has something to restore (L6).
    const saved = await this.bridge.call('render_save', { timelineId: snap.timelineId });
    const status = {};
    let ids = [], inProgress = true;
    try {
      const r = await this.bridge.call('render_start', { timelineId: snap.timelineId, format: 'mp4', codec: 'H264', jobs });
      ids = L.arr(r.jobs);
      if (r.error) throw new L.LogicError(r.error);
      if (L.arr(r.rejected).length) this.log('Render settings rejected for drop(s): ' + L.arr(r.rejected).join(', '));
      if (!ids.length) throw new L.LogicError('No render job could be added.');
      if (!r.started) throw new L.LogicError('DaVinci did not start rendering.');
      jobs.forEach((j, i) => { if (i < ids.length) this.log('Queued ' + j.CustomName + '.mp4 (' + out.drops[i].start.toFixed(2) + '-' + out.drops[i].end.toFixed(2) + ' s).'); });
      const t0 = Date.now();
      let idle = 0;
      for (;;) {
        const p = await this.bridge.call('render_poll', { jobs: ids });
        inProgress = !!p.inProgress;
        let done = true, pct = 0;
        for (const id of ids) {
          const st = (p.status || {})[id] || {};
          if (status[id] !== st.JobStatus) { this.log('Render ' + id + ': ' + st.JobStatus + (st.Error ? ' (' + st.Error + ')' : '')); status[id] = st.JobStatus; }
          if (!L.FINAL_STATES.includes(st.JobStatus)) done = false;
          pct += Number(st.CompletionPercentage) || (L.FINAL_STATES.includes(st.JobStatus) ? 100 : 0);
        }
        this.progress({ p: pct / 100 / ids.length, message: 'Rendering Best Drops' });
        if (done) break;
        idle = inProgress ? 0 : idle + 1;
        if (idle >= this.idlePolls) { this.log('DaVinci reports no render in progress; stopped waiting.'); break; }
        if (Date.now() - t0 > this.renderTimeoutMs) { this.log('Render still running after the time limit; check the Deliver page.'); break; }
        await this.sleep(this.pollMs);
      }
    } finally {
      const finished = ids.filter((id) => L.FINAL_STATES.includes(status[id]) || !inProgress);
      try {
        const c = await this.bridge.call('render_cleanup', { timelineId: snap.timelineId, deleteJobs: finished, saved });
        const f = saved && saved.format;
        this.log('Render queue cleaned (' + c.deleted + ' job(s) removed). Render format ' + (c.formatRestored ? 'restored' : 'NOT restored') +
          (f && f.format ? ' (' + f.format + ' / ' + f.codec + ')' : '') + ', render mode ' + (c.modeRestored ? 'restored' : 'not restored') +
          ', Mark In/Out ' + (c.marksRestored ? 'restored' : 'NOT restored') + '.');
        for (const x of L.arr(c.notRestored)) this.log('Could not restore ' + x + ' (DaVinci needs both marks); please set it again by hand.');
      } catch (e) { this.log('Could not restore render settings: ' + e.message); }
      // M4: these Deliver settings cannot be read back through the API, so they stay as Best Drops left them.
      this.log('Note: Deliver page now keeps Best Drops values for Location, File name, "Render: Single clip / In-Out range", unique file names (off) and Export video/audio (on).');
    }
    const complete = ids.filter((id) => status[id] === 'Complete').length;
    this.log('Best Drops: ' + complete + ' of ' + ids.length + ' rendered to ' + folder);
    return { jobs: ids, status, complete, folder, drops: out.drops, names: jobs.map((j) => j.CustomName) };
  }
}

module.exports = { Session, APPEND_BATCH, END_INCLUSIVE };
