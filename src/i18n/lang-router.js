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
    if (/[?&#](code|oauth|access_token|refresh_token|error|error_description|download|account|token_hash|type)=/.test(location.search + location.hash)) return;
    var alt = d.querySelector('link[rel="alternate"][hreflang="' + (lang === 'id' ? 'en' : 'id') + '"]');
    if (!alt) return;
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
      if (target === 'id' && !get('rp-lang')) go();
    }).catch(function () {});
  } catch (e) {}
})();
