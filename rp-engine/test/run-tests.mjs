// End-to-end test with synthetic media: a 128 BPM track with two build-up -> drop
// transitions, and three cameras recorded at different times (one before the music).
// Requires ffmpeg on PATH (or RP_FFMPEG).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import v8 from "node:v8";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../lib/tools.mjs";
import { validatePlan } from "../lib/plan-format.mjs";
import { planToFcpxml } from "../lib/fcpxml.mjs";
import { sessionAnchors } from "../lib/session.mjs";
import { probe, syncByAudio, audioStartCorrection } from "../lib/media.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Test against this repo's plugin engine, not an older copy installed in Premiere's CEP folder
// (resolvePluginDir prefers the installed one). An explicit RP_PLUGIN_DIR still wins.
const repoPlugin = path.resolve(ROOT, "../plugin", process.platform === "darwin" ? "macos" : "windows", "Plugin");
if (!process.env.RP_PLUGIN_DIR && fs.existsSync(repoPlugin)) process.env.RP_PLUGIN_DIR = repoPlugin;
await import("./unit-tests.mjs");
const FFMPEG = process.env.RP_FFMPEG || "ffmpeg";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rp-engine-test-"));
const tool = (n) => TOOLS.find((t) => t.name === n);
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`ok - ${name}`); }

