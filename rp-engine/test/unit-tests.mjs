// Unit tests that need no media and no FFmpeg. run-tests.mjs imports this file first.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validatePlan, coverageTolerance } from "../lib/plan-format.mjs";
import { planToFcpxml, timecodeFrames, timecodeStart } from "../lib/fcpxml.mjs";
import { snapEditPoints, directorSnapshot, analyzeMusic } from "../lib/engine.mjs";
import { TOOLS, partFile, parseCameraSpec } from "../lib/tools.mjs";
import { parseProbe, audioStartCorrection, resolveMediaPath, syncByAudio } from "../lib/media.mjs";
import { loadEngine, ENGINE_FILES } from "../lib/runtime.mjs";

let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`ok - unit: ${name}`); }

/** A small valid two-camera plan (25 fps, 4 s): cam1 for 2 s, then cam2. */
function miniPlan(mutate) {
  const clip = (file, extra = {}) => ({ file, offset: 0, duration: 4, width: 1920, height: 1080, fps: 25, timecode: "01:00:00:00", ...extra });
  const plan = {
    format: "rp-multicam-plan", version: 1,
    generator: { name: "test", model: "test" },
    timeline: { fps: { num: 25, den: 1 }, duration: 4, duration_frames: 100, width: 1920, height: 1080 },
    music: { file: "/m/song.wav", name: "song.wav", duration: 4, beats: [], drops: [] },
    cameras: [
      { index: 0, angle_id: "cam1", name: "A", role: "A", clips: [clip("/v/a/C0001.mov")] },
      { index: 1, angle_id: "cam2", name: "B", role: "B", clips: [clip("/v/b/C0002.mov")] }
    ],
    cuts: [
      { index: 0, start_frame: 0, end_frame: 50, camera: 0, angle_id: "cam1" },
      { index: 1, start_frame: 50, end_frame: 100, camera: 1, angle_id: "cam2" }
    ]
  };
  if (mutate) mutate(plan);
  return plan;
}
const seconds = (v) => { const m = v.match(/^(-?\d+)(?:\/(\d+))?s$/); return Number(m[1]) / Number(m[2] || 1); };

// ---- 1. drop-frame timecode
await test("drop-frame timecode uses the drop-frame formula", () => {
  assert.deepEqual(timecodeFrames("01:00:00;00", 29.97), { frames: 107892, drop: true });
  assert.deepEqual(timecodeFrames("00:10:00;00", 29.97), { frames: 17982, drop: true }); // every 10th minute keeps its frames
  assert.deepEqual(timecodeFrames("00:01:00;02", 29.97), { frames: 1800, drop: true });
  assert.deepEqual(timecodeFrames("01:00:00;00", 59.94), { frames: 215784, drop: true });
  assert.deepEqual(timecodeFrames("01:00:00:00", 29.97), { frames: 108000, drop: false }); // ':' is non-drop
  assert.deepEqual(timecodeFrames("01:00:00;00", 25), { frames: 90000, drop: false });      // ';' means nothing at 25 fps
  assert.deepEqual(timecodeFrames("01:00:00;00", 23.976), { frames: 86400, drop: false });
  assert.deepEqual(timecodeFrames("garbage", 29.97), { frames: 0, drop: false });
  const start = timecodeStart("01:00:00;00", 29.97);                                       // 107892 frames of 1001/30000 s
  assert.equal(start.n * 30000, 107892 * 1001 * start.d);
});

await test("FCPXML marks drop-frame assets DF and starts them at the drop-frame time", () => {
  const plan = miniPlan((p) => {
    p.timeline.fps = { num: 30000, den: 1001 }; p.timeline.duration_frames = 120;
    p.cuts[0].end_frame = 60; p.cuts[1].start_frame = 60; p.cuts[1].end_frame = 120;
    p.cameras[0].clips[0].fps = 29.97; p.cameras[0].clips[0].timecode = "01:00:00;00";
    p.cameras[1].clips[0].fps = 29.97; p.cameras[1].clips[0].timecode = "01:00:00:00";
  });
  const xml = planToFcpxml(plan);
  const df = xml.match(/<asset-clip ref="r\d+" name="C0001" offset="0s" start="([^"]+)"[^>]*tcFormat="DF"/);
  assert.ok(df, "C0001 should be a DF asset-clip");
  assert.ok(Math.abs(seconds(df[1]) - 107892 * 1001 / 30000) < 1e-9, `start ${df[1]}`);
  const ndf = xml.match(/<asset-clip ref="r\d+" name="C0002" offset="0s" start="([^"]+)"[^>]*tcFormat="NDF"/);
  assert.ok(ndf, "C0002 should stay NDF");
  assert.ok(Math.abs(seconds(ndf[1]) - 108000 * 1001 / 30000) < 1e-9, `start ${ndf[1]}`);
});

