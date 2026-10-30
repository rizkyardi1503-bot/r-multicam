import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Required update (2026-10-25): every version before 2.3.11.11 must update (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.11";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.15",
    download: base + "?platform=windows&version=2.3.11.15",
    sha256: "3d3794414204bcf38f1d16fb5f9659d76ad68c01affaa4231e4e0be97f2deb36"
  },
  macos: {
    version: "2.3.11.15",
    download: base + "?platform=macos&version=2.3.11.15",
    sha256: "c40e8b12a4f993f0012919663ace0454a115dbb3f132428e7e8595d8912b4247"
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
    release_notes: "v2.3.11.15 PUBLIC Windows and macOS: Sync Cameras to Music places a long single take by its audio even when its start is unclear (the end is found in the music and the start must match it), instead of sending it to Review at a wrong position; Auto Cut Multicam stops before any change when Camera roles leave only one camera with footage and names the tracks to use. On macOS the update installs while Premiere is open; restart Premiere afterwards. Mac panels older than v2.3.11.11 cannot finish the in-panel update: install v2.3.11.15 once from r-multicam.pages.dev (sign in, Download for Mac, run Install-macOS.command).",
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
