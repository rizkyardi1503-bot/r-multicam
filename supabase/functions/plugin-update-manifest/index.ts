import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Required update (2026-10-25): every version before 2.3.11.11 must update (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.11";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.14",
    download: base + "?platform=windows&version=2.3.11.14",
    sha256: "426068b0321aa42d2db1651c0fd750841a88e5322774b55e1b116d87fa59914b"
  },
  macos: {
    version: "2.3.11.14",
    download: base + "?platform=macos&version=2.3.11.14",
    sha256: "3ceb2ff7bc8b089615c5f5b14491abf93f3e088a8627e9752af02c1b4b36d7cc"
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
    release_notes: "v2.3.11.14 PUBLIC Windows and macOS: Sync Cameras to Music syncs drones through single-take cameras and places clips by their own audio when the camera clock is wrong; Auto Cut Multicam no longer blocks Apply when footage cannot meet the 4-beat minimum (switches camera, moves the cut or keeps the camera through a weaker drop) and is safer on Stop, Continue and resume; Analyze Music finds bars per section and fixes tempo misreads; the panel steps fold to one line. On macOS the update installs while Premiere is open; restart Premiere afterwards. Mac panels older than v2.3.11.11 cannot finish the in-panel update: install v2.3.11.14 once from r-multicam.pages.dev (sign in, Download for Mac, run Install-macOS.command).",
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
