// Multi-part sessions: one event recorded as several music files (e.g. a recorder that was
// stopped between sets) and cameras that span the whole night.
//
// Every camera has one clock. For a part p, "anchor[cam][p]" = clip creation time minus its
// timeline offset, i.e. the part's start expressed in that camera's clock. Because all
// cameras watch the same parts, anchor[cam][p] - anchor[cam][0] (the time between part
// starts) is the same for every camera. That lets a camera that is well synced in one part
// guide the search for its clips in the other parts, and lets cameras confirm each other.
import { planMulticam } from "./engine.mjs";

const WEIGHT = { high: 3, medium: 1, low: 0 };
const TOL = 2.5;

function clusters(obs) {
  const out = [];
  for (const o of obs) {
    const support = obs.filter((d) => Math.abs(d.anchor - o.anchor) <= TOL);
    const weight = support.reduce((n, d) => n + d.weight, 0);
    const anchor = support.reduce((n, d) => n + d.anchor * d.weight, 0) / weight;
    if (!out.some((c) => Math.abs(c.anchor - anchor) <= TOL)) out.push({ anchor, weight, count: support.length });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

const strong = (c) => c && c.weight >= 3 && c.count >= 2;

/** Work out every camera's clock anchor in every part from the first (global) sync pass. */
export function sessionAnchors(passes) {
  const parts = passes.length, cams = passes[0].cameras.length;
  const cl = [];
  for (let c = 0; c < cams; c++) {
    cl[c] = [];
    for (let p = 0; p < parts; p++) {
      const obs = passes[p].cameras[c]
        .filter((k) => k.sync && k.sync.method === "audio" && Number.isFinite(k.created) && WEIGHT[k.sync.confidence] > 0)
        .map((k) => ({ anchor: k.created - k.offset, weight: WEIGHT[k.sync.confidence] }));
      cl[c][p] = clusters(obs);
    }
  }
  // Time between the start of part 0 and part p, voted by every camera.
  const shift = [0], shiftInfo = [{ cameras: cams, weight: Infinity }];
  for (let p = 1; p < parts; p++) {
    const votes = [];
    for (let c = 0; c < cams; c++)
      for (const a of cl[c][0]) for (const b of cl[c][p]) votes.push({ d: b.anchor - a.anchor, w: Math.min(a.weight, b.weight), c });
    let best = null;
    for (const v of votes) {
      const sup = votes.filter((x) => Math.abs(x.d - v.d) <= 3);
      const w = sup.reduce((n, x) => n + x.w, 0), k = new Set(sup.map((x) => x.c)).size;
      if (!best || w > best.w || (w === best.w && k > best.k)) best = { d: sup.reduce((n, x) => n + x.d * x.w, 0) / w, w, k };
    }
    const ok = best && ((best.k >= 2 && best.w >= 2) || best.w >= 3);
    shift[p] = ok ? best.d : null;
    shiftInfo[p] = best ? { seconds: Math.round(best.d * 10) / 10, cameras: best.k, weight: best.w, accepted: !!ok } : null;
  }
  const anchors = [];
  for (let p = 0; p < parts; p++) {
    anchors[p] = [];
    for (let c = 0; c < cams; c++) {
      const own = cl[c][p][0];
      if (strong(own)) { anchors[p][c] = { anchor: own.anchor, weight: own.weight, radius: 3, source: "this part" }; continue; }
      // Borrow from the part where this camera is best anchored, via the session shift.
      let from = null;
      for (let q = 0; q < parts; q++) {
        if (q === p || shift[q] === null || shift[p] === null) continue;
        const c0 = cl[c][q][0];
        if (strong(c0) && (!from || c0.weight > from.weight)) from = { ...c0, q };
      }
      anchors[p][c] = from ? { anchor: from.anchor - shift[from.q] + shift[p], weight: from.weight, radius: 4, source: `part ${from.q + 1} via session clock` } : null;
    }
  }
  return { anchors, shift, shiftInfo };
}

/**
 * Plan every part of a session. options = planMulticam options with `parts: [music, ...]`
 * instead of `music`. Returns { plans: [...], session: { shift, anchors } }.
 */
export async function planSession(options) {
  const parts = options.parts;
  if (!Array.isArray(parts) || !parts.length) throw new Error("parts must list the music files");
  const progress = options.progress || (() => {});
  const passes = [];
  for (let p = 0; p < parts.length; p++) {
    passes.push(await planMulticam({ ...options, music: parts[p], syncOnly: true, progress: (x, m) => progress((p + x) / parts.length * 0.6, `Part ${p + 1}: ${m || ""}`) }));
  }
  const session = sessionAnchors(passes);
  const plans = [];
  for (let p = 0; p < parts.length; p++) {
    const plan = await planMulticam({ ...options, music: parts[p], clockAnchors: session.anchors[p], progress: (x, m) => progress(0.6 + (p + x) / parts.length * 0.4, `Part ${p + 1}: ${m || ""}`) });
    plan.session = { part: p + 1, parts: parts.length, seconds_since_part1_start: session.shift[p] === null ? null : Math.round(session.shift[p] * 10) / 10, shift_evidence: session.shiftInfo[p] };
    plans.push(plan);
  }
  return { plans, session };
}
