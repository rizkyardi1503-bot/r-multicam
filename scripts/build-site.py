#!/usr/bin/env python3
"""Build step for the static site.

* Bundles the stylesheets in src/css into two minified files:
    site/home.css  (homepage, keeps its original cascade order)
    site/site.css  (every other page)
* Rewrites every HTML page so it loads exactly one bundle (+ page-specific CSS),
  preloads the two web fonts and loads the motion layer.
* Gives all content pages the same header, footer, breadcrumb structured data
  and an "On this page" table of contents for long pages.
* Updates sitemap.xml <lastmod> for pages whose HTML changed.

Idempotent: generated blocks are wrapped in <!--rp:NAME--> markers and replaced on
every run. `--check` exits non-zero if the committed output is out of date (used in CI).
"""
import base64
import datetime
import hashlib
import html as htmllib
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
CSS_SRC = ROOT / 'src' / 'css'
ORIGIN = 'https://r-multicam.pages.dev'

BUNDLES = {
    'home.css': ['styles.css', 'reference-layout.css', 'practice.css', 'elegance.css', 'conversion.css', 'theme.css', 'motion3d.css'],
    'site.css': ['styles.css', 'practice.css', 'elegance.css', 'conversion.css', 'theme.css', 'motion3d.css'],
}
SOURCE_CSS = {name for files in BUNDLES.values() for name in files} | set(BUNDLES)
FONTS = ['/fonts/V8mDoQDjQSkFtoMM3T6r8E7mPbF4Cw.woff2', '/fonts/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2']
MOTION = '/motion3d.mjs'

# Pages that keep their own header/footer (custom layouts or account flows).
KEEP_LAYOUT = {'index.html', 'start/index.html', 'auth/confirmed/index.html', 'id/index.html', 'id/start/index.html'}
# Never language-routed or translated (Supabase email links land here with tokens).
NO_LANG = {'auth/confirmed/index.html', '404.html'}
I18N_SRC = ROOT / 'src' / 'i18n'

NAV_EN = [
    ('/#features', 'Product'),
    ('/dj-multicam-editing/', 'DJ editing'),
    ('/guides/music-driven-multicam-editing/', 'Guides'),
    ('/#pricing', 'Pricing'),
    ('/help/', 'Help'),
]
NAV_ID = [
    ('/id/#features', 'Fitur'),
    ('/id/dj-multicam-editing/', 'Editing DJ'),
    ('/id/guides/music-driven-multicam-editing/', 'Panduan'),
    ('/id/#pricing', 'Harga'),
    ('/id/help/', 'Bantuan'),
]
FOOTER_EN = [
    ('Product', [
        ('/ai-multicam-editor-premiere-pro/', 'AI multicam editor'),
        ('/dj-multicam-editing/', 'DJ multicam editing'),
        ('/sync-multicam-to-music/', 'Sync multicam to music'),
        ('/podcast-ai-editing/', 'Podcast AI editing'),
        ('/#pricing', 'Pricing'),
        ('/releases/', 'Release notes'),
    ]),
    ('Learn', [
        ('/guides/music-driven-multicam-editing/', 'Music-driven editing guide'),
        ('/guides/install-multicam-ai/', 'Installation guide'),
        ('/cut-to-the-beat-premiere-pro/', 'Cut to the beat in Premiere Pro'),
        ('/quick-start/', 'Quick start'),
        ('/compatibility/', 'Compatibility'),
        ('/help/', 'Help center'),
        ('/id/', 'Panduan Bahasa Indonesia'),
    ]),
    ('Company', [
        ('/affiliate/', 'Affiliate program'),
        ('/digital-delivery/', 'Digital delivery'),
        ('/refund-policy/', 'Refund policy'),
        ('/terms/', 'Terms'),
        ('/privacy/', 'Privacy'),
        ('/license/', 'Software license'),
    ]),
]
FOOTER_ID = [
    ('Produk', [
        ('/id/ai-multicam-editor-premiere-pro/', 'AI multicam editor'),
        ('/id/dj-multicam-editing/', 'Editing multicam DJ'),
        ('/id/sync-multicam-to-music/', 'Sinkron multicam ke musik'),
        ('/id/podcast-ai-editing/', 'Editing podcast AI'),
        ('/id/#pricing', 'Harga'),
        ('/id/releases/', 'Catatan rilis'),
    ]),
    ('Belajar', [
        ('/id/guides/music-driven-multicam-editing/', 'Panduan editing mengikuti musik'),
        ('/id/guides/install-multicam-ai/', 'Panduan instalasi'),
        ('/id/cut-to-the-beat-premiere-pro/', 'Cut sesuai beat di Premiere Pro'),
        ('/id/quick-start/', 'Mulai cepat'),
        ('/id/compatibility/', 'Kompatibilitas'),
        ('/id/help/', 'Pusat bantuan'),
        ('/', 'English version'),
    ]),
    ('Perusahaan', [
        ('/id/affiliate/', 'Program afiliasi'),
        ('/id/digital-delivery/', 'Pengiriman digital'),
        ('/id/refund-policy/', 'Kebijakan refund'),
        ('/id/terms/', 'Syarat & ketentuan'),
        ('/id/privacy/', 'Privasi'),
        ('/id/license/', 'Lisensi software'),
    ]),
]
SOCIAL_IMAGE = ORIGIN + '/social-card.jpg'
SOCIAL_ALT = {'en': 'R Project Multicam AI — music-driven multicam editing in Premiere Pro',
              'id': 'R Project Multicam AI — edit multicam mengikuti musik di Premiere Pro'}
