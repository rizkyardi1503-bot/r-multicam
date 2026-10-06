import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const latest = "2.3.10.137";
const rawBase = "https://raw.githubusercontent.com/rizkyardi1503-bot/r-multicam/2d21a5f088155034ff1868b41b3690e13b18460d/site/downloads/";
const releases: Record<string, { windows?: string; macos?: string }> = {
  "2.3.10.137": {
    windows: "https://raw.githubusercontent.com/rizkyardi1503-bot/r-multicam/f95f497a52cdc4f20c483adc21985ea8393f04fc/site/downloads/R-Project-Multicam-AI-Windows-v2.3.10.137-PUBLIC.zip",
    macos: "https://raw.githubusercontent.com/rizkyardi1503-bot/r-multicam/f95f497a52cdc4f20c483adc21985ea8393f04fc/site/downloads/R-Project-Multicam-AI-macOS-v2.3.10.137-PUBLIC.zip"
  },
  "2.3.10.136": {
    windows: rawBase + "R-Project-Multicam-AI-Windows-v2.3.10.136-PUBLIC.zip",
    macos: rawBase + "R-Project-Multicam-AI-macOS-v2.3.10.136-PUBLIC.zip"
  },
  "2.3.10.134": {
    windows: rawBase + "R-Project-Multicam-AI-Windows-v2.3.10.134-PUBLIC.zip",
    macos: rawBase + "R-Project-Multicam-AI-macOS-v2.3.10.134-PUBLIC.zip"
  },
  "2.3.10.133": {
    windows: rawBase + "R-Project-Multicam-AI-Windows-v2.3.10.133-PUBLIC.zip",
    macos: rawBase + "R-Project-Multicam-AI-macOS-v2.3.10.133-PUBLIC.zip"
  },
  "2.3.10.132": {
    windows: "https://drive.usercontent.google.com/download?id=1b_k04wjeoQcu4XsTed6SAHYtED2MrxYc&export=download&confirm=t",
    macos: "https://drive.usercontent.google.com/download?id=17cD-NMQhsgyFl2B-eSItGhyqrz5Pw4Rc&export=download&confirm=t"
  },
  "2.3.10.124": { windows: "https://drive.usercontent.google.com/download?id=1zXHW8p1RDmkTU2m9MtVcqKWBSJmGmfVe&export=download&confirm=t" },
  "2.3.10.123": { windows: "https://drive.usercontent.google.com/download?id=1V8ZFJZOnowWRvJ2TerSras2Wh9Vfe2RV&export=download&confirm=t" },
  "2.3.10.122": { windows: "https://drive.usercontent.google.com/download?id=19WQaCV1F9cpN07lRbJodcUQPIjQGOtmK&export=download&confirm=t" },
  "2.3.10.121": { windows: "https://drive.usercontent.google.com/download?id=1BPTLpYOUVRKeIwCa5HBZuwRUT9f6OXId&export=download&confirm=t" },
  "2.3.10.120": { windows: "https://drive.usercontent.google.com/download?id=1fiQ67I_6fw4WgsD63lD8EePQwqdZvnX6&export=download&confirm=t" },
  "2.3.10.119": { windows: "https://drive.usercontent.google.com/download?id=1Pl4HCyyZAOFKEvTlzADrJmxgt6wGW8b5&export=download&confirm=t" }
};

Deno.serve(async (req: Request) => {
  const u = new URL(req.url);
  const version = u.searchParams.get("version") || latest;
  const explicit = (u.searchParams.get("platform") || "").toLowerCase();
  const ua = req.headers.get("user-agent") || "";
  const platform = explicit === "macos" || explicit === "windows"
    ? explicit
    : /Macintosh|Mac OS X/i.test(ua) ? "macos" : "windows";

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