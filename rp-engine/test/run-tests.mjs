// End-to-end test with synthetic media: a 128 BPM track with two build-up -> drop
// transitions, and three cameras recorded at different times (one before the music).
// Requires ffmpeg on PATH (or RP_FFMPEG).
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOOLS } from "../lib/tools.mjs";
import { validatePlan } from "../lib/plan-format.mjs";
import { planToFcpxml } from "../lib/fcpxml.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
// offset = timeline position of the camera's first frame.
const CAMS = [{ name: "wide", offset: 0, color: "red" }, { name: "dj", offset: 6, color: "green" }, { name: "crowd", offset: -3, color: "blue" }];
for (const c of CAMS) {
  const file = path.join(dir, `${c.name}.mp4`), len = DUR - Math.max(0, c.offset);
  const audio = c.offset >= 0
    ? ["-ss", String(c.offset), "-i", music]
    : ["-f", "lavfi", "-i", `anoisesrc=d=${-c.offset}:c=pink:a=0.02:r=${SR}`, "-i", music];
  const filter = c.offset >= 0
    ? `[1:a]volume=0.6,aecho=0.6:0.3:40:0.2[a]`
    : `[1:a]volume=0.02[n];[2:a]volume=0.6,aecho=0.6:0.3:40:0.2[m];[n][m]concat=n=2:v=0:a=1[a]`;
  ff(["-f", "lavfi", "-i", `color=c=${c.color}:size=320x180:rate=25`, ...audio, "-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-t", String(len), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
  c.file = file;
}

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
  digest = await tool("plan_multicam").run({ music, cameras: CAMS.map((c, i) => ({ file: c.file, role: ["Master Wide", "DJ Close-Up", "Crowd Reaction"][i] })), output: planPath, fcpxml: fcpPath });
  CAMS.forEach((c, i) => {
    const got = digest.cameras[i];
    assert.ok(Math.abs(got.offset - c.offset) <= 0.04 + 1e-9, `${c.name} offset ${got.offset} != ${c.offset}`);
    assert.equal(got.sync.method, "audio");
  });
  assert.equal(digest.fps, "25/1");
  assert.ok(digest.cut_count >= 10, `cuts ${digest.cut_count}`);
});

const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
await test("plan is contiguous, frame exact and uses footage only where it exists", async () => {
  assert.deepEqual(validatePlan(plan), []);
  assert.equal(plan.cuts[0].start_frame, 0);
  assert.equal(plan.cuts.at(-1).end_frame, plan.timeline.duration_frames);
  // Camera "dj" starts at 6 s: it must not be used before then.
  assert.ok(plan.cuts.filter((c) => c.camera === 1).every((c) => c.start >= 6 - 1e-6));
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
  const frames = (v) => (v === "0s" ? 0 : Number(v.match(/^(\d+)\/25s$/)[1]));
  const clips = [...xml.matchAll(/<mc-clip [^>]*offset="([^"]+)"[^>]*duration="([^"]+)"/g)].map((m) => [frames(m[1]), frames(m[2])]);
  const used = plan.cuts.filter((c) => c.camera >= 0);
  assert.equal(clips.length, used.length);
  clips.forEach(([off, dur], i) => { assert.equal(off, used[i].start_frame); assert.equal(dur, used[i].end_frame - used[i].start_frame); });
  // Crowd camera started 3 s before the music: its clip is trimmed by 75 frames, no gap.
  assert.match(xml, /angleID="cam3">\s*<asset-clip [^>]*offset="0s" start="75\/25s"/);
  // DJ camera starts 6 s in: 150-frame gap first.
  assert.match(xml, /angleID="cam2">\s*<gap [^>]*duration="150\/25s"/);
  assert.equal((xml.match(/<marker /g) || []).length, plan.music.drops.length);
  // Well-formed: balanced tags.
  const open = (xml.match(/<(?!\/|\?|!)[a-z-]+[^>]*[^/]>/g) || []).length, close = (xml.match(/<\/[a-z-]+>/g) || []).length;
  assert.equal(open, close);
  assert.match(planToFcpxml(plan, { mediaDir: "/Volumes/Footage" }), /src="file:\/\/\/Volumes\/Footage\/wide\.mp4"/);
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

if (process.env.RP_KEEP_TEST) console.log(`kept ${dir}`); else fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} tests passed`);