CONTACT = [
    ('mailto:rizkyardi1503@gmail.com', 'Email support', False),
    ('https://wa.me/6282233161680', 'WhatsApp support ↗', True),
    ('https://www.instagram.com/r.project__/', 'Instagram ↗', True),
]


# ---------------------------------------------------------------- CSS
def minify_css(css: str) -> str:
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    out, i, n = [], 0, len(css)
    # Collapse whitespace outside of string literals.
    while i < n:
        c = css[i]
        if c in '"\'':
            j = i + 1
            while j < n and css[j] != c:
                j += 2 if css[j] == '\\' else 1
            out.append(css[i:j + 1])
            i = j + 1
            continue
        if c.isspace():
            while i < n and css[i].isspace():
                i += 1
            out.append(' ')
            continue
        out.append(c)
        i += 1
    css = ''.join(out)
    css = re.sub(r'\s*([{};,>])\s*', r'\1', css)
    css = css.replace(';}', '}')
    return css.strip() + '\n'


def build_bundles():
    outputs = {}
    for name, files in BUNDLES.items():
        parts = []
        for f in files:
            parts.append(f'/* {f} */\n' + (CSS_SRC / f).read_text())
        outputs[name] = minify_css('\n'.join(parts))
    return outputs


def version(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:10]


# ---------------------------------------------------------------- HTML helpers
def esc(s):
    return htmllib.escape(s, quote=True)


def page_path(rel: str) -> str:
    """'guides/x/index.html' -> '/guides/x/'"""
    if rel == 'index.html':
        return '/'
    if rel.endswith('/index.html'):
        return '/' + rel[:-len('index.html')]
    return '/' + rel


def replace_block(html: str, name: str, new: str, fallback_pattern=None, insert_after=None):
    """Replace <!--rp:name-->...<!--/rp:name-->; otherwise replace the first match of
    fallback_pattern; otherwise insert after the first match of insert_after."""
    wrapped = f'<!--rp:{name}-->{new}<!--/rp:{name}-->'
    marker = re.compile(rf'<!--rp:{name}-->.*?<!--/rp:{name}-->', re.S)
    if marker.search(html):
        return marker.sub(lambda m: wrapped, html, count=1)
    if fallback_pattern:
        m = re.search(fallback_pattern, html, re.S)
        if m:
            return html[:m.start()] + wrapped + html[m.end():]
    if insert_after:
        m = re.search(insert_after, html, re.S)
        if m:
            return html[:m.end()] + wrapped + html[m.end():]
    return html


