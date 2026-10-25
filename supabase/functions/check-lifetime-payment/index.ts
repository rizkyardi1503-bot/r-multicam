import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// "Check payment" button (website + Premiere panel): asks Midtrans about this customer's recent orders
// and activates the lifetime license when one was paid. Safety net for a missed webhook.
// Changes vs. the first production version:
//  - the user is verified with Supabase Auth (before: the JWT payload was decoded without verification);
//  - CORS allows the Premiere panel (bearer-token auth, no cookies);
//  - a paid order is never downgraded, and every write is checked.

// Statuses the orders table accepts (plugin_payment_orders_status_check); anything else keeps the stored status.
const STORABLE = new Set(["created", "pending", "authorize", "capture", "settlement", "deny", "cancel", "expire", "failure",
  "refund", "partial_refund", "chargeback", "partial_chargeback", "failed"]);

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};
const b64 = (s: string) => btoa(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);

  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY_PRODUCTION");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serverKey || !supabaseUrl || !serviceKey) return json({ error: "SERVER_NOT_CONFIGURED" }, 503);

  const identity = await fetch(supabaseUrl + "/auth/v1/user", { headers: { apikey: serviceKey, authorization: "Bearer " + token }, signal: AbortSignal.timeout(10000) });
  if (!identity.ok) return json({ error: "AUTH_REQUIRED" }, 401);
  const userId: string = (await identity.json()).id || "";
  if (!userId) return json({ error: "AUTH_REQUIRED" }, 401);

  const headers = { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" };
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(supabaseUrl + "/rest/v1/" + path, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });

  // An account already lifetime from another order: a further paid order is a duplicate payment. It is recorded as
  // paid (not as the activation, so no affiliate commission), the first activation is kept and the owner is alerted,
  // exactly like the webhook does.
  const pq = await rest("plugin_profiles?select=license_status,lifetime_order_id&user_id=eq." + encodeURIComponent(userId));
  if (!pq.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const prof = (await pq.json().catch(() => []))?.[0] || null;
  const firstOrder: string | null = prof && prof.license_status === "lifetime" && prof.lifetime_order_id ? prof.lifetime_order_id : null;

  const oq = await rest("plugin_payment_orders?user_id=eq." + encodeURIComponent(userId) + "&select=*&order=created_at.desc&limit=10");
  if (!oq.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const orders: any[] = await oq.json();
  if (!orders?.length) return json({ paid: false, status: "no_order" });

  let lastStatus = "pending";
  for (const order of orders) {
    const mr = await fetch("https://api.midtrans.com/v2/" + encodeURIComponent(order.order_id) + "/status", {
      headers: { accept: "application/json", authorization: "Basic " + b64(serverKey + ":") },
      signal: AbortSignal.timeout(10000)
    }).catch(() => null);
    if (!mr || !mr.ok) continue;
    const m = await mr.json().catch(() => ({}));
    if (String(m.status_code) === "404") continue; // checkout never opened
    const status = String(m.transaction_status || "");
    const fraud = m.fraud_status ? String(m.fraud_status) : null;
    const amountMatches = Number(m.gross_amount) === Number(order.gross_amount_idr);
    const success = amountMatches && (status === "settlement" || status === "capture") && (!fraud || fraud.toLowerCase() === "accept") && String(m.status_code) === "200";
    const now = new Date().toISOString();
    if (status) lastStatus = status;
    const duplicate = success && !!firstOrder && firstOrder !== order.order_id;

    if (!order.paid_at || success) {
      const up = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(order.order_id), {
        method: "PATCH",
        body: JSON.stringify({
          status: STORABLE.has(status) ? status : order.status,
          midtrans_transaction_id: m.transaction_id || order.midtrans_transaction_id,
          payment_type: m.payment_type || order.payment_type,
          fraud_status: fraud,
          paid_at: success ? (order.paid_at || now) : order.paid_at,
          lifetime_activated_at: success && !duplicate ? (order.lifetime_activated_at || now) : order.lifetime_activated_at,
          updated_at: now
        })
      });
      if (!up.ok && success) return json({ error: "LICENSE_ACTIVATION_FAILED", order_id: order.order_id }, 500);
    }

    if (duplicate) {
      if (!order.paid_at) {
        const al = await rest("website_analytics_events", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ event_name: "purchase_duplicate", user_id: userId, path: "/", metadata: { order_id: order.order_id, first_order_id: firstOrder, gross_amount_idr: Number(order.gross_amount_idr) } }) }).catch(() => null);
        if (!al || !al.ok) console.error("owner alert not stored", "purchase_duplicate", order.order_id, al ? al.status : "network");
      }
      continue; // the license already comes from the first order
    }

    if (success) {
      const pr = await rest("plugin_profiles?user_id=eq." + encodeURIComponent(userId) + "&license_status=neq.blocked", {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ license_status: "lifetime", lifetime_activated_at: order.lifetime_activated_at || now, lifetime_order_id: order.order_id, updated_at: now })
      });
      if (!pr.ok) return json({ error: "LICENSE_ACTIVATION_FAILED", order_id: order.order_id }, 500);
      const rows = await pr.json().catch(() => []);
      if (!rows.length) return json({ error: "This account is blocked. Contact support.", order_id: order.order_id }, 403);
      return json({ paid: true, activated: true, status, order_id: order.order_id });
    }
  }
  if (firstOrder) return json({ paid: true, activated: true, status: "settlement", order_id: firstOrder });
  return json({ paid: false, status: lastStatus });
});
