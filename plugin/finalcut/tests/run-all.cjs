// Runs every Final Cut test in order and stops at the first failure. Needs node 18+, ffmpeg, bash, unzip.
// Usage: node tests/run-all.cjs
'use strict';
const cp = require('child_process'), path = require('path');
const tests = ['engine-tests.cjs', 'install-pack-tests.cjs'];
for (const t of tests) {
  console.log('\n=== ' + t + ' ===');
  const t0 = Date.now();
  const r = cp.spawnSync(process.execPath, [path.join(__dirname, t)], { stdio: 'inherit' });
  if (r.status !== 0) { console.log('FAILED: ' + t); process.exit(1); }
  console.log('(' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)');
}
console.log('\nALL TEST FILES PASSED (' + tests.length + ')');