def header_html(path: str, lang: str, existing: str) -> str:
    nav = NAV_ID if lang == 'id' else NAV_EN
    links = []
    for href, label in nav:
        here = '#' not in href and href != '/' and path.startswith(href)
        cur = ' aria-current="page"' if here else ''
        extra = ' lang="en" hreflang="en"' if (lang == 'id' and href == '/') else ''
        links.append(f'<a href="{href}"{cur}{extra}>{esc(label)}</a>')
    # Keep account buttons a page's scripts depend on (e.g. affiliate login).
    m = re.search(r'<div class="header-account-actions">.*?</div>', existing or '', re.S)
    if m and 'data-' in m.group(0):
        actions = m.group(0)
    else:
        cta = 'Coba gratis' if lang == 'id' else 'Free trial'
        pricing = '/id/#pricing' if lang == 'id' else '/#pricing'
        actions = f'<div class="header-account-actions"><a class="button small" href="{pricing}">{cta} <span>↗</span></a></div>'
    label = 'Navigasi utama' if lang == 'id' else 'Main navigation'
    home = '/id/' if lang == 'id' else '/'
    return (f'<header class="rp-header"><a class="brand" href="{home}"><span class="mark">R</span>'
            f'<span>R Project <small>Multicam AI</small></span></a>'
            f'<nav aria-label="{label}">{"".join(links)}</nav>{lang_switch(path, lang)}{actions}</header>')


def alt_path(path: str, lang: str) -> str:
    """Counterpart URL path in the other language."""
    if lang == 'id':
        return path[3:] if path.startswith('/id/') else '/'
    return '/id' + path


def lang_switch(path: str, lang: str) -> str:
    other = alt_path(path, lang)
    # A page without a counterpart (404.html) links to the other language's home page, not to a missing page.
    target = SITE / other.lstrip('/')
    if not (target.is_file() if other.endswith('.html') else (target / 'index.html').is_file()):
        other = '/' if lang == 'id' else '/id/'
    en_href, id_href = (other, path) if lang == 'id' else (path, other)
    # The 404 page is served for any missing URL: both switches go to the home pages, never to /404.html itself.
    if path.endswith('/404.html'):
        en_href, id_href = '/', '/id/'
    label = 'Pilih bahasa' if lang == 'id' else 'Choose language'
    def item(code, href, text, hl):
        cur = ' aria-current="true"' if code == lang else ''
        return f'<a href="{href}" hreflang="{hl}" lang="{hl}" data-lang-switch="{code}"{cur}>{text}</a>'
    return (f'<div class="rp-lang" role="group" aria-label="{label}">'
            f'{item("en", en_href, "EN", "en")}{item("id", id_href, "ID", "id")}</div>')


def footer_html(lang: str) -> str:
    groups = FOOTER_ID if lang == 'id' else FOOTER_EN
    blurb = ('Software independen untuk Adobe Premiere Pro. Dibuat oleh Rizki Ardiansyah, event filmmaker di Bali.'
             if lang == 'id' else
             'Independent software for Adobe Premiere Pro. Created by Rizki Ardiansyah, an event filmmaker based in Bali.')
    cols = []
    for title, items in groups:
        lis = ''.join(f'<li><a href="{h}">{esc(t)}</a></li>' for h, t in items)
        cols.append(f'<div><h2>{esc(title)}</h2><ul>{lis}</ul></div>')
    contact_title = 'Kontak' if lang == 'id' else 'Contact'
    contact = ''.join(
        f'<li><a href="{h}"' + (' target="_blank" rel="noopener noreferrer"' if ext else '') + f'>{esc(t)}</a></li>'
        for h, t, ext in CONTACT)
    cols.append(f'<div><h2>{contact_title}</h2><ul>{contact}</ul></div>')
    legal = 'Adobe dan Premiere Pro adalah merek dagang Adobe.' if lang == 'id' else 'Adobe and Premiere Pro are trademarks of Adobe.'
    return (f'<footer class="rp-footer"><div class="rp-footer-inner"><div class="rp-footer-brand">'
            f'<a class="brand" href="{"/id/" if lang == "id" else "/"}"><span class="mark">R</span><span>R Project <small>Multicam AI</small></span></a>'
            f'<p>{esc(blurb)}</p></div><nav class="rp-footer-links" aria-label="Footer">{"".join(cols)}</nav></div>'
            f'<p class="rp-legal">© 2026 R Project · {esc(legal)}</p></footer>')


