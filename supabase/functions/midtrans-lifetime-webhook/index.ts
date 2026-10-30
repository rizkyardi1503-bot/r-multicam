import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Midtrans HTTP notification for lifetime orders.
// "Verify JWT" must stay OFF for this function (Midtrans does not send a Supabase JWT).
// Changes vs. the first production version:
//  - every database write is checked; on failure we answer 500 so Midtrans retries the notification
//    (before, a failed write still answered {ok:true} and the customer paid without getting a license);
//  - a paid order is never downgraded by a later/out-of-order notification (e.g. "pending" after "settlement");
//  - refunds and chargebacks are recorded on the order and logged for the owner (no automatic revoke);
//  - unknown order ids (Midtrans dashboard test notifications) are acknowledged instead of retried forever.

const enc = new TextEncoder();
// Constant-time comparison for the Midtrans signature (no early exit on the first differing character).
const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const REFUND = new Set(["refund", "partial_refund", "chargeback", "partial_chargeback"]);
// Statuses the orders table accepts (plugin_payment_orders_status_check). Anything else keeps the stored status, so an
// unexpected value is acknowledged instead of failing the write and making Midtrans retry forever.
const STORABLE = new Set(["created", "pending", "authorize", "capture", "settlement", "deny", "cancel", "expire", "failure",
  "refund", "partial_refund", "chargeback", "partial_chargeback", "failed"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY_PRODUCTION");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serverKey || !supabaseUrl || !serviceKey) return json({ error: "WEBHOOK_NOT_CONFIGURED" }, 503);

  const body = await req.json().catch(() => null);
  if (!body?.order_id || !body?.signature_key) return json({ error: "BAD_NOTIFICATION" }, 400);

  const expected = hex(await crypto.subtle.digest("SHA-512", enc.encode(String(body.order_id) + String(body.status_code) + String(body.gross_amount) + serverKey)));
  if (!safeEqual(expected.toLowerCase(), String(body.signature_key).toLowerCase())) return json({ error: "INVALID_SIGNATURE" }, 401);

  const headers = { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" };
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(supabaseUrl + "/rest/v1/" + path, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
  const orderId = encodeURIComponent(String(body.order_id));
  // Owner alerts (refund, paid but not activated, duplicate payment). A failed write is logged, never retried by Midtrans.
  // purchase_paid is sent by whichever path activates the order first (this webhook, check-lifetime-payment or the
  // checkout reconcile); a unique index allows one per order, so 409 means another path already sent it.
  const alert = async (event_name: string, user_id: string, metadata: Record<string, unknown>) => {
    const r = await rest("website_analytics_events", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ event_name, user_id, path: "/", metadata })
    }).catch(() => null);
    if (!r || (!r.ok && r.status !== 409)) console.error("owner alert not stored", event_name, String(metadata.order_id || ""), r ? r.status : "network");
  };

  const q = await rest("plugin_payment_orders?order_id=eq." + orderId + "&select=*");
  if (!q.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const order = (await q.json())?.[0];
  if (!order) return json({ ok: true, ignored: "ORDER_NOT_FOUND" });

  if (Number(body.gross_amount) !== Number(order.gross_amount_idr)) return json({ error: "AMOUNT_MISMATCH" }, 400);

  const status = String(body.transaction_status || "failed");
  if (!STORABLE.has(status)) console.warn("unknown Midtrans status kept out of the order", status, String(body.order_id));
  const storedStatus = STORABLE.has(status) ? status : order.status;
  const fraud = body.fraud_status ? String(body.fraud_status) : null;
  const success = (status === "settlement" || status === "capture") && (!fraud || fraud.toLowerCase() === "accept") && String(body.status_code) === "200";
  const refunded = REFUND.has(status);
  const alreadyPaid = !!order.paid_at;
  const now = new Date().toISOString();

  // A second paid order for an account that is already lifetime from another order (two checkouts paid): it is
  // recorded as paid but not as the activation (no affiliate commission), the first activation is kept and the owner
  // is told to refund it in Midtrans.
  let duplicateOf: string | null = null;
  if (success) {
    const cur = await rest("plugin_profiles?select=license_status,lifetime_order_id&user_id=eq." + encodeURIComponent(order.user_id));
    if (!cur.ok) return json({ error: "PROFILE_LOOKUP_FAILED" }, 500); // Midtrans retries
    const prof = (await cur.json().catch(() => []))?.[0] || null;
    if (prof && prof.license_status === "lifetime" && prof.lifetime_order_id && prof.lifetime_order_id !== order.order_id) duplicateOf = prof.lifetime_order_id;
  }

  // Ignore stale notifications for a paid order unless they report a refund/chargeback.
  if (!alreadyPaid || success || refunded) {
    const up = await rest("plugin_payment_orders?order_id=eq." + orderId, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        status: storedStatus,
        midtrans_transaction_id: body.transaction_id || order.midtrans_transaction_id || null,
        payment_type: body.payment_type || order.payment_type || null,
        fraud_status: fraud,
        paid_at: success ? (order.paid_at || now) : order.paid_at,
        lifetime_activated_at: success && !duplicateOf ? (order.lifetime_activated_at || now) : order.lifetime_activated_at,
        updated_at: now
      })
    });
    // 409: a "pending" notice for an order that checkout already closed while a newer one is open (one open order
    // per customer). Nothing to activate; acknowledge so Midtrans does not retry forever.
    if (up.status === 409 && !success && !refunded) {
      console.warn("order status not stored (another open order)", status, String(body.order_id));
      return json({ ok: true, ignored: "ANOTHER_OPEN_ORDER" });
    }
    if (!up.ok) return json({ error: "ORDER_UPDATE_FAILED" }, 500);
  }

  if (success && duplicateOf) {
    if (!alreadyPaid) await alert("purchase_duplicate", order.user_id, { order_id: order.order_id, first_order_id: duplicateOf, gross_amount_idr: Number(order.gross_amount_idr) });
    return json({ ok: true, warning: "DUPLICATE_PAYMENT" });
  }

  if (success) {
    const pr = await rest("plugin_profiles?user_id=eq." + encodeURIComponent(order.user_id) + "&license_status=neq.blocked", {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ license_status: "lifetime", lifetime_activated_at: order.lifetime_activated_at || now, lifetime_order_id: order.order_id, updated_at: now })
    });
    if (!pr.ok) return json({ error: "LICENSE_ACTIVATION_FAILED" }, 500);
    const rows = await pr.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) {
      // Paid, but the profile is missing or blocked: retrying will not help, so record it for the owner.
      await alert("purchase_paid_not_activated", order.user_id, { order_id: order.order_id });
      return json({ ok: true, warning: "PROFILE_NOT_FOUND_OR_BLOCKED" });
    }
    if (!order.lifetime_activated_at) await alert("purchase_paid", order.user_id, { order_id: order.order_id, gross_amount_idr: Number(order.gross_amount_idr), via: "webhook" });
  } else if (refunded) {
    await alert("purchase_refunded", order.user_id, { order_id: order.order_id, status, gross_amount_idr: Number(order.gross_amount_idr) });
  }
  return json({ ok: true });
});
