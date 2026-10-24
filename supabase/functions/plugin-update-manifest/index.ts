import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Required update (2026-10-25): every version before 2.3.11.11 must update (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.11";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.12",
    download: base + "?platform=windows&version=2.3.11.12",
    sha256: "e76fe66e4b372db6f5ecb3993572277e23e56fbf7de77f0f487ee26d32bdbfdc"
  },
  macos: {
    version: "2.3.11.12",
    download: base + "?platform=macos&version=2.3.11.12",
    sha256: "cf4c4cea7cbdee280c147fa53ea537ccfb0d7ef30cdd7629aadad7b5e633aead"
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
    release_notes: "v2.3.11.12 PUBLIC Windows and macOS: update test release, same code as v2.3.11.11. On macOS the update installs while Premiere is open; restart Premiere afterwards. Optional for v2.3.11.11; earlier versions must update. If an older Mac panel says the update helper was stopped, install once from r-multicam.pages.dev.",
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