// ---------- synthetic media ----------
const SR = 44100, BPM = 128, BEAT = 60 / BPM, DUR = 96;
const SECTIONS = [[0, 16, "intro"], [16, 30, "build"], [30, 60, "drop"], [60, 70, "break"], [70, 75, "build"], [75, 96, "drop"]];
function song() {
  const y = new Float32Array(SR * DUR);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const kick = (at, amp) => { let ph = 0; for (let i = 0; i < SR * 0.25; i++) { const t = i / SR, f = 50 + 120 * Math.exp(-t * 30); ph += 2 * Math.PI * f / SR; const k = Math.floor(at * SR) + i; if (k < y.length) y[k] += Math.sin(ph) * Math.exp(-t * 9) * amp; } };
  const noise = (at, len, amp) => { for (let i = 0; i < SR * len; i++) { const k = Math.floor(at * SR) + i; if (k < y.length) y[k] += rnd() * amp * Math.exp(-(i / SR) * 25); } };
  for (let b = 0; b < DUR - 0.3; b += BEAT) {
    const [s, , sec] = SECTIONS.find(([s0, e]) => b >= s0 && b < e);
    if (sec === "intro") { kick(b, 0.35); noise(b + BEAT / 2, 0.05, 0.05); }
    else if (sec === "build") { const p = (b - s) / 14, n = p > 0.5 ? 4 : 2; kick(b, 0.3 + 0.3 * p); for (let k = 0; k < n; k++) noise(b + k * BEAT / n, 0.06, 0.08 + 0.25 * p); }
    else if (sec === "drop") { kick(b, 1); noise(b + BEAT / 2, 0.08, 0.15); }
    else noise(b, 0.1, 0.04);
  }
  for (const [s, e, n] of SECTIONS) if (n === "drop") for (let i = s * SR; i < e * SR; i++) { const t = i / SR; y[i] += 0.35 * Math.sin(2 * Math.PI * 55 * t) * (0.6 + 0.4 * Math.abs(Math.sin(Math.PI * t / BEAT))); }
  let peak = 0; for (const v of y) peak = Math.max(peak, Math.abs(v));
  const buf = Buffer.alloc(44 + y.length * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + y.length * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(y.length * 2, 40);
  for (let i = 0; i < y.length; i++) buf.writeInt16LE(Math.round(y[i] / peak / 1.05 * 32767), 44 + i * 2);
  return buf;
}
function ff(args) { const r = spawnSync(FFMPEG, ["-v", "error", "-y", ...args], { encoding: "utf8" }); if (r.status !== 0) throw new Error(r.stderr); }

const music = path.join(dir, "song.wav");
fs.writeFileSync(music, song());
// offset = timeline position of the clip's first frame. The DJ camera has two clips plus a
// stray clip of room noise that is not part of the set (it must be left out).
const CAMS = [
  { name: "wide", color: "red", clips: [{ offset: 0, len: DUR }] },
  { name: "dj", color: "green", clips: [{ offset: 6, len: 30 }, { offset: 50, len: DUR - 50 }, { stray: true, len: 20 }] },
  { name: "crowd", color: "blue", clips: [{ offset: -3, len: DUR + 3 }] }
];
for (const c of CAMS) {
  c.files = c.clips.map((k, j) => {
    const file = path.join(dir, `${c.name}_${j + 1}.mp4`);
    let audio, filter;
    if (k.stray) { audio = ["-f", "lavfi", "-i", `anoisesrc=d=${k.len}:c=brown:a=0.3:r=${SR}`]; filter = "[1:a]volume=1[a]"; }
    else if (k.offset >= 0) { audio = ["-ss", String(k.offset), "-i", music]; filter = "[1:a]volume=0.6,aecho=0.6:0.3:40:0.2[a]"; }
    else {
      audio = ["-f", "lavfi", "-i", `anoisesrc=d=${-k.offset}:c=pink:a=0.02:r=${SR}`, "-i", music];
      filter = "[1:a]volume=0.02[n];[2:a]volume=0.6,aecho=0.6:0.3:40:0.2[m];[n][m]concat=n=2:v=0:a=1[a]";
    }
    // Camera clock: the DJ camera's clock runs 1 h 7 s off, but consistently (stray clip too).
    const created = c.name === "dj" ? new Date(Date.UTC(2026, 9, 10, 13, 0, 7) + (k.stray ? 30 : k.offset) * 1000).toISOString() : null;
    ff(["-f", "lavfi", "-i", `color=c=${c.color}:size=320x180:rate=25`, ...audio, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", ...(created ? ["-metadata", `creation_time=${created}`] : []), "-t", String(Math.min(k.len, DUR - Math.max(0, k.offset || 0))), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
    return file;
  });
}
const seconds = (v) => { if (v === "0s") return 0; const m = v.match(/^(\d+)(?:\/(\d+))?s$/); return Number(m[1]) / Number(m[2] || 1); };
const frames25 = (v) => Math.round(seconds(v) * 25);

// ---------- tests ----------
await test("analyze_music finds tempo and both drops", async () => {
  const r = await tool("analyze_music").run({ music });
  assert.ok(Math.abs(r.bpm - BPM) <= 1, `bpm ${r.bpm}`);
  assert.equal(r.bpm_confidence, "high");
  const drops = r.drops.map((d) => d.time).sort((a, b) => a - b);
  assert.ok(drops.some((t) => Math.abs(t - 30) < 0.3) && drops.some((t) => Math.abs(t - 75) < 0.3), `drops ${drops}`);
  assert.ok(r.beat_count > 190 && r.beat_count < 210, `beats ${r.beat_count}`);
});

const planPath = path.join(dir, "set.rpplan.json"), fcpPath = path.join(dir, "set.fcpxml");
let digest;
await test("plan_multicam syncs cameras and writes a valid plan + FCPXML", async () => {
  digest = await tool("plan_multicam").run({ music, cameras: CAMS.map((c, i) => ({ files: c.files, role: ["Master Wide", "DJ Close-Up", "Crowd Reaction"][i] })), output: planPath, fcpxml: fcpPath });
  const saved = JSON.parse(fs.readFileSync(planPath, "utf8"));
  CAMS.forEach((c, i) => {
    const expected = c.clips.filter((k) => !k.stray).map((k) => k.offset);
    const got = saved.cameras[i].clips.map((k) => k.offset);
    assert.equal(got.length, expected.length, `${c.name}: ${got.length} clips placed, expected ${expected.length}`);
    got.forEach((o, j) => assert.ok(Math.abs(o - expected[j]) <= 0.04 + 1e-9, `${c.name} clip ${j + 1} offset ${o} != ${expected[j]}`));
    saved.cameras[i].clips.forEach((k) => assert.equal(k.sync.method, c.name === "dj" ? "audio+clock" : "audio"));
  });
  assert.equal(saved.cameras[1].excluded_clips.length, 1, "stray clip should be excluded");
  assert.match(saved.cameras[1].excluded_clips[0].file, /dj_3\.mp4$/);
  assert.ok(saved.cameras[1].clock, "DJ camera clock anchor should be found");
  assert.equal(digest.fps, "25/1");
  assert.ok(digest.cut_count >= 10, `cuts ${digest.cut_count}`);
});

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
await test("plan is contiguous, frame exact and uses footage only where it exists", async () => {
  assert.deepEqual(validatePlan(plan), []);
  assert.equal(plan.cuts[0].start_frame, 0);
  assert.equal(plan.cuts.at(-1).end_frame, plan.timeline.duration_frames);
  // Camera "dj" has footage only at 6-36 s and 50 s-end.
  assert.ok(plan.cuts.filter((c) => c.camera === 1).every((c) => (c.start >= 6 - 1e-6 && c.end <= 36 + 1e-6) || c.start >= 50 - 1e-6));
});

await test("drops land on a cut with a camera change", async () => {
  for (const t of [30, 75]) {
    const i = plan.cuts.findIndex((c) => Math.abs(c.start - t) < 0.25);
    assert.ok(i > 0, `no cut at drop ${t}`);
    assert.notEqual(plan.cuts[i].camera, plan.cuts[i - 1].camera);
    assert.ok(plan.cuts[i].drop != null);
  }
});

await test("validator rejects broken plans", async () => {
  const bad = structuredClone(plan); bad.cuts[1].start_frame += 1;
  assert.ok(validatePlan(bad).some((e) => /contiguous/.test(e)));
  const gap = structuredClone(plan); gap.cuts[0].camera = 1; // dj camera has no footage at 0 s
  assert.ok(validatePlan(gap).some((e) => /outside its recorded range/.test(e)));
});

await test("FCPXML mirrors the plan", async () => {
  const xml = fs.readFileSync(fcpPath, "utf8");
  assert.match(xml, /<fcpxml version="1\.10">/);
  assert.equal((xml.match(/<mc-angle /g) || []).length, CAMS.length + 1);
  const clips = [...xml.matchAll(/<mc-clip [^>]*offset="([^"]+)"[^>]*duration="([^"]+)"/g)].map((m) => [frames25(m[1]), frames25(m[2])]);
  const used = plan.cuts.filter((c) => c.camera >= 0);
  assert.equal(clips.length, used.length);
  clips.forEach(([off, dur], i) => { assert.equal(off, used[i].start_frame); assert.equal(dur, used[i].end_frame - used[i].start_frame); });
  // Crowd camera started 3 s before the music: its clip is trimmed by 75 frames, no gap.
  assert.match(xml, /angleID="cam3">\s*<asset-clip [^>]*offset="0s" start="3s"/);
  // DJ camera: 6 s gap, clip 1, gap until 50 s, clip 2.
  assert.match(xml, /angleID="cam2">\s*<gap [^>]*duration="6s"\/>\s*<asset-clip [^>]*offset="6s"[^>]*duration="30s"[^>]*\/>\s*<gap [^>]*offset="36s"[^>]*duration="14s"\/>\s*<asset-clip [^>]*offset="50s"/);
  assert.equal((xml.match(/<marker /g) || []).length, plan.music.drops.length);
  // Well-formed: balanced tags.
  const open = (xml.match(/<(?!\/|\?|!)[a-z-]+[^>]*[^/]>/g) || []).length, close = (xml.match(/<\/[a-z-]+>/g) || []).length;
  assert.equal(open, close);
  assert.match(planToFcpxml(plan, { mediaDir: "/Volumes/Footage" }), /src="file:\/\/\/Volumes\/Footage\/wide_1\.mp4"/);
});

await test("session clock links cameras across music parts", async () => {
  // Part 2 starts 15600 s after part 1 (by every camera's clock). Camera A is well synced
  // in part 1 only, camera B in part 2 only, and both have one weak match in the other part.
  const k = (created, offset, confidence) => ({ created, offset, sync: { method: "audio", confidence } });
  const passes = [
    { cameras: [[k(1000, 100, "high"), k(2000, 1100, "high")], [k(50000, 300, "medium")]] },
    { cameras: [[k(16600, 100 + 15600 - 15600, "medium")], [k(70000, 4000, "high"), k(70500, 4500, "high")]] }
  ];
  // Camera A part 1 anchor = 900; camera B part 2 anchor = 66000, part 1 weak anchor = 49700.
  passes[1].cameras[0][0].offset = 16600 - (900 + 15600);           // = 100, consistent
  passes[0].cameras[1][0].offset = 50000 - (66000 - 15600);         // = -400, consistent
  const s = sessionAnchors(passes);
  assert.equal(Math.round(s.shift[1]), 15600);
  assert.equal(s.anchors[0][0].source, "this part");
  assert.equal(Math.round(s.anchors[1][0].anchor), 900 + 15600);
  assert.match(s.anchors[1][0].source, /part 1 via session clock/);
  assert.equal(Math.round(s.anchors[0][1].anchor), 66000 - 15600);
});

await test("published schema matches the engine schema", async () => {
  const site = path.resolve(ROOT, "../site/schema/rp-multicam-plan-1.json");
  if (!fs.existsSync(site)) return console.log("   (skipped: not inside the repo)");
  assert.equal(fs.readFileSync(site, "utf8"), fs.readFileSync(path.join(ROOT, "schema/rp-multicam-plan-1.json"), "utf8"));
});

await test("MCP server speaks JSON-RPC over stdio", async () => {
  const proc = spawn(process.execPath, [path.join(ROOT, "bin/rp-engine-mcp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let buf = "";
  proc.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } } });
  let next = 1;
  const call = (method, params) => new Promise((res) => { const id = next++; pending.set(id, res); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); });
  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const list = await call("tools/list", {});
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ["analyze_music", "describe_plan_format", "export_fcpxml", "plan_multicam", "validate_plan"]);
  const v = await call("tools/call", { name: "validate_plan", arguments: { plan: planPath } });
  assert.equal(v.result.structuredContent.valid, true);
  const bad = await call("tools/call", { name: "export_fcpxml", arguments: { plan: path.join(dir, "missing.json"), output: path.join(dir, "x.fcpxml") } });
  assert.equal(bad.result.isError, true);
  const unknown = await call("nope", {});
  assert.equal(unknown.error.code, -32601);
  proc.stdin.end();
});

