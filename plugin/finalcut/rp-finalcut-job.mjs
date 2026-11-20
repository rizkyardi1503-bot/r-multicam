// One engine job (Analyze Music or Create Multicam Edit), run in a child process of R Project Engine so the control
// page stays responsive and Cancel can stop it (and its FFmpeg processes) at once.
// Not a command-line tool: it only works as a child started by rp-finalcut-engine.js (IPC channel), which checks the
// R Project license before every job.
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (typeof process.send !== "function") {
  console.error("This file is started by R Project Engine. Open R Project Engine instead.");
  process.exit(2);
}
// The engine files that ship with this build (never an older Premiere install found elsewhere).
process.env.RP_PLUGIN_DIR = path.join(HERE, "engine");

const { TOOLS } = await import("./rp-engine/lib/tools.mjs");
const { killChildren } = await import("./rp-engine/lib/media.mjs");
const controller = new AbortController();
let lastSent = 0;

function stop(code) { try { killChildren(); } catch { /* none */ } process.exit(code); }
process.on("SIGTERM", () => stop(143));
process.on("disconnect", () => stop(0));          // engine closed: never leave FFmpeg running

process.on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "cancel") { controller.abort(new Error("Cancelled")); setTimeout(() => stop(130), 3000).unref(); return; }
  if (msg.type !== "run") return;
  const tool = TOOLS.find((t) => t.name === msg.tool);
  if (!tool || !["analyze_music", "plan_multicam"].includes(msg.tool)) { process.send({ type: "error", message: "Unknown job " + msg.tool }); return stop(1); }
  const progress = (p, message) => {
    const now = Date.now();
    if (now - lastSent < 200 && p < 1) return;
    lastSent = now;
    process.send({ type: "progress", p: Math.max(0, Math.min(1, Number(p) || 0)), message: String(message || "") });
  };
  try {
    const result = await tool.run(msg.args, progress, { signal: controller.signal });
    process.send({ type: "done", result }, () => stop(0));
  } catch (e) {
    process.send({ type: "error", message: controller.signal.aborted ? "Cancelled" : String(e && e.message || e) }, () => stop(1));
  }
});
process.send({ type: "ready" });
