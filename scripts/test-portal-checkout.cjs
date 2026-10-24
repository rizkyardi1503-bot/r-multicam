// Website checkout details: the affiliate ?ref= code survives sign-up and later visits (30 days), an emptied promo
// field forgets it, server sentences are shown instead of codes, and "already paid" (409) refreshes the account.
// Usage: node scripts/test-portal-checkout.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const REF_KEY = 'rp_affiliate_ref_v1', DAY = 86400000;

function makeStorage(init = {}) { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m }; }

async function portal({ search = '', storage = makeStorage(), checkout = () => ({ status: 200, body: { checkout_url: 'https://app.midtrans.com/snap/test', charge_currency: 'IDR', gross_amount_idr: 2000000 } }) } = {}) {
  const els = new Map();
  const elem = () => ({ hidden: false, value: '', textContent: '', href: '', dataset: {}, classList: { toggle() {}, contains() { return false; } }, scrollIntoView() {}, setAttribute() {}, removeAttribute() {}, replaceChildren() {}, appendChild() {}, remove() {}, checkValidity() { return true; }, click() {}, style: {} });
  const el = (id) => { if (!els.has(id)) els.set(id, elem()); return els.get(id); };
  const dialog = elem(); dialog.querySelector = (q) => el(q.replace(/^#/, '')); dialog.querySelectorAll = () => []; dialog.showModal = () => {}; dialog.close = () => {};
  const log = { bodies: [], profileReads: 0 };
  const w = { RP_CONFIG: { supabaseUrl: 'https://api.test', supabasePublishableKey: 'public', checkoutOpen: true }, location: { pathname: '/', search, assign(u) { log.opened = u; } }, addEventListener() {} };
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const ctx = {
    window: w, document: { createElement: (t) => (t === 'dialog' ? dialog : elem()), body: { appendChild() {} }, querySelectorAll: () => [] },
    localStorage: storage, URL, URLSearchParams, AbortSignal, Uint8Array, Date, setTimeout() {},
    fetch: async (u, o) => {
      if (u.includes('/auth/v1/user')) return res(200, { id: 'user1', email: 'person@example.com' });
      if (u.includes('/rest/v1/plugin_profiles')) { log.profileReads++; return res(200, [{ license_status: 'trial', plugin_version: '2.3.11.8' }]); }
      if (u.includes('/rest/v1/plugin_payment_orders')) return res(200, []);
      if (u.includes('create-lifetime-checkout')) { log.bodies.push(JSON.parse(o.body)); const r = checkout(); return res(r.status, r.body); }
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
})().catch((e) => { console.error(e); process.exitCode = 1; });