await test("CLI validate", async () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "bin/rp-engine.mjs"), "validate", planPath], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).valid, true);
});

// A small helper to talk to the MCP server: resolves with every message it wrote once it exits.
function runMcp(lines, { before } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [path.join(ROOT, "bin/rp-engine-mcp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    proc.stdout.on("data", (d) => { out += d; });
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ code, messages: out.split("\n").filter(Boolean).map((l) => JSON.parse(l)) }));
    (async () => { await before?.(proc); for (const [delay, msg] of lines) { if (delay) await new Promise((r) => setTimeout(r, delay)); proc.stdin.write(JSON.stringify(msg) + "\n"); } proc.stdin.end(); })();
    setTimeout(() => { proc.kill(); reject(new Error("MCP server did not exit")); }, 60000).unref();
  });
}
const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, params });

await test("MCP server still answers calls in flight when stdin closes", async () => {
  const missing = path.join(dir, "no-such-song.wav");
  const r = await runMcp([[0, rpc(1, "tools/call", { name: "analyze_music", arguments: { music: missing } })]]);
  const reply = r.messages.find((m) => m.id === 1);
  assert.ok(reply, "the result of the call in flight must be written before the server exits");
  assert.equal(reply.result.isError, true);
  assert.equal(r.code, 0);
});

