// Tool definitions shared by the MCP server and the CLI.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeMusic, planMulticam } from "./engine.mjs";
import { buildPlan, validatePlan } from "./plan-format.mjs";
import { planToFcpxml } from "./fcpxml.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = path.resolve(HERE, "../schema/rp-multicam-plan-1.json");

function readPlan(planPath) {
  const plan = JSON.parse(fs.readFileSync(path.resolve(planPath), "utf8"));
  return plan;
}

function writeFile(target, text) {
  const out = path.resolve(target);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, text);
  return out;
}

function planDigest(plan, extra = {}) {
  const used = {};
  for (const c of plan.cuts) if (c.camera >= 0) used[c.angle_id] = (used[c.angle_id] || 0) + c.duration;
  return {
    ...extra,
    model: plan.generator.model,
    plugin_version: plan.generator.plugin_version,
    fps: `${plan.timeline.fps.num}/${plan.timeline.fps.den}`,
    duration_seconds: plan.timeline.duration,
    bpm: plan.music.bpm,
    bpm_confidence: plan.music.bpm_confidence,
    drops: plan.music.drops.map((d) => ({ time: d.time, build_start: d.build_start, confidence: d.confidence })),
    cameras: plan.cameras.map((c) => ({ angle: c.angle_id, role: c.role, offset: c.offset, sync: c.sync })),
    cut_count: plan.cuts.length,
    longest_shot_seconds: Math.max(...plan.cuts.map((c) => c.duration)),
    screen_time_seconds: Object.fromEntries(Object.entries(used).map(([k, v]) => [k, Math.round(v * 100) / 100])),
    first_cuts: plan.cuts.slice(0, 12).map((c) => `${c.start.toFixed(2)}s ${c.angle_id || "gap"}${c.drop != null ? " [DROP]" : ""}`),
    summary: plan.summary
  };
}

const cameraSchema = {
  type: "object",
  required: ["file"],
  properties: {
    file: { type: "string", description: "Absolute path to the camera video file." },
    role: { type: "string", description: "Camera role, e.g. 'Master Wide', 'DJ Close-Up', 'Crowd Reaction'." },
    name: { type: "string" },
    offset: { type: "number", description: "Seconds on the music timeline where this camera's first frame lands. Omit to sync automatically from the camera's own audio." },
    sync: { type: "string", enum: ["audio", "none"], description: "Force audio sync, or 'none' to use offset (default 0)." }
  }
};

