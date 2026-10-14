import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.4",
    download: base + "?platform=windows&version=2.3.11.4",
    sha256: "c5f042e38d79ca8d1cfa1a076f81d27f60a42f89c187c8715bfeec92d1fa2d17"
  },
  macos: {
    version: "2.3.11.4",
    download: base + "?platform=macos&version=2.3.11.4",
    sha256: "c75ead269f50a44dd789d0201e4b0b8e62e4800df9e71783771724e7c3e95b8e"
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
    release_notes: "v2.3.11.4 PUBLIC Windows and macOS: Camera Roles now steer the cut. The panel reads shot size and direction from each role, so the same kind of angle (for example wide after wide) never follows itself. 4-beat cuts are kept at 25/30 fps and music analysis of long sets is much faster. Save and close Premiere before installing, then generate a fresh plan.",
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
