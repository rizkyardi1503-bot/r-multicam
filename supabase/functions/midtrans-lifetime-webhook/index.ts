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
const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const REFUND = new Set(["refund", "partial_refund", "chargeback", "partial_chargeback"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY_PRODUCTION");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serverKey || !supabaseUrl || !serviceKey) return json({ error: "WEBHOOK_NOT_CONFIGURED" }, 503);

  const body = await req.json().catch(() => null);
  if (!body?.order_id || !body?.signature_key) return json({ error: "BAD_NOTIFICATION" }, 400);

  const expected = hex(await crypto.subtle.digest("SHA-512", enc.encode(String(body.order_id) + String(body.status_code) + String(body.gross_amount) + serverKey)));
  if (expected.toLowerCase() !== String(body.signature_key).toLowerCase()) return json({ error: "INVALID_SIGNATURE" }, 401);

  const headers = { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" };
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(supabaseUrl + "/rest/v1/" + path, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
  const orderId = encodeURIComponent(String(body.order_id));

  const q = await rest("plugin_payment_orders?order_id=eq." + orderId + "&select=*");
  if (!q.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const order = (await q.json())?.[0];
  if (!order) return json({ ok: true, ignored: "ORDER_NOT_FOUND" });

  if (Number(body.gross_amount) !== Number(order.gross_amount_idr)) return json({ error: "AMOUNT_MISMATCH" }, 400);

  const status = String(body.transaction_status || "failed");
  const fraud = body.fraud_status ? String(body.fraud_status) : null;
  const success = (status === "settlement" || status === "capture") && (!fraud || fraud.toLowerCase() === "accept") && String(body.status_code) === "200";
  const refunded = REFUND.has(status);
  const alreadyPaid = !!order.paid_at;
  const now = new Date().toISOString();

  // Ignore stale notifications for a paid order unless they report a refund/chargeback.
  if (!alreadyPaid || success || refunded) {
    const up = await rest("plugin_payment_orders?order_id=eq." + orderId, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        status,
        midtrans_transaction_id: body.transaction_id || order.midtrans_transaction_id || null,
        payment_type: body.payment_type || order.payment_type || null,
        fraud_status: fraud,
        paid_at: success ? (order.paid_at || now) : order.paid_at,
        lifetime_activated_at: success ? (order.lifetime_activated_at || now) : order.lifetime_activated_at,
        updated_at: now
      })
    });
    if (!up.ok) return json({ error: "ORDER_UPDATE_FAILED" }, 500);
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
      await rest("website_analytics_events", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ event_name: "purchase_paid_not_activated", user_id: order.user_id, path: "/", metadata: { order_id: order.order_id } })
      }).catch(() => null);
      return json({ ok: true, warning: "PROFILE_NOT_FOUND_OR_BLOCKED" });
    }
    if (!order.lifetime_activated_at) {
      await rest("website_analytics_events", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({ event_name: "purchase_paid", user_id: order.user_id, path: "/", metadata: { order_id: order.order_id, gross_amount_idr: Number(order.gross_amount_idr) } })
      }).catch(() => null);
    }
  } else if (refunded) {
    await rest("website_analytics_events", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ event_name: "purchase_refunded", user_id: order.user_id, path: "/", metadata: { order_id: order.order_id, status, gross_amount_idr: Number(order.gross_amount_idr) } })
    }).catch(() => null);
  }
  return json({ ok: true });
});
