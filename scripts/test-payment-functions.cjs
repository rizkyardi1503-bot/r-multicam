// Payment functions against a fake PostgREST + fake Midtrans: one payable checkout per customer (reuse, cancel,
// busy), already-paid activation, webhook statuses (chargeback, unknown), duplicate payment and owner alerts,
// parallel check-payment with stale-order skip/expiry, and one purchase_paid alert whichever path activates.
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
function world({ orders = [], profile = { license_status: 'trial', lifetime_order_id: null }, mid = {}, cancel = {}, insertStatus = 201, alertStatus = 201, paidMeanwhile = false, pendingConflict = false, startedMeanwhile = false, profileFail = false, licenseFail = 0, stampFail = 0 } = {}) {
  const w = { orders: orders.map((o) => ({ ...o })), profile: { ...profile }, calls: [], alerts: [], snapHeaders: null, snapCalls: 0, licenseFail, stampFail };
  w.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    w.calls.push(method + ' ' + u.pathname);
    const ok = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/auth/v1/user') return ok({ id: 'u1', email: 'a@b.c', email_confirmed_at: '2026' });
    if (u.pathname === '/rest/v1/plugin_profiles') {
      if (method === 'GET') return profileFail ? ok({ message: 'down' }, 503) : ok([{ ...w.profile }]);
      if (method === 'POST') return ok(null, 201);
      if (method === 'PATCH') {
        if (w.licenseFail > 0) { w.licenseFail--; return ok({ message: 'down' }, 503); }
        if (u.searchParams.get('license_status') === 'neq.blocked' && w.profile.license_status === 'blocked') return ok([]);
        Object.assign(w.profile, body); return ok([{ ...w.profile }]);
      }
    }
    if (u.pathname === '/rest/v1/plugin_payment_orders') {
      const id = (u.searchParams.get('order_id') || '').replace(/^eq\./, '');
      if (method === 'GET' && id) return ok(w.orders.filter((o) => o.order_id === id));
      if (method === 'GET') return ok([...w.orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 10));
      if (method === 'POST') { if (insertStatus !== 201) return ok({ code: '23505' }, insertStatus); w.orders.push({ ...body, created_at: new Date().toISOString() }); return ok(null, 201); }
      if (method === 'PATCH') {
        const o = w.orders.find((x) => x.order_id === id);
        if (u.searchParams.get('lifetime_activated_at') === 'is.null') {
          if (w.stampFail > 0) { w.stampFail--; return ok({ message: 'down' }, 503); }
          if (o.lifetime_activated_at) return ok(null, 204);
        }
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
    if (u.hostname === 'app.midtrans.com') { w.snapCalls++; w.snapHeaders = new Headers(init.headers); return ok({ token: 't', redirect_url: 'https://app.midtrans.com/snap/v4/redirection/new' }, 201); }
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
  // Card payment still under review at Midtrans (authorize / fraud challenge): continued like pending, never 'could not confirm'.
  for (const mid of [{ status_code: '201', transaction_status: 'authorize', gross_amount: '2000000.00' }, { status_code: '201', transaction_status: 'capture', fraud_status: 'challenge', gross_amount: '2000000.00' }]) {
    const w = world({ orders: [order('A', { status: 'pending', created_at: new Date(Date.now() - 23.5 * hour).toISOString() })], mid: { A: mid } });
    const r = await buy(w, ''); assert.equal(r.status, 409); assert.match(r.data.error, /already started a payment/); assert.equal(w.orders[0].status, 'pending'); assert.equal(w.orders.length, 1); }
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

  // Check payment asks Midtrans about all relevant orders at once, skips orders closed > 25 h ago, and expires
  // never-opened checkouts older than 24 h.
  { const ago = (h) => new Date(Date.now() - h * hour).toISOString();
    const w = world({ orders: [order('NEW', { created_at: ago(1) }), order('STALE', { created_at: ago(30) }), order('CLOSED_OLD', { status: 'expire', created_at: ago(40) }),
      order('CANCEL_OLD', { status: 'cancel', created_at: ago(26) }), order('CANCEL_RECENT', { status: 'cancel', created_at: ago(5) }), order('FAILED_OLD', { status: 'failed', created_at: ago(50) })] });
    const base = w.fetch; let inFlight = 0, maxInFlight = 0; const asked = [];
    w.fetch = async (url, init) => { const u = new URL(url); if (u.hostname !== 'api.midtrans.com') return base(url, init);
      asked.push(decodeURIComponent(u.pathname.split('/')[2])); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30)); inFlight--; return base(url, init); };
    const r = await check(w);
    assert.equal(r.data.paid, false);
    assert.deepEqual(asked.sort(), ['CANCEL_OLD', 'CANCEL_RECENT', 'NEW', 'STALE'], 'expired/failed orders older than 25 h are not asked about; cancelled ones are (old Snap tab)');
    assert.equal(maxInFlight, 4, 'Midtrans is asked in parallel');
    assert.equal(w.orders.find((o) => o.order_id === 'STALE').status, 'expire', 'never-opened checkout older than 24 h expires');
    assert.equal(w.orders.find((o) => o.order_id === 'NEW').status, 'created', 'a recent unopened checkout stays payable');
    assert.equal(w.orders.find((o) => o.order_id === 'CANCEL_RECENT').status, 'cancel');
    const again = []; w.fetch = async (url, init) => { const u = new URL(url); if (u.hostname === 'api.midtrans.com') again.push(decodeURIComponent(u.pathname.split('/')[2])); return base(url, init); };
    await check(w); assert.deepEqual(again.sort(), ['CANCEL_OLD', 'CANCEL_RECENT', 'NEW'], 'the expired order is not asked about again after 25 h'); }
  // A bare HTTP 404 without Midtrans JSON (gateway/outage) is unknown, never "never opened": nothing expired or closed.
  { const ago = new Date(Date.now() - 30 * hour).toISOString();
    const bare = (w) => { const base = w.fetch; w.fetch = async (url, init) => (new URL(url).hostname === 'api.midtrans.com' ? new Response('<html>Not Found</html>', { status: 404 }) : base(url, init)); return w; };
    let w = bare(world({ orders: [order('STALE', { created_at: ago })] })); await check(w); assert.equal(w.orders[0].status, 'created');
    w = bare(world({ orders: [order('STALE', { created_at: ago })] })); const r = await buy(w, ''); assert.equal(r.status, 409); assert.match(r.data.error, /could not confirm/); assert.equal(w.orders.length, 1); assert.equal(w.orders[0].status, 'created'); }
  // Race: the webhook stores the settlement after check payment read the order but before its "pending" write.
  { const w = world({ orders: [order('A')], mid: { A: { status_code: '201', transaction_status: 'pending', gross_amount: '2000000.00' } } });
    const base = w.fetch; w.fetch = async (url, init = {}) => { const u = new URL(url);
      if ((init.method || 'GET') === 'PATCH' && u.pathname === '/rest/v1/plugin_payment_orders') Object.assign(w.orders[0], { status: 'settlement', paid_at: '2026-10-30T00:00:00Z', lifetime_activated_at: '2026-10-30T00:00:00Z' });
      if ((init.method || 'GET') === 'PATCH' && u.pathname === '/rest/v1/plugin_payment_orders' && u.searchParams.get('paid_at') !== 'is.null') { const o = w.orders[0]; Object.assign(o, JSON.parse(init.body)); return new Response(null, { status: 204 }); }
      return base(url, init); };
    await check(w); const o = w.orders[0];
    assert.equal(o.status, 'settlement', 'a pending answer never downgrades a stored payment'); assert.equal(o.paid_at, '2026-10-30T00:00:00Z'); assert.equal(o.lifetime_activated_at, '2026-10-30T00:00:00Z'); }
  console.log('PASS check payment race: a late pending answer never overwrites a webhook settlement; bare HTTP 404 is unknown (check + checkout); cancelled orders still checked');
  // A lifetime account: its paid orders are not asked about again; result stays paid.
  { const w = world({ orders: [order('A', { status: 'settlement', paid_at: '2026-10-01', lifetime_activated_at: '2026-10-01' })], profile: { license_status: 'lifetime', lifetime_order_id: 'A' } });
    const r = await check(w); assert.equal(r.data.paid, true); assert(!w.calls.some((c) => c.includes('/v2/')), 'no Midtrans call'); }
  // Checkout: a never-opened order older than 24 h is closed as "expire" (not "cancel") before the new one.
  { const w = world({ orders: [order('OLD', { created_at: new Date(Date.now() - 26 * hour).toISOString() })] });
    const r = await buy(w, ''); assert.equal(r.status, 200); assert.equal(w.orders.find((o) => o.order_id === 'OLD').status, 'expire'); }
  // Checkout responses are IDR only.
  { const w = world(); const r = await buy(w); assert.equal(r.data.charge_currency, 'IDR'); assert(!('display_price_usd' in r.data) && !('reference_price_usd' in r.data)); assert.equal(r.data.gross_amount_idr, 2000000); }
  console.log('PASS check payment: parallel Midtrans checks, closed orders > 25 h skipped, unopened > 24 h expired (check and checkout), lifetime account skips paid orders; IDR-only checkout reply');

  // purchase_paid owner alert: exactly once, whichever path activates.
  const settle = { status_code: '200', transaction_status: 'settlement', gross_amount: '2000000.00', transaction_id: 't' };
  const paidAlerts = (w) => w.alerts.filter((a) => a.event_name === 'purchase_paid');
  { const w = world({ orders: [order('A')], mid: { A: settle } });
    await check(w); assert.deepEqual(paidAlerts(w).map((a) => [a.metadata.order_id, a.metadata.via]), [['A', 'check_payment']]);
    await check(w); await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' });
    assert.equal(paidAlerts(w).length, 1, 'check payment first: no second alert from a repeat check or the webhook'); }
  { const w = world({ orders: [order('A')], mid: { A: settle } });
    const r = await buy(w); assert.equal(r.data.activated, true); assert.deepEqual(paidAlerts(w).map((a) => [a.metadata.order_id, a.metadata.via]), [['A', 'checkout_reconcile']]);
    await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' }); await check(w);
    assert.equal(paidAlerts(w).length, 1, 'checkout reconcile first: no second alert'); }
  { const w = world({ orders: [order('A')], mid: { A: settle } });
    await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' }); await check(w);
    assert.deepEqual(paidAlerts(w).map((a) => a.metadata.via), ['webhook'], 'webhook first: check payment adds nothing'); }
  // Two paths at the same time: the unique index answers 409 to the second insert; that is not an error.
  { const w = world({ orders: [order('A')], alertStatus: 409 }); const r = await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' });
    assert.equal(r.status, 200); assert(!r.logs.some((l) => l[0] === 'error'), '409 = alert already stored'); }
  { const w = world({ orders: [order('A')], mid: { A: settle }, alertStatus: 409 }); const logs = [], h = load('check-lifetime-payment', w.fetch, logs);
    const r = await h(new Request('https://f.test', { method: 'POST', headers: { authorization: 'Bearer user' }, body: '{}' })); assert.equal(r.status, 200); assert(!logs.some((l) => l[0] === 'error')); }
  console.log('PASS purchase_paid alert: once via check payment, checkout reconcile or webhook, whichever activates first; concurrent duplicate (409) is quiet');

  // ---- 2026-11-04 audit ----
  const names = (w) => w.alerts.map((a) => a.event_name);
  const ago = (h) => new Date(Date.now() - h * hour).toISOString();
  const settled = (id) => ({ order_id: id, status_code: '200', gross_amount: '2000000.00', transaction_status: 'settlement' });
  const paidOrder = (id, extra = {}) => order(id, { status: 'settlement', paid_at: ago(2), lifetime_activated_at: null, ...extra });

  // Checkout: paid and not refunded, licence write had failed: activates, no new order, no new charge.
  { const w = world({ orders: [paidOrder('A')] }); const r = await buy(w, '');
    assert.equal(r.status, 409); assert.equal(r.data.activated, true); assert.equal(w.snapCalls, 0); assert.equal(w.orders.length, 1);
    assert.equal(w.profile.license_status, 'lifetime'); assert.equal(w.profile.lifetime_order_id, 'A');
    assert(w.orders[0].lifetime_activated_at, 'stamped once the licence is written'); assert.deepEqual(names(w), ['purchase_paid']); }
  // Same, already stamped by an older build whose licence write failed: activates without a second alert.
  { const w = world({ orders: [paidOrder('A', { lifetime_activated_at: '2026-10-01T00:00:00Z' })] }); const r = await buy(w, '');
    assert.equal(r.data.activated, true); assert.equal(w.profile.lifetime_activated_at, '2026-10-01T00:00:00Z'); assert.deepEqual(names(w), []); assert.equal(w.snapCalls, 0); }
  // Licence write fails again: 500, order not stamped; the next try activates and sends the alert.
  { const w = world({ orders: [paidOrder('A')], licenseFail: 1 }); let r = await buy(w, '');
    assert.equal(r.status, 500); assert.equal(w.orders[0].lifetime_activated_at, null); assert.equal(w.snapCalls, 0);
    r = await buy(w, ''); assert.equal(r.data.activated, true); assert.deepEqual(names(w), ['purchase_paid']); }
  // Refunded or merchant-cancelled paid orders do not activate: a new purchase is allowed.
  for (const status of ['refund', 'partial_refund', 'chargeback', 'partial_chargeback', 'cancel']) {
    const w = world({ orders: [paidOrder('A', { status, lifetime_activated_at: ago(2) })] }); const r = await buy(w, '');
    assert.equal(r.status, 200, status); assert.equal(w.snapCalls, 1); assert.equal(w.profile.license_status, 'trial'); assert.equal(w.orders.length, 2); }
  // Closed order paid in an old tab, under 25 h: Midtrans is asked and it activates.
  { const w = world({ orders: [order('OLD', { status: 'cancel', created_at: ago(5) })], mid: { OLD: { status_code: '200', transaction_status: 'settlement', gross_amount: '2000000.00', transaction_id: 't' } } });
    const r = await buy(w, ''); assert.equal(r.data.activated, true); assert.equal(w.snapCalls, 0); assert.equal(w.orders[0].status, 'settlement'); assert(w.orders[0].paid_at); assert(w.orders[0].lifetime_activated_at); assert.deepEqual(names(w), ['purchase_paid']); }
  // Over 25 h: not asked, a new order is made.
  { const w = world({ orders: [order('OLD', { status: 'cancel', created_at: ago(26) })], mid: { OLD: { status_code: '200', transaction_status: 'settlement', gross_amount: '2000000.00' } } });
    const r = await buy(w, ''); assert.equal(r.status, 200); assert(!w.calls.some((c) => c.includes('/v2/OLD/')), 'not asked after 25 h'); assert.equal(w.snapCalls, 1); }
  // Closed order nobody opened: stays closed, never re-offered (panel asks without a promo code), new order made.
  { const w = world({ orders: [order('OLD', { status: 'cancel', created_at: ago(5) })] }); const r = await buy(w);
    assert.equal(r.status, 200); assert.equal(r.data.reused, false); assert.notEqual(r.data.order_id, 'OLD'); assert.equal(w.orders.find((o) => o.order_id === 'OLD').status, 'cancel'); }
  // Payment started in an old tab of a closed order, while a newer unused checkout exists: the started payment is continued.
  { const w = world({ orders: [order('NEW', { created_at: ago(1) }), order('OLD', { status: 'cancel', created_at: ago(5) })], mid: { OLD: { status_code: '201', transaction_status: 'pending', gross_amount: '2000000.00' } } });
    const r = await buy(w); assert.equal(r.data.reused, true); assert.equal(r.data.order_id, 'OLD'); assert.equal(w.snapCalls, 0); assert.equal(w.orders.find((o) => o.order_id === 'NEW').status, 'created'); }
  // Started too long ago to continue: blocked, and the open order is left alone.
  { const w = world({ orders: [order('NEW', { created_at: ago(1), affiliate_code: 'OTHER' }), order('OLD', { status: 'cancel', created_at: ago(24) })], mid: { OLD: { status_code: '201', transaction_status: 'pending', gross_amount: '2000000.00' } } });
    const r = await buy(w, ''); assert.equal(r.status, 409); assert.match(r.data.error, /already started a payment/); assert.equal(w.orders.find((o) => o.order_id === 'NEW').status, 'created'); assert.equal(w.snapCalls, 0); }
  // Midtrans cannot answer about a closed order: no new charge.
  { const w = world({ orders: [order('OLD', { status: 'cancel', created_at: ago(5) })], mid: { OLD: 'down' } });
    const r = await buy(w, ''); assert.equal(r.status, 409); assert.match(r.data.error, /could not confirm/); assert.equal(w.snapCalls, 0); }
  // Several closed orders are asked at once.
  { const w = world({ orders: [order('C1', { status: 'cancel', created_at: ago(5) }), order('C2', { status: 'cancel', created_at: ago(6) }), order('C3', { status: 'cancel', created_at: ago(7) })] });
    const base = w.fetch; let inFlight = 0, most = 0; w.fetch = async (url, init) => { if (new URL(url).hostname !== 'api.midtrans.com') return base(url, init); inFlight++; most = Math.max(most, inFlight); await new Promise((r) => setTimeout(r, 20)); inFlight--; return base(url, init); };
    await buy(w, ''); assert.equal(most, 3); }
  // A recorded payment whose refund notice was lost: Midtrans is asked first, the refund is stored, owner told, new purchase allowed.
  for (const st of ['refund', 'cancel']) {
    const w = world({ orders: [paidOrder('A')], mid: { A: { status_code: '200', transaction_status: st, gross_amount: '2000000.00' } } }); const r = await buy(w, '');
    assert.equal(r.status, 200); assert.equal(w.snapCalls, 1); assert.equal(w.orders.find((o) => o.order_id === 'A').status, st); assert.equal(w.profile.license_status, 'trial');
    assert.deepEqual(w.alerts.filter((a) => a.event_name !== 'checkout_created').map((a) => [a.event_name, a.metadata.status]), [['purchase_refunded', st]]); }
  // Midtrans confirms the payment, or cannot answer: the recorded payment stands, no new charge.
  for (const answer of [settle, 'down']) {
    const w = world({ orders: [paidOrder('A')], mid: { A: answer } }); const r = await buy(w, ''); assert.equal(r.data.activated, true); assert.equal(w.snapCalls, 0); }
  // A saved promo code that is no longer approved does not stop activation (the fake has no affiliates table: reaching it would throw).
  { const w = world({ orders: [paidOrder('A')] }); const r = await buy(w, 'OLDCODE'); assert.equal(r.data.activated, true); }
  { const w = world({ orders: [order('A', { status: 'pending' })], mid: { A: settle } }); const r = await buy(w, 'OLDCODE'); assert.equal(r.data.activated, true); }
  // A bad code with only unpaid orders: 400, the open order stays open, no new charge.
  { const w = world({ orders: [order('A')] }); const base = w.fetch; w.fetch = async (url, init) => (new URL(url).pathname === '/rest/v1/plugin_affiliates' ? new Response('[]', { status: 200 }) : base(url, init));
    const r = await buy(w, 'OLDCODE'); assert.equal(r.status, 400); assert.equal(w.orders[0].status, 'created'); assert.equal(w.orders.length, 1); assert.equal(w.snapCalls, 0); }
  console.log('PASS checkout: paid unrefunded order activates without a new charge, refunded ones do not, closed orders under 25 h are asked (paid, started, unused, unreachable), asked in parallel');

  // Webhook: merchant cancels a paid card payment: stored, owner told, licence kept.
  { const w = world({ orders: [paidOrder('A', { status: 'capture', lifetime_activated_at: ago(2) })], profile: { license_status: 'lifetime', lifetime_order_id: 'A' } });
    const r = await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'cancel' });
    assert.equal(r.status, 200); assert.equal(w.orders[0].status, 'cancel'); assert(w.orders[0].paid_at, 'the payment record is kept'); assert.equal(w.profile.license_status, 'lifetime');
    assert.deepEqual(w.alerts.map((a) => [a.event_name, a.metadata.status]), [['purchase_refunded', 'cancel']]); }
  // Cancel on an unpaid order is only a closed checkout: no alert.
  { const w = world({ orders: [order('A', { status: 'pending' })] }); await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'cancel' });
    assert.equal(w.orders[0].status, 'cancel'); assert.deepEqual(names(w), []); }
  // Late settlement after money went back: nothing flips, no licence, no alert.
  for (const status of ['refund', 'partial_refund', 'chargeback', 'partial_chargeback', 'cancel']) {
    const w = world({ orders: [paidOrder('A', { status, lifetime_activated_at: ago(2) })] });
    const r = await notify(w, settled('A')); assert.equal(r.status, 200); assert.equal(r.data.ignored, 'ALREADY_REFUNDED'); assert.equal(w.orders[0].status, status); assert.equal(w.profile.license_status, 'trial'); assert.deepEqual(names(w), []); }
  // Refund recorded on an order we never saw paid: a late settlement does not activate it either.
  { const w = world({ orders: [order('A', { status: 'refund' })] }); const r = await notify(w, settled('A'));
    assert.equal(r.data.ignored, 'ALREADY_REFUNDED'); assert.equal(w.orders[0].paid_at, null); assert.equal(w.profile.license_status, 'trial'); }
  // A late "pending" does not undo a refund recorded on an order we never saw paid.
  { const w = world({ orders: [order('A', { status: 'refund' })] }); const r = await notify(w, { order_id: 'A', status_code: '201', gross_amount: '2000000.00', transaction_status: 'pending' });
    assert.equal(r.data.ignored, 'ALREADY_REFUNDED'); assert.equal(w.orders[0].status, 'refund'); }
  // Race: the settlement is stored after this "pending" read the order: it never overwrites the payment.
  { const w = world({ orders: [order('A', { status: 'pending' })] }); const base = w.fetch;
    w.fetch = async (url, init = {}) => { if ((init.method || 'GET') === 'PATCH' && new URL(url).pathname === '/rest/v1/plugin_payment_orders') Object.assign(w.orders[0], { status: 'settlement', paid_at: '2026-11-05T00:00:00Z', lifetime_activated_at: '2026-11-05T00:00:00Z' }); return base(url, init); };
    const r = await notify(w, { order_id: 'A', status_code: '201', gross_amount: '2000000.00', transaction_status: 'pending' });
    assert.equal(r.status, 200); assert.equal(w.orders[0].status, 'settlement'); assert.equal(w.orders[0].paid_at, '2026-11-05T00:00:00Z'); }
  // A refund notice keeps the payment date.
  { const w = world({ orders: [paidOrder('A', { paid_at: '2026-11-01T00:00:00Z', lifetime_activated_at: '2026-11-01T00:00:00Z' })] }); await notify(w, { order_id: 'A', status_code: '200', gross_amount: '2000000.00', transaction_status: 'refund' });
    assert.equal(w.orders[0].status, 'refund'); assert.equal(w.orders[0].paid_at, '2026-11-01T00:00:00Z'); }
  // Old tab: unpaid "cancel" then a real payment still activates.
  { const w = world({ orders: [order('A', { status: 'cancel' })] }); await notify(w, settled('A'));
    assert.equal(w.orders[0].status, 'settlement'); assert.equal(w.profile.license_status, 'lifetime'); assert.deepEqual(names(w), ['purchase_paid']); }
  // Blocked account: paid is recorded, no activation stamp (no commission), owner told.
  { const w = world({ orders: [order('A')], profile: { license_status: 'blocked', lifetime_order_id: null } }); const r = await notify(w, settled('A'));
    assert.equal(r.data.warning, 'PROFILE_NOT_FOUND_OR_BLOCKED'); assert(w.orders[0].paid_at); assert.equal(w.orders[0].lifetime_activated_at, null); assert.equal(w.profile.license_status, 'blocked'); assert.deepEqual(names(w), ['purchase_paid_not_activated']); }
  // Licence write fails: Midtrans retries; the retry activates, stamps and alerts.
  { const w = world({ orders: [order('A')], licenseFail: 1 }); let r = await notify(w, settled('A'));
    assert.equal(r.status, 500); assert(w.orders[0].paid_at); assert.equal(w.orders[0].lifetime_activated_at, null); assert.deepEqual(names(w), []);
    r = await notify(w, settled('A')); assert.equal(r.status, 200); assert(w.orders[0].lifetime_activated_at); assert.equal(w.profile.license_status, 'lifetime'); assert.deepEqual(names(w), ['purchase_paid']); }
  // Stamp write fails after the licence: retried too, one alert, not read as a duplicate.
  { const w = world({ orders: [order('A')], stampFail: 1 }); let r = await notify(w, settled('A')); assert.equal(r.status, 500); assert.deepEqual(names(w), []);
    r = await notify(w, settled('A')); assert.equal(r.status, 200); assert.equal(r.data.warning, undefined); assert(w.orders[0].lifetime_activated_at); assert.deepEqual(names(w), ['purchase_paid']); }
  // A second notice (capture then settlement) keeps the first stamp.
  { const w = world({ orders: [order('A')] }); await notify(w, { ...settled('A'), transaction_status: 'capture', fraud_status: 'accept' }); const first = w.orders[0].lifetime_activated_at;
    await new Promise((r) => setTimeout(r, 2)); await notify(w, settled('A')); assert.equal(w.orders[0].lifetime_activated_at, first); assert.deepEqual(names(w), ['purchase_paid']); }
  console.log('PASS webhook: merchant cancel of a paid order stored + alert, late settlement never undoes a refund, old-tab payment still activates, blocked account not stamped, failed licence or stamp write keeps the alert');

  // Check payment: same order of writes, and refunded orders stay refunded.
  { const w = world({ orders: [order('A')], profile: { license_status: 'blocked', lifetime_order_id: null }, mid: { A: settle } });
    let r = await check(w); assert.equal(r.status, 403); assert(w.orders[0].paid_at); assert.equal(w.orders[0].lifetime_activated_at, null); assert.deepEqual(names(w), ['purchase_paid_not_activated']);
    r = await check(w); assert.equal(r.status, 403); assert.equal(w.alerts.length, 1, 'repeat clicks do not repeat the alert'); }
  { const w = world({ orders: [order('A')], licenseFail: 1, mid: { A: settle } }); let r = await check(w);
    assert.equal(r.status, 500); assert.equal(w.orders[0].lifetime_activated_at, null); assert.deepEqual(names(w), []);
    r = await check(w); assert.equal(r.data.paid, true); assert(w.orders[0].lifetime_activated_at); assert.deepEqual(names(w), ['purchase_paid']); }
  { const w = world({ orders: [paidOrder('A', { status: 'refund', lifetime_activated_at: ago(2) })], mid: { A: settle } }); const r = await check(w);
    assert.equal(r.data.paid, false); assert.equal(r.data.status, 'refund'); assert.equal(w.orders[0].status, 'refund'); assert.equal(w.profile.license_status, 'trial'); assert(!w.calls.some((c) => c.includes('/v2/'))); }
  // Licence written but stamp failed: the next check finishes it, even though the account already reads lifetime.
  { const w = world({ orders: [order('A')], stampFail: 1, mid: { A: settle } }); let r = await check(w);
    assert.equal(r.status, 500); assert.equal(w.profile.license_status, 'lifetime'); assert.equal(w.orders[0].lifetime_activated_at, null); assert.deepEqual(names(w), []);
    r = await check(w); assert.equal(r.data.paid, true); assert(w.orders[0].lifetime_activated_at); assert.deepEqual(names(w), ['purchase_paid']);
    r = await check(w); assert.deepEqual(names(w), ['purchase_paid'], 'finished: asked no more'); }
  // Midtrans reports money back on a paid order: stored, owner told once, no activation; also a refund never seen as paid.
  { const w = world({ orders: [paidOrder('A')], mid: { A: { status_code: '200', transaction_status: 'refund', gross_amount: '2000000.00' } } }); let r = await check(w);
    assert.equal(r.data.paid, false); assert.equal(w.orders[0].status, 'refund'); assert(w.orders[0].paid_at); assert.equal(w.profile.license_status, 'trial'); assert.deepEqual(names(w), ['purchase_refunded']);
    await check(w); assert.equal(w.alerts.length, 1, 'once'); }
  { const w = world({ orders: [order('A')], mid: { A: { status_code: '200', transaction_status: 'refund', gross_amount: '2000000.00' } } }); await check(w);
    assert.equal(w.orders[0].status, 'refund'); assert.equal(w.orders[0].paid_at, null); assert.deepEqual(names(w), ['purchase_refunded']); }
  console.log('PASS check payment: missing stamp repaired, refund answer stored with one alert; blocked account not stamped and alerted once, failed licence write keeps the alert, refunded order not reactivated');
})().catch((e) => { console.error(e); process.exitCode = 1; });
