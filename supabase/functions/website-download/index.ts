import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const browserOrigins = new Set(["https://r-multicam.pages.dev","http://127.0.0.1:8765"]);
const latest = "2.3.10.137";
const filenames: Record<string, string> = {
  windows: "R-Project-Multicam-AI-Windows-v2.3.10.137-PUBLIC.zip",
  macos: "R-Project-Multicam-AI-macOS-v2.3.10.137-PUBLIC.zip"
};
const fallbackBase = "https://raw.githubusercontent.com/rizkyardi1503-bot/r-multicam/f95f497a52cdc4f20c483adc21985ea8393f04fc/site/downloads/";

function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    ...(browserOrigins.has(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "authorization, apikey, content-type",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-expose-headers": "content-disposition, content-length, x-rproject-download-source",
    "vary": "Origin"
  };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405, headers: cors });

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return new Response("Sign in required", { status: 401, headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const identity = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { apikey: serviceKey, authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10000)
  });
  if (!identity.ok) return new Response("Sign in required", { status: 401, headers: cors });

  const user = await identity.json();
  if (!user?.id || !user?.email_confirmed_at) {
    return new Response("Confirm your email before downloading.", { status: 403, headers: cors });
  }

  const platform = (new URL(req.url).searchParams.get("platform") || "").toLowerCase();
  if (platform !== "windows" && platform !== "macos") {
    return new Response("Choose windows or macos.", { status: 400, headers: cors });
  }

  const filename = filenames[platform];
  const privateUrl = supabaseUrl + "/storage/v1/object/authenticated/plugin-installers/" + encodeURIComponent(filename);
  let upstream = await fetch(privateUrl, {
    headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey },
    signal: AbortSignal.timeout(30000)
  }).catch(() => null);
  let source = "private-storage";

  if (!upstream?.ok || !upstream.body) {
    upstream = await fetch(fallbackBase + filename, { redirect: "follow", signal: AbortSignal.timeout(30000) }).catch(() => null);
    source = "temporary-pinned-fallback";
  }
  if (!upstream?.ok || !upstream.body) return new Response("Download source is temporarily unavailable.", { status: 502, headers: cors });

  const headers = new Headers(cors);
  headers.set("content-type", "application/zip");
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  headers.set("cache-control", "private, no-store, max-age=0");
  headers.set("x-rproject-download-source", source);
  const length = upstream.headers.get("content-length");
  if (length) headers.set("content-length", length);
  return new Response(upstream.body, { status: 200, headers });
});