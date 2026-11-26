#!/usr/bin/env node
// R Project Multicam AI engine — command line.
//   rp-engine analyze song.wav [--out music.json] [--sensitivity balanced]
//   rp-engine plan --music song.wav --camera wide.mp4=Master Wide --camera dj.mp4=DJ Close-Up@12.5 \
//                  --out set.rpplan.json [--fcpxml set.fcpxml] [--cadence 4,6,8] [--drop-camera 1] [--vision]
//   rp-engine fcpxml set.rpplan.json --out set.fcpxml [--media-dir /Volumes/Footage]
//   rp-engine validate set.rpplan.json
// A camera is FILE[=ROLE][@OFFSET_SECONDS]; without @OFFSET it is synced from its own audio.
// The role starts at the last '='; end a file name that contains '=' with a trailing '=' (FILE=).
import { TOOLS, parseCameraSpec } from "../lib/tools.mjs";

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2), next = argv[i + 1];
    const value = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (key === "camera") (out.camera ||= []).push(value); else out[key] = value;
  }
  return out;
}

const progress = (p, message) => process.stderr.write(`\r${String(Math.round(p * 100)).padStart(3)}%  ${String(message || "").slice(0, 70).padEnd(70)}`);
const tool = (name) => TOOLS.find((t) => t.name === name);

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const args = parse(rest);
  let result;
  if (cmd === "analyze" && args._[0]) {
    result = await tool("analyze_music").run({ music: args._[0], output: args.out, sensitivity: args.sensitivity, include_beats: !!args.beats }, progress);
  } else if (cmd === "plan" && args.music && args.camera) {
    result = await tool("plan_multicam").run({
      music: args.music, cameras: args.camera.map(parseCameraSpec), output: args.out || "plan.rpplan.json", fcpxml: args.fcpxml,
      cadences: args.cadence ? String(args.cadence).split(",").map(Number) : undefined,
      drop_camera: args["drop-camera"] === undefined ? undefined : Number(args["drop-camera"]),
      sensitivity: args.sensitivity, vision: !!args.vision, fps: args.fps ? Number(args.fps) : undefined
    }, progress);
  } else if (cmd === "fcpxml" && args._[0]) {
    result = await tool("export_fcpxml").run({ plan: args._[0], output: args.out || args._[0].replace(/(\.rpplan)?\.json$/i, "") + ".fcpxml", media_dir: args["media-dir"], project_name: args.name });
  } else if (cmd === "validate" && args._[0]) {
    result = await tool("validate_plan").run({ plan: args._[0] });
    if (!result.valid) process.exitCode = 1;
  } else {
    console.error("Usage:\n  rp-engine analyze <music> [--out file.json]\n  rp-engine plan --music <file> --camera <file[=role][@offset]> ... --out plan.json [--fcpxml out.fcpxml]\n  rp-engine fcpxml <plan.json> [--out file.fcpxml] [--media-dir dir]\n  rp-engine validate <plan.json>");
    process.exit(2);
  }
  process.stderr.write("\n");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => { process.stderr.write("\n"); console.error("Error: " + (e?.message || e)); process.exit(1); });
