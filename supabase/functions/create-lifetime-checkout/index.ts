import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Creates (or re-uses) a Midtrans Snap checkout for the lifetime license.
// Changes vs. the first production version:
//  - CORS: the Premiere panel (CEP, file:// origin "null") can call this function. Auth is a bearer
//    token, not a cookie, so allowing any origin does not widen access;
//  - an open checkout from the last 23 h with the same price/promo is re-used instead of creating a new
//    Midtrans order on every click (prevents paying twice from two tabs);
//  - before creating a new order, recent orders are checked with Midtrans; an order that was already paid
//    activates the license instead of asking the customer to pay again;
//  - prices are IDR only: the response carries no USD figure (panels since v2.3.11.9 show gross_amount_idr);
//  - a never-opened Snap checkout older than 24 h is closed as "expire" (Midtrans sends nothing for it);
//  - activating a missed payment here sends the owner's purchase_paid alert (the webhook then skips it);
//  - an order already recorded as paid and not refunded (for example the licence write failed) activates instead of
//    opening a new charge, and orders closed as "cancel" less than 25 h ago are asked about too (old Snap tab).
// Needs the column added in supabase/migrations/20261015_payment_and_version_hardening.sql (checkout_url).

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};

// One price for every country: Rp2.000.000 (all Midtrans methods), charged and shown in IDR.
const LIFETIME_IDR = 2000000;
// plugin_payment_orders.display_price_usd is a NOT NULL column left from the retired USD-quoted checkout (fx_* columns
// stay null, so no CHECK uses it). Nothing shows or charges it; new rows keep the last value for consistent reports.
const LEGACY_DISPLAY_PRICE_USD = 120;
const REUSE_MS = 23 * 3600 * 1000;
const SNAP_EXPIRY_MS = 24 * 3600 * 1000;
// Midtrans statuses after which an order can no longer be paid.
const FINAL = new Set(["expire", "cancel", "deny", "failure"]);
const REFUND = new Set(["refund", "partial_refund", "chargeback", "partial_chargeback"]);
// An order this function closed as "cancel" is closed in our table only: its Snap page stays payable until it expires.
const CANCEL_PAYABLE_MS = 25 * 3600 * 1000;
// Public webhook address (SUPABASE_URL inside a function is the API gateway and may not be the public host).
const WEBHOOK_URL = "https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/midtrans-lifetime-webhook";
const b64 = (s: string) => btoa(s);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "AUTH_REQUIRED" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY_PRODUCTION");
  if (!serverKey) return json({ error: "PAYMENT_PRODUCTION_NOT_CONFIGURED" }, 503);
  const svc = { apikey: serviceKey, authorization: "Bearer " + serviceKey, "content-type": "application/json" };
  const rest = (path: string, init: RequestInit = {}) =>
    fetch(supabaseUrl + "/rest/v1/" + path, { ...init, headers: { ...svc, ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });
  const midtransAuth = { accept: "application/json", authorization: "Basic " + b64(serverKey + ":") };

  const identity = await fetch(supabaseUrl + "/auth/v1/user", {
    headers: { apikey: serviceKey, authorization: "Bearer " + token },
    signal: AbortSignal.timeout(10000)
  });
  if (!identity.ok) return json({ error: "AUTH_REQUIRED" }, 401);
  const customer = await identity.json();
  if (!customer.id || !customer.email || !customer.email_confirmed_at) return json({ error: "Confirm your email before purchasing." }, 403);
  const userId: string = customer.id;
  const email: string = customer.email;

  const bootstrap = await rest("plugin_profiles?on_conflict=user_id", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, email, license_status: "trial" })
  });
  if (!bootstrap.ok) return json({ error: "ACCOUNT_SETUP_FAILED" }, 500);
  const account = await rest("plugin_profiles?select=license_status&user_id=eq." + encodeURIComponent(userId));
  if (!account.ok) return json({ error: "ACCOUNT_SETUP_FAILED" }, 500);
  const profiles = await account.json();
  if (!profiles.length) return json({ error: "ACCOUNT_SETUP_FAILED" }, 500);
  if (profiles[0].license_status === "blocked") return json({ error: "This account is blocked. Contact support." }, 403);
  if (profiles[0].license_status === "lifetime") return json({ error: "Your lifetime license is already active." }, 409);

  const ownerAlert = async (event_name: string, metadata: Record<string, unknown>) => {
    const al = await rest("website_analytics_events", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ event_name, user_id: userId, path: "/", metadata }) }).catch(() => null);
    // 409: purchase_paid already sent for this order by another path (unique index on purchase_paid per order).
    if (!al || (!al.ok && al.status !== 409)) console.error("owner alert not stored", event_name, String(metadata.order_id || ""), al ? al.status : "network");
  };
  // Grants the licence from an order recorded as paid. The order is stamped only after the licence write worked, as in
  // the webhook: the stamp earns the affiliate commission, and an unstamped order still gets its alert on the next try.
  const activate = async (o: any) => {
    const now = new Date().toISOString();
    const b = await rest("plugin_profiles?user_id=eq." + encodeURIComponent(userId) + "&license_status=neq.blocked", { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ license_status: "lifetime", lifetime_activated_at: o.lifetime_activated_at || now, lifetime_order_id: o.order_id, updated_at: now }) });
    if (!b.ok) return json({ error: "LICENSE_ACTIVATION_FAILED", order_id: o.order_id }, 500);
    if (!(await b.json().catch(() => [])).length) {
      await ownerAlert("purchase_paid_not_activated", { order_id: o.order_id });
      return json({ error: "This account is blocked. Contact support." }, 403);
    }
    if (!o.lifetime_activated_at) {
      const stamp = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(o.order_id) + "&lifetime_activated_at=is.null", { method: "PATCH", body: JSON.stringify({ lifetime_activated_at: now, updated_at: now }) });
      if (!stamp.ok) return json({ error: "LICENSE_ACTIVATION_FAILED", order_id: o.order_id }, 500);
      await ownerAlert("purchase_paid", { order_id: o.order_id, gross_amount_idr: Number(o.gross_amount_idr), via: "checkout_reconcile" });
    }
    return json({ error: "Your payment was already received. Your lifetime license is now active.", activated: true }, 409);
  };

  // Look at this customer's orders first (newest 10).
  const recentQ = await rest("plugin_payment_orders?select=order_id,status,gross_amount_idr,affiliate_code,checkout_url,created_at,paid_at,lifetime_activated_at&user_id=eq." +
    encodeURIComponent(userId) + "&order=created_at.desc&limit=10");
  if (!recentQ.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const recent: any[] = await recentQ.json();
  const askMidtrans = (o: any) => fetch("https://api.midtrans.com/v2/" + encodeURIComponent(o.order_id) + "/status", { headers: midtransAuth, signal: AbortSignal.timeout(10000) })
    .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => ({})) })).catch(() => null);

  // Already recorded as paid and the money was not returned, yet the account is not lifetime (the licence write failed,
  // or the account was blocked at the time): activate from the oldest such order, never charge again. Midtrans is asked
  // first because a refund notice can be lost; if it cannot answer, the recorded payment stands.
  for (const o of recent.filter((x) => x.paid_at && !REFUND.has(x.status) && x.status !== "cancel").reverse()) {
    const answer = await askMidtrans(o);
    const st = answer && answer.ok ? String(answer.body.transaction_status || "") : "";
    if (!REFUND.has(st) && st !== "cancel") return await activate(o);
    const back = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(o.order_id), { method: "PATCH", body: JSON.stringify({ status: st, updated_at: new Date().toISOString() }) });
    if (!back.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
    await ownerAlert("purchase_refunded", { order_id: o.order_id, status: st, gross_amount_idr: Number(o.gross_amount_idr) });
  }
  const unpaid = recent.filter((o) => !o.paid_at && (o.status === "created" || o.status === "pending" || (o.status === "cancel" && Date.now() - Date.parse(o.created_at) < CANCEL_PAYABLE_MS)));

  // Ask Midtrans about each one, all at once (clients give up after 30 s). A payment that went through but was never
  // recorded (missed webhook, or an old tab of a closed order) activates instead of charging again. o.mt: "pending"
  // (payment started), "none" (Snap page never used), a final status, or "unknown" when Midtrans could not be reached.
  const answers = await Promise.all(unpaid.map(askMidtrans));
  for (let i = 0; i < unpaid.length; i++) {
    const o = unpaid[i], mr = answers[i];
    const m: any = mr ? mr.body : {};
    // "Never opened" only when Midtrans says so in its JSON (status_code 404); a bare HTTP 404 or error is unknown.
    if (mr && String(m.status_code) === "404") { o.mt = "none"; continue; }
    if (!mr || !mr.ok) { o.mt = "unknown"; continue; }
    const st = String(m.transaction_status || "");
    const fraud = m.fraud_status ? String(m.fraud_status).toLowerCase() : null;
    if ((st === "settlement" || st === "capture") && (!fraud || fraud === "accept") && String(m.status_code) === "200" && Number(m.gross_amount) === Number(o.gross_amount_idr)) {
      const now = new Date().toISOString();
      const a = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(o.order_id), { method: "PATCH", body: JSON.stringify({ status: st, paid_at: now, midtrans_transaction_id: m.transaction_id || null, payment_type: m.payment_type || null, fraud_status: fraud, updated_at: now }) });
      if (!a.ok) return json({ error: "LICENSE_ACTIVATION_FAILED", order_id: o.order_id }, 500);
      return await activate(o);
    }
    // A card payment Midtrans is still reviewing (authorize, or capture/settlement held for a fraud challenge) is a
    // payment in progress, like pending: continue it, never charge again. Other states (paid with a different amount,
    // refunded...) stay "unknown" and block a new checkout until the owner looks at the order.
    const reviewing = st === "authorize" || ((st === "capture" || st === "settlement") && fraud === "challenge");
    o.mt = st === "pending" || reviewing ? "pending" : (FINAL.has(st) ? st : "unknown");
  }

  // After the paid checks: a saved promo code that is no longer approved must not stop a paid customer's activation.
  const input = (await req.json().catch(() => null)) || {};
  // The panel sends no promo_code at all: it continues any payable open checkout (keeping that order's promo code).
  // The website always sends promo_code ("" = standard price on purpose).
  const keepOpen = !(input && typeof input === "object" && "promo_code" in input);
  const promo = typeof input.promo_code === "string" ? input.promo_code.trim().toUpperCase() : "";
  let affiliate: { user_id: string; code: string } | null = null;
  if (promo) {
    if (!/^[A-Z0-9]{3,40}$/.test(promo)) return json({ error: "Invalid promo code." }, 400);
    const lookup = await rest("plugin_affiliates?select=user_id,code&status=eq.approved&code=eq." + encodeURIComponent(promo));
    if (!lookup.ok) return json({ error: "Promo service is temporarily unavailable." }, 503);
    affiliate = (await lookup.json())[0] || null;
    if (!affiliate) return json({ error: "Promo code is invalid or is not approved yet." }, 400);
    if (affiliate.user_id === userId) return json({ error: "You cannot use your own affiliate code." }, 400);
  }
  const discountPercent = affiliate ? 10 : 0;
  const grossAmount = Math.round(LIFETIME_IDR * (1 - discountPercent / 100));

  const reply = (orderId: string, checkoutUrl: string, reused: boolean, amount = grossAmount, code: string | null = affiliate?.code || null) => json({
    order_id: orderId,
    checkout_url: checkoutUrl,
    reused,
    display_price_idr: LIFETIME_IDR,
    charge_currency: "IDR",
    gross_amount_idr: amount,
    discount_percent: code ? 10 : 0,
    net_price_idr: amount,
    promo_code: code,
    environment: "production"
  });

  // Re-use an open checkout (still payable, less than 23 h old): same price and promo code, or any one when the panel
  // asks without a promo code. A payment already started (bank transfer, QRIS) is always continued, never replaced, even
  // on an order closed as "cancel"; a closed order nobody started stays closed.
  const payable = (o: any) => o.checkout_url && (o.mt === "pending" || (o.mt === "none" && o.status !== "cancel")) && Date.now() - Date.parse(o.created_at) < REUSE_MS;
  const reusable = unpaid.find((o) => payable(o) && o.mt === "pending") ||
    unpaid.find((o) => payable(o) && (keepOpen || (Number(o.gross_amount_idr) === grossAmount && (o.affiliate_code || null) === (affiliate?.code || null))));
  if (reusable) return reply(reusable.order_id, reusable.checkout_url, true, Number(reusable.gross_amount_idr), reusable.affiliate_code || null);

  // One open checkout per customer: other unpaid orders are closed before a new one is created (another price or
  // promo code, or an old one). A started payment blocks instead of being cancelled. A Snap page that was never used
  // cannot be revoked at Midtrans and stays payable until it expires (24 h); if both are paid, the webhook keeps the
  // first activation and alerts the owner (purchase_duplicate) to refund the second.
  const busy = (msg: string) => json({ error: msg, message: msg, code: "PREVIOUS_CHECKOUT_OPEN" }, 409);
  for (const o of unpaid) {
    if (o.mt === "unknown") return busy("The payment provider could not confirm your previous checkout. Please try again in a few minutes.");
    if (o.mt === "pending") return busy("You already started a payment for your previous checkout. Finish it, or wait until it expires (up to 24 hours), then try again.");
  }
  for (const o of unpaid) {
    if (o.status === "cancel") continue; // already closed in our table
    const up = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(o.order_id) + "&paid_at=is.null&status=eq." + encodeURIComponent(o.status), {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      // Never opened: "expire" once its Snap link has expired, otherwise "cancel" (closed by this new checkout).
      body: JSON.stringify({ status: o.mt === "none" ? (Date.now() - Date.parse(o.created_at) > SNAP_EXPIRY_MS ? "expire" : "cancel") : o.mt, updated_at: new Date().toISOString() })
    });
    if (!up.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
    // Paid or started a moment ago (webhook in between): stop; the next attempt sees it.
    if (!((await up.json().catch(() => [])) || []).length) return busy("Your previous checkout changed a moment ago. Please try again.");
  }

  const orderId = ("RPRO-" + crypto.randomUUID()).slice(0, 50);
  const insert = await rest("plugin_payment_orders", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: userId, order_id: orderId, product_code: "lifetime_v1",
      display_price_usd: LEGACY_DISPLAY_PRICE_USD, charge_currency: "IDR", gross_amount_idr: grossAmount,
      fx_rate_usd_idr: null, fx_provider: null, fx_rate_updated_at: null, fx_quoted_at: null,
      affiliate_user_id: affiliate?.user_id || null, affiliate_code: affiliate?.code || null,
      discount_percent: discountPercent, affiliate_commission_percent: affiliate ? 20 : 0, status: "created"
    })
  });
  // 409: another request created this customer's open order a moment ago (unique index on open orders).
  if (insert.status === 409) return busy("A checkout is already being prepared. Please wait a few seconds and try again.");
  if (!insert.ok) return json({ error: "ORDER_CREATE_FAILED" }, 500);

  // Every order notifies our webhook directly, whatever "Payment Notification URL" says in the Midtrans
  // dashboard (X-Override-Notification replaces the dashboard URL for this transaction only).
  const mid = await fetch("https://app.midtrans.com/snap/v1/transactions", {
    method: "POST",
    headers: { ...midtransAuth, "content-type": "application/json", "x-override-notification": WEBHOOK_URL },
    signal: AbortSignal.timeout(20000),
    body: JSON.stringify({
      transaction_details: { order_id: orderId, gross_amount: grossAmount },
      item_details: [{ id: "rproject-lifetime", price: grossAmount, quantity: 1, name: "R Project Multicam AI Lifetime License" }],
      customer_details: { email },
      expiry: { unit: "hours", duration: 24 }
    })
  }).catch(() => null);
  const data = mid ? await mid.json().catch(() => ({})) : {};
  if (!mid || !mid.ok || !data.redirect_url) {
    await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(orderId), { method: "PATCH", body: JSON.stringify({ status: "failed", updated_at: new Date().toISOString() }) });
    return json({ error: "MIDTRANS_CREATE_FAILED", message: "Payment provider is temporarily unavailable." }, 502);
  }
  await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(orderId), { method: "PATCH", body: JSON.stringify({ checkout_url: data.redirect_url }) });

  await rest("website_analytics_events", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({ event_name: "checkout_created", user_id: userId, path: "/", metadata: { order_id: orderId, price_idr: grossAmount, discount_percent: discountPercent } })
  }).catch(() => null);

  return reply(orderId, data.redirect_url, false);
});