def slugify(text: str) -> str:
    text = htmllib.unescape(re.sub(r'<[^>]+>', '', text)).lower()
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    return re.sub(r'[\s-]+', '-', text).strip('-')[:60] or 'section'


def add_toc(html: str, lang: str) -> str:
    m = re.search(r'(<main\b[^>]*>)(.*?)(</main>)', html, re.S)
    if not m:
        return html
    body = re.sub(r'<!--rp:toc-->.*?<!--/rp:toc-->', '', m.group(2), flags=re.S)
    heads = list(re.finditer(r'<h2(\s[^>]*)?>(.*?)</h2>', body, re.S))
    if len(heads) < 4:
        return html[:m.start(2)] + body + html[m.end(2):]
    used, items = set(), []

    def ensure_id(hm):
        attrs, inner = hm.group(1) or '', hm.group(2)
        idm = re.search(r'\sid="([^"]+)"', attrs)
        if idm:
            hid = idm.group(1)
        else:
            base = slugify(inner)
            hid, k = base, 2
            while hid in used:
                hid, k = f'{base}-{k}', k + 1
            attrs = f' id="{hid}"' + attrs
        used.add(hid)
        items.append((hid, htmllib.unescape(re.sub(r'<[^>]+>', '', inner)).strip()))
        return f'<h2{attrs}>{inner}</h2>'

    # Headings inside a section that already has an id keep that section as anchor target.
    body = re.sub(r'<h2(\s[^>]*)?>(.*?)</h2>', ensure_id, body, flags=re.S)
    title = 'Di halaman ini' if lang == 'id' else 'On this page'
    lis = ''.join(f'<li><a href="#{hid}">{esc(text)}</a></li>' for hid, text in items)
    toc = f'<!--rp:toc--><nav class="rp-toc" aria-label="{title}"><p>{title}</p><ol>{lis}</ol></nav><!--/rp:toc-->'
    first = re.search(r'<section\b[^>]*>\s*<h2|<h2[\s>]', body)
    body = body[:first.start()] + toc + body[first.start():]
    return html[:m.start(2)] + body + html[m.end(2):]


def breadcrumb_ld(html: str, path: str) -> str:
    html = re.sub(r'<!--rp:crumbs-->.*?<!--/rp:crumbs-->', '', html, flags=re.S)
    if 'BreadcrumbList' in html:
        return html
    nav = re.search(r'<nav aria-label="Breadcrumb">(.*?)</nav>', html, re.S)
    if not nav:
        return html
    items = []
    for href, text in re.findall(r'<a href="([^"]+)"[^>]*>(.*?)</a>', nav.group(1), re.S):
        items.append((ORIGIN + href if href.startswith('/') else href, htmllib.unescape(re.sub(r'<[^>]+>', '', text)).strip()))
    tail = re.sub(r'<a\b.*?</a>', '', nav.group(1), flags=re.S)
    tail = htmllib.unescape(re.sub(r'<[^>]+>', '', tail)).replace('/', ' ').strip()
    if tail:
        items.append((ORIGIN + path, tail))
    if len(items) < 2:
        return html
    data = {'@context': 'https://schema.org', '@type': 'BreadcrumbList', 'itemListElement': [
        {'@type': 'ListItem', 'position': i + 1, 'name': name, 'item': url} for i, (url, name) in enumerate(items)]}
    block = f'<!--rp:crumbs--><script type="application/ld+json">{json.dumps(data, ensure_ascii=False, separators=(",", ":"))}</script><!--/rp:crumbs-->'
    return html.replace('</head>', block + '</head>', 1)


def page_paths():
    """URL paths of all English pages (used to rewrite links on Indonesian pages)."""
    out = set()
    for f in SITE.rglob('*.html'):
        rel = f.relative_to(SITE).as_posix()
        if not rel.startswith('id/') and rel.endswith('index.html'):
            out.add(page_path(rel))
    return out


