import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Required update (2026-10-25): every version before 2.3.11.11 must update (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.11";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.18",
    download: base + "?platform=windows&version=2.3.11.18",
    sha256: "5fee49d6b638d866adb1b566badb2d56a0db2f4802d98ea2bdffe2e78bc75dca"
  },
  macos: {
    version: "2.3.11.18",
    download: base + "?platform=macos&version=2.3.11.18",
    sha256: "c791ed8903638d1aea793099f29c783bd426916380d4ae0ec19e174cdc30114c"
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
    release_notes: "v2.3.11.18 PUBLIC Windows and macOS: Sync Cameras to Music now places cameras when the A1 music covers only part of the shoot (a recorder that stopped early): long clips are searched along their whole length and a camera clip placed with high confidence lends its audio past the music. On macOS the update installs while Premiere is open; restart Premiere afterwards. Mac panels older than v2.3.11.11 cannot finish the in-panel update: install v2.3.11.18 once from r-multicam.pages.dev (sign in, Download for Mac, run Install-macOS.command).",
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
