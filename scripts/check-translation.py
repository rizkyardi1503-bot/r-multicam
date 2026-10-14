#!/usr/bin/env python3
"""Verify that every Indonesian page (site/id/...) has the same markup skeleton as its
English source: same tags in the same order with the same ids, classes, data-* attributes,
links and form fields. Only human-readable text may differ.

Usage: python3 scripts/check-translation.py [relative/path/index.html ...]
"""
import pathlib
import re
import sys
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
SKIP = {'auth/confirmed/index.html', '404.html'}
TRANSLATABLE_ATTRS = {'alt', 'aria-label', 'title', 'placeholder', 'lang', 'hreflang', 'aria-description'}
ORIGIN = 'https://r-multicam.pages.dev'


def strip_generated(html: str) -> str:
    html = re.sub(r'<!--rp:(\w+)-->.*?<!--/rp:\1-->', '', html, flags=re.S)
    html = re.sub(r'<link rel="alternate" hreflang="[^"]*" href="[^"]*">', '', html)
    html = re.sub(r'<script src="/i18n-id\.js[^"]*" defer></script>', '', html)
    return html


def norm_url(v: str) -> str:
    v = v.replace(ORIGIN, '')
    v = re.sub(r'^/id(/|$)', '/', v)
    v = re.sub(r'\?v=[0-9a-f]+$', '', v)
    return v.lstrip('/')


class Skeleton(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self.raw = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'meta' and ('content' in a) and (a.get('name') or a.get('property') or '').lower() not in ('robots', 'viewport', 'google-site-verification', 'og:image', 'og:image:width', 'og:image:height', 'og:image:type', 'og:image:secure_url', 'og:type', 'og:url', 'twitter:card', 'twitter:image'):
            a.pop('content')  # descriptions/titles are translated
        if tag == 'meta' and (a.get('property') == 'og:locale'):
            a.pop('content', None)
        kept = []
        for k, v in sorted(a.items()):
            if k in TRANSLATABLE_ATTRS:
                continue
            if k in ('href', 'src', 'content') and v:
                v = norm_url(v)
            kept.append(f'{k}={v}')
        self.items.append(f'<{tag} {" ".join(kept)}>')

    def handle_endtag(self, tag):
        self.items.append(f'</{tag}>')


def skeleton(html: str):
    p = Skeleton()
    p.feed(strip_generated(html))
    return p.items


def compare(rel: str):
    en_file = SITE / rel
    id_file = SITE / 'id' / rel
    if not id_file.exists():
        return [f'missing translation: site/id/{rel}']
    en, idn = skeleton(en_file.read_text()), skeleton(id_file.read_text())
    errors = []
    if 'lang="id"' not in id_file.read_text()[:400]:
        errors.append('html lang must be "id"')
    import difflib
    if en != idn:
        diff = list(difflib.unified_diff(en, idn, 'en', 'id', n=1, lineterm=''))
        errors.append('markup differs from English:\n' + '\n'.join(diff[:40]))
    return errors


def main(argv):
    if argv:
        rels = argv
    else:
        rels = [f.relative_to(SITE).as_posix() for f in sorted(SITE.rglob('*.html'))
                if not f.relative_to(SITE).as_posix().startswith('id/')]
        rels = [r for r in rels if r not in SKIP]
    failed = 0
    for rel in rels:
        errs = compare(rel)
        if errs:
            failed += 1
            print(f'FAIL {rel}')
            for e in errs:
                print('   ' + e.replace('\n', '\n   '))
        else:
            print(f'ok   {rel}')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main(sys.argv[1:])
