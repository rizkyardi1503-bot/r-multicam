// Copies everything the Final Cut Pro build shares with other builds into plugin/finalcut, byte-identical:
//   engine/      <- plugin/macos/Plugin   (the Mac Premiere engine: same BPM / drops / pacing / camera choices)
//   rp-engine/   <- rp-engine/lib         (sync by audio, rp-multicam-plan/1, FCPXML 1.10 export)
//   lib/         <- plugin/davinci/lib    (R Project account + license gate, Google sign-in)
// Never edits the sources. Deterministic (no timestamps, no local paths), so the package hash only changes with content.
// Usage: node build-finalcut.cjs [--check]   --check: exit 1 when a copy differs from its source (nothing is written)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const HERE = __dirname, ROOT = path.join(HERE, '..', '..');
// rp-engine/lib/runtime.mjs loads exactly these (same order as the Premiere panel).
const ENGINE_FILES = ['music-pacing-auto.js', 'audio-core.js', 'spectral-features.js', 'audio-engine.js', 'music-learning.js', 'music-intelligence-v10.js', 'ai-director.js'];
const RP_ENGINE_FILES = ['cache.mjs', 'engine.mjs', 'fcpxml.mjs', 'media.mjs', 'plan-format.mjs', 'runtime.mjs', 'session.mjs', 'tools.mjs'];
const SHARED_LIB = ['account.js', 'google-auth.js'];

const COPIES = [].concat(
  ENGINE_FILES.map((f) => ({ from: path.join('plugin', 'macos', 'Plugin', f), to: 'engine/' + f })),
  RP_ENGINE_FILES.map((f) => ({ from: path.join('rp-engine', 'lib', f), to: 'rp-engine/lib/' + f })),
  SHARED_LIB.map((f) => ({ from: path.join('plugin', 'davinci', 'lib', f), to: 'lib/' + f })),
);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function manifest() {
  let buildId = '';
  try { buildId = fs.readFileSync(path.join(ROOT, 'plugin', 'macos', 'Plugin', 'BUILD-ID.txt'), 'utf8').trim(); } catch (e) { /* optional */ }
  const m = { sourceBuildId: buildId, order: ENGINE_FILES, files: {} };
  for (const c of COPIES) m.files[c.to] = { from: c.from.split(path.sep).join('/'), sha256: sha(fs.readFileSync(path.join(ROOT, c.from))) };
  return JSON.stringify(m, null, 1) + '\n';
}

/** Returns the list of out-of-date files (relative to plugin/finalcut). Writes them unless check is set. */
function build({ check = false, quiet = false } = {}) {
  const stale = [];
  const want = COPIES.map((c) => ({ to: c.to, data: fs.readFileSync(path.join(ROOT, c.from)) }));
  want.push({ to: 'MANIFEST.json', data: Buffer.from(manifest()) });
  for (const w of want) {
    const out = path.join(HERE, w.to);
    let cur = null;
    try { cur = fs.readFileSync(out); } catch (e) { /* missing */ }
    if (cur && cur.equals(w.data)) continue;
    stale.push(w.to);
    if (!check) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, w.data); if (!quiet) console.log('updated ' + w.to); }
  }
  return stale;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const stale = build({ check });
  if (check && stale.length) { console.error('Out of date (run node plugin/finalcut/build-finalcut.cjs): ' + stale.join(', ')); process.exit(1); }
  console.log(check ? 'Final Cut shared files are in sync.' : 'Final Cut shared files ready' + (stale.length ? '' : ' (no change)') + '.');
}
module.exports = { build, COPIES, ENGINE_FILES };
