// Drone sync reference camera (plugin drone-sync.js, Windows and macOS builds): the drone follows the clocked camera that
// places the most drone clips inside the music. Numbers mirror Zumana 25 Nov 2026: Mavic 4 (true UTC) with a DJI Osmo
// (local time as UTC, correct clock), two Sony cameras (no zone, ~67 s off) and a Blackmagic (true UTC, ~93 min late).
'use strict';
const assert = require('assert/strict'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');

function load(platform) {
  const ctx = {};
  (new Function('window', 'module', fs.readFileSync(path.join(ROOT, 'plugin', platform, 'Plugin', 'drone-sync.js'), 'utf8')))(ctx, undefined);
  return ctx.RPDroneSync;
}

const MUSIC = 4276.1, ZONE = 8 * 3600;
const masterLocal = Date.UTC(2026, 10, 25, 23, 11, 4) / 1000;          // music starts 23:11:04 local (Bali, UTC+8)
const osmo = { name: 'cam 3', make: 'DJI', model: 'DJI OsmoPocket4P', serial: 'ANHXP7P002H7JH', anchor: masterLocal, zone: 0, placed: 2 };
const sony = { name: 'cam 2', make: 'Sony', model: 'Sony', serial: '', anchor: masterLocal - ZONE - 66.64, zone: null, placed: 2 };
const bmd = { name: 'cam 4', make: 'Blackmagic', model: 'Blackmagic Pocket Cinema Camera 4K', serial: 'c8be3204', anchor: masterLocal - ZONE + 5615.6, zone: ZONE, placed: 23 };
// 50 Mavic clips from 23:27:01 local, true UTC in creation_time, local time in the file name.
const clips = [];
for (let i = 0; i < 50; i++) {
  const local = masterLocal + 957.4 + i * 63, d = new Date(local * 1000), p = (n) => String(n).padStart(2, '0');
  const name = `DJI_${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}_${String(i + 1).padStart(4, '0')}_D.MP4`;
  clips.push({ id: String(i), name, fileName: name, created: local - ZONE, sourceIn: 0, duration: 30 });
}
const drone = { name: 'MAVIC 4', make: 'DJI', model: 'DJI Mavic4 Pro L3B', serial: '', clips };
const placed = (p) => p.clips.filter((c) => c.status === 'placed');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok - ' + name); }

for (const platform of ['windows', 'macos']) {
  const D = load(platform);
  test(platform + ': a camera with a wrong clock is skipped; the drone follows the Osmo (Zumana 25 Nov)', () => {
    const p = D.planDrone(drone, [sony, osmo, bmd], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(D.chooseReference([sony, osmo, bmd], 'DJI', 28800).name, 'cam 4', 'zone match alone picks the Blackmagic');
    assert.equal(p.reference, 'cam 3');
    assert.equal(placed(p).length, 50);
    assert.ok(Math.abs(placed(p)[0].start - 957.88) < 0.05, 'first clip at ' + placed(p)[0].start);
    // The Osmo is taken first, so the Blackmagic is never tried and there is nothing to explain.
    assert.equal(p.osmo, true);
    assert.ok(!p.warnings.some((w) => /instead/.test(w)));
  });
  test(platform + ': without the Osmo the drone follows the Sony clock (all clips placed, ~67 s later)', () => {
    const p = D.planDrone(drone, [sony, bmd], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(p.reference, 'cam 2');
    assert.equal(placed(p).length, 50);
    assert.ok(Math.abs(placed(p)[0].start - (957.88 + 66.64)) < 0.1, 'first clip at ' + placed(p)[0].start);
  });
  test(platform + ': only a wrong clock: nothing is placed and the clips say why', () => {
    const p = D.planDrone(drone, [bmd], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(p.reference, 'cam 4');
    assert.equal(placed(p).length, 0);
    assert.ok(p.clips.every((c) => c.reason === 'camera clock places it outside the music'));
  });
  test(platform + ': when every camera places the drone inside the music, the old order still decides (no change for working shoots)', () => {
    const goodBmd = Object.assign({}, bmd, { anchor: masterLocal - ZONE + 1.5 });
    const p = D.planDrone(drone, [sony, osmo, goodBmd], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(p.reference, 'cam 3', 'the Osmo is always the reference when it recorded (decided 27 Nov 2026)');
    assert.equal(placed(p).length, 50);
    assert.ok(!p.warnings.some((w) => /instead/.test(w)));
  });
  test(platform + ': a remembered correction for the followed camera is still applied', () => {
    const key = D.offsetKey(drone, osmo), learned = { [key]: { offset: -4.12, at: '2026-11-21T17:38:25.962Z', shots: { '2026-11-25': { offset: -4.12, at: '2026-11-26T00:00:00Z' } } } };
    const p = D.planDrone(drone, [sony, osmo, bmd], { musicDuration: MUSIC, frame: 0.04, learned });
    assert.equal(p.reference, 'cam 3');
    assert.equal(p.learned.offset, -4.12);
    assert.ok(Math.abs(placed(p)[0].start - (957.88 - 4.12)) < 0.05, 'first clip at ' + placed(p)[0].start);
  });
  // Two cameras without a zone: the DJI one is first (same brand as the drone), the Sony second.
  const first = { name: 'camA', make: 'DJI', model: 'DJI OsmoPocket4P', serial: 'A1', anchor: masterLocal, zone: null, placed: 5 };
  test(platform + ': one clip at the edge of the music does not move the drone to another camera', () => {
    // camA places 1 clip (the other ends just before the music); camB, 3 s off, places 2.
    const edge = [{ id: 'a', name: 'DJI_A.MP4', created: masterLocal - 31, sourceIn: 0, duration: 30 },
      { id: 'b', name: 'DJI_B.MP4', created: masterLocal + 600, sourceIn: 0, duration: 30 }];
    const camB = { name: 'camB', make: 'Sony', model: 'Sony', serial: '', anchor: masterLocal - 3, zone: null, placed: 9 };
    const p = D.planDrone(Object.assign({}, drone, { clips: edge }), [first, camB], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(p.reference, 'camA');
    assert.equal(placed(p).length, 1);
    assert.ok(!p.warnings.some((w) => /instead/.test(w)));
  });
  test(platform + ': drone footage filmed before the set does not make a late clock win', () => {
    // 10 clips before the music and 10 during it: camA (right clock) places 10, camB (30 min late) places all 20.
    const pre = [];
    for (let i = 0; i < 20; i++) pre.push({ id: String(i), name: 'DJI_' + i + '.MP4', created: masterLocal + (i < 10 ? -1500 + i * 60 : 300 + i * 60), sourceIn: 0, duration: 30 });
    const late = { name: 'camB', make: 'Sony', model: 'Sony', serial: '', anchor: masterLocal - 1800, zone: null, placed: 9 };
    const p = D.planDrone(Object.assign({}, drone, { clips: pre }), [first, late], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(p.reference, 'camA');
    assert.equal(placed(p).length, 10);
  });
  test(platform + ': a drone follows the camera it was paired with before (its Osmo), even when another camera ranks first', () => {
    // Zumana 27 Nov 2026: Osmo (phone clock) and Blackmagic (most clips) both store true UTC like the drone; the
    // remembered pairing Mini 4 -> Osmo wins on a later shoot day, whatever the ranking says.
    const osmoUtc = Object.assign({}, osmo, { zone: ZONE, anchor: masterLocal - ZONE, placed: 3 });
    const bmdRight = Object.assign({}, bmd, { anchor: masterLocal - ZONE - 19.5, placed: 53 });
    const mini = Object.assign({}, drone, { model: 'DJI Mini4 Pro' });
    const sameBrandBmd = Object.assign({}, bmdRight, { make: 'DJI', model: 'DJI Osmo Action 5', serial: 'Z9' });
    assert.equal(D.planDrone(mini, [sameBrandBmd, osmoUtc], { musicDuration: MUSIC, frame: 0.04, learned: {} }).reference, 'cam 4', 'without memory the camera with most clips wins');
    const key = D.offsetKey(mini, osmoUtc), learned = { [key]: { offset: 0, shots: { '2026-10-01': { offset: 0 } } } };
    const p = D.planDrone(mini, [sameBrandBmd, osmoUtc], { musicDuration: MUSIC, frame: 0.04, learned });
    assert.equal(p.reference, 'cam 3');
    assert.equal(p.paired, true);
  });
  test(platform + ': any drone follows the Osmo, even a new drone with nothing remembered and a better-ranked camera', () => {
    // Zumana 25 Nov layout: the Blackmagic shares the Mavic's zone (true UTC) and would rank first; the Osmo wins.
    const p = D.planDrone(drone, [sony, osmo, bmd], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(p.reference, 'cam 3');
    assert.equal(p.osmo, true);
    const noOsmo = D.planDrone(drone, [sony, bmd], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.ok(noOsmo.reference && noOsmo.reference !== 'cam 3', 'without an Osmo the old ranking still works');
  });
  test(platform + ': no clocked camera at all keeps the old explanation', () => {
    const p = D.planDrone(drone, [Object.assign({}, osmo, { anchor: NaN })], { musicDuration: MUSIC, frame: 0.04, learned: {} });
    assert.equal(p.reference, null);
    assert.ok(p.clips.every((c) => c.status === 'excluded'));
  });
}
assert.equal(fs.readFileSync(path.join(ROOT, 'plugin/windows/Plugin/drone-sync.js'), 'utf8').replace(/\r/g, ''),
  fs.readFileSync(path.join(ROOT, 'plugin/macos/Plugin/drone-sync.js'), 'utf8').replace(/\r/g, ''), 'Windows and macOS drone-sync.js differ');
console.log('PASS drone sync reference camera: ' + passed + ' tests');
