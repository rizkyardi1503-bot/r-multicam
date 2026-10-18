import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Optional update: v2.3.11.2 and newer keep working (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.2";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.7",
    download: base + "?platform=windows&version=2.3.11.7",
    sha256: "efc6e69306a75f4aa95070f15b111ae8a630206d1c7488406862ded4002c326e"
  },
  macos: {
    version: "2.3.11.7",
    download: base + "?platform=macos&version=2.3.11.7",
    sha256: "a2f700e50cd52d784bfcdcd1e1247b01991c1d210f075b2fb4e937d2e469f534"
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
    release_notes: "v2.3.11.7 PUBLIC Windows and macOS: drone and FPV clips sync by camera clock in Sync Cameras to Music (beta, lifetime) with remembered corrections; Cut Pace 2/4/6/8 counts real beats; no blocked Apply near drops; camera switch where footage ends; tempo no longer locks at half speed; update and installer fixes. Optional update: v2.3.11.2 and newer keep working. Save and close Premiere before installing.",
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
