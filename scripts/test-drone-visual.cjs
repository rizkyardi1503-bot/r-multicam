// Drone visual check (plugin drone-visual.js, Windows and macOS builds) on synthetic footage: a 10-minute "light show"
// (coloured looks with random lengths, like a venue's lighting program) filmed by a ground camera, and drone clips that
// see the same show darker and noisier. Needs FFmpeg on PATH or RP_FFMPEG.
//   the drone placed 37 s too early -> shift +37 s; placed right -> confirmed; every clip off by its own amount ->
//   inconclusive; a show without light changes -> inconclusive; the light cache gives the same answer.
'use strict';
const assert = require('assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..'), FFMPEG = process.env.RP_FFMPEG || 'ffmpeg';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-drone-visual-'));
process.env.LOCALAPPDATA = path.join(tmp, 'cache');                      // the light cache goes here, not the user profile
function ff(args) { const r = cp.spawnSync(FFMPEG, ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); }

// ---- the light show: looks of 2-9 s, random colour and brightness (seeded)
const SHOW = 600;
let seed = 3; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const looks = []; for (let t = 0; t < SHOW;) { const d = 2 + Math.floor(rnd() * 8); looks.push({ d, r: rnd(), g: rnd(), b: rnd(), v: 0.25 + 0.75 * rnd() }); t += d; }
const hex = (x) => Math.max(0, Math.min(255, Math.round(x * 255))).toString(16).padStart(2, '0');
function render(file, gain, noise, flat) {
  const parts = looks.map((l) => `color=c=0x${flat ? '606060' : hex(l.r * l.v * gain) + hex(l.g * l.v * gain) + hex(l.b * l.v * gain)}:s=64x36:r=25:d=${l.d}`);
  const inputs = parts.flatMap((p) => ['-f', 'lavfi', '-i', p]);
  const filter = parts.map((_, i) => `[${i}:v]`).join('') + `concat=n=${parts.length}:v=1:a=0,trim=duration=${SHOW}` + (noise ? `,noise=alls=${noise}:allf=t` : '') + '[v]';
  ff([...inputs, '-filter_complex', filter, '-map', '[v]', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', file]);
}
const ground = path.join(tmp, 'ground.mp4'), droneSrc = path.join(tmp, 'drone-src.mp4'), flatGround = path.join(tmp, 'flat.mp4');
render(ground, 1, 0, false); render(droneSrc, 0.7, 12, false); render(flatGround, 1, 6, true);
// Ten drone clips of 15-30 s cut from the drone's view of the show (true timeline positions known).
const truth = [];
for (let i = 0; i < 10; i++) {
  const at = 40 + i * 52, len = 15 + (i * 7) % 16, file = path.join(tmp, `DJI_${i}.mp4`);
  ff(['-ss', String(at), '-t', String(len), '-i', droneSrc, '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-pix_fmt', 'yuv420p', file]);
  truth.push({ id: String(i), file, at, duration: len });
}
// The ground camera starts 5 s before the music (timeline 0 = 5 s into its file), like a camera synced by audio.
const camera = (file) => [{ name: 'cam 1', clips: [{ file, start: -5, sourceIn: 0, sourceOut: SHOW }] }];
const placed = (shift) => ({ clips: truth.map((c) => ({ id: c.id, file: c.file, start: c.at - 5 + shift, sourceIn: 0, duration: c.duration })) });

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('ok - ' + name); }
(async () => {
  for (const platform of ['windows', 'macos']) {
    const V = require(path.join(ROOT, 'plugin', platform, 'Plugin', 'drone-visual.js'));
    delete require.cache[require.resolve(path.join(ROOT, 'plugin', platform, 'Plugin', 'drone-visual.js'))];
    const opts = () => ({ ffmpeg: FFMPEG, maxLag: 120 });
    await test(platform + ': a drone placed 37 s too early is shifted +37 s', async () => {
      const r = await V.verify(placed(-37), camera(ground), opts());
      assert.equal(r.verdict, 'shift', JSON.stringify(r));
      assert.ok(Math.abs(r.shift - 37) <= 0.5, 'shift ' + r.shift);
      assert.ok(r.clipsAgree >= 5, 'clips agreeing ' + r.clipsAgree);
    });
    await test(platform + ': a drone already in place is confirmed (no shift)', async () => {
      const r = await V.verify(placed(0), camera(ground), opts());
      assert.equal(r.verdict, 'confirmed', JSON.stringify(r));
    });
    await test(platform + ': clips that are each off by their own amount give no shift', async () => {
      const offs = [-90, 61, -23, 104, -71, 13, 88, -52, 37, -110];
      const r = await V.verify({ clips: placed(0).clips.map((c, i) => ({ ...c, start: c.start + offs[i] })) }, camera(ground), opts());
      assert.equal(r.verdict, 'inconclusive', JSON.stringify(r));
    });
    await test(platform + ': a camera that sees no light changes gives no shift', async () => {
      const r = await V.verify(placed(-37), camera(flatGround), opts());
      assert.equal(r.verdict, 'inconclusive', JSON.stringify(r));
    });
  }
  await test('light cache: a second check reads nothing and gives the same answer', async () => {
    const V = require(path.join(ROOT, 'plugin', 'macos', 'Plugin', 'drone-visual.js'));
    const spawn = cp.spawn; let spawned = 0; cp.spawn = (...a) => { spawned++; return spawn(...a); };
    try { const r = await V.verify(placed(-37), camera(ground), { ffmpeg: FFMPEG, maxLag: 120 }); assert.equal(r.verdict, 'shift'); assert.equal(spawned, 0, 'FFmpeg started ' + spawned + 'x'); }
    finally { cp.spawn = spawn; }
  });
  assert.equal(fs.readFileSync(path.join(ROOT, 'plugin/windows/Plugin/drone-visual.js'), 'utf8').replace(/\r/g, ''),
    fs.readFileSync(path.join(ROOT, 'plugin/macos/Plugin/drone-visual.js'), 'utf8').replace(/\r/g, ''), 'Windows and macOS drone-visual.js differ');
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS drone visual check: ' + passed + ' tests');
})().catch((e) => { console.error(e); process.exit(1); });
