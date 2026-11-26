// Subscription plans (docs/subscriptions-phase-1.md) against a fake PostgREST + fake Midtrans: founder price and its
// limits, promo rules, lifetime cutoff for website and released panels, plan reuse / switch / started payment, reconcile
// of a paid plan order, renewals, and the webhook + check-payment grant paths (exactly once, one purchase_paid alert).
// The SQL side (grant_subscription_order, plugin_entitlement) is tested in the database with a rolled-back transaction.
// Usage: node scripts/test-subscription-functions.cjs
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const root = path.resolve(__dirname, '..');
const KEY = 'server-key';
const DAY = 86400000;
const BEFORE_CUTOFF = Date.parse('2026-11-21T12:00:00+08:00');
const AFTER_CUTOFF = Date.parse('2026-12-01T00:00:01+08:00');

function load(slug, w) {
  let handler;
  const raw = fs.readFileSync(path.join(root, 'supabase/functions', slug, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');
  const src = stripTypeScriptTypes(raw.replace(/^import .*;\n/m, ''));
  const env = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service', MIDTRANS_SERVER_KEY_PRODUCTION: KEY };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(w.now); } static now() { return w.now; } }
  const console_ = { log() {}, warn: (...a) => w.logs.push(['warn', ...a]), error: (...a) => w.logs.push(['error', ...a]) };
  vm.runInNewContext(src, { Deno: { serve: (f) => { handler = f; }, env: { get: (n) => env[n] } }, fetch: w.fetch, Request, Response, Headers, URL, AbortSignal, crypto: globalThis.crypto, TextEncoder, btoa, console: console_, Date: FakeDate });
  return handler;
}

function world({ profile = {}, orders = [], mid = {}, slots = 100, affiliates = [], now = BEFORE_CUTOFF, grantFail = false } = {}) {
  const w = {
    now, logs: [], alerts: [], snap: [], grants: 0, midAsked: [], grantFail,
    profile: { license_status: 'trial', lifetime_order_id: null, subscription_expires_at: null, subscription_plan: null, founder_price_locked: false, ...profile },
    orders: orders.map((o) => ({ user_id: 'u1', status: 'created', paid_at: null, lifetime_activated_at: null, affiliate_code: null, founder_price: false, checkout_url: 'https://app.midtrans.com/snap/v4/redirection/' + o.order_id, created_at: new Date(now - 3600000).toISOString(), ...o })),
    mid: { ...mid }, slots, affiliates
  };
  const iso = () => new Date(w.now).toISOString();
  w.grant = (orderId) => {
    const o = w.orders.find((x) => x.order_id === orderId), p = w.profile;
    if (!o) return { ok: false, reason: 'ORDER_NOT_FOUND' };
    if (o.product_code !== 'monthly_v1' && o.product_code !== 'annual_v1') return { ok: false, reason: 'NOT_SUBSCRIPTION' };
    if (!o.paid_at) return { ok: false, reason: 'NOT_PAID' };
    if (o.status !== 'settlement' && o.status !== 'capture') return { ok: false, reason: 'REFUNDED' };
    if (o.lifetime_activated_at) return { ok: true, already: true, license_status: p.license_status, subscription_expires_at: p.subscription_expires_at };
    if (p.license_status === 'blocked') return { ok: false, reason: 'BLOCKED' };
    if (p.license_status === 'lifetime') return { ok: false, reason: 'ALREADY_LIFETIME' };
    const days = o.product_code === 'monthly_v1' ? 30 : 365;
    // Same rules as the SQL: stack only on an active plan; the founder lock only while the 100 spots last.
    const end = p.subscription_expires_at ? Date.parse(p.subscription_expires_at) : 0;
    const base = p.license_status === 'subscription' && end > w.now ? end : w.now;
    const founder = p.founder_price_locked || (!!o.founder_price && w.slots > 0);
    Object.assign(p, { license_status: 'subscription', subscription_expires_at: new Date(base + days * DAY).toISOString(), subscription_plan: o.product_code, founder_price_locked: founder });
    o.lifetime_activated_at = iso();
    w.grants++;
    return { ok: true, already: false, license_status: 'subscription', subscription_expires_at: p.subscription_expires_at, period_days: days };
  };
  const matches = (o, q) => [...q.entries()].every(([k, v]) => {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true;
    if (v === 'is.null') return o[k] == null;
    if (v.startsWith('eq.')) return String(o[k]) === v.slice(3);
    return true;
  });
  w.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET', body = init.body ? JSON.parse(init.body) : null;
    const res = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    const rep = /return=representation/.test(JSON.stringify(init.headers || {}));
    if (u.pathname === '/auth/v1/user') return res({ id: 'u1', email: 'a@b.c', email_confirmed_at: '2026' });
    if (u.pathname === '/rest/v1/rpc/grant_subscription_order') return w.grantFail ? res({ message: 'down' }, 503) : res(w.grant(body.p_order_id));
    if (u.pathname === '/rest/v1/rpc/subscription_pricing') return res({ founder_limit: 100, founder_slots_left: w.slots });
    if (u.pathname === '/rest/v1/plugin_affiliates') return res(w.affiliates.filter((a) => a.code === u.searchParams.get('code').slice(3)));
    if (u.pathname === '/rest/v1/website_analytics_events') {
      if (body.event_name === 'purchase_paid' && w.alerts.some((a) => a.event_name === 'purchase_paid' && a.metadata.order_id === body.metadata.order_id)) return res(null, 409);
      if (body.event_name !== 'checkout_created') w.alerts.push(body);
      return res(null, 201);
    }
    if (u.pathname === '/rest/v1/plugin_profiles') {
      if (method === 'GET') return res([{ ...w.profile }]);
      if (method === 'POST') return res(null, 201);
      if (method === 'PATCH') { if (w.profile.license_status === 'blocked') return res([]); Object.assign(w.profile, body); return res([{ ...w.profile }]); }
    }
    if (u.pathname === '/rest/v1/plugin_payment_orders') {
      if (method === 'GET') {
        const list = w.orders.filter((o) => matches(o, u.searchParams)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
        return res(list.map((o) => ({ ...o })));
      }
      if (method === 'POST') {
        if (w.orders.some((o) => !o.paid_at && (o.status === 'created' || o.status === 'pending'))) return res({ message: 'one open order' }, 409);
        w.orders.push({ ...body, created_at: iso(), paid_at: null, lifetime_activated_at: null, checkout_url: null });
        return res(null, 201);
      }
      if (method === 'PATCH') {
        const hit = w.orders.filter((o) => matches(o, u.searchParams));
        hit.forEach((o) => Object.assign(o, body));
        return rep ? res(hit.map((o) => ({ ...o }))) : res(null, 204);
      }
    }
    if (u.hostname === 'app.midtrans.com' && u.pathname === '/snap/v1/transactions') {
      w.snap.push({ body, headers: init.headers });
      return res({ token: 't', redirect_url: 'https://app.midtrans.com/snap/v4/redirection/' + body.transaction_details.order_id }, 201);
    }
    if (u.hostname === 'api.midtrans.com') {
      const id = decodeURIComponent(u.pathname.split('/')[2]);
      w.midAsked.push(id);
      return w.mid[id] ? res(w.mid[id]) : res({ status_code: '404', status_message: 'not found' }, 404);
    }
    throw Error('unexpected fetch ' + method + ' ' + url);
  };
  return w;
}

const call = async (slug, w, body, auth = true) => {
  const h = load(slug, w);
  const r = await h(new Request('https://fn.test/' + slug, { method: 'POST', headers: auth ? { authorization: 'Bearer user-token', 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: r.status, data: await r.json() };
};
const checkout = (w, body) => call('create-lifetime-checkout', w, body);
const sign = (o, code, amount) => crypto.createHash('sha512').update(o + code + amount + KEY).digest('hex');
const notify = (w, n) => call('midtrans-lifetime-webhook', w, { status_code: '200', fraud_status: 'accept', transaction_id: 'tx', payment_type: 'qris', ...n, signature_key: sign(n.order_id, n.status_code || '200', n.gross_amount) });
const paidAnswer = (amount, extra = {}) => ({ status_code: '200', transaction_status: 'settlement', gross_amount: String(amount) + '.00', fraud_status: 'accept', transaction_id: 'tx', payment_type: 'qris', ...extra });

(async () => {
  // 1. Founder monthly, standard monthly, annual with promo, promo + founder refused, unknown plan.
  {
    let w = world();
    let r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.gross_amount_idr, 59000); assert.equal(r.data.founder_price, true); assert.equal(r.data.product_code, 'monthly_v1');
    assert.equal(r.data.period_days, 30); assert.equal(r.data.display_price_idr, 99000); assert.match(r.data.checkout_url, /^https:\/\/app\.midtrans\.com\//);
    const o = w.orders.at(-1);
    assert.equal(o.product_code, 'monthly_v1'); assert.equal(o.founder_price, true); assert.equal(o.gross_amount_idr, 59000); assert.equal(o.display_price_usd, 0);
    assert.equal(w.snap[0].body.item_details[0].id, 'rproject-monthly'); assert.equal(w.snap[0].body.transaction_details.gross_amount, 59000);
    assert.ok(w.snap[0].body.item_details[0].name.length <= 50);

    w = world({ slots: 0 });
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.data.gross_amount_idr, 99000); assert.equal(r.data.founder_price, false); assert.equal(w.orders.at(-1).founder_price, false);

    w = world({ affiliates: [{ user_id: 'aff', code: 'DJCREW' }] });
    r = await checkout(w, { product_code: 'annual_v1', promo_code: 'djcrew' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.gross_amount_idr, 719100); assert.equal(r.data.discount_percent, 10);
    assert.equal(r.data.period_days, 365); assert.equal(w.orders.at(-1).affiliate_commission_percent, 20); assert.equal(w.snap[0].body.item_details[0].id, 'rproject-annual');

    w = world({ affiliates: [{ user_id: 'aff', code: 'DJCREW' }] });
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: 'DJCREW' });
    assert.equal(r.status, 400); assert.equal(r.data.code, 'PROMO_NOT_WITH_FOUNDER'); assert.equal(w.orders.length, 0);

    w = world({ slots: 0, affiliates: [{ user_id: 'aff', code: 'DJCREW' }] });
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: 'DJCREW' });
    assert.equal(r.data.gross_amount_idr, 89100, 'promo works on the standard monthly price');

    for (const bad of ['weekly_v1', 'constructor', '__proto__', 'toString', '']) {
      w = world();
      r = await checkout(w, { product_code: bad, promo_code: '' });
      assert.equal(r.status, 400, bad); assert.equal(r.data.code, 'UNKNOWN_PLAN'); assert.equal(w.orders.length, 0);
    }
    console.log('PASS checkout plans: founder 59.000 while slots last, 99.000 after, annual + promo 719.100, promo never with founder, unknown and prototype plan names refused');
  }

  // 2. Lifetime: sold before the cutoff (website and released panel), refused after it with a message the panel shows.
  {
    let w = world();
    let r = await checkout(w, {});
    assert.equal(r.status, 200); assert.equal(r.data.product_code, 'lifetime_v1'); assert.equal(r.data.gross_amount_idr, 2000000); assert.equal(w.orders.at(-1).display_price_usd, 120);
    w = world({ now: AFTER_CUTOFF });
    r = await checkout(w, {});
    assert.equal(r.status, 410); assert.equal(r.data.code, 'LIFETIME_CLOSED'); assert.match(r.data.message, /monthly or annual plan/); assert.equal(w.snap.length, 0);
    r = await checkout(w, { product_code: 'lifetime_v1', promo_code: '' });
    assert.equal(r.status, 410);
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.status, 200, 'plans are still sold after the cutoff');
    // A lifetime checkout opened before the cutoff and paid after it still activates.
    w = world({ now: AFTER_CUTOFF, orders: [{ order_id: 'L1', product_code: 'lifetime_v1', gross_amount_idr: 2000000, created_at: new Date(AFTER_CUTOFF - 3 * 3600000).toISOString() }], mid: { L1: paidAnswer(2000000) } });
    r = await checkout(w, {});
    assert.equal(r.status, 409); assert.equal(r.data.activated, true); assert.equal(w.profile.license_status, 'lifetime');
    // After the cutoff: a lifetime transfer started before midnight can still be reopened; an unused one is not handed out.
    w = world({ now: AFTER_CUTOFF, orders: [{ order_id: 'L2', product_code: 'lifetime_v1', gross_amount_idr: 2000000, created_at: new Date(AFTER_CUTOFF - 2 * 3600000).toISOString() }], mid: { L2: { status_code: '201', transaction_status: 'pending', gross_amount: '2000000.00' } } });
    r = await checkout(w, {});
    assert.equal(r.status, 200); assert.equal(r.data.reused, true); assert.equal(r.data.order_id, 'L2');
    w = world({ now: AFTER_CUTOFF, orders: [{ order_id: 'L3', product_code: 'lifetime_v1', gross_amount_idr: 2000000, created_at: new Date(AFTER_CUTOFF - 2 * 3600000).toISOString() }] });
    r = await checkout(w, {});
    assert.equal(r.status, 410); assert.equal(w.snap.length, 0);
    // A lifetime account does not buy plans.
    w = world({ profile: { license_status: 'lifetime' } });
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.status, 409); assert.match(r.data.error, /lifetime license is already active/);
    console.log('PASS lifetime: sold until 30 Nov (panel + website), 410 with the plan price after it, open lifetime payment still activates, lifetime accounts cannot buy plans');
  }

  // 3. Reuse, switching plans, a started payment for another plan blocks.
  {
    let w = world({ orders: [{ order_id: 'M1', product_code: 'monthly_v1', gross_amount_idr: 59000, founder_price: true }] });
    let r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.data.reused, true); assert.equal(r.data.order_id, 'M1'); assert.equal(r.data.founder_price, true); assert.equal(w.snap.length, 0);
    r = await checkout(w, { product_code: 'annual_v1', promo_code: '' });
    assert.equal(r.status, 200); assert.equal(r.data.reused, false); assert.equal(r.data.product_code, 'annual_v1');
    assert.equal(w.orders.find((o) => o.order_id === 'M1').status, 'cancel', 'the unused monthly checkout is closed');
    // Released panel (no product_code, no promo_code) never continues a plan checkout as if it were lifetime.
    w = world({ orders: [{ order_id: 'M2', product_code: 'monthly_v1', gross_amount_idr: 99000 }] });
    r = await checkout(w, {});
    assert.equal(r.data.product_code, 'lifetime_v1'); assert.notEqual(r.data.order_id, 'M2');
    // A payment already started for another plan.
    w = world({ orders: [{ order_id: 'M3', product_code: 'monthly_v1', gross_amount_idr: 99000 }], mid: { M3: { status_code: '201', transaction_status: 'pending', gross_amount: '99000.00' } } });
    r = await checkout(w, { product_code: 'annual_v1', promo_code: '' });
    assert.equal(r.status, 409); assert.equal(r.data.code, 'PREVIOUS_CHECKOUT_OPEN'); assert.match(r.data.message, /another plan/);
    assert.equal(w.orders.find((o) => o.order_id === 'M3').status, 'created', 'a started payment is never cancelled');
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.data.reused, true); assert.equal(r.data.order_id, 'M3');
    console.log('PASS reuse: same plan reused (keeps founder flag), switching plan closes the unused order, panel never takes a plan order, started payment for another plan blocks');
  }

  // 4. Reconcile: a paid plan order never granted is applied instead of a new charge; granted ones allow renewals.
  {
    let w = world({ orders: [{ order_id: 'M1', product_code: 'monthly_v1', gross_amount_idr: 59000, founder_price: true, status: 'settlement', paid_at: new Date(BEFORE_CUTOFF - 7200000).toISOString() }], mid: { M1: paidAnswer(59000) } });
    let r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.status, 409); assert.equal(r.data.activated, true); assert.match(r.data.error, /already received/);
    assert.equal(w.profile.license_status, 'subscription'); assert.equal(w.profile.founder_price_locked, true); assert.equal(w.grants, 1);
    assert.equal(w.alerts.filter((a) => a.event_name === 'purchase_paid').length, 1); assert.equal(w.snap.length, 0);
    // Renewal: the granted order is done; a new founder order is created and stacks on payment.
    const end = w.profile.subscription_expires_at;
    w.midAsked = [];
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.gross_amount_idr, 59000, 'founder keeps the price while active'); assert.ok(!w.midAsked.includes('M1'));
    const renewal = w.orders.at(-1);
    let n = await notify(w, { order_id: renewal.order_id, transaction_status: 'settlement', gross_amount: '59000.00' });
    assert.equal(n.status, 200); assert.equal(Date.parse(w.profile.subscription_expires_at) - Date.parse(end), 30 * DAY, 'renewal adds 30 days on top');
    // Founder lapsed less than 7 days: still 59.000; more than 7 days: 99.000.
    w = world({ slots: 0, profile: { license_status: 'expired', founder_price_locked: true, subscription_expires_at: new Date(BEFORE_CUTOFF - 6 * DAY).toISOString() } });
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.data.gross_amount_idr, 59000);
    w = world({ slots: 50, profile: { license_status: 'expired', founder_price_locked: true, subscription_expires_at: new Date(BEFORE_CUTOFF - 8 * DAY).toISOString() } });
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.data.gross_amount_idr, 99000, 'a founder who lapsed over 7 days pays the standard price');
    // A plan revoked by hand (expired, end date still ahead) neither keeps the founder price nor stacks on the old end.
    w = world({ slots: 0, profile: { license_status: 'expired', founder_price_locked: true, subscription_plan: 'annual_v1', subscription_expires_at: new Date(BEFORE_CUTOFF + 200 * DAY).toISOString() } });
    r = await checkout(w, { product_code: 'monthly_v1', promo_code: '' });
    assert.equal(r.data.gross_amount_idr, 99000);
    n = await notify(w, { order_id: w.orders.at(-1).order_id, transaction_status: 'settlement', gross_amount: '99000.00' });
    assert.equal(Date.parse(w.profile.subscription_expires_at) - w.now, 30 * DAY, 'revoked days do not come back');
    // A founder checkout paid after the 100 spots ran out is honoured once but does not lock the price.
    w = world({ orders: [{ order_id: 'F1', product_code: 'monthly_v1', gross_amount_idr: 59000, founder_price: true }] });
    w.slots = 0;
    n = await notify(w, { order_id: 'F1', transaction_status: 'settlement', gross_amount: '59000.00' });
    assert.equal(w.profile.license_status, 'subscription'); assert.equal(w.profile.founder_price_locked, false);
    console.log('PASS reconcile + renewal: paid ungranted plan order granted once with one alert, granted orders allow renewals that stack, founder grace 7 days');
  }

  // 5. Webhook: grant once, duplicate notice quiet, lifetime account alerted, failed grant retried.
  {
    let w = world({ orders: [{ order_id: 'A1', product_code: 'annual_v1', gross_amount_idr: 799000 }] });
    let n = await notify(w, { order_id: 'A1', transaction_status: 'settlement', gross_amount: '799000.00' });
    assert.equal(n.status, 200); assert.equal(w.profile.license_status, 'subscription'); assert.equal(w.profile.subscription_plan, 'annual_v1');
    assert.equal(Date.parse(w.profile.subscription_expires_at) - w.now, 365 * DAY);
    n = await notify(w, { order_id: 'A1', transaction_status: 'settlement', gross_amount: '799000.00' });
    assert.equal(n.status, 200); assert.equal(w.grants, 1); assert.equal(w.alerts.filter((a) => a.event_name === 'purchase_paid').length, 1);
    w = world({ profile: { license_status: 'lifetime' }, orders: [{ order_id: 'M9', product_code: 'monthly_v1', gross_amount_idr: 99000 }] });
    n = await notify(w, { order_id: 'M9', transaction_status: 'settlement', gross_amount: '99000.00' });
    assert.equal(n.data.warning, 'DUPLICATE_PAYMENT'); assert.equal(w.profile.license_status, 'lifetime');
    assert.equal(w.alerts.filter((a) => a.event_name === 'purchase_duplicate').length, 1);
    w = world({ grantFail: true, orders: [{ order_id: 'M5', product_code: 'monthly_v1', gross_amount_idr: 99000 }] });
    n = await notify(w, { order_id: 'M5', transaction_status: 'settlement', gross_amount: '99000.00' });
    assert.equal(n.status, 500, 'Midtrans retries when the grant could not run');
    w.grantFail = false;
    n = await notify(w, { order_id: 'M5', transaction_status: 'settlement', gross_amount: '99000.00' });
    assert.equal(n.status, 200); assert.equal(w.profile.license_status, 'subscription');
    n = await notify(w, { order_id: 'M5', transaction_status: 'settlement', gross_amount: '1.00' });
    assert.equal(n.status, 400, 'amount mismatch still refused');
    console.log('PASS webhook plans: 365 days granted once, repeated notice quiet, paid plan on a lifetime account alerted, failed grant retried, amount checked');
  }

  // 6. Check payment: grants a settled plan order, then answers "paid" from the granted order without asking Midtrans.
  {
    const w = world({ orders: [{ order_id: 'M7', product_code: 'monthly_v1', gross_amount_idr: 99000 }], mid: { M7: paidAnswer(99000) } });
    let r = await call('check-lifetime-payment', w, {});
    assert.equal(r.status, 200); assert.equal(r.data.paid, true); assert.equal(r.data.product_code, 'monthly_v1'); assert.ok(r.data.subscription_expires_at);
    assert.equal(w.grants, 1); assert.equal(w.alerts.filter((a) => a.event_name === 'purchase_paid').length, 1);
    w.midAsked = [];
    r = await call('check-lifetime-payment', w, {});
    assert.equal(r.data.paid, true); assert.equal(r.data.order_id, 'M7'); assert.deepEqual(w.midAsked, []); assert.equal(w.grants, 1);
    console.log('PASS check payment plans: settled plan order granted with one alert; afterwards answered from the granted order');
  }
})().catch((e) => { console.error(e); process.exit(1); });
