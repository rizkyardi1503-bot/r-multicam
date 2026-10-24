import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Required update (2026-10-25): every version before 2.3.11.10 must update (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.10";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.11",
    download: base + "?platform=windows&version=2.3.11.11",
    sha256: "eb3d932ea0a1c0f5e9e8f757e20dd5aaefb39c296cd888ceb5c6f2a958118da3"
  },
  macos: {
    version: "2.3.11.11",
    download: base + "?platform=macos&version=2.3.11.11",
    sha256: "6812f04bac0baa753d0d58f95fc1b2c0adf32e3ba3d400a10b952e26e6cd0aff"
  }
};

function supported(value: string | null, minimumVersion: string): boolean {
  const match = /^([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})\.([0-9]{1,9})(-[A-Za-z0-9][A-Za-z0-9.-]*)?$/.exec(value || "");
  if (!match) return false;
  const actual = match.slice(1, 5).map(Number);
  const minimum = minimumVersion.split(".").map(Number);
  for (let i = 0; i < 4; i++) {
    if (actual[i] !== minimum[i]) return actual[i] > minimum[i];
  }
  return true;
}
Deno.serve((req: Request) => {
  const url = new URL(req.url);
  const explicit = (url.searchParams.get("platform") || "").toLowerCase();
  const ua = req.headers.get("user-agent") || "";
  const platform = explicit === "macos" || explicit === "windows"
    ? explicit
    : /Macintosh|Mac OS X/i.test(ua) ? "macos" : "windows";
  const selected = releases[platform];

  return new Response(JSON.stringify({
    version: selected.version,
    platform,
    required: !supported(url.searchParams.get("v"), MINIMUM_SUPPORTED),
    minimum_version: MINIMUM_SUPPORTED,
    grace_period_days: 0,
    release_notes: "v2.3.11.11 PUBLIC Windows and macOS, required update: the macOS in-panel update now installs while Premiere is open (restart Premiere afterwards). Includes v2.3.11.10: signed offline license, music engine V19, visual quality checks, faster analysis. If an older Mac panel says the update helper was stopped, install once from r-multicam.pages.dev.",
    windows_download: releases.windows.download,
    macos_download: releases.macos.download,
    windows_sha256: releases.windows.sha256,
    macos_sha256: releases.macos.sha256
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store, no-cache, must-revalidate"
    }
  });
});
