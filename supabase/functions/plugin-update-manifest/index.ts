import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.5",
    download: base + "?platform=windows&version=2.3.11.5",
    sha256: "fbcaa8d3286820b81c53e2b6ee30d9b3eb5a6ce5769356c47031a871e5eb5a2e"
  },
  macos: {
    version: "2.3.11.5",
    download: base + "?platform=macos&version=2.3.11.5",
    sha256: "9be10af82d3cbc3b6a4536f34464ddc0140c1a3ed323004f31e7258d1c1249bb"
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
    required: !supported(url.searchParams.get("v"), selected.version),
    minimum_version: selected.version,
    grace_period_days: 0,
    release_notes: "v2.3.11.5 PUBLIC Windows and macOS: Camera Roles now steer the cut (no wide after wide), 4-beat cuts are kept at 25/30 fps and long sets analyze much faster. Also: sequence In/Out respected, backup copy before Apply, Continue after Stop fixed on Windows, Random Zoom relative to each clip, no stuck buttons, offline use up to 72 hours, and updates that wait only for Premiere. Save and close Premiere before installing, then generate a fresh plan.",
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
