import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const latest: Record<string, string> = { windows: "2.3.11.5", macos: "2.3.11.5" };
const releases: Record<string, { windows?: string; macos?: string }> = {
  "2.3.11.5": {
    windows: "https://raw.githubusercontent.com/rizkyardi1503-bot/r-multicam/cd4b99ca94cc2f6b716c66fd38d6813274debc2f/site/downloads/R-Project-Multicam-AI-Windows-v2.3.11.5-PUBLIC.zip",
    macos: "https://raw.githubusercontent.com/rizkyardi1503-bot/r-multicam/cd4b99ca94cc2f6b716c66fd38d6813274debc2f/site/downloads/R-Project-Multicam-AI-macOS-v2.3.11.5-PUBLIC.zip"
  }
};

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  const explicit = (u.searchParams.get("platform") || "").toLowerCase();
  const ua = req.headers.get("user-agent") || "";
  const platform = explicit === "macos" || explicit === "windows"
    ? explicit
    : /Macintosh|Mac OS X/i.test(ua) ? "macos" : "windows";
  const version = u.searchParams.get("version") || latest[platform];

  const source = releases[version]?.[platform];
  if (!source) return new Response("Unknown version or platform", { status: 404 });

  try {
    const r = await fetch(source, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!r.ok || !r.body) return new Response("Upstream download failed", { status: 502 });
    const h = new Headers();
    h.set("content-type", "application/zip");
    h.set("content-disposition", `attachment; filename="R-Project-Multicam-AI-${platform === "macos" ? "macOS" : "Windows"}-v${version}-PUBLIC.zip"`);
    h.set("cache-control", "public, max-age=300");
    const len = r.headers.get("content-length");
    if (len) h.set("content-length", len);
    return new Response(r.body, { status: 200, headers: h });
  } catch {
    return new Response("Download proxy error", { status: 502 });
  }
});
