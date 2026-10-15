// Regression test for the inline language router (src/i18n/lang-router.js, built into every page).
// Auth callbacks must never be redirected; any redirect must keep the query string and hash.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const ORIGIN = 'https://r-multicam.pages.dev';

function routerOf(rel) {
  const m = /<!--rp:lang-->[\s\S]*?<script>([\s\S]*?)<\/script><!--\/rp:lang-->/.exec(read(rel));
  return m && m[1];
}
const router = routerOf('site/index.html');
assert(router, 'router missing on /');
assert.equal(routerOf('site/id/index.html'), router, 'EN and ID pages must ship the same router');
assert.equal(routerOf('site/auth/confirmed/index.html'), null, 'auth confirmation page must not carry the router');

function visit(url, { lang = 'en', languages = ['en-US'], stored = {}, ua = 'Mozilla/5.0', country = null, before = null, pluginGoogle = false } = {}) {
  const u = new URL(url, ORIGIN);
  const enPath = u.pathname.replace(/^\/id(\/|$)/, '/');
  const alts = { en: ORIGIN + enPath, id: ORIGIN + '/id' + enPath };
  const replaced = [], store = new Map(Object.entries(stored));
  const location = { href: u.href, search: u.search, hash: u.hash, pathname: u.pathname, replace: x => replaced.push(x) };
  let trace = null;
  const window = { localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) } };
  if (pluginGoogle) window.RP_PLUGIN_GOOGLE_ACTIVE = true;
  const document = {
    documentElement: { lang },
    addEventListener: () => {},
    querySelector: sel => {
      const m = /hreflang="(en|id)"/.exec(sel);
      if (m) return { href: alts[m[1]] };
      if (sel === 'dialog[open]') return null;
      return null;
    },
  };
  const ctx = {
    window, document, location, URL,
    navigator: { userAgent: ua, languages, language: languages[0], webdriver: false },
    fetch: () => { trace = Promise.resolve({ text: () => Promise.resolve(country ? 'loc=' + country + '\n' : '') }); return trace; },
  };
  vm.runInNewContext(router, ctx);
  return { replaced, store, location, window, settle: async () => { if (before) before(location, window); if (trace) { await trace; for (let i = 0; i < 5; i++) await null; } return replaced; } };
}

(async () => {
  const idBrowser = { languages: ['id-ID', 'en'] };
  // 1. Auth / relay callbacks: never redirected, even for Indonesian visitors with a remembered choice.
  const authUrls = [
    '/?oauth=google&code=one-use-pkce-code',
    '/?code=abc',
    '/#access_token=at&refresh_token=rt&expires_in=3600&token_type=bearer&type=signup',
    '/#access_token=at&provider_token=pt&refresh_token=rt',
    '/?oauth=google#error=access_denied&error_code=403&error_description=denied',
    '/?error=server_error&error_description=x',
    '/#type=recovery&access_token=at',
    '/?token_hash=abc&type=signup',
    '/#plugin-google=' + encodeURIComponent(JSON.stringify({ port: 45321, state: 'a'.repeat(64), challenge: 'b'.repeat(43) })),
    '/?download=windows',
    '/?account=signin',
  ];
  for (const url of authUrls) {
    for (const opts of [idBrowser, { ...idBrowser, stored: { 'rp-lang': 'id' } }, { stored: { 'rp-lang-auto': 'id' } }, { country: 'ID' }]) {
      const v = visit(url, opts);
      assert.deepEqual(await v.settle(), [], 'redirected auth URL ' + url + ' ' + JSON.stringify(opts));
    }
    // An Indonesian page with an English preference also keeps auth callbacks in place.
    const back = visit('/id' + url, { lang: 'id', stored: { 'rp-lang': 'en' } });
    assert.deepEqual(await back.settle(), [], 'redirected /id auth URL ' + url);
  }
  // Plugin relay already active (hash consumed by plugin-google.js) -> no redirect.
  assert.deepEqual(await visit('/', { ...idBrowser, pluginGoogle: true }).settle(), []);

  // 2. Redirects keep query and hash.
  let v = visit('/?utm_source=threads&utm_content=t02#pricing', idBrowser);
  assert.deepEqual(await v.settle(), ['/id/?utm_source=threads&utm_content=t02#pricing']);
  assert.equal(v.store.get('rp-lang-auto'), 'id');
  v = visit('/id/compatibility/?x=1#mac', { lang: 'id', stored: { 'rp-lang': 'en' } });
  assert.deepEqual(await v.settle(), ['/compatibility/?x=1#mac']);
  v = visit('/?order_id=RP-1&status_code=200&transaction_status=settlement', { stored: { 'rp-lang': 'id' } });
  assert.deepEqual(await v.settle(), ['/id/?order_id=RP-1&status_code=200&transaction_status=settlement']);

  // 3. Location-based (async) routing.
  v = visit('/?ref=ABC#faq', { country: 'ID' });
  assert.deepEqual(await v.settle(), ['/id/?ref=ABC#faq']);
  v = visit('/', { country: 'US' });
  assert.deepEqual(await v.settle(), []);
  assert.equal(v.store.get('rp-lang-auto'), 'en');
  // Late answer after the page changed its URL (e.g. a sign-in started) -> no redirect.
  v = visit('/', { country: 'ID', before: loc => { loc.href = ORIGIN + '/?oauth=google'; loc.search = '?oauth=google'; } });
  assert.deepEqual(await v.settle(), []);
  v = visit('/', { country: 'ID', before: (loc, win) => { win.RP_PLUGIN_GOOGLE_ACTIVE = true; } });
  assert.deepEqual(await v.settle(), []);

  // 4. Indonesian pages are never auto-sent to English; crawlers are never redirected.
  assert.deepEqual(await visit('/id/', { lang: 'id', languages: ['en-US'], country: 'US' }).settle(), []);
  assert.deepEqual(await visit('/', { ...idBrowser, ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' }).settle(), []);

  // 5. OAuth return URLs used by the website and the plugin relay land on the English homepage,
  //    which carries the router; both must be exempt (checked above) and the relay must still start there.
  assert(read('site/portal.js').includes("redirect_to:'https://r-multicam.pages.dev/?oauth=google'"));
  assert(read('site/plugin-google.js').includes("redirect_to:origin+'/?oauth=google'"));
  for (const page of ['site/index.html', 'site/id/index.html']) {
    const html = read(page);
    assert(html.indexOf('/plugin-google.js') > 0 && html.indexOf('/plugin-google.js') < html.indexOf('/portal.js'), page + ': plugin relay must load before portal');
  }
  console.log('PASS language router: auth/PKCE/implicit/recovery/plugin-relay URLs never redirected, query+hash preserved, late geo answer guarded, ID pages and crawlers untouched');
})().catch(e => { console.error(e); process.exit(1); });
