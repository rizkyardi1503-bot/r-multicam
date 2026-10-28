// Phone visitors (mostly Instagram) cannot install the plugin: the site must send them to their computer instead of
// dead-ending. Covers the send-to-laptop view, Copy link, in-app browser handling (no Google button, no mailto),
// download buttons and ?download= on a phone, "download anyway", post-signup text and the desktop path unchanged.
// Usage: node scripts/test-mobile-handoff.cjs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const IG_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 350.0';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36';

function run({ ua, search = '', pathname = '/', clipboard = true, share = false } = {}) {
  const els = new Map(), events = [], fetches = [];
  const classSet = () => { const s = new Set(); return { toggle(c, on) { if (on === undefined ? !s.has(c) : on) s.add(c); else s.delete(c); }, add(c) { s.add(c); }, contains: (c) => s.has(c), remove(c) { s.delete(c); } }; };
  const elem = (extra = {}) => ({ hidden: false, value: '', textContent: '', href: '', dataset: {}, classList: classSet(), setAttribute() {}, removeAttribute(n) { delete this[n]; }, replaceChildren() {}, appendChild() {}, remove() {}, checkValidity() { return true; }, click() { return this.onclick && this.onclick({ preventDefault() {} }); }, focus() {}, scrollIntoView() {}, style: {}, closest: () => null, matches: () => false, ...extra });
  const el = (id) => { if (!els.has(id)) els.set(id, elem()); return els.get(id); };
  const portal = elem(); portal.querySelector = (q) => el(q.replace(/^#/, '')); portal.querySelectorAll = () => []; portal.showModal = () => { portal.open = true; }; const closers = []; portal.addEventListener = (t, fn) => { if (t === 'close') closers.push(fn); }; portal.close = () => { portal.open = false; closers.forEach((fn) => fn()); };
  // Homepage buttons: hero handoff + trial, sticky bar handoff, two download buttons.
  const signup = elem({ matches: (s) => s === '[data-signup]' });
  const heroHandoff = elem({ nextElementSibling: signup, hidden: true });
  const barHandoff = elem({ closest: (s) => (s === '[data-mobile-cta]' ? {} : null), hidden: true });
  const dlWin = elem({ dataset: { download: 'windows' } }), dlMac = elem({ dataset: { download: 'macos' } });
  const page = { '[data-handoff]': [heroHandoff, barHandoff], '[data-download]': [dlWin, dlMac], '[data-signup]': [signup], '[data-login]': [] };
  const nav = { userAgent: ua, platform: /iPhone/.test(ua) ? 'iPhone' : 'Win32', maxTouchPoints: /iPhone/.test(ua) ? 5 : 0 };
  if (clipboard) nav.clipboard = { writeText: async (t) => { nav.copied = t; } };
  if (share) nav.share = async () => {};
  const w = { RP_CONFIG: { supabaseUrl: 'https://api.test', supabasePublishableKey: 'public', checkoutOpen: true }, location: { origin: 'https://r-multicam.pages.dev', pathname, search, href: 'https://r-multicam.pages.dev' + pathname + search }, addEventListener() {}, RP_ANALYTICS: { track: (name, meta) => events.push([name, meta]) }, history: { replaceState() {} } };
  const ctx = { navigator: nav, window: w, history: w.history, document: { createElement: (t) => (t === 'dialog' ? portal : elem()), body: { appendChild() {} }, querySelectorAll: (q) => page[q] || [], querySelector: () => null },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} }, URL, URLSearchParams, AbortSignal, Uint8Array, Date, setTimeout() {}, console,
    fetch: async (u) => { fetches.push(u); return { ok: false, status: 401, json: async () => ({}) }; } };
  const src = fs.readFileSync(path.join(__dirname, '../site/portal.js'), 'utf8').replace(' bootstrap().catch(error=>say(friendly(error),true));', ' window.test={bootstrap,phoneView};');
  vm.runInNewContext(src, ctx);
  return { el, portal, events, fetches, nav, w, heroHandoff, barHandoff, signup, dlWin, dlMac };
}
const handoffView = (p) => p.portal.classList.contains('handoff-view') && !p.el('phone-handoff').hidden;
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  // Instagram on iPhone: hero handoff opens the send-to-laptop view (no WhatsApp jump), Google hidden, no mailto.
  { const p = run({ ua: IG_IPHONE });
    assert(!p.heroHandoff.hidden && !p.barHandoff.hidden, 'handoff buttons shown on a phone');
    assert(p.signup.classList.contains('secondary'), 'trial button steps back to secondary');
    assert.equal(p.el('google-signin').hidden, true, 'Google sign-in hidden in the Instagram browser');
    assert.equal(p.el('inapp-note').hidden, false, 'in-app note explains why');
    assert.equal(p.el('handoff-email').hidden, true, 'mailto hidden in the Instagram browser');
    p.heroHandoff.click();
    assert(p.portal.open && handoffView(p), 'hero opens the send-to-laptop view');
    assert.equal(p.events.length, 0, 'opening alone is not a trial click');
    await p.el('handoff-copy').onclick(); await tick();
    assert(p.events.some(([n, m]) => n === 'trial_cta_clicked' && m.method === 'copy' && m.entry_point === 'hero'), 'copy keeps the hero entry point');
    assert.match(p.nav.copied, /^https:\/\/r-multicam\.pages\.dev\/\?utm_source=handoff&utm_medium=copy&utm_campaign=mobile_to_desktop$/);
    assert.match(p.el('handoff-status').textContent, /^Link copied\./);
    // Switch to creating the account here: form back, one-line way back to the handoff.
    p.el('handoff-account').onclick();
    assert(!p.portal.classList.contains('handoff-view') && p.el('phone-handoff').hidden && !p.el('handoff-open').hidden, 'account form with handoff opener');
    p.el('handoff-open').onclick(); assert(handoffView(p), 'opener returns to the handoff');
    p.barHandoff.click(); p.el('handoff-whatsapp').onclick(); assert(p.events.some(([n, m]) => m && m.method === 'whatsapp' && m.entry_point === 'mobile_bar'));
    // Closing ends the handoff view: other buttons (Buy, My license) reopen on their own content.
    p.portal.close(); assert(!p.portal.classList.contains('handoff-view') && p.el('phone-handoff').hidden, 'close resets the view');
    console.log('PASS Instagram phone: handoff view from hero/sticky bar, Copy link with handoff UTM, no Google/mailto in-app, account form toggle'); }

  // Clipboard blocked: the link is shown to copy by hand and the failure is recorded as such.
  { const p = run({ ua: IG_IPHONE, clipboard: false }); p.heroHandoff.click(); await p.el('handoff-copy').onclick();
    assert.match(p.el('handoff-status').textContent, /^Copy this link and open it on your laptop: https:\/\/r-multicam\.pages\.dev\/\?utm_source=handoff/);
    assert(p.events.some(([n, m]) => m && m.method === 'copy_failed')); }
  // In-app browser matrix: Google and mailto hidden only in app webviews, never in real browsers.
  for (const [name, ua, inApp] of [
    ['Instagram Android', 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 Instagram 350.0.0', true],
    ['Facebook iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/480.0]', true],
    ['Threads iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Barcelona 350.0', true],
    ['TikTok Android', 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36 musical_ly_2023', true],
    ['Chrome Android', 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', false],
    ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36', false],
    ['Safari iPhone', SAFARI_IPHONE, false]]) {
    const p = run({ ua }); assert.equal(p.el('google-signin').hidden, inApp, name + ': Google ' + (inApp ? 'hidden' : 'kept')); assert.equal(p.el('handoff-email').hidden, inApp, name + ': email ' + (inApp ? 'hidden' : 'kept')); }

  // Trial button on a phone: account form first (not two screens of handoff), opener visible.
  { const p = run({ ua: SAFARI_IPHONE, share: true }); p.signup.onclick();
    assert(p.portal.open && p.el('phone-handoff').hidden && !p.el('handoff-open').hidden, 'trial shows the form with the opener');
    assert.equal(p.el('google-signin').hidden, false, 'Safari keeps Google sign-in');
    assert.equal(p.el('handoff-email').hidden, false, 'Safari keeps the email option');
    assert.equal(p.el('handoff-share').hidden, false, 'share sheet offered when available'); }

  // Download buttons on a phone: handoff first, no request; "anyway" continues to sign-in.
  { const p = run({ ua: SAFARI_IPHONE }); p.dlWin.onclick();
    assert(handoffView(p), 'download opens the handoff');
    assert.equal(p.el('handoff-title').textContent, 'The installer is for your laptop or PC.');
    assert.equal(p.el('handoff-anyway').hidden, false, '"download anyway" offered');
    assert.equal(p.fetches.length, 0, 'nothing requested yet');
    p.el('handoff-whatsapp').onclick(); assert(p.events.some(([n, m]) => m && m.method === 'whatsapp' && m.entry_point === 'download'), 'download entry point kept');
    p.el('handoff-anyway').onclick();
    assert(!p.portal.classList.contains('handoff-view'), 'back to the account form');
    assert.match(p.el('account-message').textContent, /Sign in or create a free account to download the Windows installer/);
    p.dlMac.onclick(); assert(!p.portal.classList.contains('handoff-view'), 'after "anyway" the phone is not asked again'); }

  // ?download=windows opened on a phone: handoff first.
  { const p = run({ ua: SAFARI_IPHONE, search: '?download=windows' }); await p.w.test.bootstrap(); await tick();
    assert(handoffView(p) && !p.el('handoff-anyway').hidden, 'deep link opens the handoff'); }

  // ID page: Copy link points to /id/.
  { const p = run({ ua: IG_IPHONE, pathname: '/id/' }); p.heroHandoff.click(); await p.el('handoff-copy').onclick();
    assert.match(p.nav.copied, /^https:\/\/r-multicam\.pages\.dev\/id\/\?utm_source=handoff/); }
  console.log('PASS phone: trial shows the form, download buttons and ?download= hand off first, "download anyway", clipboard fallback, ID link');

  // Desktop: unchanged (no handoff, download goes straight to sign-in).
  { const p = run({ ua: DESKTOP });
    assert(p.heroHandoff.hidden && p.barHandoff.hidden, 'no handoff buttons on desktop');
    assert.equal(p.el('google-signin').hidden, false);
    p.dlWin.onclick(); assert(!p.portal.classList.contains('handoff-view'), 'desktop never enters the handoff view');
    assert.match(p.el('account-message').textContent, /Sign in or create a free account to download the Windows installer/); }
  console.log('PASS desktop: no handoff, download goes straight to sign-in');
})().catch((e) => { console.error(e); process.exitCode = 1; });