def localize_links(html: str) -> str:
    """On Indonesian pages point internal page links, canonical and structured-data URLs to /id/."""
    known = page_paths()

    def fix(url: str) -> str:
        base = url.split('#')[0].split('?')[0]
        if base.startswith('/id/') or base == '/id':
            return url
        if base in known or (base == '/' and url != '/' ) or url == '/':
            return '/id' + url
        return url

    def href(m):
        return f'{m.group(1)}="{fix(m.group(2))}"'
    # Leave hreflang alternates and the language switch alone.
    parts = re.split(r'(<!--rp:(?:lang|langswitch)-->.*?<!--/rp:(?:lang|langswitch)-->|<div class="rp-lang".*?</div>)', html, flags=re.S)
    for i in range(0, len(parts), 2):
        seg = re.sub(r'\b(href)="(/[^"]*)"', href, parts[i])
        seg = re.sub(r'(<link rel="canonical" href=")' + re.escape(ORIGIN) + r'(/[^"]*)"', lambda m: m.group(1) + ORIGIN + fix(m.group(2)) + '"', seg)
        seg = re.sub(r'(<meta property="og:url" content=")' + re.escape(ORIGIN) + r'(/[^"]*)"', lambda m: m.group(1) + ORIGIN + fix(m.group(2)) + '"', seg)
        seg = re.sub(r'(<script type="application/ld\+json">)(.*?)(</script>)',
                     lambda m: m.group(1) + re.sub(r'"' + re.escape(ORIGIN) + r'(/[^"]*)"', lambda u: '"' + ORIGIN + fix(u.group(1)) + '"', m.group(2)) + m.group(3), seg, flags=re.S)
        parts[i] = seg
    return ''.join(parts)


def lang_block(rel: str, path: str, lang: str, router: str) -> str:
    """hreflang alternates + inline router, or '' when the page has no counterpart."""
    if rel in NO_LANG:
        return ''
    en_rel = rel[3:] if rel.startswith('id/') else rel
    id_rel = 'id/' + en_rel
    if not ((SITE / en_rel).exists() and (SITE / id_rel).exists()):
        return ''
    en_url, id_url = ORIGIN + page_path(en_rel), ORIGIN + page_path(id_rel)
    return (f'<link rel="alternate" hreflang="en" href="{en_url}">'
            f'<link rel="alternate" hreflang="id" href="{id_url}">'
            f'<link rel="alternate" hreflang="x-default" href="{en_url}">'
            f'<script>{router}</script>')


def social_meta(html: str, lang: str) -> str:
    """Default Open Graph / Twitter / theme-color tags for indexable pages. Only missing tags are added,
    so pages keep their own wording; defaults come from <title>, the meta description and the canonical URL."""
    robots = re.search(r'<meta name="robots" content="([^"]*)">', html)
    if not robots or 'noindex' in robots.group(1):
        return html

    def meta(attr, key):
        m = re.search(rf'<meta {attr}="{re.escape(key)}" content="([^"]*)">', html)
        return m.group(1) if m else None
    title = re.search(r'<title>(.*?)</title>', html, re.S)
    title = esc(htmllib.unescape(title.group(1).strip())) if title else None
    desc = meta('name', 'description')
    canonical = re.search(r'<link rel="canonical" href="([^"]*)">', html)
    want = [
        ('property', 'og:type', 'website'),
        ('property', 'og:site_name', 'R Project Multicam AI'),
        ('property', 'og:locale', 'id_ID' if lang == 'id' else 'en_US'),
        ('property', 'og:title', title),
        ('property', 'og:description', desc),
        ('property', 'og:url', canonical.group(1) if canonical else None),
        ('property', 'og:image', SOCIAL_IMAGE),
        ('property', 'og:image:width', '1200'),
        ('property', 'og:image:height', '630'),
        ('property', 'og:image:alt', SOCIAL_ALT['id' if lang == 'id' else 'en']),
        ('name', 'twitter:card', 'summary_large_image'),
        ('name', 'twitter:title', meta('property', 'og:title') or title),
        ('name', 'twitter:description', meta('property', 'og:description') or desc),
        ('name', 'twitter:image', SOCIAL_IMAGE),
        ('name', 'theme-color', '#070911'),
    ]
    add = ''.join(f'<meta {a}="{k}" content="{v}">' for a, k, v in want if v and meta(a, k) is None)
    if not add:
        return html
    last = None
    for last in re.finditer(r'<meta (?:property|name)="(?:og|twitter):[^"]*" content="[^"]*">', html):
        pass
    at = (last or robots).end()
    return html[:at] + add + html[at:]