await test("MCP cancellation stops the call and sends no result for it", async () => {
  const args = { music, cameras: CAMS.map((c) => ({ files: c.files })), output: path.join(dir, "cancelled.rpplan.json") };
  const r = await runMcp([
    [0, rpc(1, "tools/call", { name: "plan_multicam", arguments: args })],
    [200, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 1, reason: "test" } }],
    [100, rpc(2, "ping", {})]
  ]);
  assert.ok(r.messages.some((m) => m.id === 2), "the server keeps answering after a cancellation");
  assert.ok(!r.messages.some((m) => m.id === 1), "a cancelled request gets no response");
  assert.ok(!fs.existsSync(args.output), "a cancelled plan must not be written");
});

await test("probe times out and can be aborted", async () => {
  await assert.rejects(probe(FFMPEG, music, { timeoutMs: 1 }), /did not answer/);
  const controller = new AbortController();
  const pending = probe(FFMPEG, music, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  const ok = await probe(FFMPEG, music);
  assert.ok(Math.abs(ok.duration - DUR) < 0.1 && ok.hasAudio && !ok.hasVideo);
});

await test("a camera whose audio starts after its video is placed by its first frame", async () => {
  // Video frame 0 is at 19.5 s of the music; the audio (music from 20 s) is delayed 0.5 s in the file.
  const lagging = path.join(dir, "lagging.mp4");
  ff(["-f", "lavfi", "-i", "color=c=red:size=160x90:rate=25", "-itsoffset", "0.5", "-ss", "20", "-t", "35", "-i", music, "-map", "0:v", "-map", "1:a", "-t", "30", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", lagging]);
  const info = await probe(FFMPEG, lagging);
  assert.ok(info.audioStart - info.videoStart > 0.4 && info.audioStart - info.videoStart < 0.6, `audio lead ${info.audioStart - info.videoStart}`);
  const raw = await syncByAudio(FFMPEG, music, lagging, {});
  const placed = raw.offset - audioStartCorrection(info, 0);
  assert.ok(Math.abs(raw.offset - 20) <= 0.05, `raw offset ${raw.offset} locates the first audio sample`);
  assert.ok(Math.abs(placed - 19.5) <= 0.05, `first frame at ${placed}, expected 19.5`);
});

await test("a clip too short to sync is a cached, deterministic failure", async () => {
  const short = path.join(dir, "short.mp4");
  ff(["-f", "lavfi", "-i", "color=c=red:size=160x90:rate=25", "-ss", "10", "-t", "1.5", "-i", music, "-map", "0:v", "-map", "1:a", "-t", "1.5", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", short]);
  const cacheDir = path.join(dir, "cache-short");
  const { planMulticam } = await import("../lib/engine.mjs");
  const r = await planMulticam({ music, cameras: [{ files: [short] }], syncOnly: true, cacheDir });
  assert.deepEqual(r.cameras, [[]]);
  const files = fs.readdirSync(cacheDir).filter((f) => f.startsWith("sync-"));
  assert.equal(files.length, 1);
  const cached = v8.deserialize(fs.readFileSync(path.join(cacheDir, files[0])));
  assert.match(cached.error, /too short/);
  assert.equal(cached.deterministic, true);
});

if (process.env.RP_KEEP_TEST) console.log(`kept ${dir}`); else fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
