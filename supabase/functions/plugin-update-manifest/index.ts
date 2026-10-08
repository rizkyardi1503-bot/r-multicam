import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.2",
    download: base + "?platform=windows&version=2.3.11.2",
    sha256: "4de23a845ef06be4bcf7295c38c6fdb85fac48339d12532110c62e819253f553"
  },
  macos: {
    version: "2.3.11.2",
    download: base + "?platform=macos&version=2.3.11.2",
    sha256: "b50d796071cb91683afa902aa30e30e0578f1e983a27afe4cee3b4c291831c55"
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
    release_notes: "v2.3.11.2 PUBLIC Windows and macOS: Minimum physical camera shot is four beats; optional flash cuts are merged without shifting exact drops. Coverage or close locked-drop conflicts block Apply before timeline changes. Generate a new plan after updating; existing timelines are unchanged and old resume jobs must be regenerated. Mac <=12 GiB Low Memory mode retained: one CPU decoder, up to 24 optional vision samples, smaller batches and memory preflight. Music V18 and Google/manual login retained. Native Premiere/M1 testing remains required. Save and close Premiere before installing. Zero grace period below 2.3.11.2.",
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
