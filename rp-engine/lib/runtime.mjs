// Loads the unmodified R Project plugin engine (the same JS files the Premiere panel runs)
// into an isolated Node VM context. Only a tiny `cep_node` shim is provided, so the
// beat / tempo / drop / pacing / camera logic is byte-for-byte the plugin's own code.
import crypto from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { trackChild } from "./media.mjs";

const nodeRequire = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

// The plugin code spawns FFmpeg through this module: track those children so they can be stopped.
const childProcess = nodeRequire("node:child_process");
const trackedChildProcess = { ...childProcess, spawn: (...args) => trackChild(childProcess.spawn(...args)) };

// Load order mirrors Plugin/index.html.
export const ENGINE_FILES = [
  "music-pacing-auto.js",
  "audio-core.js",
  "spectral-features.js",
  "audio-engine.js",
  "music-learning.js",
  "music-intelligence-v10.js",
  "ai-director.js"
];

function hasEngine(dir) {
  return !!dir && ENGINE_FILES.every((f) => fs.existsSync(path.join(dir, f)));
}

/** Where to find the plugin engine: RP_PLUGIN_DIR, an installed CEP extension, or this repo. */
export function resolvePluginDir(explicit) {
  const home = os.homedir();
  const candidates = [
    explicit,
    process.env.RP_PLUGIN_DIR,
    process.platform === "darwin"
      ? path.join(home, "Library/Application Support/Adobe/CEP/extensions/RProjectMulticamAI")
      : process.env.APPDATA && path.join(process.env.APPDATA, "Adobe/CEP/extensions/RProjectMulticamAI"),
    path.resolve(HERE, "../../plugin", process.platform === "darwin" ? "macos" : "windows", "Plugin"),
    path.resolve(HERE, "../../plugin/windows/Plugin")
  ];
  for (const dir of candidates) if (hasEngine(dir)) return dir;
  throw new Error("R Project plugin engine not found. Install the plugin or set RP_PLUGIN_DIR to its Plugin folder.");
}

export function pluginVersion(dir) {
  try {
    const manifest = fs.readFileSync(path.join(dir, "CSXS/manifest.xml"), "utf8");
    return (manifest.match(/ExtensionBundleVersion="([0-9.]+)"/) || [])[1] || null;
  } catch {
    return null;
  }
}

/** Create a fresh engine instance (one per job, so no state leaks between calls). */
export function loadEngine(pluginDir, seed) {
  const dir = resolvePluginDir(pluginDir);
  const memory = new Map();
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    cep_node: { require: (name) => (name === "child_process" ? trackedChildProcess : nodeRequire(name === "process" ? "node:process" : name)) },
    localStorage: {
      getItem: (k) => (memory.has(k) ? memory.get(k) : null),
      setItem: (k, v) => memory.set(k, String(v)),
      removeItem: (k) => memory.delete(k)
    }
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox, { name: "rp-engine" });
  // The director's anti-repeat step uses Math.random. Seed it so the same inputs always
  // give the same plan (set RP_ENGINE_SEED to get a different, still reproducible, variation).
  vm.runInContext(`(function(seed){var a=seed>>>0;Math.random=function(){a=(a+0x6D2B79F5)>>>0;var t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};})(${Number(seed ?? process.env.RP_ENGINE_SEED ?? 1503) >>> 0})`, context);
  const hash = crypto.createHash("sha1");
  for (const file of ENGINE_FILES) {
    const code = fs.readFileSync(path.join(dir, file), "utf8");
    hash.update(`${file}|${code.length}|${code}|`);
    vm.runInContext(code, context, { filename: path.join(dir, file) });
  }
  for (const name of ["RPAudio", "RPBeat", "RPBeatFirst", "RPDirector"]) {
    if (!sandbox[name]) throw new Error(`Engine module ${name} did not load from ${dir}.`);
  }
  if (!sandbox.RPMusicV12 && !sandbox.RPMusicV10) throw new Error("Music intelligence module did not load.");
  return {
    dir,
    version: pluginVersion(dir),
    // Content hash of the engine files: cache keys use it, so an edited engine never reuses stale results.
    hash: hash.digest("hex").slice(0, 12),
    RPAudio: sandbox.RPAudio,
    RPBeat: sandbox.RPBeat,
    RPBeatFirst: sandbox.RPBeatFirst,
    RPDirector: sandbox.RPDirector,
    RPMusic: sandbox.RPMusicV12 || sandbox.RPMusicV10
  };
}
