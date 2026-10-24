// Compare two engine-bench.cjs outputs. Exit 0 = identical (deep-equal JSON) or within tolerance, 1 = different.
// Tolerance (only used when not byte-identical): numbers within 1e-3 absolute (times 1 ms, BPM 0.01), same array
// lengths, same strings/booleans, and an identical director plan (cut times and camera per interval).
// Usage: node scripts/bench/compare.cjs base.json new.json
'use strict';
const fs = require('fs');
const [A, B] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
const stages = ['audio', 'music', 'sync', 'visual', 'director'];
let bad = 0;
function walk(a, b, p, acc) {
  if (typeof a === 'number' && typeof b === 'number') { if (a !== b && !(isNaN(a) && isNaN(b))) { const d = Math.abs(a - b); acc.num++; acc.max = Math.max(acc.max, d); if (!(d <= 1e-3)) acc.hard.push(p + ' ' + a + ' vs ' + b); } return; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (a !== b) acc.hard.push(p + ' ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b)); return; }
  if (Array.isArray(a) !== Array.isArray(b)) { acc.hard.push(p + ' type'); return; }
  if (Array.isArray(a) && a.length !== b.length) { acc.hard.push(p + ' length ' + a.length + ' vs ' + b.length); return; }
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of keys) walk(a[k], b[k], p + '.' + k, acc);
}
for (const s of stages) {
  const x = A.out[s], y = B.out[s];
  if (JSON.stringify(x) === JSON.stringify(y)) { console.log(`${s.padEnd(8)} identical`); continue; }
  const acc = { num: 0, max: 0, hard: [] }; walk(x, y, s, acc);
  if (acc.hard.length) { bad++; console.log(`${s.padEnd(8)} DIFFERENT: ${acc.hard.length} hard diffs, e.g.\n  ` + acc.hard.slice(0, 8).join('\n  ')); }
  else console.log(`${s.padEnd(8)} within tolerance: ${acc.num} numbers differ, max |diff| ${acc.max.toExponential(2)}`);
}
// The director plan must be exactly the same cuts and cameras.
const pa = A.out.director.plan, pb = B.out.director.plan;
if (pa || pb) {
  const sig = (p) => p ? JSON.stringify({ i: p.intervals.map((it) => [it.start, it.end]), c: p.choices.map((c) => c.camera) }) : null;
  if (sig(pa) !== sig(pb)) { bad++; console.log('director plan: cut times or cameras DIFFER'); } else console.log('director plan: same cut times and cameras (' + pa.choices.length + ' intervals)');
}
const pct = (k) => { const a = A.min[k], b = B.min[k]; return `${String(a).padStart(7)} -> ${String(b).padStart(7)} ms` + (a ? `  (${(a / Math.max(1, b)).toFixed(2)}x)` : ''); };
console.log('timings (min of runs):'); for (const k of Object.keys(A.min)) console.log('  ' + k.padEnd(8) + pct(k));
process.exit(bad ? 1 : 0);
