import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.3",
    download: base + "?platform=windows&version=2.3.11.3",
    sha256: "11e14e36c273738fdc7648c811dbd8088ad5fdec8dcf5d28fef368f4605696df"
  },
  macos: {
    version: "2.3.11.3",
    download: base + "?platform=macos&version=2.3.11.3",
    sha256: "ff5e3a1c38263e9273b2515d854313f399350f2d4be1bdacea434fa25498be2f"
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
    release_notes: "v2.3.11.3 PUBLIC Windows and macOS: safer installer. FFmpeg is pinned to 9.0.2 and its SHA-256 is verified before use (Windows: GitHub release with gyan.dev backup; macOS: martin-riedl.de Apple Silicon/Intel builds); installation stops before changing the plugin if verification fails. Auto pacing is now named Auto Music Map. Internal training tools removed from packages. Editing engine, Music V18, Google/manual login, trial dates and licenses unchanged; existing FFmpeg installs are kept. Save and close Premiere before installing. Native Premiere testing remains recommended on a duplicate project.",
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
