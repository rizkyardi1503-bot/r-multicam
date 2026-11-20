// Optional on-disk cache so long sets can be processed in resumable steps
// (music analysis, music sync envelope and per-clip sync results are reused when the
// source files have not changed). Enabled by passing `cacheDir`.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";

export function fileKey(...parts) {
  const h = crypto.createHash("sha1");
  for (const p of parts) {
    if (typeof p === "string" && fs.existsSync(p)) { const s = fs.statSync(p); h.update(`${path.resolve(p)}|${s.size}|${s.mtimeMs}`); }
    else h.update(JSON.stringify(p ?? null));
    h.update("\0");
  }
  return h.digest("hex").slice(0, 20);
}

export function cacheGet(dir, name) {
  if (!dir) return undefined;
  const f = path.join(dir, name);
  try { return fs.existsSync(f) ? v8.deserialize(fs.readFileSync(f)) : undefined; } catch { return undefined; }
}

export function cachePut(dir, name, value) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name), tmp = f + ".tmp";
  fs.writeFileSync(tmp, v8.serialize(value));
  fs.renameSync(tmp, f);
}
