// Copies the shared engine files from the Premiere (Windows) build into davinci/engine so the DaVinci
// build runs byte-identical engine code. Never edits the source folder.
// Usage: node build-davinci.cjs [sourcePluginDir]
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

// Load order matters (see rp-engine-cli.js): RPBeatFirst before audio-engine/ai-director, audio-core before
// spectral-features (which replaces RPBeat.features), RPVisual and RPAudio before RPDirector.run.
const ENGINE_FILES = [
  'music-pacing-auto.js',
  'audio-core.js',
  'spectral-features.js',
  'audio-engine.js',
  'music-learning.js',
  'music-intelligence-v10.js',
  'visual-quality.js',
  'ai-director.js',
];

const here = __dirname;
const src = path.resolve(process.argv[2] || path.join(here, '..', 'windows', 'Plugin'));
const out = path.join(here, 'engine');
fs.mkdirSync(out, { recursive: true });
// Deterministic (no timestamp, no local paths): the package hash must not change between identical builds.
const manifest = { source: 'plugin/windows/Plugin', files: {} };
let buildId = '';
try { buildId = fs.readFileSync(path.join(src, 'BUILD-ID.txt'), 'utf8').trim(); } catch (e) { /* optional */ }
manifest.sourceBuildId = buildId;
for (const f of ENGINE_FILES) {
  const from = path.join(src, f);
  if (!fs.existsSync(from)) { console.error('Missing engine file: ' + from); process.exit(1); }
  const data = fs.readFileSync(from);
  fs.writeFileSync(path.join(out, f), data);
  manifest.files[f] = crypto.createHash('sha256').update(data).digest('hex');
  console.log('copied ' + f + ' (' + data.length + ' bytes)');
}
manifest.order = ENGINE_FILES;
fs.writeFileSync(path.join(out, 'MANIFEST.json'), JSON.stringify(manifest, null, 1));
console.log('Engine ready in ' + out + (buildId ? ' (source build ' + buildId + ')' : ''));
