import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Optional update: v2.3.11.2 and newer keep working (matches plugin_entitlement c_min_supported).
const MINIMUM_SUPPORTED = "2.3.11.2";
const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.8",
    download: base + "?platform=windows&version=2.3.11.8",
    sha256: "46d9afc799509848566aa93fbda5542be55d668cdcf4e70c63bce0db71261889"
  },
  macos: {
    version: "2.3.11.8",
    download: base + "?platform=macos&version=2.3.11.8",
    sha256: "6b8bc09e4194882d6de61aa9c99d88c2d73dd7572c166e8aed26deab5bb7e23d"
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
    release_notes: "v2.3.11.8 PUBLIC Windows and macOS: Buy Lifetime and Check Payment are back in the panel (online checkout through Midtrans is open again). Includes everything from v2.3.11.7. Optional update: v2.3.11.2 and newer keep working. Save and close Premiere before installing.",
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
