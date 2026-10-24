import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// v2.3.11.6 and older must update (2026-10-25): v2.3.11.7 and newer keep working (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.7";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.10",
    download: base + "?platform=windows&version=2.3.11.10",
    sha256: "14439a78df66c6b39e5141caa88f6245a78caffbfa0ee7f4fa569a0c7b0616a5"
  },
  macos: {
    version: "2.3.11.10",
    download: base + "?platform=macos&version=2.3.11.10",
    sha256: "89dd0cc94577258f8343d831d2d55c0da1ec67246f83d7ac96f121b306922d2b"
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
    release_notes: "v2.3.11.10 PUBLIC Windows and macOS, required update: offline use protected by a server-signed license (online use unchanged). Includes everything from v2.3.11.9: music engine V19, visual quality checks, faster analysis, Rp prices, macOS FFmpeg fix. Save and close Premiere before installing.",
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