export const TOOLS = [
  {
    name: "analyze_music",
    description: "Analyze a music/DJ-set audio file with the R Project engine (the same code as the Premiere plugin): BPM, tempo map, beat grid, sections, build-ups and drops. Runs locally with FFmpeg; no media leaves the computer.",
    inputSchema: {
      type: "object",
      required: ["music"],
      properties: {
        music: { type: "string", description: "Absolute path to the audio (or video with audio) file." },
        sensitivity: { type: "string", enum: ["conservative", "balanced", "aggressive"], description: "Drop detection sensitivity (default balanced)." },
        include_beats: { type: "boolean", description: "Include every beat time (can be long for DJ sets)." },
        output: { type: "string", description: "Optional path to save the full analysis JSON." }
      }
    },
    async run(args, progress) {
      const a = await analyzeMusic(args.music, { sensitivity: args.sensitivity, progress });
      const fake = { choices: [], summaries: [] };
      const plan = buildPlan({ engine: a.engine, analysis: a, cameras: [], points: [], snapshot: { intervals: [] }, director: fake, fps: a.fps, frame: a.fps.den / a.fps.num, duration: a.duration, musicFile: path.resolve(args.music), cadences: [] });
      const music = plan.music;
      if (args.output) writeFile(args.output, JSON.stringify(music, null, 2));
      const out = { ...music, beat_count: music.beats.length, downbeat_count: music.downbeats.length };
      if (!args.include_beats) { delete out.beats; delete out.downbeats; }
      if (args.output) out.saved_to = path.resolve(args.output);
      return out;
    }
  },
  {
    name: "plan_multicam",
    description: "Create a multicam edit plan (rp-multicam-plan/1) from a music file and camera files: the engine syncs cameras by audio, detects beats/drops, paces cuts to the music and picks a camera for every shot. The same plan can be exported to Final Cut Pro (FCPXML) and read by Premiere tooling.",
    inputSchema: {
      type: "object",
      required: ["music", "cameras", "output"],
      properties: {
        music: { type: "string", description: "Absolute path to the master music / DJ-set audio." },
        cameras: { type: "array", minItems: 1, items: cameraSchema },
        output: { type: "string", description: "Where to save the plan JSON (e.g. /Users/me/Edits/set.rpplan.json)." },
        fcpxml: { type: "string", description: "Optional: also write a Final Cut Pro .fcpxml here." },
        cadences: { type: "array", items: { type: "integer", enum: [2, 4, 6, 8] }, description: "Allowed beats per cut (default 4,6,8)." },
        drop_camera: { type: "integer", description: "0-based camera index to use on every drop (default automatic)." },
        sensitivity: { type: "string", enum: ["conservative", "balanced", "aggressive"] },
        vision: { type: "boolean", description: "Sample video frames to avoid dark/blurry angles (slower)." },
        fps: { type: "number", description: "Override timeline frame rate (default: first camera's rate)." }
      }
    },
    async run(args, progress) {
      const plan = await planMulticam({
        music: args.music, cameras: args.cameras, cadences: args.cadences, dropCamera: args.drop_camera,
        sensitivity: args.sensitivity, vision: !!args.vision, fps: args.fps, progress
      });
      const errors = validatePlan(plan);
      if (errors.length) throw new Error("Engine produced an invalid plan: " + errors.join("; "));
      const saved = writeFile(args.output, JSON.stringify(plan, null, 2));
      const extra = { plan: saved };
      if (args.fcpxml) extra.fcpxml = writeFile(args.fcpxml, planToFcpxml(plan));
      return planDigest(plan, extra);
    }
  },
  {
    name: "export_fcpxml",
    description: "Convert a saved rp-multicam-plan JSON into a Final Cut Pro FCPXML (1.10, FCP 10.6+): one multicam clip with an angle per camera plus the music, and a project cut on the plan's angle switches with drop markers.",
    inputSchema: {
      type: "object",
      required: ["plan", "output"],
      properties: {
        plan: { type: "string", description: "Path to the plan JSON." },
        output: { type: "string", description: "Path for the .fcpxml file." },
        media_dir: { type: "string", description: "Relink all media to this folder (use when the plan was made on another computer)." },
        project_name: { type: "string" },
        event_name: { type: "string" }
      }
    },
    async run(args) {
      const plan = readPlan(args.plan);
      const xml = planToFcpxml(plan, { mediaDir: args.media_dir, projectName: args.project_name, eventName: args.event_name });
      return { fcpxml: writeFile(args.output, xml), cuts: plan.cuts.length, angles: plan.cameras.map((c) => c.angle_id) };
    }
  },
  {
    name: "validate_plan",
    description: "Check that an rp-multicam-plan JSON is structurally valid (contiguous frame-exact cuts, cameras used only where they have footage).",
    inputSchema: { type: "object", required: ["plan"], properties: { plan: { type: "string" } } },
    async run(args) {
      const plan = readPlan(args.plan);
      const errors = validatePlan(plan);
      return errors.length ? { valid: false, errors } : { valid: true, ...planDigest(plan) };
    }
  },
  {
    name: "describe_plan_format",
    description: "Return the JSON Schema of rp-multicam-plan/1, the shared format used for Premiere and Final Cut Pro.",
    inputSchema: { type: "object", properties: {} },
    async run() { return JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8")); }
  }
];
