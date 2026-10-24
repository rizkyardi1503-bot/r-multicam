import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Optional update: v2.3.11.2 and newer keep working (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.2";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.9",
    download: base + "?platform=windows&version=2.3.11.9",
    sha256: "624b32dd9b529284bde334b767e86e389f23e8d6da0c35325d1c07f3b3a6d35a"
  },
  macos: {
    version: "2.3.11.9",
    download: base + "?platform=macos&version=2.3.11.9",
    sha256: "bb064c2b385fd8d8af40b04517fac91f9168dc45a4c738d76d2b3db1a3b4a5a0"
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
    release_notes: "v2.3.11.9 PUBLIC Windows and macOS: music engine V19 (one continuous beat chain), visual quality checks in the AI director, Rp prices in the panel, sign-in renewed before it expires, macOS FFmpeg fix. Optional update: v2.3.11.2 and newer keep working. Save and close Premiere before installing.",
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
