import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Optional update: v2.3.11.2 and newer keep working (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.2";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.6",
    download: base + "?platform=windows&version=2.3.11.6",
    sha256: "a9e4d30a8d61ee189ccf3aad60ed024af1cc6899c7eb98413d8c2074960d44e0"
  },
  macos: {
    version: "2.3.11.6",
    download: base + "?platform=macos&version=2.3.11.6",
    sha256: "5d85b5604f2ee13f239fefc42c046635e9fa983d5408015914dbecce56da2692"
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
    release_notes: "v2.3.11.6 PUBLIC Windows and macOS: new Sync to Master Music (beta, lifetime) places every camera clip on the master music and builds a new synced sequence; faster beat-drop detection; much faster removal of unused camera pieces on long sets; optional backup copy before Apply; tidier panel. Also: Camera Roles steer the cut (no wide after wide), 4-beat cuts kept at 25/30 fps, faster long-set analysis, sequence In/Out respected, reliable Stop/Continue. Optional update: save and close Premiere before installing.",
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
