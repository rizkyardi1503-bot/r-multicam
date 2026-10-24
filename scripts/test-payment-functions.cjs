// Payment functions against a fake PostgREST + fake Midtrans: one payable checkout per customer (reuse, cancel,
// busy), already-paid activation, webhook statuses (chargeback, unknown), duplicate payment and owner alerts.
// Usage: node scripts/test-payment-functions.cjs
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const KEY = 'server-key';
const hour = 3600 * 1000;

function load(slug, fetch, logs) {
  let handler;
  const src = stripTypeScriptTypes(fs.readFileSync(path.join(root, 'supabase/functions', slug, 'index.ts'), 'utf8').replace(/^import .*;\n/m, ''));
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', MIDTRANS_SERVER_KEY_PRODUCTION: KEY };
  const console_ = { log() {}, warn: (...a) => logs.push(['warn', ...a]), error: (...a) => logs.push(['error', ...a]) };
  vm.runInNewContext(src, { Deno: { serve: (f) => { handler = f; }, env: { get: (n) => env[n] } }, fetch, Request, Response, Headers, URL, AbortSignal, crypto: globalThis.crypto, TextEncoder, btoa, console: console_ });
  return handler;
}

// World: tables + Midtrans transactions; every call is recorded.
function world({ orders = [], profile = { license_status: 'trial', lifetime_order_id: null }, mid = {}, cancel = {}, insertStatus = 201, alertStatus = 201, paidMeanwhile = false, pendingConflict = false, startedMeanwhile = false, profileFail = false } = {}) {
  const w = { orders: orders.map((o) => ({ ...o })), profile: { ...profile }, calls: [], alerts: [], snapHeaders: null };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    w.calls.push(method + ' ' + u.pathname);
    const ok = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/auth/v1/user') return ok({ id: 'u1', email: 'a@b.c', email_confirmed_at: '2026' });
    if (u.pathname === '/rest/v1/plugin_profiles') {
      if (method === 'GET') return profileFail ? ok({ message: 'down' }, 503) : ok([{ ...w.profile }]);
      if (method === 'POST') return ok(null, 201);
      if (method === 'PATCH') { Object.assign(w.profile, body); return ok([{ ...w.profile }]); }
    }
    if (u.pathname === '/rest/v1/plugin_payment_orders') {
      const id = (u.searchParams.get('order_id') || '').replace(/^eq\./, '');
      if (method === 'GET' && id) return ok(w.orders.filter((o) => o.order_id === id));
      if (method === 'GET') return ok([...w.orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 10));
      if (method === 'POST') { if (insertStatus !== 201) return ok({ code: '23505' }, insertStatus); w.orders.push({ ...body, created_at: new Date().toISOString() }); return ok(null, 201); }
      if (method === 'PATCH') {
        const o = w.orders.find((x) => x.order_id === id);
        if (pendingConflict && body.status === 'pending') return ok({ code: '23505' }, 409);
        if (paidMeanwhile && u.searchParams.get('paid_at') === 'is.null') { o.paid_at = '2026-10-19'; o.status = 'settlement'; }
        if (startedMeanwhile && u.searchParams.get('status')) o.status = 'pending';
        const wantStatus = (u.searchParams.get('status') || '').replace(/^eq\./, '');
        const hit = o && !(u.searchParams.get('paid_at') === 'is.null' && o.paid_at) && (!wantStatus || o.status === wantStatus); if (hit) Object.assign(o, body);
        return /representation/.test(new Headers(init.headers).get('prefer') || '') ? ok(hit ? [{ ...o }] : []) : ok(null, 204);
      }
    }
    if (u.pathname === '/rest/v1/website_analytics_events') { w.alerts.push(body); return ok(null, alertStatus); }
    if (u.hostname === 'api.midtrans.com') {
      const m = u.pathname.match(/^\/v2\/([^/]+)\/(status|cancel)$/), id = decodeURIComponent(m[1]);
      if (m[2] === 'status') { const t = mid[id]; if (t === 'down') throw new TypeError('fetch failed'); return t ? ok(t) : ok({ status_code: '404', status_message: "Transaction doesn't exist." }, 404); }
      const c = cancel[id] || { status_code: '412', status_message: 'Merchant cannot modify the status of the transaction' };
      return ok(c, Number(c.status_code) === 200 ? 200 : Number(c.status_code));
    }
    if (u.hostname === 'app.midtrans.com') { w.snapHeaders = new Headers(init.headers); return ok({ token: 't', redirect_url: 'https://app.midtrans.com/snap/v4/redirection/new' }, 201); }
    throw Error('unexpected fetch ' + method + ' ' + url);
  };
  return w;
}
const order = (id, extra = {}) => ({ order_id: id, user_id: 'u1', status: 'created', gross_amount_idr: 2000000, affiliate_code: null, checkout_url: 'https://app.midtrans.com/snap/v4/redirection/' + id, created_at: new Date(Date.now() - hour).toISOString(), paid_at: null, lifetime_activated_at: null, ...extra });
// promo undefined = panel (no promo_code key: continue any open checkout); a string = website ("" = standard price).
const buy = async (w, promo) => {
  const logs = [], h = load('create-lifetime-checkout', w.fetch, logs);
  const r = await h(new Request('https://f.test', { method: 'POST', headers: { authorization: 'Bearer user', 'content-type': 'application/json' }, body: JSON.stringify(promo === undefined ? {} : { promo_code: promo }) }));
  return { status: r.status, data: await r.json(), logs };
};
const sign = (b) => crypto.createHash('sha512').update(String(b.order_id) + String(b.status_code) + String(b.gross_amount) + KEY).digest('hex');
const notify = async (w, b) => {
  const logs = [], h = load('midtrans-lifetime-webhook', w.fetch, logs);
  const r = await h(new Request('https://f.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...b, signature_key: sign(b) }) }));
  return { status: r.status, data: await r.json(), logs };
};

(async () => {
  // Checkout: first order goes to Midtrans with the webhook as notification URL.
  { const w = world(); const r = await buy(w);
    assert.equal(r.status, 200); assert.equal(w.orders.length, 1); assert.equal(r.data.reused, false);
    assert.equal(w.snapHeaders.get('x-override-notification'), 'https://ngotkvqtzqiotztnqwaw.supabase.co/functions/v1/midtrans-lifetime-webhook'); }
  // Same price, Snap page never used: re-used, nothing new.
  { const w = world({ orders: [order('A')] }); const r = await buy(w);
    assert.equal(r.data.reused, true); assert.equal(r.data.order_id, 'A'); assert.equal(w.orders.length, 1); assert.equal(w.orders[0].status, 'created'); }
  // Promo changed: the unused order is closed before the discounted one is created.
  { const w = world({ orders: [order('A')] }); w.fetch2 = w.fetch; const base = w.fetch;
    w.fetch = async (url, init) => { const u = new URL(url); if (u.pathname === '/rest/v1/plugin_affiliates') return new Response(JSON.stringify([{ user_id: 'aff', code: 'FRIEND' }]), { status: 200 }); return base(url, init); };
    const r = await buy(w, 'friend');
    assert.equal(r.status, 200); assert.equal(r.data.gross_amount_idr, 1800000);
    assert.equal(w.orders.find((o) => o.order_id === 'A').status, 'cancel', 'old order closed');
    assert.equal(w.orders.filter((o) => o.status === 'created').length, 1, 'one open order'); }
  // Panel (no promo key) while a discounted website payment is pending: that order is continued, discount kept.
  { const w = world({ orders: [order('A', { status: 'pending', gross_amount_idr: 1800000, affiliate_code: 'FRIEND' })], mid: { A: { status_code: '201', transaction_status: 'pending', gross_amount: '1800000.00' } } });
    const r = await buy(w);
    assert.equal(r.status, 200); assert.equal(r.data.reused, true); assert.equal(r.data.gross_amount_idr, 1800000); assert.equal(r.data.promo_code, 'FRIEND'); assert.equal(r.data.discount_percent, 10);
    assert(!w.calls.some((c) => /cancel/.test(c))); assert.equal(w.orders.length, 1); }
  // Website with another price while a payment is started: that payment is continued (its own price and code), never cancelled.
  { const w = world({ orders: [order('A', { status: 'pending' })], mid: { A: { status_code: '201', transaction_status: 'pending', gross_amount: '2000000.00' } } });
    const w2 = w.fetch; w.fetch = async (url, init) => (new URL(url).pathname === '/rest/v1/plugin_affiliates' ? new Response(JSON.stringify([{ user_id: 'aff', code: 'FRIEND' }]), { status: 200 }) : w2(url, init));
    const r = await buy(w, 'FRIEND');
    assert.equal(r.status, 200); assert.equal(r.data.reused, true); assert.equal(r.data.order_id, 'A'); assert.equal(r.data.gross_amount_idr, 2000000); assert.equal(r.data.discount_percent, 0); assert.equal(r.data.promo_code, null);
    assert(!w.calls.some((c) => /cancel/.test(c))); assert.equal(w.orders.length, 1); assert.equal(w.orders[0].status, 'pending'); }
  // Started more than 23 h ago (not re-used any more) and still pending: blocked until it expires.
  { const w = world({ orders: [order('A', { status: 'pending', created_at: new Date(Date.now() - 23.5 * hour).toISOString() })], mid: { A: { status_code: '201', transaction_status: 'pending', gross_amount: '2000000.00' } } });
    const r = await buy(w, ''); assert.equal(r.status, 409); assert.match(r.data.error, /already started a payment/); assert.equal(w.orders.length, 1); }
  // Website removes the code on purpose ("" = standard price): unused discounted order closed, standard one created.
  { const w = world({ orders: [order('A', { gross_amount_idr: 1800000, affiliate_code: 'FRIEND' })] });
    const r = await buy(w, '');
    assert.equal(r.status, 200); assert.equal(r.data.gross_amount_idr, 2000000); assert.equal(w.orders.find((o) => o.order_id === 'A').status, 'cancel'); }
  // Payment started between the status check and the close step: not overwritten, no new order.
  { const w = world({ orders: [order('A', { affiliate_code: 'OTHER' })], startedMeanwhile: true });
    const r = await buy(w, ''); assert.equal(r.status, 409); assert.equal(w.orders[0].status, 'pending'); assert.equal(w.orders.length, 1); }
  // A JSON null body is treated as no options (panel).
  { const w = world(), logs = [], h = load('create-lifetime-checkout', w.fetch, logs);
    const r = await h(new Request('https://f.test', { method: 'POST', headers: { authorization: 'Bearer user' }, body: 'null' })); assert.equal(r.status, 200); }
  // Paid between the status check and the close step: no new order.
  { const w = world({ orders: [order('A', { affiliate_code: 'OTHER' })], paidMeanwhile: true });
    const r = await buy(w, ''); assert.equal(r.status, 409); assert.match(r.data.error, /changed a moment ago/); assert.equal(w.orders.length, 1); }
  // Midtrans unreachable: refuse instead of creating a parallel order.
  { const w = world({ orders: [order('A', { affiliate_code: 'OTHER' })], mid: { A: 'down' } });
    const r = await buy(w); assert.equal(r.status, 409); assert.equal(w.orders.length, 1); }
  // An open order that was paid (missed webhook) activates instead of charging again.
  { const w = world({ orders: [order('A')], mid: { A: { status_code: '200', transaction_status: 'settlement', gross_amount: '2000000.00', transaction_id: 't' } } });
    const r = await buy(w); assert.equal(r.status, 409); assert.equal(r.data.activated, true); assert.equal(w.profile.license_status, 'lifetime'); }
  // Expired old order is closed with its real status; then a new one is created.
  { const w = world({ orders: [order('A', { created_at: new Date(Date.now() - 30 * hour).toISOString() })], mid: { A: { status_code: '407', transaction_status: 'expire', gross_amount: '2000000.00' } } });
    const r = await buy(w); assert.equal(r.status, 200); assert.equal(w.orders.find((o) => o.order_id === 'A').status, 'expire'); }
  // Two requests at once: the unique index rejects the second insert -> friendly 409.
  { const w = world({ insertStatus: 409 }); const r = await buy(w); assert.equal(r.status, 409); assert.match(r.data.message, /already being prepared/); }
  console.log('PASS checkout: webhook header, reuse, promo switch closes unused order, panel continues pending discounted order, started payment never cancelled, explicit standard price, paid-meanwhile stop, provider down blocks, missed payment activates, expired closed, concurrent insert');

  // Webhook: normal payment activates and logs purchase_paid.
  { const w = world({ orders: [order('A')] }); const r = await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement', transaction_id: 't1' });
    assert.equal(r.status, 200); assert.equal(w.profile.license_status, 'lifetime'); assert.equal(w.profile.lifetime_order_id, 'A'); assert.deepEqual(w.alerts.map((a) => a.event_name), ['purchase_paid']); }
  // Chargeback is stored (no 500 retry loop) and alerts the owner.
  { const w = world({ orders: [order('A', { status: 'settlement', paid_at: '2026-10-01', lifetime_activated_at: '2026-10-01' })], profile: { license_status: 'lifetime', lifetime_order_id: 'A' } });
    const r = await notify(w, { order_id: 'A', status_code: '202', gross_amount: '2000000.00', transaction_status: 'chargeback' });
    assert.equal(r.status, 200); assert.equal(w.orders[0].status, 'chargeback'); assert.deepEqual(w.alerts.map((a) => a.event_name), ['purchase_refunded']); }
  // Unknown status: acknowledged, stored status unchanged, warning logged.
  { const w = world({ orders: [order('A', { status: 'pending' })] });
    const r = await notify(w, { order_id: 'A', status_code: '201', gross_amount: '2000000.00', transaction_status: 'something_new' });
    assert.equal(r.status, 200); assert.equal(w.orders[0].status, 'pending'); assert(r.logs.some((l) => l[0] === 'warn')); }
  // Second paid order while already lifetime from another order: first activation kept, owner told.
  { const w = world({ orders: [order('B')], profile: { license_status: 'lifetime', lifetime_order_id: 'A' } });
    const r = await notify(w, { order_id: 'B', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' });
    assert.equal(r.status, 200); assert.equal(r.data.warning, 'DUPLICATE_PAYMENT'); assert.equal(w.profile.lifetime_order_id, 'A');
    assert.deepEqual(w.alerts.map((a) => [a.event_name, a.metadata.first_order_id]), [['purchase_duplicate', 'A']]);
    assert(w.orders[0].paid_at, 'duplicate recorded as paid'); assert.equal(w.orders[0].lifetime_activated_at, null, 'duplicate is not the activation (no commission)');
    const again = await notify(w, { order_id: 'B', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' });
    assert.equal(again.data.warning, 'DUPLICATE_PAYMENT'); assert.equal(w.alerts.length, 1, 'retry does not alert twice'); }
  // Profile cannot be read while a payment arrives: Midtrans retries instead of risking a wrong activation.
  { const w = world({ orders: [order('B')], profile: { license_status: 'lifetime', lifetime_order_id: 'A' }, profileFail: true });
    const r = await notify(w, { order_id: 'B', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' });
    assert.equal(r.status, 500); assert.equal(w.orders[0].paid_at, null); }
  // "pending" notice for an order checkout closed while a newer one is open: acknowledged, no retry loop.
  { const w = world({ orders: [order('A', { status: 'cancel' })], pendingConflict: true });
    const r = await notify(w, { order_id: 'A', status_code: '201', gross_amount: '2000000.00', transaction_status: 'pending' });
    assert.equal(r.status, 200); assert.equal(r.data.ignored, 'ANOTHER_OPEN_ORDER'); assert.equal(w.orders[0].status, 'cancel'); }
  // Alert write rejected: still acknowledged, logged as an error.
  { const w = world({ orders: [order('A', { status: 'settlement', paid_at: '2026-10-01', lifetime_activated_at: '2026-10-01' })], alertStatus: 400 });
    const r = await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'refund' });
    assert.equal(r.status, 200); assert(r.logs.some((l) => l[0] === 'error' && l[2] === 'purchase_refunded')); }
  // Forged signature still rejected.
  { const w = world({ orders: [order('A')] }), logs = [], h = load('midtrans-lifetime-webhook', w.fetch, logs);
    const r = await h(new Request('https://f.test', { method: 'POST', body: JSON.stringify({ order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement', signature_key: 'x' }) }));
    assert.equal(r.status, 401); assert.equal(w.profile.license_status, 'trial'); }
  console.log('PASS webhook: activation, chargeback stored + alert, unknown status acknowledged, duplicate payment kept first + no activation stamp + one alert, closed-order pending acknowledged, failed alert logged, forged signature rejected');

  // Check payment: normal activation, and a duplicate paid order keeps the first activation (no stamp, one alert).
  const check = async (w) => { const logs = [], h = load('check-lifetime-payment', w.fetch, logs); const r = await h(new Request('https://f.test', { method: 'POST', headers: { authorization: 'Bearer user' }, body: '{}' })); return { status: r.status, data: await r.json() }; };
  { const w = world({ orders: [order('A')], mid: { A: { status_code: '200', transaction_status: 'settlement', gross_amount: '2000000.00', transaction_id: 't' } } });
    const r = await check(w); assert.equal(r.data.paid, true); assert.equal(w.profile.license_status, 'lifetime'); assert.equal(w.profile.lifetime_order_id, 'A'); assert(w.orders[0].lifetime_activated_at); }
  { const w = world({ orders: [order('A', { status: 'settlement', paid_at: '2026-10-01', lifetime_activated_at: '2026-10-01', created_at: new Date(Date.now() - 2 * hour).toISOString() }), order('B')], profile: { license_status: 'lifetime', lifetime_order_id: 'A' },
      mid: { A: { status_code: '200', transaction_status: 'settlement', gross_amount: '2000000.00' }, B: { status_code: '200', transaction_status: 'settlement', gross_amount: '2000000.00' } } });
    const r = await check(w); const b = w.orders.find((o) => o.order_id === 'B');
    assert.equal(r.data.paid, true); assert.equal(w.profile.lifetime_order_id, 'A', 'first activation kept');
    assert(b.paid_at, 'duplicate recorded as paid'); assert.equal(b.lifetime_activated_at, null, 'duplicate not stamped (no commission)');
    assert.deepEqual(w.alerts.map((a) => [a.event_name, a.metadata.order_id]), [['purchase_duplicate', 'B']]);
    await check(w); assert.equal(w.alerts.length, 1, 'no repeat alert');
    const n = await notify(w, { order_id: 'B', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' });
    assert.equal(n.data.warning, 'DUPLICATE_PAYMENT'); assert.equal(b.lifetime_activated_at, null); assert.equal(w.alerts.length, 1, 'webhook after check: no second alert'); }
  console.log('PASS check payment: activation, duplicate keeps first activation with one alert, webhook afterwards agrees');
})().catch((e) => { console.error(e); process.exitCode = 1; });
