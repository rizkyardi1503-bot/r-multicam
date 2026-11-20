// Copies everything the Final Cut engine runs into plugin/finalcut/app so the package carries byte-identical code:
//   app/engine     the Premiere (macOS) engine files, same as the panel runs (+ its CSXS/manifest.xml for the version)
//   app/rp-engine  rp-engine (sync, plan, FCPXML) from the repo root
//   app/lib        the account / Google sign-in modules shared with the DaVinci engine
// Never edits the sources. Deterministic: no timestamps or local paths in MANIFEST.json.
// Usage: node build-finalcut.cjs [--check]
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const here = __dirname, repo = path.resolve(here, '..', '..'), app = path.join(here, 'app');
const PLUGIN = path.join(repo, 'plugin', 'macos', 'Plugin');
// Same set and order as the DaVinci build (rp-engine/lib/runtime.mjs loads them in this order).
const ENGINE_FILES = ['music-pacing-auto.js', 'audio-core.js', 'spectral-features.js', 'audio-engine.js', 'music-learning.js',
  'music-intelligence-v10.js', 'visual-quality.js', 'ai-director.js'];
const COPIES = [
  ...ENGINE_FILES.map((f) => [path.join(PLUGIN, f), path.join('engine', f)]),
  [path.join(PLUGIN, 'CSXS', 'manifest.xml'), path.join('engine', 'CSXS', 'manifest.xml')],
  [path.join(repo, 'rp-engine', 'package.json'), path.join('rp-engine', 'package.json')],
  ...['bin', 'lib', 'schema'].flatMap((d) => fs.readdirSync(path.join(repo, 'rp-engine', d)).sort()
    .map((f) => [path.join(repo, 'rp-engine', d, f), path.join('rp-engine', d, f)])),
  [path.join(repo, 'plugin', 'davinci', 'lib', 'account.js'), path.join('lib', 'account.js')],
  [path.join(repo, 'plugin', 'davinci', 'lib', 'google-auth.js'), path.join('lib', 'google-auth.js')],
];

const check = process.argv.includes('--check');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const manifest = { files: {} };
try { manifest.sourceBuildId = fs.readFileSync(path.join(PLUGIN, 'BUILD-ID.txt'), 'utf8').trim(); } catch (e) { manifest.sourceBuildId = ''; }
let stale = 0;
for (const [from, rel] of COPIES) {
  const data = fs.readFileSync(from), to = path.join(app, rel), key = rel.split(path.sep).join('/');
  manifest.files[key] = sha(data);
  if (check) {
    let cur = null;
    try { cur = fs.readFileSync(to); } catch (e) { /* missing */ }
    if (!cur || !cur.equals(data)) { console.error('out of date: app/' + key); stale++; }
    continue;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, data);
}
const text = JSON.stringify(manifest, null, 1) + '\n', mf = path.join(app, 'MANIFEST.json');
if (check) {
  let cur = '';
  try { cur = fs.readFileSync(mf, 'utf8'); } catch (e) { /* missing */ }
  if (cur !== text) { console.error('out of date: app/MANIFEST.json'); stale++; }
  if (stale) { console.error('Run: node plugin/finalcut/build-finalcut.cjs'); process.exit(1); }
  console.log('Final Cut app copies are up to date (' + COPIES.length + ' files).');
} else {
  fs.writeFileSync(mf, text);
  console.log('Copied ' + COPIES.length + ' files into ' + app + (manifest.sourceBuildId ? ' (engine ' + manifest.sourceBuildId + ')' : ''));
}
