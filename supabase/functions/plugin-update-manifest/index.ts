import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.10.137",
    download: base + "?platform=windows&version=2.3.10.137",
    sha256: "6248406f8a3f0728089cc3df7fa844c171063f8201afa7dc28853376b29df6c1"
  },
  macos: {
    version: "2.3.10.137",
    download: base + "?platform=macos&version=2.3.10.137",
    sha256: "fe37fb17cde21cd367f56b7ddba9d2fdab08eb387cb58315bb9067cb8b2251fa"
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
    release_notes: "v2.3.10.137 PUBLIC: Music Engine V18 multi-signal BPM/beat tracking, tempo-continuity handling, attack-ramp onset backtracking, optional local model/benchmark tools. No trained model bundled. Balanced UI default 64 beats; saved settings and cutting cadence retained. Re-run Analyze Music and generate a fresh plan. Existing .137 TEST users must manually reinstall the PUBLIC ZIP. Windows installer and rollback passed isolated tests; macOS installer/updater passed syntax and mocked checks, not native macOS/Premiere validation. Online update is mandatory below this public release with no grace period.",
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