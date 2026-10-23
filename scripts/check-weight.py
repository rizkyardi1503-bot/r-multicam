#!/usr/bin/env python3
"""Page weight budget check for the static website (stdlib only).

Run from the repository root:  python3 scripts/check-weight.py [--site DIR]

Exits 1 with one message per violated rule. Sizes use KiB/MiB (1024 based).
"""
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

KB = 1024
MB = 1024 * 1024

HOME_PAGES = ("index.html", "id/index.html")
HTML_MAX = 70 * KB
CSS_MAX = 45 * KB
JS_MAX = 120 * KB
VIDEO_MAX = 3.2 * MB
ALLOWED_SCRIPT_HOSTS = {"static.cloudflareinsights.com"}
BLUR_MAX_PX = 20
CDN_HOSTS = ("cdn.jsdelivr.net", "unpkg.com", "cdnjs")

failures = []
warnings = []
rows = []


def fail(msg):
    failures.append(msg)


def warn(msg):
    warnings.append(msg)


def kb(n):
    return f"{n / KB:.1f} KB"


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.scripts = []  # attrs dicts of <script>
        self.styles = []  # hrefs of stylesheet links
        self.videos = []  # {"attrs": {...}, "sources": [src, ...]}
        self.canvas = 0
        self._video = None

    def handle_starttag(self, tag, attrs):
        a = {k: (v if v is not None else "") for k, v in attrs}
        if tag == "script":
            self.scripts.append(a)
        elif tag == "link" and "stylesheet" in a.get("rel", "").lower().split():
            if a.get("href"):
                self.styles.append(a["href"])
        elif tag == "video":
            self._video = {"attrs": a, "sources": [a["src"]] if a.get("src") else []}
            self.videos.append(self._video)
        elif tag == "source" and self._video is not None and a.get("src"):
            self._video["sources"].append(a["src"])
        elif tag == "canvas":
            self.canvas += 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "video":
            self._video = None


def parse_html(path):
    p = PageParser()
    p.feed(path.read_text(encoding="utf-8", errors="replace"))
    return p


def is_external(ref):
    return ref.startswith(("http://", "https://", "//"))


def external_host(ref):
    return urlsplit("https:" + ref if ref.startswith("//") else ref).hostname or ""


def resolve(site, page, ref):
    """Map a same-origin URL used by `page` to a file under `site`."""
    clean = urlsplit(ref).path
    if clean.startswith("/"):
        return site / clean.lstrip("/")
    return page.parent / clean


def rel(site, path):
    try:
        return path.relative_to(site.parent).as_posix()
    except ValueError:
        return path.as_posix()


def check_external_scripts(site, page, parsed):
    for s in parsed.scripts:
        src = s.get("src", "")
        if src and is_external(src) and external_host(src) not in ALLOWED_SCRIPT_HOSTS:
            fail(f"{rel(site, page)}: external script {src!r} is not allowed "
                 f"(only {', '.join(sorted(ALLOWED_SCRIPT_HOSTS))})")


def check_home_page(site, page):
    name = rel(site, page)
    parsed = parse_html(page)
    html_size = page.stat().st_size
    if html_size > HTML_MAX:
        fail(f"{name}: HTML is {kb(html_size)}, budget is {kb(HTML_MAX)}")

    css_size = 0
    for href in parsed.styles:
        if is_external(href):
            continue
        f = resolve(site, page, href)
        if f.is_file():
            css_size += f.stat().st_size
        else:
            fail(f"{name}: stylesheet {href!r} not found at {rel(site, f)}")
    if css_size > CSS_MAX:
        fail(f"{name}: linked CSS is {kb(css_size)}, budget is {kb(CSS_MAX)}")

    js_size = 0
    for s in parsed.scripts:
        src = s.get("src", "")
        if not src or is_external(src):
            continue
        f = resolve(site, page, src)
        if f.is_file():
            js_size += f.stat().st_size
        else:
            fail(f"{name}: script {src!r} not found at {rel(site, f)}")
    if js_size > JS_MAX:
        fail(f"{name}: same-origin scripts total {kb(js_size)}, budget is {kb(JS_MAX)}")

    if parsed.canvas:
        fail(f"{name}: contains {parsed.canvas} <canvas> element(s); canvas is not allowed")

    video_largest = 0
    for v in parsed.videos:
        label = (v["sources"] or ["<video>"])[0]
        a = v["attrs"]
        if "autoplay" in a:
            fail(f"{name}: <video> {label} has autoplay; start playback from script instead")
        preload = a.get("preload", "").lower()
        if preload not in ("none", "metadata"):
            fail(f"{name}: <video> {label} has preload={preload or '(unset)'!r}; "
                 "use preload=\"none\" or \"metadata\"")
        for src in v["sources"]:
            if is_external(src):
                continue
            f = resolve(site, page, src)
            if not f.is_file():
                fail(f"{name}: video {src!r} not found at {rel(site, f)}")
                continue
            size = f.stat().st_size
            video_largest = max(video_largest, size)
            if size > VIDEO_MAX:
                fail(f"{name}: video {rel(site, f)} is {size / MB:.2f} MB, budget is {VIDEO_MAX / MB:.1f} MB")

    rows.append((name, kb(html_size), kb(css_size), kb(js_size),
                 f"{video_largest / MB:.2f} MB" if video_largest else "-", len(parsed.videos)))
    return parsed


