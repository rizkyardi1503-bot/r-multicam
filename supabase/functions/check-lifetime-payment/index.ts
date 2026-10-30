import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// "Check payment" button (website + Premiere panel): asks Midtrans about this customer's recent orders
// and activates the lifetime license when one was paid. Safety net for a missed webhook.
// Changes vs. the first production version:
//  - the user is verified with Supabase Auth (before: the JWT payload was decoded without verification);
//  - CORS allows the Premiere panel (bearer-token auth, no cookies);
//  - a paid order is never downgraded, and every write is checked;
//  - Midtrans is asked about all relevant orders at once (before: one after another, up to 10 x 10 s while clients
//    give up after 30 s); orders expired/denied/failed more than 25 h ago are not asked about at all;
//  - a Snap checkout that was never opened (Midtrans: JSON status_code 404) and is older than 24 h is stored as "expire" (Midtrans
//    sends no notification for it, so it used to stay "created" forever);
//  - activating here sends the owner's purchase_paid alert (the webhook skips it once the order is activated).

// Statuses the orders table accepts (plugin_payment_orders_status_check); anything else keeps the stored status.
const STORABLE = new Set(["created", "pending", "authorize", "capture", "settlement", "deny", "cancel", "expire", "failure",
  "refund", "partial_refund", "chargeback", "partial_chargeback", "failed"]);

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};
// Unpaid orders in these states cannot become paid any more once their Snap link expired (24 h after creation).
// "cancel" is not here: a newer checkout closes the previous one as "cancel" in our table only, and its Snap page can
// still be paid in an old tab.
const CLOSED = new Set(["expire", "deny", "failure", "failed"]);
const DAY_MS = 24 * 3600 * 1000;
const SKIP_AFTER_MS = 25 * 3600 * 1000;
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
  // Owner alerts. 409: the purchase_paid alert for this order already exists (unique index), i.e. another path sent it.
  const ownerAlert = async (event_name: string, metadata: Record<string, unknown>) => {
    const al = await rest("website_analytics_events", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ event_name, user_id: userId, path: "/", metadata }) }).catch(() => null);
    if (!al || (!al.ok && al.status !== 409)) console.error("owner alert not stored", event_name, String(metadata.order_id || ""), al ? al.status : "network");
  };

  const pq = await rest("plugin_profiles?select=license_status,lifetime_order_id&user_id=eq." + encodeURIComponent(userId));
  if (!pq.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const prof = (await pq.json().catch(() => []))?.[0] || null;
  const firstOrder: string | null = prof && prof.license_status === "lifetime" && prof.lifetime_order_id ? prof.lifetime_order_id : null;

  const oq = await rest("plugin_payment_orders?user_id=eq." + encodeURIComponent(userId) + "&select=*&order=created_at.desc&limit=10");
  if (!oq.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const orders: any[] = await oq.json();
  if (!orders?.length) return json({ paid: false, status: "no_order" });

  const age = (o: any) => Date.now() - Date.parse(o.created_at);
  // Nothing to learn from Midtrans: an unpaid order closed long ago, or a paid order once the account is lifetime
  // (the answer is "paid" either way; its duplicate alert, if any, was sent when it was recorded as paid).
  const ask = orders.filter((o) => !(firstOrder && o.paid_at) && !(!o.paid_at && CLOSED.has(o.status) && age(o) > SKIP_AFTER_MS));
  // All at once; results are handled newest first as before. null = Midtrans unreachable or an error answer.
  const answers = await Promise.all(ask.map(async (order) => {
    const mr = await fetch("https://api.midtrans.com/v2/" + encodeURIComponent(order.order_id) + "/status", {
      headers: { accept: "application/json", authorization: "Basic " + b64(serverKey + ":") },
      signal: AbortSignal.timeout(10000)
    }).catch(() => null);
    if (!mr) return null;
    const body = await mr.json().catch(() => null);
    // "Never opened" only when Midtrans itself says so (JSON status_code 404); a bare HTTP 404 (gateway, outage) is unknown.
    if (body && String(body.status_code) === "404") return { status_code: "404" };
    if (!mr.ok) return null;
    return body || {};
  }));

  let lastStatus = "pending";
  for (let i = 0; i < ask.length; i++) {
    const order = ask[i], m = answers[i];
    if (!m) continue;
    if (String(m.status_code) === "404") { // checkout never opened
      if (order.status === "created" && !order.paid_at && age(order) > DAY_MS) {
        const ex = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(order.order_id) + "&status=eq.created&paid_at=is.null", {
          method: "PATCH",
          body: JSON.stringify({ status: "expire", updated_at: new Date().toISOString() })
        }).catch(() => null);
        if (!ex || !ex.ok) console.error("stale order not expired", order.order_id, ex ? ex.status : "network");
      }
      continue;
    }
    const status = String(m.transaction_status || "");
    const fraud = m.fraud_status ? String(m.fraud_status) : null;
    const amountMatches = Number(m.gross_amount) === Number(order.gross_amount_idr);
    const success = amountMatches && (status === "settlement" || status === "capture") && (!fraud || fraud.toLowerCase() === "accept") && String(m.status_code) === "200";
    const now = new Date().toISOString();
    if (status) lastStatus = status;
    const duplicate = success && !!firstOrder && firstOrder !== order.order_id;

    if (!order.paid_at || success) {
      // A non-success answer ("pending"...) only updates an order that is still unpaid in the database: the webhook may
      // have stored the payment since the order was read, and that must never be overwritten or downgraded.
      const fields: Record<string, unknown> = {
        status: STORABLE.has(status) ? status : order.status,
        midtrans_transaction_id: m.transaction_id || order.midtrans_transaction_id,
        payment_type: m.payment_type || order.payment_type,
        fraud_status: fraud,
        updated_at: now
      };
      if (success) {
        fields.paid_at = order.paid_at || now;
        fields.lifetime_activated_at = !duplicate ? (order.lifetime_activated_at || now) : order.lifetime_activated_at;
      }
      const up = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(order.order_id) + (success ? "" : "&paid_at=is.null"), {
        method: "PATCH",
        body: JSON.stringify(fields)
      });
      if (!up.ok && success) return json({ error: "LICENSE_ACTIVATION_FAILED", order_id: order.order_id }, 500);
    }

    if (duplicate) {
      if (!order.paid_at) await ownerAlert("purchase_duplicate", { order_id: order.order_id, first_order_id: firstOrder, gross_amount_idr: Number(order.gross_amount_idr) });
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
      // This request activated the order (it was not activated when read): tell the owner, once.
      if (!order.lifetime_activated_at) await ownerAlert("purchase_paid", { order_id: order.order_id, gross_amount_idr: Number(order.gross_amount_idr), via: "check_payment" });
      return json({ paid: true, activated: true, status, order_id: order.order_id });
    }
  }
  if (firstOrder) return json({ paid: true, activated: true, status: "settlement", order_id: firstOrder });
  return json({ paid: false, status: lastStatus });
});
