(function () {
  // Language routing. Runs inline in <head> on every page.
  // Rules:
  //  - A language the visitor picked with the ID/EN switch always wins (remembered).
  //  - Otherwise Indonesian visitors (browser language or Indonesian location) are sent
  //    from an English page to its Indonesian version, once per page view.
  //  - Indonesian pages are never auto-redirected to English (people reach them on purpose,
  //    e.g. from Indonesian search results).
  //  - Crawlers are never redirected, so Google indexes both versions via hreflang.
  //  - Login / payment / download callbacks are never interrupted.
  try {
    var d = document, ls = null;
    try { ls = window.localStorage; } catch (e) {}
    d.addEventListener('click', function (e) {
      var a = e.target && e.target.closest && e.target.closest('[data-lang-switch]');
      if (a && ls) { try { ls.setItem('rp-lang', a.getAttribute('data-lang-switch')); } catch (e2) {} }
    });
    var lang = d.documentElement.lang === 'id' ? 'id' : 'en';
    if (navigator.webdriver || /bot|crawl|spider|slurp|google|bing|yandex|baidu|duckduck|facebookexternalhit|embedly|preview|lighthouse|pagespeed|headless/i.test(navigator.userAgent)) return;
    // Auth callbacks (Supabase OAuth/PKCE, email links), the Premiere plugin Google relay
    // (#plugin-google=...) and download/account deep links are never redirected: the
    // query and hash carry one-time codes/tokens that a redirect could drop or replay.
    var AUTH = /(^|[?&#\/])(code|oauth|state|access_token|refresh_token|provider_token|provider_refresh_token|expires_at|expires_in|token_type|error|error_code|error_description|download|account|token_hash|type|plugin-google)=/;
    var authUrl = function () { return AUTH.test(location.search) || AUTH.test(location.hash); };
    if (authUrl() || window.RP_PLUGIN_GOOGLE_ACTIVE) return;
    var here = location.href;
    var alt = d.querySelector('link[rel="alternate"][hreflang="' + (lang === 'id' ? 'en' : 'id') + '"]');
    if (!alt) return;
    // Always keep the visitor's query string and hash (UTM tags, anchors, payment returns).
    var go = function () {
      var u = new URL(alt.href, location.href);
      location.replace(u.pathname + location.search + location.hash);
    };
    var get = function (k) { try { return ls && ls.getItem(k); } catch (e) { return null; } };
    var set = function (k, v) { try { ls && ls.setItem(k, v); } catch (e) {} };
    var choice = get('rp-lang');
    if (choice === 'en' || choice === 'id') { if (choice !== lang) go(); return; }
    if (lang === 'id') return;
    var auto = get('rp-lang-auto');
    if (auto === 'id') { go(); return; }
    if (auto === 'en') return;
    var langs = (navigator.languages || [navigator.language || '']).join(',').toLowerCase();
    if (/(^|,)(id|in)(-|,|$)/.test(langs)) { set('rp-lang-auto', 'id'); go(); return; }
    fetch('/cdn-cgi/trace', { cache: 'no-store', credentials: 'omit' }).then(function (r) { return r.text(); }).then(function (t) {
      var m = /^loc=([A-Z]{2})\s*$/m.exec(t);
      var target = m && m[1] === 'ID' ? 'id' : 'en';
      set('rp-lang-auto', target);
      // Late answer: do not interrupt a page that started a sign-in or changed its URL meanwhile.
      if (target === 'id' && !get('rp-lang') && location.href === here && !authUrl() && !window.RP_PLUGIN_GOOGLE_ACTIVE && !d.querySelector('dialog[open]')) go();
    }).catch(function () {});
  } catch (e) {}
})();