def process_page(rel: str, html: str, versions: dict) -> str:
    path = page_path(rel)
    lang = (re.search(r'<html[^>]*\blang="([^"]+)"', html) or [None, 'en'])[1]
    bundle = 'home.css' if rel in ('index.html', 'id/index.html') else 'site.css'

    # 0. Absolute script URLs (pages also live under /id/), language alternates + router.
    html = re.sub(r'<script src="([a-z0-9-]+\.js)"', r'<script src="/\1"', html)
    scripts = versions.get('scripts', {})
    html = re.sub(r'<script src="/([a-z0-9-]+\.js)(\?v=[0-9a-f]+)?"',
                  lambda m: f'<script src="/{m.group(1)}?v={scripts[m.group(1)]}"' if m.group(1) in scripts and m.group(1) != 'i18n-id.js' else m.group(0), html)
    html = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*">', '', html)
    html = re.sub(r'<!--rp:lang-->.*?<!--/rp:lang-->', '', html, flags=re.S)
    block = lang_block(rel, path, lang, versions['router'])
    if block:
        html = re.sub(r'(<meta charset="[^"]*">)', lambda m: m.group(1) + f'<!--rp:lang-->{block}<!--/rp:lang-->', html, count=1)
    html = social_meta(html, lang)

    # 1. Stylesheets -> one bundle at the position of the first old link.
    link_re = re.compile(r'<link rel="stylesheet" href="/?([a-z0-9-]+\.css)(\?[^"]*)?">')
    first = None
    def strip_link(m):
        nonlocal first
        if m.group(1) in SOURCE_CSS:
            if first is None:
                first = True
                return '\x00BUNDLE\x00'
            return ''
        return m.group(0)
    html = link_re.sub(strip_link, html)
    # Page-specific stylesheets (e.g. /start/start.css) get a content hash too.
    def page_css(m):
        f = SITE / m.group(1)
        return f'<link rel="stylesheet" href="/{m.group(1)}?v={version(f.read_text())}">' if f.exists() else m.group(0)
    html = re.sub(r'<link rel="stylesheet" href="/([a-z0-9-]+/[a-z0-9-]+\.css)(\?v=[0-9a-f]+)?">', page_css, html)
    tag = f'<link rel="stylesheet" href="/{bundle}?v={versions[bundle]}">'
    html = html.replace('\x00BUNDLE\x00', tag) if first else html.replace('</head>', tag + '</head>', 1)

    # 2. Font preloads (prevents late font swap -> better LCP/CLS).
    html = re.sub(r'<link rel="preload" href="/fonts/[^"]+" as="font"[^>]*>', '', html)
    preloads = ''.join(f'<link rel="preload" href="{f}" as="font" type="font/woff2" crossorigin>' for f in FONTS)
    html = html.replace(tag, preloads + tag, 1)

    # 3. Motion layer (+ Indonesian UI translator on /id/ pages).
    html = re.sub(r'<script type="module" src="/motion3d\.mjs(\?[^"]*)?"></script>', '', html)
    html = re.sub(r'<script src="/i18n-id\.js(\?[^"]*)?" defer></script>', '', html)
    extra = f'<script src="/i18n-id.js?v={versions["i18n-id.js"]}" defer></script>' if rel.startswith('id/') else ''
    html = html.replace('</head>', f'{extra}<script type="module" src="{MOTION}?v={versions["motion3d.mjs"]}"></script></head>', 1)

    if rel.startswith('id/'):
        html = localize_links(html)

    if rel in KEEP_LAYOUT:
        # Language switch inside the page's own header navigation.
        html = re.sub(r'<!--rp:langswitch-->.*?<!--/rp:langswitch-->', '', html, flags=re.S)
        if block and '<header' in html:
            html = re.sub(r'(<header\b.*?)(</nav>)', lambda m: m.group(1) + m.group(2) + f'<!--rp:langswitch-->{lang_switch(path, lang)}<!--/rp:langswitch-->', html, count=1, flags=re.S)
        if rel == 'id/index.html':
            # Keep old deep links (/id/#mulai-cepat, /id/#kompatibilitas) working.
            html = re.sub(r'<!--rp:anchors-->.*?<!--/rp:anchors-->', '', html, flags=re.S)
            html = html.replace('<section class="wrap section" id="downloads"', '<!--rp:anchors--><span id="kompatibilitas"></span><!--/rp:anchors--><section class="wrap section" id="downloads"', 1)
            html = re.sub(r'(<section[^>]*id="start-checklist")', r'<!--rp:anchors--><span id="mulai-cepat"></span><!--/rp:anchors-->\1', html, count=1)
        return html

    # 4. Shared header (+ skip link), main landmark id, shared footer.
    existing = re.search(r'<!--rp:header-->(.*?)<!--/rp:header-->|<header\b[^>]*>.*?</header>', html, re.S)
    existing = existing.group(0) if existing else ''
    if rel.startswith('id/') and 'data-' not in (re.search(r'<div class="header-account-actions">.*?</div>', existing, re.S) or [''])[0]:
        # Indonesian copies inherit account buttons from the English page, with translated labels.
        en_html = (SITE / rel[3:]).read_text() if (SITE / rel[3:]).exists() else ''
        m = re.search(r'<div class="header-account-actions">.*?</div>', en_html, re.S)
        if m and 'data-' in m.group(0):
            words = json.loads((I18N_SRC / 'id.json').read_text()).get('text', {})
            words = {**words, 'Login': 'Masuk', 'Explore the plugin': 'Lihat plugin'}
            acts = re.sub(r'>([^<>]+)<', lambda t: '>' + words.get(t.group(1).strip(), t.group(1).strip()).join(re.match(r'(\s*).*?(\s*)$', t.group(1), re.S).groups()) + '<', m.group(0))
            existing = localize_links(acts)
    hdr = header_html(path, lang, existing)
    html = replace_block(html, 'header', hdr, fallback_pattern=r'<header\b[^>]*>.*?</header>', insert_after=r'<body[^>]*>')
    if not re.search(r'<main\b[^>]*\bid=', html):
        html = re.sub(r'<main\b', '<main id="main"', html, count=1)
    skip = 'Langsung ke konten' if lang == 'id' else 'Skip to content'
    if 'class="skip-link"' not in html:
        html = re.sub(r'(<body[^>]*>)', rf'\1<a class="skip-link" href="#main">{skip}</a>', html, count=1)
    html = replace_block(html, 'footer', footer_html(lang), fallback_pattern=r'<footer\b[^>]*>.*?</footer>', insert_after=r'</main>')

    # 5. Table of contents + breadcrumb structured data.
    html = add_toc(html, lang)
    html = breadcrumb_ld(html, path)
    return html


