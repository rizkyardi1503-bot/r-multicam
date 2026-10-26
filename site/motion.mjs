// R Project — light motion layer: header state on scroll and a one-time reveal of small blocks.
// No WebGL, no animation loop: it only reacts to scroll and to elements entering the screen.
// Progressive enhancement: without this file every element is simply visible.

const doc = document.documentElement;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isBot = navigator.webdriver || /bot|crawl|spider|slurp|lighthouse|pagespeed|headless|google|bing|yandex|duckduck|baidu|facebookexternalhit|embedly|preview/i.test(navigator.userAgent);

// Content pages keep their markup, so their reveal targets are picked by selector
// (the homepage, main.home, marks its own targets with data-reveal).
const PAGE_TARGETS = [
  'main:not(.home) > h2', 'main:not(.home) > h3', 'main:not(.home) > section', 'main:not(.home) > details',
  'main:not(.home) .support-grid article', 'main:not(.home) .compatibility-table-wrap', 'main:not(.home) .rp-toc'
];

function setupHeader() {
  let ticking = false;
  const update = () => {
    ticking = false;
    doc.classList.toggle('rp-scrolled', scrollY > 24);
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

function setupReveal() {
  const items = new Set(document.querySelectorAll('[data-reveal]'));
  for (const sel of PAGE_TARGETS) {
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('header, dialog, .rp-header, footer')) continue;
      el.setAttribute('data-reveal', '');  // gets the reveal transition from the shared CSS
      items.add(el);
    }
  }
  if (reduceMotion || isBot || !('IntersectionObserver' in window)) return;
  // Stagger siblings that enter together.
  for (const el of items) {
    const i = [...el.parentElement.children].filter((c) => items.has(c)).indexOf(el);
    el.style.setProperty('--rp-delay', `${Math.min(i, 5) * 0.06}s`);
  }
  // Content already on screen is never hidden, so the first paint has no flash.
  // Tall blocks (whole sections, long FAQ lists) are never dimmed: a fast scroller
  // must never land on a large faded area. Only small elements get the reveal,
  // and even those start at opacity .6 (see base.css), never invisible.
  const fold = innerHeight * 0.92;
  const maxH = innerHeight * 0.45;
  const pending = [...items].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= fold && r.height <= maxH;
  });
  if (!pending.length) return;
  doc.classList.add('rp-motion');
  for (const el of pending) el.classList.add('rp-hide');
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) { e.target.classList.remove('rp-hide'); io.unobserve(e.target); }
    }
  }, { rootMargin: '0px 0px -2% 0px', threshold: 0 });
  pending.forEach((el) => io.observe(el));
  // A jump via #hash shows everything that lands on screen at once.
  addEventListener('hashchange', () => pending.forEach((el) => {
    if (el.getBoundingClientRect().top < innerHeight) el.classList.remove('rp-hide');
  }));
}

setupHeader();
setupReveal();
