import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const base = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/plugin-update-download";
const releases = {
  windows: {
    version: "2.3.11.0",
    download: base + "?platform=windows&version=2.3.11.0",
    sha256: "317f3412b0c0db3f4df5adc87e1f9e7668194f39217f094e38fb068bc0a052a2"
  },
  macos: {
    version: "2.3.11.0",
    download: base + "?platform=macos&version=2.3.11.0",
    sha256: "a21bb1d9bc38bb74a2557785efe7668d41a547b74a3036e77c9e81929c073bf3"
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
    release_notes: "v2.3.11.0 PUBLIC: Continue with Google is included in Windows/macOS plugin panels. Secure browser-to-plugin PKCE sign-in, identity verification, existing license/device checks, local Google icon, cancel and timeout. Email/password retained. Music Engine V18 unchanged; accounts, trial dates and paid licenses retained. Windows isolated installer/rollback tests and macOS mocked tests pass; native macOS/Premiere and user Google consent still require validation. Save your project, close Premiere to install, then reopen. Mandatory online update below this release; zero grace period.",
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
