// Drone memory in the Premiere plugin (sync-ui.js verifyDrones, Windows and macOS builds): what the venue-light check
// confirms or finds is remembered per drone + reference camera + shoot day, and a remembered offset for the same day
// skips the light check.
'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
function load(platform) {
  const ctx = {};
  (new Function('window', 'module', fs.readFileSync(path.join(ROOT, 'plugin', platform, 'Plugin', 'sync-ui.js'), 'utf8')))(ctx, undefined);
  return ctx.RPSyncUI;
}
const results = (learned) => [
  { name: 'cam 2', drone: false, rows: [{ status: 'placed', start: -10, sourceIn: 0, sourceOut: 900, file: 'osmo.mp4' }] },
  { name: 'drone', drone: true, key: 'DJI Mini4 Pro -> DJI OsmoPocket4P #X', shootDay: '2026-11-27', reference: 'cam 2', learned,
    rows: [{ status: 'placed', confidence: 'clock', start: 100, sourceIn: 0, sourceOut: 30, file: 'd1.mp4', nodeId: 'n1' }] }];
let passed = 0;
(async () => {
  for (const platform of ['windows', 'macos']) {
    const U = load(platform);
    let saved = [], calls = 0;
    const deps = (verdict, shift) => ({ visual: { verify: async () => { calls++; return { verdict, shift, z: 9 }; } }, saveLearned: (...a) => saved.push(a) });
    let r = results(null);
    await U.verifyDrones(r, 'ffmpeg', {}, () => {}, deps('shift', -19.5));
    assert.equal(r[1].rows[0].start, 80.5);
    assert.deepEqual(saved, [['DJI Mini4 Pro -> DJI OsmoPocket4P #X', -19.5, '2026-11-27', 'cam 2']]);
    passed++; console.log('ok - ' + platform + ': a light shift is remembered for the drone, camera and day');
    saved = []; r = results({ offset: -19.5, day: '2026-10-01' });
    await U.verifyDrones(r, 'ffmpeg', {}, () => {}, deps('confirmed', 0.5));
    assert.deepEqual(saved, [['DJI Mini4 Pro -> DJI OsmoPocket4P #X', -19.5, '2026-11-27', 'cam 2']], 'confirmed keeps the offset in use, saved for today');
    passed++; console.log('ok - ' + platform + ': a confirmed offset from another day is saved for this day');
    saved = []; calls = 0; r = results({ offset: -19.5, day: '2026-11-27' });
    await U.verifyDrones(r, 'ffmpeg', {}, () => {}, deps('shift', 7));
    assert.equal(calls, 0, 'same day remembered: the light is not read');
    assert.equal(r[1].visual.verdict, 'remembered');
    assert.equal(r[1].rows[0].start, 100);
    passed++; console.log('ok - ' + platform + ': a remembered offset for the same day skips the light check');
  }
  console.log('PASS drone memory: ' + passed + ' tests');
})().catch((e) => { console.error(e); process.exit(1); });