def build_sitemaps(changed_pages):
    """Bilingual sitemap: every indexable page in both languages with hreflang alternates."""
    sm_file = SITE / 'sitemap.xml'
    old = sm_file.read_text()
    lastmod = dict(re.findall(r'<loc>([^<]+)</loc>\s*(?:<xhtml:link[^>]*/>\s*)*<lastmod>([^<]+)</lastmod>', old))
    today = datetime.date.today().isoformat()
    order = re.findall(r'<loc>' + re.escape(ORIGIN) + r'(/(?!id/)[^<]*)</loc>', old)
    entries, txt = [], []
    for p in order:
        rel_en = 'index.html' if p == '/' else p.lstrip('/') + 'index.html'
        rel_id = 'id/' + rel_en
        pair = [(ORIGIN + p, p)]
        if (SITE / rel_id).exists():
            pair.append((ORIGIN + '/id' + p, '/id' + p))
        alts = ''
        if len(pair) == 2:
            alts = (f'<xhtml:link rel="alternate" hreflang="en" href="{pair[0][0]}"/>'
                    f'<xhtml:link rel="alternate" hreflang="id" href="{pair[1][0]}"/>'
                    f'<xhtml:link rel="alternate" hreflang="x-default" href="{pair[0][0]}"/>')
        for url, path in pair:
            mod = today if (path in changed_pages or url not in lastmod) else lastmod[url]
            entries.append(f'<url><loc>{url}</loc>{alts}<lastmod>{mod}</lastmod></url>')
            txt.append(url)
    xml = ("<?xml version='1.0' encoding='utf-8'?>\n"
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
           + '\n'.join(entries) + '\n</urlset>\n')
    return xml, '\n'.join(txt) + '\n'