// ---- 2. media_dir relinking by basename
await test("media_dir refuses two different files with the same name", () => {
  const plan = miniPlan((p) => {
    p.cameras[0].clips[0].file = "C:\\card1\\C0001.MOV";
    p.cameras[1].clips[0].file = "D:\\card2\\C0001.MOV";
  });
  assert.throws(() => planToFcpxml(plan, { mediaDir: "/Volumes/Footage" }), /cannot relink two different files named "c0001\.mov"/);
  assert.match(planToFcpxml(plan), /file:\/\/\/C:\/card1\/C0001\.MOV/);            // without media_dir the full paths are kept
  assert.match(planToFcpxml(plan, { pathMap: { from: "D:\\", to: "/Volumes/D/" } }), /src="file:\/\/\/Volumes\/D\/card2/);
  const same = miniPlan((p) => { p.cameras[1].clips[0].file = p.cameras[0].clips[0].file; });
  assert.match(planToFcpxml(same, { mediaDir: "/Volumes/Footage" }), /Footage\/C0001\.mov/); // one file used twice is fine
});

// ---- 3. validatePlan: angles and music
await test("validatePlan checks angle ids and the music block", () => {
  assert.deepEqual(validatePlan(miniPlan()), []);
  const noAngle = miniPlan((p) => { delete p.cameras[1].angle_id; });
  assert.ok(validatePlan(noAngle).some((e) => /cameras\[1\]\.angle_id is required/.test(e)));
  const dup = miniPlan((p) => { p.cameras[1].angle_id = "cam1"; });
  assert.ok(validatePlan(dup).some((e) => /used by another camera/.test(e)));
  const reserved = miniPlan((p) => { p.cameras[1].angle_id = "music"; });
  assert.ok(validatePlan(reserved).some((e) => /reserved/.test(e)));
  const mismatch = miniPlan((p) => { p.cuts[1].angle_id = "cam1"; });
  assert.ok(validatePlan(mismatch).some((e) => /cuts\[1\]\.angle_id "cam1" does not match cameras\[1\]/.test(e)));
  for (const bad of [0, -1, NaN, Infinity, "4", null]) {
    assert.ok(validatePlan(miniPlan((p) => { p.music.duration = bad; })).some((e) => /music\.duration/.test(e)), `duration ${bad}`);
  }
  assert.ok(validatePlan(miniPlan((p) => { p.music.name = ""; })).some((e) => /music\.name/.test(e)));
  assert.ok(validatePlan(miniPlan((p) => { delete p.music; })).some((e) => /music\.file/.test(e)));
  // schema-valid: the name is optional and a cut may omit its angle_id
  const lean = miniPlan((p) => { delete p.music.name; for (const c of p.cuts) delete c.angle_id; });
  assert.deepEqual(validatePlan(lean), []);
  const xml = planToFcpxml(lean);
  assert.match(xml, /name="song\.wav"/);
  assert.equal((xml.match(/<mc-source angleID="cam[12]" srcEnable="video"\/>/g) || []).length, 2);
});

await test("angle ids are escaped in FCPXML attributes", () => {
  const plan = miniPlan((p) => { p.cameras[0].angle_id = 'a"<b>&'; p.cuts[0].angle_id = 'a"<b>&'; });
  const xml = planToFcpxml(plan);
  assert.match(xml, /angleID="a&quot;&lt;b&gt;&amp;"/);
  assert.ok(!xml.includes('angleID="a"'));
});

// ---- 4. edit points and coverage tolerance
await test("snapEditPoints never produces a zero-length first or last shot", () => {
  const frame = 0.04;
  assert.deepEqual(snapEditPoints([0.01, 5.0, 5.01, 9.99, 10.0, 10.5], 10, frame), [125 * frame]);
  // duration that is not a whole number of frames: 10.01 s rounds to frame 250, so 10.0 s (frame 250) must go
  assert.deepEqual(snapEditPoints([4.0, 10.0], 10.01, frame), [100 * frame]);
  assert.deepEqual(snapEditPoints([4.0, 9.96, 9.98], 10.01, frame), [100 * frame, 249 * frame]);
  assert.deepEqual(snapEditPoints([], 10, frame), []);
});

await test("director coverage uses the validator's tolerance, including the last frame", () => {
  const frame = 0.04, duration = 10;
  const camera = (len) => ({ clips: [{ offset: 0, trim: 0, duration: len, file: "a.mp4", hasVideo: true }] });
  const candidates = (len) => directorSnapshot([camera(len)], [5], duration, frame).intervals.map((i) => i.candidates.length);
  assert.deepEqual(candidates(10), [1, 1]);
  assert.deepEqual(candidates(10 - 0.4 * frame), [1, 1]);   // 0.4 frame short: the validator accepts it, so the director must too
  assert.deepEqual(candidates(10 - 0.7 * frame), [1, 0]);   // 0.7 frame short: the validator rejects it
  assert.ok(coverageTolerance(frame) > frame / 2);
  // and the plan validator agrees about the same clip lengths
  const plan = (len) => miniPlan((p) => {
    p.timeline.duration = 4; p.cameras[0].clips[0].duration = len; p.cuts = [{ index: 0, start_frame: 0, end_frame: 100, camera: 0, angle_id: "cam1" }];
  });
  assert.deepEqual(validatePlan(plan(4 - 0.4 * 0.04)), []);
  assert.ok(validatePlan(plan(4 - 0.7 * 0.04)).some((e) => /outside its recorded range/.test(e)));
});

// ---- 6. multi-part output names
await test("part file names stay in the file's own folder", () => {
  const dir = path.join(os.tmpdir(), "out.d");
  assert.equal(partFile(path.join(dir, "set.rpplan.json"), 1, 3), path.join(dir, "set - Part 2.rpplan.json"));
  assert.equal(partFile(path.join(dir, "set"), 0, 2), path.join(dir, "set - Part 1"));          // dotted folder, no extension
  assert.equal(partFile(path.join(dir, "set.fcpxml"), 2, 3), path.join(dir, "set - Part 3.fcpxml"));
  assert.equal(partFile("set.json", 0, 1), "set.json");                                         // a single part keeps its name
  if (process.platform === "win32") assert.equal(partFile("C:\\Edits\\night.v2\\set", 0, 2), "C:\\Edits\\night.v2\\set - Part 1");
});

// ---- 7. validate_plan on schema-valid plans with only the required fields
await test("validate_plan does not crash on plans without clip.sync, cut details or music.name", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-unit-"));
  try {
    const plan = miniPlan((p) => {
      delete p.music.name;
      for (const c of p.cuts) delete c.angle_id;
      p.generator = { name: "x", model: "y" };
    });
    const file = path.join(dir, "lean.rpplan.json");
    fs.writeFileSync(file, JSON.stringify(plan));
    const r = await TOOLS.find((t) => t.name === "validate_plan").run({ plan: file });
    assert.equal(r.valid, true);
    assert.equal(r.cut_count, 2);
    assert.ok(Math.abs(r.longest_shot_seconds - 2) < 1e-9);
    assert.deepEqual(r.screen_time_seconds, { cam1: 2, cam2: 2 });
    assert.deepEqual(r.cameras.map((c) => c.sync), [[undefined], [undefined]]);
    const noGen = { ...plan }; delete noGen.generator;
    fs.writeFileSync(file, JSON.stringify(noGen));
    assert.equal((await TOOLS.find((t) => t.name === "validate_plan").run({ plan: file })).valid, true);
    assert.match(planToFcpxml(noGen), /Generated by R Project Multicam AI Engine \(unknown\)/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- 10. input hardening
await test("music and camera paths must be local files", async () => {
  for (const bad of ["http://example.com/a.wav", "https://x/y.mp4", "concat:a.wav|b.wav", "pipe:0", "file:///etc/passwd", "rtmp://h/s", "", null]) {
    assert.throws(() => resolveMediaPath(bad), /local file|required/, String(bad));
  }
  assert.equal(resolveMediaPath("rel/x.wav"), path.resolve("rel/x.wav"));
  assert.equal(resolveMediaPath("C:\\Music\\a.wav"), path.resolve("C:\\Music\\a.wav"));     // a drive letter is not a protocol
  await assert.rejects(analyzeMusic("http://example.com/a.wav"), /local file/);
});

await test("CLI camera spec splits the role on the last '='", () => {
  assert.deepEqual(parseCameraSpec("wide.mp4"), { file: "wide.mp4" });
  assert.deepEqual(parseCameraSpec("wide.mp4=Master Wide"), { file: "wide.mp4", role: "Master Wide" });
  assert.deepEqual(parseCameraSpec("dj.mp4=DJ Close-Up@12.5"), { file: "dj.mp4", role: "DJ Close-Up", offset: 12.5, sync: "none" });
  assert.deepEqual(parseCameraSpec("dj.mp4@-3"), { file: "dj.mp4", offset: -3, sync: "none" });
  assert.deepEqual(parseCameraSpec("C:\\shoot=1\\cam a.mp4=Wide"), { file: "C:\\shoot=1\\cam a.mp4", role: "Wide" });
  assert.deepEqual(parseCameraSpec("/m/a=b/x.mp4"), { file: "/m/a=b/x.mp4" });                // '=' inside a folder, no role
  assert.deepEqual(parseCameraSpec("/m/clip=1.mp4="), { file: "/m/clip=1.mp4" });             // trailing '=' ends a file name that has one
  assert.deepEqual(parseCameraSpec("a=b=Role"), { file: "a=b", role: "Role" });
});

await test("probe text gives per-stream start times and the audio correction", () => {
  const mp4 = `Input #0, mov,mp4, from 'L.mp4':
  Duration: 00:00:30.00, start: 0.000000, bitrate: 74 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 160x90 [SAR 1:1 DAR 16:9], 2 kb/s, 25 fps, 25 tbr, 12800 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 69 kb/s, start 0.476780 (default)`;
  const a = parseProbe(mp4, "L.mp4");
  assert.equal(a.videoStart, 0); assert.equal(a.audioStart, 0.47678);
  assert.ok(Math.abs(audioStartCorrection(a, 0) - 0.47678) < 1e-9);   // audio samples start 0.48 s after the first frame
  assert.equal(audioStartCorrection(a, 20), 0);                        // an excerpt is cut at container time: no shift
  const ts = `Input #0, mpegts, from 'L.ts':
  Duration: 00:00:30.00, start: 1.400000, bitrate: 137 kb/s
  Stream #0:0[0x100]: Video: h264 (Constrained Baseline) ([27][0][0][0] / 0x001B), yuv420p(progressive), 160x90 [SAR 1:1 DAR 16:9], 25 fps, 25 tbr, 90k tbn, start 1.400000
  Stream #0:1[0x101]: Audio: aac (LC) ([15][0][0][0] / 0x000F), 44100 Hz, mono, fltp, 72 kb/s, start 1.876778`;
  const b = parseProbe(ts, "L.ts");
  assert.equal(b.videoStart, 1.4); assert.equal(b.audioStart, 1.876778);
  assert.ok(Math.abs(audioStartCorrection(b, 0) - 0.476778) < 1e-9);
  const early = { hasVideo: true, hasAudio: true, videoStart: 0.3, audioStart: 0 };  // audio begins before the video
  assert.ok(Math.abs(audioStartCorrection(early, 0) + 0.3) < 1e-9);
  assert.ok(Math.abs(audioStartCorrection(early, 20) + 0.3) < 1e-9);
  assert.equal(audioStartCorrection({ hasVideo: true, hasAudio: false }, 0), 0);
  assert.throws(() => parseProbe("x.mp4: No such file or directory", "x.mp4"), /Cannot read media/);
});

await test("an aborted sync stops before starting FFmpeg", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(syncByAudio("ffmpeg-does-not-exist", "a.wav", "b.mp4", { signal: controller.signal }), { name: "AbortError" });
});

// ---- 8. cache key
await test("the engine hash follows the content of the engine files", () => {
  const engine = loadEngine();
  assert.match(engine.hash, /^[0-9a-f]{12}$/);
  assert.equal(loadEngine().hash, engine.hash);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "rp-engine-copy-"));
  try {
    for (const f of ENGINE_FILES) fs.copyFileSync(path.join(engine.dir, f), path.join(copy, f));
    assert.equal(loadEngine(copy).hash, engine.hash, "identical content, identical hash");
    fs.appendFileSync(path.join(copy, ENGINE_FILES[0]), "\n/* edited */\n");
    assert.notEqual(loadEngine(copy).hash, engine.hash, "edited content, different hash");
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
});

console.log(`${passed} unit tests passed`);
