import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Creates (or re-uses) a Midtrans Snap checkout for the lifetime license.
// Changes vs. the first production version:
//  - CORS: the Premiere panel (CEP, file:// origin "null") can call this function. Auth is a bearer
//    token, not a cookie, so allowing any origin does not widen access;
//  - an open checkout from the last 23 h with the same price/promo is re-used instead of creating a new
//    Midtrans order on every click (prevents paying twice from two tabs);
//  - before creating a new order, recent orders are checked with Midtrans; an order that was already paid
//    activates the license instead of asking the customer to pay again;
//  - the response includes display_price_usd (the panel reads that field; it showed "US$undefined").
// Needs the column added in supabase/migrations/20261015_payment_and_version_hardening.sql (checkout_url).

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS"
};

const LIFETIME_IDR = 3575000;
const LIFETIME_USD_REFERENCE = 200;
const REUSE_MS = 23 * 3600 * 1000;
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

  const input = await req.json().catch(() => ({}));
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

  const reply = (orderId: string, checkoutUrl: string, reused: boolean) => json({
    order_id: orderId,
    checkout_url: checkoutUrl,
    reused,
    display_price_idr: LIFETIME_IDR,
    display_price_usd: LIFETIME_USD_REFERENCE,
    reference_price_usd: LIFETIME_USD_REFERENCE,
    charge_currency: "IDR",
    gross_amount_idr: grossAmount,
    discount_percent: discountPercent,
    net_price_idr: grossAmount,
    promo_code: affiliate?.code || null,
    environment: "production"
  });

  // Look at this customer's recent orders first.
  const recentQ = await rest("plugin_payment_orders?select=order_id,status,gross_amount_idr,affiliate_code,checkout_url,created_at,paid_at,lifetime_activated_at&user_id=eq." +
    encodeURIComponent(userId) + "&order=created_at.desc&limit=10");
  if (!recentQ.ok) return json({ error: "ORDER_LOOKUP_FAILED" }, 500);
  const recent: any[] = await recentQ.json();
  const open = recent.filter((o) => !o.paid_at && (o.status === "created" || o.status === "pending") && Date.now() - Date.parse(o.created_at) < REUSE_MS);

  // A payment that went through but was never recorded (missed webhook) activates instead of charging again.
  for (const o of open) {
    const mr = await fetch("https://api.midtrans.com/v2/" + encodeURIComponent(o.order_id) + "/status", { headers: midtransAuth, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!mr || !mr.ok) continue;
    const m = await mr.json().catch(() => ({}));
    const st = String(m.transaction_status || "");
    const fraud = m.fraud_status ? String(m.fraud_status).toLowerCase() : null;
    if ((st === "settlement" || st === "capture") && (!fraud || fraud === "accept") && String(m.status_code) === "200" && Number(m.gross_amount) === Number(o.gross_amount_idr)) {
      const now = new Date().toISOString();
      const a = await rest("plugin_payment_orders?order_id=eq." + encodeURIComponent(o.order_id), { method: "PATCH", body: JSON.stringify({ status: st, paid_at: now, lifetime_activated_at: now, midtrans_transaction_id: m.transaction_id || null, payment_type: m.payment_type || null, fraud_status: fraud, updated_at: now }) });
      const b = await rest("plugin_profiles?user_id=eq." + encodeURIComponent(userId), { method: "PATCH", body: JSON.stringify({ license_status: "lifetime", lifetime_activated_at: now, lifetime_order_id: o.order_id, updated_at: now }) });
      if (!a.ok || !b.ok) return json({ error: "LICENSE_ACTIVATION_FAILED", order_id: o.order_id }, 500);
      return json({ error: "Your payment was already received. Your lifetime license is now active.", activated: true }, 409);
    }
    if (st === "pending") continue; // still payable (e.g. VA / QRIS waiting) – keep it re-usable
    if (st && st !== "pending") o.status = st; // expired / cancelled / deny: not re-usable
  }

  const reusable = open.find((o) => o.checkout_url && (o.status === "created" || o.status === "pending") &&
    Number(o.gross_amount_idr) === grossAmount && (o.affiliate_code || null) === (affiliate?.code || null));
  if (reusable) return reply(reusable.order_id, reusable.checkout_url, true);

  const orderId = ("RPRO-" + crypto.randomUUID()).slice(0, 50);
  const insert = await rest("plugin_payment_orders", {
    method: "POST",
    headers: { prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: userId, order_id: orderId, product_code: "lifetime_v1",
      display_price_usd: LIFETIME_USD_REFERENCE, charge_currency: "IDR", gross_amount_idr: grossAmount,
      fx_rate_usd_idr: null, fx_provider: null, fx_rate_updated_at: null, fx_quoted_at: null,
      affiliate_user_id: affiliate?.user_id || null, affiliate_code: affiliate?.code || null,
      discount_percent: discountPercent, affiliate_commission_percent: affiliate ? 20 : 0, status: "created"
    })
  });
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