STRIP_COMMENTS = re.compile(r"/\*.*?\*/", re.S)
ANIMATION_INFINITE = re.compile(r"animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b", re.I)
BLUR = re.compile(r"blur\(\s*([0-9]*\.?[0-9]+)\s*(px|rem|em)?\s*\)", re.I)


def check_css_rules(site, path):
    name = rel(site, path)
    css = STRIP_COMMENTS.sub("", path.read_text(encoding="utf-8", errors="replace"))
    if "backdrop-filter" in css:
        fail(f"{name}: uses backdrop-filter (expensive to composite)")
    if ANIMATION_INFINITE.search(css):
        fail(f"{name}: has an infinite animation (animation ... infinite)")
    if re.search(r"mix-blend-mode", css, re.I):
        fail(f"{name}: uses mix-blend-mode")
    for m in BLUR.finditer(css):
        value = float(m.group(1))
        px = value * 16 if m.group(2) and m.group(2).lower() in ("rem", "em") else value
        if px >= BLUR_MAX_PX:
            fail(f"{name}: blur({m.group(1)}{m.group(2) or ''}) radius is >= {BLUR_MAX_PX}px")
    n = len(re.findall(r"will-change\s*:", css, re.I))
    if n > 1:
        warn(f"{name}: will-change appears {n} times (keep it to at most one)")
    return n


THREE = re.compile(r"\bTHREE\.|\bthree(?:\.module|\.min|\.core)?\.m?js\b|['\"`/]three['\"`/]|@three|three\.js", re.I)

JS_BANNED = (
    (THREE, "references three.js"),
    (re.compile(r"webgl", re.I), "references WebGL"),
    (re.compile(r"getContext\s*\("), "calls getContext("),
    (re.compile("|".join(re.escape(h) for h in CDN_HOSTS), re.I), "references a CDN host"),
)


def check_js_file(site, path):
    name = rel(site, path)
    text = path.read_text(encoding="utf-8", errors="replace")
    # Drop only whole-line // comments (so "no WebGL" notes pass). Block comments are kept:
    # a "/*" inside a string or regex could otherwise swallow real code. Trailing comments stay,
    # which keeps URLs like https://cdn... visible.
    text = re.sub(r"(?m)^\s*//.*$", "", text)
    for pattern, why in JS_BANNED:
        m = pattern.search(text)
        if m:
            fail(f"{name}: {why} ({m.group(0)!r})")


def main(argv):
    site = Path("site")
    if "--site" in argv:
        i = argv.index("--site") + 1
        if i >= len(argv) or argv[i].startswith("-"):
            print("usage: check-weight.py [--site DIR]  (--site needs a directory)", file=sys.stderr)
            return 2
        site = Path(argv[i])
    if not (site / "index.html").is_file():
        print(f"check-weight: {site}/index.html not found; run from the repo root", file=sys.stderr)
        return 2

    for h in HOME_PAGES:
        page = site / h
        if page.is_file():
            check_home_page(site, page)
        else:
            fail(f"{rel(site, page)}: homepage file is missing")

    css_rows = []
    for css in ("home.css", "site.css"):
        path = site / css
        if not path.is_file():
            fail(f"{rel(site, path)}: bundle is missing (run scripts/build-site.py)")
            continue
        size = path.stat().st_size
        if css == "site.css" and size > CSS_MAX:
            fail(f"{rel(site, path)}: is {kb(size)}, budget is {kb(CSS_MAX)}")
        n = check_css_rules(site, path)
        css_rows.append((css, kb(size), n))

    pages = sorted(site.rglob("*.html"))
    for page in pages:
        check_external_scripts(site, page, parse_html(page))

    # Every first-party script, at any depth; downloads/ only holds plugin release archives.
    downloads = site / "downloads"
    js_files = sorted(p for p in list(site.rglob("*.js")) + list(site.rglob("*.mjs"))
                      if downloads not in p.parents)
    for js in js_files:
        check_js_file(site, js)

    print("Page weight budget")
    print(f"  {'page':<22}{'HTML':>10}{'CSS':>10}{'JS':>10}{'max video':>11}  videos")
    print(f"  {'budget':<22}{kb(HTML_MAX):>10}{kb(CSS_MAX):>10}{kb(JS_MAX):>10}{VIDEO_MAX / MB:>8.1f} MB  (per video file)")
    for name, h, c, j, v, n in rows:
        print(f"  {name:<22}{h:>10}{c:>10}{j:>10}{v:>11}  {n}")
    for name, size, n in css_rows:
        print(f"  {name:<22}{'':>10}{size:>10}   will-change x{n}")
    print(f"  checked {len(pages)} HTML pages and {len(js_files)} scripts")

    for w in warnings:
        print(f"WARN: {w}")
    if failures:
        print(f"\n{len(failures)} weight budget violation(s):")
        for f in failures:
            print(f"FAIL: {f}")
        return 1
    print("OK: weight budget respected")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
