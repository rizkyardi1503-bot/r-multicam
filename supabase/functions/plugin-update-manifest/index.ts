import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.0",
    download: base + "?platform=windows&version=2.3.11.0",
    sha256: "317f3412b0c0db3f4df5adc87e1f9e7668194f39217f094e38fb068bc0a052a2"
  },
  macos: {
    version: "2.3.11.1",
    download: base + "?platform=macos&version=2.3.11.1",
    sha256: "f945488da9be7d45e97e6744d1ca4cde87b64583895bac1d74c1d24bebe1eded"
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
    release_notes: platform === "macos"
      ? "v2.3.11.1 PUBLIC macOS-only: Automatic Low Memory mode on Macs with 12 GiB RAM or less (including M1 8 GB and Rosetta). Optional AI Vision uses one CPU decoding thread and up to 24 samples; timeline batches are smaller with 250 ms pacing. macOS reclaimable-page estimates, analysis preflight and periodic audio memory checks replace Windows-style thresholds. Beat/BPM/drop detail and Google/manual login retained; trial dates and paid licenses unchanged. Automated tests and installer syntax pass; native M1/Premiere performance remains unmeasured. Save your project and close Premiere before installing. Zero grace period below the macOS release. Windows stays v2.3.11.0."
      : "v2.3.11.0 PUBLIC Windows: Continue with Google, secure PKCE sign-in and existing license/device checks. Email/password and Music Engine V18 retained. No new Windows package or minimum-version change in the macOS-only 2.3.11.1 release. Save your project and close Premiere before installing. Zero grace period below v2.3.11.0.",
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
