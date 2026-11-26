// Website checkout details: the affiliate ?ref= code survives sign-up and later visits (30 days), an emptied promo
// field forgets it, server sentences are shown instead of codes, and "already paid" (409) refreshes the account.
// Usage: node scripts/test-portal-checkout.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const REF_KEY = 'rp_affiliate_ref_v1', DAY = 86400000;

function makeStorage(init = {}) { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; }

async function portal({ search = '', storage = makeStorage(), profile = { license_status: 'trial', plugin_version: '2.3.11.8' }, newColumnsFail = false, buyButtons = [], payment = () => ({ status: 200, body: { paid: false, status: 'pending' } }), checkout = () => ({ status: 200, body: { checkout_url: 'https://app.midtrans.com/snap/test', charge_currency: 'IDR', gross_amount_idr: 2000000 } }) } = {}) {
  const els = new Map();
  const elem = () => ({ hidden: false, value: '', textContent: '', href: '', dataset: {}, classList: { toggle() {}, contains() { return false; } }, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, replaceChildren() {}, appendChild() {}, remove() {}, checkValidity() { return true; }, click() {}, style: {} });
  const el = (id) => { if (!els.has(id)) els.set(id, elem()); return els.get(id); };
  const dialog = elem(); dialog.querySelector = (q) => el(q.replace(/^#/, '')); dialog.querySelectorAll = () => []; dialog.showModal = () => {}; dialog.close = () => {};
  const log = { bodies: [], profileReads: 0, profileUrls: [] };
  const w = { RP_CONFIG: { supabaseUrl: 'https://api.test', supabasePublishableKey: 'public', checkoutOpen: true }, location: { pathname: '/', search, assign(u) { log.opened = u; } }, addEventListener() {} };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const ctx = {
    window: w, document: { createElement: (t) => (t === 'dialog' ? dialog : elem()), body: { appendChild() {} }, querySelectorAll: (q) => (q === '[data-buy]' ? buyButtons : []) },
    localStorage: storage, URL, URLSearchParams, AbortSignal, Uint8Array, Date, setTimeout() {},
    fetch: async (u, o) => {
      if (u.includes('/auth/v1/user')) return res(200, { id: 'user1', email: 'person@example.com' });
      if (u.includes('/rest/v1/plugin_profiles')) { log.profileReads++; log.profileUrls.push(u); if (newColumnsFail && u.includes('subscription_expires_at')) return res(400, { message: 'column plugin_profiles.subscription_expires_at does not exist' }); return res(200, [profile]); }
      if (u.includes('/rest/v1/plugin_payment_orders')) return res(200, []);
      if (u.includes('create-lifetime-checkout')) { log.bodies.push(JSON.parse(o.body)); const r = checkout(); return res(r.status, r.body); }
      if (u.includes('check-lifetime-payment')) { const r = payment(); return res(r.status, r.body); }
      throw Error('Unexpected request ' + u);
    }
  };
  const src = fs.readFileSync(path.join(__dirname, '../site/portal.js'), 'utf8').replace(' bootstrap().catch(error=>say(friendly(error),true));', ' window.test={acceptSession,purchase,friendly};');
  vm.runInNewContext(src, ctx);
  await w.test.acceptSession({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
  return { t: w.test, el, log, storage };
}

(async () => {
  // Referral link: code saved and used at checkout.
  { const p = await portal({ search: '?ref=friend' });
    assert.equal(p.el('promo-code').value, 'FRIEND'); assert.equal(JSON.parse(p.storage.getItem(REF_KEY)).code, 'FRIEND');
    await p.t.purchase(); assert.equal(p.log.bodies[0].promo_code, 'FRIEND'); }
  // Later visit without ?ref= (after sign-up / email confirmation): saved code still fills checkout.
  { const p = await portal({ storage: makeStorage({ [REF_KEY]: JSON.stringify({ code: 'FRIEND', at: Date.now() - 2 * DAY }) }) });
    assert.equal(p.el('promo-code').value, 'FRIEND'); }
  // An invalid ?ref= in the link does not hide a valid saved code.
  { const p = await portal({ search: '?ref=x-y', storage: makeStorage({ [REF_KEY]: JSON.stringify({ code: 'FRIEND', at: Date.now() - DAY }) }) });
    assert.equal(p.el('promo-code').value, 'FRIEND'); }
  // Older than 30 days or malformed: ignored.
  { const p = await portal({ storage: makeStorage({ [REF_KEY]: JSON.stringify({ code: 'FRIEND', at: Date.now() - 31 * DAY }) }) }); assert.equal(p.el('promo-code').value, ''); }
  { const p = await portal({ storage: makeStorage({ [REF_KEY]: '{"code":"<x>","at":1}' }) }); assert.equal(p.el('promo-code').value, ''); }
  // Customer removes the code: standard price and the saved code is forgotten.
  { const p = await portal({ search: '?ref=friend' }); p.el('promo-code').value = ''; await p.t.purchase();
    assert.equal(p.log.bodies[0].promo_code, ''); assert.equal(p.storage.getItem(REF_KEY), null); }
  // Blocked storage: no crash, link code still used.
  { const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); }, removeItem() { throw Error('blocked'); } };
    const p = await portal({ search: '?ref=friend', storage: blocked }); assert.equal(p.el('promo-code').value, 'FRIEND'); }
  // Pages without the portal (guides, affiliate page): analytics.js saves the code too.
  { const storage = makeStorage(), w = { localStorage: storage, sessionStorage: makeStorage() };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../site/analytics.js'), 'utf8'), { window: w, localStorage: storage, sessionStorage: w.sessionStorage, crypto: require('crypto').webcrypto, URL, URLSearchParams, location: { search: '?ref=Friend&utm_source=instagram', pathname: '/guides/' }, document: { referrer: '', title: 'Guide', querySelectorAll: () => [], getElementById: () => null }, fetch: async () => ({}) });
    assert.equal(JSON.parse(storage.getItem(REF_KEY)).code, 'FRIEND'); }
  console.log('PASS referral: link saved (portal and every page), prefilled after sign-up/later visit, 30-day expiry, malformed ignored, removal forgets it, blocked storage');

  // Server sentence wins over its code; bare codes become sentences.
  { const p = await portal({ checkout: () => ({ status: 502, body: { error: 'MIDTRANS_CREATE_FAILED', message: 'Payment provider is temporarily unavailable.' } }) });
    await assert.rejects(p.t.purchase(), /^Error: Payment provider is temporarily unavailable\.$/); }
  { const p = await portal({ checkout: () => ({ status: 500, body: { error: 'ORDER_LOOKUP_FAILED' } }) });
    const e = await p.t.purchase().then(() => null, (x) => x); assert.equal(p.t.friendly(e), 'Checkout could not be prepared. Please try again in a minute.');
    assert.equal(p.t.friendly(Error('AUTH_REQUIRED')), 'Your session ended. Sign in again.');
    assert.match(p.t.friendly(Error('SOMETHING_NEW')), /^Something went wrong \(SOMETHING_NEW\)\./);
    assert.equal(p.t.friendly(Error('Promo code is invalid or is not approved yet.')), 'Promo code is invalid or is not approved yet.'); }
  // One open checkout per customer: the 409 sentence is shown as an error.
  { const p = await portal({ checkout: () => ({ status: 409, body: { error: 'Your previous payment is still being processed. Finish it, or wait a few minutes and try again.', code: 'PREVIOUS_CHECKOUT_OPEN' } }) });
    await assert.rejects(p.t.purchase(), /previous payment is still being processed/); }
  // Already paid (409): no error, account reloaded, success message shown.
  { const p = await portal({ checkout: () => ({ status: 409, body: { error: 'Your payment was already received. Your lifetime license is now active.', activated: true } }) });
    const before = p.log.profileReads; await p.t.purchase();
    assert(p.log.profileReads > before, 'account reloaded'); assert.match(p.el('account-message').textContent, /already received/); assert(p.el('checkout-confirm').hidden); }
  console.log('PASS errors: server sentence over code, codes mapped, busy 409 shown, already-paid 409 refreshes the account');

  const tick = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const buyBtn = (code) => ({ onclick: null, getAttribute: (k) => (k === 'data-buy' ? code : null), dataset: {}, hidden: false });

  // Plan buttons send {product_code, promo_code}; the website always sends both fields.
  { const p = await portal(); p.el('promo-code').value = '';
    await p.t.purchase('annual_v1'); assert.deepEqual(p.log.bodies[0], { product_code: 'annual_v1', promo_code: '' });
    await p.t.purchase('lifetime_v1'); assert.deepEqual(p.log.bodies[1], { product_code: 'lifetime_v1', promo_code: '' });
    await p.t.purchase(); assert.equal(p.log.bodies[2].product_code, 'monthly_v1', 'no plan chosen means Monthly');
    await p.t.purchase('bogus_v9'); assert.equal(p.log.bodies[3].product_code, 'monthly_v1', 'unknown codes are never sent'); }
  // Dialog buttons and the data-buy buttons on the page choose the plan.
  { const buttons = [buyBtn('monthly_v1'), buyBtn('annual_v1'), buyBtn('lifetime_v1'), buyBtn('')];
    const p = await portal({ search: '?ref=friend', buyButtons: buttons });
    p.el('buy-monthly').onclick(); await tick(); p.el('buy-annual').onclick(); await tick(); p.el('buy-lifetime').onclick(); await tick();
    assert.deepEqual(p.log.bodies.map((b) => b.product_code), ['monthly_v1', 'annual_v1', 'lifetime_v1']); assert(p.log.bodies.every((b) => b.promo_code === 'FRIEND'));
    p.log.bodies.length = 0;
    for (const b of buttons) { b.onclick(); await tick(); }
    assert.deepEqual(p.log.bodies.map((b) => b.product_code), ['monthly_v1', 'annual_v1', 'lifetime_v1', 'monthly_v1'], 'page buttons: data-buy value, bare data-buy = Monthly'); }
  // Checkout answer for a plan: plan name, amount, founder price, no recurring wording for plans.
  { const p = await portal({ checkout: () => ({ status: 200, body: { checkout_url: 'https://app.midtrans.com/snap/test', charge_currency: 'IDR', gross_amount_idr: 59000, product_code: 'monthly_v1', period_days: 30, founder_price: true } }) });
    await p.t.purchase('monthly_v1'); assert.equal(p.el('checkout-plan').textContent, 'Monthly plan · 30 days'); assert.match(p.el('checkout-amount').textContent, /^· IDR 59\.000$/); assert.equal(p.el('checkout-extra').textContent, 'Founder price applied.');
    assert.match(p.el('checkout-rate').textContent, /no automatic renewal/); assert.equal(p.log.opened, 'https://app.midtrans.com/snap/test'); }
  { const p = await portal({ checkout: () => ({ status: 200, body: { checkout_url: 'https://app.midtrans.com/snap/test', charge_currency: 'IDR', gross_amount_idr: 719100, product_code: 'annual_v1', period_days: 365, founder_price: false, discount_percent: 10 } }) });
    await p.t.purchase('annual_v1'); assert.equal(p.el('checkout-plan').textContent, 'Annual plan · 365 days'); assert.equal(p.el('checkout-extra').textContent, '10% affiliate discount applied.'); }
  { const p = await portal(); await p.t.purchase('lifetime_v1'); assert.equal(p.el('checkout-plan').textContent, 'Lifetime license'); assert.match(p.el('checkout-rate').textContent, /^Displayed lifetime price: Rp2\.000\.000 one-time/); }
  // Every error in the API contract.
  { const p = await portal({ checkout: () => ({ status: 400, body: { error: 'Promo codes cannot be combined with the founder price.', code: 'PROMO_NOT_WITH_FOUNDER' } }) });
    const e = await p.t.purchase('monthly_v1').then(() => null, (x) => x); assert.equal(p.t.friendly(e), 'A code cannot be used with the founder price. Remove it to continue.'); assert.equal(p.log.opened, undefined); }
  { const p = await portal({ checkout: () => ({ status: 410, body: { error: 'Lifetime sales have ended.', code: 'LIFETIME_CLOSED' } }) });
    const e = await p.t.purchase('lifetime_v1').then(() => null, (x) => x); assert.equal(p.t.friendly(e), 'Lifetime sales ended on 30 November 2026. Choose a Monthly or Annual plan instead.'); }
  { const p = await portal({ checkout: () => ({ status: 410, body: { error: 'LIFETIME_CLOSED' } }) });
    const e = await p.t.purchase('lifetime_v1').then(() => null, (x) => x); assert.match(p.t.friendly(e), /^Lifetime sales ended on 30 November 2026/, 'bare code in the error field'); }
  { const p = await portal({ checkout: () => ({ status: 409, body: { error: 'Your previous payment is still being processed. Finish it, or wait a few minutes and try again.', code: 'PREVIOUS_CHECKOUT_OPEN' } }) });
    await assert.rejects(p.t.purchase('annual_v1'), /previous payment is still being processed/); }
  { const p = await portal({ checkout: () => ({ status: 409, body: { error: 'Your payment was already received.', activated: true } }) });
    const before = p.log.profileReads; await p.t.purchase('monthly_v1'); assert(p.log.profileReads > before, 'account reloaded');
    assert.equal(p.el('account-message').textContent, 'Your payment was already received and your access is active.'); assert(p.el('checkout-confirm').hidden); }
  { const p = await portal({ checkout: () => ({ status: 409, body: { error: 'Your lifetime license is already active.' } }) });
    const before = p.log.profileReads; await p.t.purchase('monthly_v1'); assert(p.log.profileReads > before); assert.equal(p.el('account-message').textContent, 'Your lifetime license is already active.'); }
  { const p = await portal({ checkout: () => ({ status: 403, body: { error: 'Confirm your email before purchasing.' } }) });
    await assert.rejects(p.t.purchase('monthly_v1'), /Confirm your email before purchasing/); }
  console.log('PASS plans: buttons send {product_code, promo_code}; plan checkout shown; 400 founder+code, 410 lifetime closed, 409 busy / already active / activated, 403 handled');

  // Account state comes from the user's own plugin_profiles row.
  const FAR = '2099-12-21T12:00:00Z', GONE = '2020-01-05T12:00:00Z';
  { const p = await portal({ profile: { license_status: 'subscription', subscription_plan: 'monthly_v1', subscription_expires_at: FAR, founder_price_locked: true } });
    assert.equal(p.el('license-state').textContent, 'MONTHLY'); assert.equal(p.el('license-detail').textContent, 'Active until 21 Dec 2099.'); assert.equal(p.el('account-summary').textContent, 'Monthly plan');
    assert.equal(p.el('founder-badge').hidden, false, 'founder badge'); assert.equal(p.el('plan-title').textContent, 'Renew your plan'); assert.equal(p.el('account-purchase').hidden, false, 'renew buttons stay available');
    assert.match(p.log.profileUrls[0], /subscription_expires_at,subscription_plan,founder_price_locked/); }
  { const p = await portal({ profile: { license_status: 'subscription', subscription_plan: 'annual_v1', subscription_expires_at: FAR, founder_price_locked: false } });
    assert.equal(p.el('license-state').textContent, 'ANNUAL'); assert.equal(p.el('account-summary').textContent, 'Annual plan'); assert.equal(p.el('founder-badge').hidden, true); }
  // Lapsed plan: expired, plan cards, no founder badge once the 7 days are over.
  { const p = await portal({ profile: { license_status: 'subscription', subscription_plan: 'monthly_v1', subscription_expires_at: GONE, founder_price_locked: true } });
    assert.equal(p.el('license-state').textContent, 'EXPIRED'); assert.equal(p.el('license-detail').textContent, 'Ended on 5 Jan 2020. Choose a plan to continue.'); assert.equal(p.el('account-summary').textContent, 'Plan ended');
    assert.equal(p.el('plan-title').textContent, 'Choose a plan'); assert.equal(p.el('account-purchase').hidden, false); assert.equal(p.el('founder-badge').hidden, true); }
  // Lapsed less than 7 days ago: the founder price is still kept.
  { const p = await portal({ profile: { license_status: 'subscription', subscription_plan: 'monthly_v1', subscription_expires_at: new Date(Date.now() - 2 * DAY).toISOString(), founder_price_locked: true } });
    assert.equal(p.el('license-state').textContent, 'EXPIRED'); assert.equal(p.el('founder-badge').hidden, false); }
  // Lifetime customers see no purchase buttons; trial accounts see the plan cards.
  { const p = await portal({ profile: { license_status: 'lifetime', lifetime_activated_at: '2026-10-01T00:00:00Z' } }); assert.equal(p.el('account-purchase').hidden, true); assert.equal(p.el('check-payment').hidden, true); assert.equal(p.el('account-summary').textContent, 'Lifetime customer'); }
  { const p = await portal(); assert.equal(p.el('account-purchase').hidden, false); assert.equal(p.el('plan-title').textContent, 'Choose a plan'); assert.equal(p.el('founder-badge').hidden, true); }
  // The new columns are not in the database yet: the account still loads with the older columns.
  { const p = await portal({ newColumnsFail: true }); assert.equal(p.log.profileUrls.length, 2); assert(!p.log.profileUrls[1].includes('subscription_expires_at')); assert.equal(p.el('license-state').textContent, 'TRIAL'); }
  console.log('PASS account: active plan (dates, founder badge, renew), annual, lapsed plan (cards), lapsed within 7 days keeps founder, lifetime, trial, older database columns');

  // Check payment for a plan order.
  for (const body of [{ paid: true, status: 'paid', product_code: 'monthly_v1', subscription_expires_at: FAR }, { paid: true, status: 'paid' }]) {
    const p = await portal({ payment: () => ({ status: 200, body }) }); const before = p.log.profileReads;
    await p.el('check-payment').onclick(); assert.equal(p.el('account-message').textContent, 'Payment verified. Refresh your license in the Premiere plugin.'); assert(p.log.profileReads > before, 'account reloaded, so the plan end date shows'); }
  { const p = await portal(); await p.el('check-payment').onclick(); assert.match(p.el('account-message').textContent, /No completed payment was confirmed yet/); }
  console.log('PASS check payment: plan and lifetime replies verify the payment and reload the account');

  // Indonesian: every new sentence, and the dynamic ones, translate.
  { const w = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../site/i18n-id.js'), 'utf8'), { window: w, document: { body: null, addEventListener() {} }, MutationObserver: class {}, NodeFilter: {}, WeakMap });
    const translate = w.RP_I18N.translate;
    const cases = { 'Active until 21 Dec 2099.': 'Aktif sampai 21 Dec 2099.', 'Ended on 5 Jan 2020. Choose a plan to continue.': 'Berakhir pada 5 Jan 2020. Pilih paket untuk melanjutkan.', '10% affiliate discount applied.': 'Diskon afiliasi 10% diterapkan.', 'Founder price applied.': 'Harga founder diterapkan.',
      'A code cannot be used with the founder price. Remove it to continue.': 'Kode tidak bisa dipakai bersama harga founder. Hapus kode untuk melanjutkan.', 'Lifetime sales ended on 30 November 2026. Choose a Monthly or Annual plan instead.': 'Penjualan lifetime berakhir pada 30 November 2026. Pilih paket Bulanan atau Tahunan.',
      'Monthly plan · 30 days': 'Paket Bulanan · 30 hari', 'Annual plan · 365 days': 'Paket Tahunan · 365 hari', 'Monthly plan': 'Paket Bulanan', 'Annual plan': 'Paket Tahunan', 'Plan ended': 'Paket berakhir', 'MONTHLY': 'BULANAN', 'ANNUAL': 'TAHUNAN', 'FOUNDER PRICE': 'HARGA FOUNDER', 'Choose a plan': 'Pilih paket', 'Renew your plan': 'Perpanjang paketmu', 'Lifetime license': 'Lisensi lifetime' };
    for (const [en, id] of Object.entries(cases)) assert.equal(translate(en), id, en);
    for (const en of ['Your payment was already received and your access is active.', 'Prepaid, no automatic renewal. Days paid early are added to the days you have left.', 'Create an account or sign in to continue to checkout.', 'Signed in with Google. Choose your plan to continue to checkout.', 'Your access has ended. Choose a Monthly or Annual plan to continue.', 'Choose a plan to continue using Multicam AI.']) assert.notEqual(translate(en), en, en); }
  console.log('PASS Indonesian dictionary covers the plan sentences, dates and error messages');
})().catch((e) => { console.error(e); process.exitCode = 1; });