def with_csp(headers: str, router: str, motion_src: str) -> str:
    """Content-Security-Policy for every page, derived from what the site loads: the inline language router
    (by hash), three.js for motion3d.mjs, Supabase (config.js) and the Cloudflare Web Analytics beacon."""
    router_hash = 'sha256-' + base64.b64encode(hashlib.sha256(router.encode('utf-8')).digest()).decode()
    three = re.search(r"THREE_URL = '(https://[^']+/)[^/']+'", motion_src).group(1)
    supabase = re.search(r"supabaseUrl: '(https://[^']+)'", (SITE / 'config.js').read_text()).group(1)
    csp = ("default-src 'self'; "
           f"script-src 'self' '{router_hash}' {three} https://static.cloudflareinsights.com; "
           "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://developers.google.com/static/identity/images/; "
           "font-src 'self'; media-src 'self'; "
           f"connect-src 'self' {supabase} https://cloudflareinsights.com; "
           "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'")
    lines = [l for l in headers.split('\n') if not l.strip().startswith('Content-Security-Policy:')]
    at = lines.index('/*') + 1
    lines.insert(at, '  Content-Security-Policy: ' + csp)
    return '\n'.join(lines)


def build(check=False):
    changed = []
    css = build_bundles()
    motion_src = (SITE / 'motion3d.mjs').read_text()
    versions = {name: version(text) for name, text in css.items()}
    versions['motion3d.mjs'] = version(motion_src)
    router = (I18N_SRC / 'lang-router.js').read_text()
    router = re.sub(r'^\s*//.*$', '', router, flags=re.M)
    router = re.sub(r'\n\s*', '\n', router).strip()
    versions['router'] = router
    dictionary = json.loads((I18N_SRC / 'id.json').read_text())
    i18n_js = (I18N_SRC / 'runtime.js').read_text().replace('__DICT__', json.dumps(dictionary, ensure_ascii=False, separators=(',', ':')))
    versions['i18n-id.js'] = version(i18n_js)

    outputs = {SITE / name: text for name, text in css.items()}
    outputs[SITE / 'i18n-id.js'] = i18n_js
    # Content hashes for every first-party script, so HTML always points at the exact
    # version and the files themselves can be cached for a long time.
    portal = (SITE / 'portal.js').read_text()
    owner_v = version((SITE / 'owner-dashboard.js').read_text())
    portal = re.sub(r"(['\"])/owner-dashboard\.js(\?v=[0-9a-f]+)?\1", lambda m: f"{m.group(1)}/owner-dashboard.js?v={owner_v}{m.group(1)}", portal)
    outputs[SITE / 'portal.js'] = portal
    scripts = {}
    for js in sorted(SITE.glob('*.js')):
        scripts[js.name] = version(outputs.get(js, None) if js in outputs else js.read_text())
    versions['scripts'] = scripts
    changed_pages = []
    for f in sorted(SITE.rglob('*.html')):
        rel = f.relative_to(SITE).as_posix()
        old = f.read_text()
        new = process_page(rel, old, versions)
        new = process_page(rel, new, versions)  # second pass must be a no-op
        outputs[f] = new
        if new != old:
            changed_pages.append(page_path(rel))

    outputs[SITE / 'sitemap.xml'], outputs[SITE / 'sitemap.txt'] = build_sitemaps(changed_pages)
    outputs[SITE / '_headers'] = with_csp((SITE / '_headers').read_text(), router, motion_src)

    for f, text in outputs.items():
        cur = f.read_text() if f.exists() else None
        if cur != text:
            changed.append(f.relative_to(ROOT).as_posix())
            if not check:
                f.write_text(text)
    return changed


if __name__ == '__main__':
    check = '--check' in sys.argv
    changed = build(check)
    if check:
        # lastmod dates legitimately differ by day; ignore sitemap in check mode.
        stale = [c for c in changed if c != 'site/sitemap.xml']
        if stale:
            print('Site build output is out of date. Run: python3 scripts/build-site.py')
            print('\n'.join(stale))
            sys.exit(1)
        print('Site build output is up to date.')
    else:
        print(f'Updated {len(changed)} file(s).')
        for c in changed:
            print(' ', c)
