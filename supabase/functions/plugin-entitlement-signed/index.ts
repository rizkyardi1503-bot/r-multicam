import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { canonicalPayload, importSigningKey, signPayload } from "./signing.ts";

// Signed entitlement for the Premiere panel's 72 h offline grace (deploy with verify_jwt = true).
// The decision itself stays in public.plugin_entitlement, called with the user's own token; this
// function only signs that answer with an Ed25519 key kept in Supabase Vault (read via
// public.plugin_entitlement_signing_key(), executable by service_role only).
// Response: { entitlement, signed: { payload, signature, key_id } } — signed is null for a replaced session.

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};

let keyCache: { keyId: string; key: CryptoKey } | null = null;

async function signingKey(supabaseUrl: string, serviceKey: string) {
  if (keyCache) return keyCache;
  const r = await fetch(supabaseUrl + "/rest/v1/rpc/plugin_entitlement_signing_key", {
    method: "POST",
    headers: { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(10000)
  });
  if (!r.ok) return null;
  const secret = await r.json().catch(() => null);
  let parsed: { key_id?: string; pkcs8?: string } | null = null;
  try { parsed = typeof secret === "string" ? JSON.parse(secret) : null; } catch { parsed = null; }
  if (!parsed?.key_id || !parsed?.pkcs8) return null;
  keyCache = { keyId: String(parsed.key_id), key: await importSigningKey(crypto.subtle, parsed.pkcs8) };
  return keyCache;
}

const field = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors } });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !apiKey) return json({ error: "SERVER_NOT_CONFIGURED" }, 503);

  const body = await req.json().catch(() => ({}));
  const deviceId = field(body?.p_device_id, 200), platform = field(body?.p_platform, 40), pluginVersion = field(body?.p_plugin_version, 80);
  if (!deviceId || !platform || !pluginVersion) return json({ error: "BAD_REQUEST" }, 400);

  const identity = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: serviceKey, authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
  if (!identity.ok) return json({ error: "AUTH_REQUIRED" }, 401);
  const userId: string = (await identity.json().catch(() => ({}))).id || "";
  if (!userId) return json({ error: "AUTH_REQUIRED" }, 401);

  // Same RPC, same token, same arguments as the panel: the database stays the single source of truth.
  const rpc = await fetch(supabaseUrl + "/rest/v1/rpc/plugin_entitlement", {
    method: "POST",
    headers: { apikey: apiKey, authorization: "Bearer " + token, "content-type": "application/json", accept: "application/vnd.pgrst.object+json" },
    body: JSON.stringify({ p_device_id: deviceId, p_platform: platform, p_plugin_version: pluginVersion }),
    signal: AbortSignal.timeout(10000)
  });
  const entitlement = await rpc.json().catch(() => null);
  if (!rpc.ok || !entitlement || typeof entitlement !== "object") {
    return json({ error: "ENTITLEMENT_FAILED", message: entitlement?.message || null }, rpc.status >= 400 && rpc.status < 500 ? rpc.status : 502);
  }
  if (entitlement.session_replaced) return json({ entitlement, signed: null });

  const key = await signingKey(supabaseUrl, serviceKey).catch(() => null);
  if (!key) return json({ error: "SIGNING_NOT_CONFIGURED" }, 503);

  const payload = canonicalPayload({ keyId: key.keyId, userId, deviceId, platform, pluginVersion, entitlement, now: new Date() });
  const signature = await signPayload(crypto.subtle, key.key, payload);
  return json({ entitlement, signed: { payload, signature, key_id: key.keyId } });
});
