#!/usr/bin/env python3
"""Prepare plugin v2.3.11.12 (test release: same code as v2.3.11.11, proves the fixed macOS in-panel update).

* bumps 2.3.11.9 -> 2.3.11.10 in the plugin trees (handshakes, labels, installers, guides)
* prepends a v2.3.11.10 entry to RELEASE-NOTES.txt / VALIDATION.txt and the release pages (EN/ID)
* updates "current version" mentions on the website; the v2.3.11.9 ZIPs leave the site (their links already redirect)
  and the v2.3.11.10 ZIP links redirect to the signed-in download too
* points the update/download functions at v2.3.11.10; v2.3.11.9 stays downloadable for panels with a stale manifest
  (2.3.11.10 is dropped). The raw.githubusercontent pin of 2.3.11.10 is PIN (40 zeros) until the release commit exists:
  replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-231110.py (CI keeps calling test-public-23115.py, a shim) and updates test-conversion.cjs
The minimum supported version is raised separately (after the downloads are live).
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-231112.py            (bump, notes, site, functions, tests)
       release-231112.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW = "2.3.11.11", "2.3.11.12"
DATE = "2026-10-25"
OLD_PIN, PIN = "e59facb8db8ef757cfa9b0acf177720b3c5d76d7", "0" * 40
PREV_PIN = "b0cf84b2ceaac3adea60ceb6a3ffa5880c2c98d3"   # 2.3.11.10, no longer served

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Update test release
New in this release:
- No changes to the plugin: v{NEW} is the same code as v2.3.11.11. It exists so v2.3.11.11 can be updated from
  inside the panel, which proves the fixed macOS update (installs while Premiere is open, then asks for a restart).
- Optional update for v2.3.11.11; earlier versions must update.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Plugin files identical to v2.3.11.11 except the version strings; all release, archive, token-refresh, signing,
  payment and website tests rerun.
- The real check is on Apple hardware: from v2.3.11.11, Check Update installs v{NEW} while Premiere stays open.

"""

EN_ENTRY = (
    f'<h2 id="v231112-public-windows-macos-update-test">v{NEW} · PUBLIC · Windows &amp; macOS · Update test release</h2>'
    '<p>No changes to the plugin: this release is the same code as v2.3.11.11 and lets v2.3.11.11 be updated from inside the panel, which confirms the fixed macOS update (it installs while Premiere is open, then asks you to restart Premiere). Optional for v2.3.11.11; earlier versions must update.</p>'
)
ID_ENTRY = (
    f'<h2 id="v231112-public-windows-macos-update-test">v{NEW} · PUBLIC · Windows &amp; macOS · Rilis uji update</h2>'
    '<p>Tidak ada perubahan pada plugin: rilis ini kodenya sama dengan v2.3.11.11 dan memungkinkan v2.3.11.11 di-update langsung dari panel, sekaligus membuktikan perbaikan update macOS (menginstal saat Premiere masih terbuka, lalu meminta restart Premiere). Opsional untuk v2.3.11.11; versi sebelumnya wajib update.</p>'
)
EN_DESC_OLD = "v2.3.11.11 (required) fixes the macOS in-panel update; v2.3.11.10 protects offline use with a signed license, for Windows and macOS."
EN_DESC_NEW = "v2.3.11.12 is an update test release (same code as v2.3.11.11, which fixed the macOS in-panel update), for Windows and macOS."
ID_DESC_OLD = "v2.3.11.11 (wajib) memperbaiki update di panel macOS; v2.3.11.10 melindungi pemakaian offline dengan lisensi bertanda tangan."
ID_DESC_NEW = "v2.3.11.12 adalah rilis uji update (kode sama dengan v2.3.11.11 yang memperbaiki update di panel macOS)."
MANIFEST_NOTES_NEW = ("v2.3.11.12 PUBLIC Windows and macOS: update test release, same code as v2.3.11.11. On macOS the update installs while "
                      "Premiere is open; restart Premiere afterwards. Optional for v2.3.11.11; earlier versions must update. If an older Mac "
                      "panel says the update helper was stopped, install once from r-multicam.pages.dev.")


def read(p): return p.read_bytes().decode("utf-8")
def write(p, s): p.write_bytes(s.encode("utf-8"))
def sub(p, old, new, count=1):
    s = read(p)
    if s.count(old) != count: sys.exit(f"{p}: expected {count}x {old[:60]!r}, found {s.count(old)}")
    write(p, s.replace(old, new))


def write_checksums():
    man = ROOT / "supabase/functions/plugin-update-manifest/index.ts"
    s = read(man)
    for label, key in (("Windows", "windows"), ("macOS", "macos")):
        z = ROOT / f"site/downloads/R-Project-Multicam-AI-{label}-v{NEW}-PUBLIC.zip"
        if not z.exists(): sys.exit(f"missing {z}: run build-plugin-release.py first")
        sha = hashlib.sha256(z.read_bytes()).hexdigest()
        s, n = re.subn(r'(download: base \+ "\?platform=' + key + r'&version=' + re.escape(NEW) + r'",\s*sha256: ")[0-9a-f]{64}(")', r"\g<1>" + sha + r"\2", s)
        if n != 1: sys.exit(f"{man}: {key} sha256 not found")
    write(man, s)
    print("manifest checksums written")


if "--sha" in sys.argv:
    write_checksums(); sys.exit(0)

if f'ExtensionBundleVersion="{NEW}"' in read(ROOT / "plugin/windows/Plugin/CSXS/manifest.xml"):
    sys.exit("already at " + NEW)

for plat in ("windows", "macos"):
    base = ROOT / "plugin" / plat
    for rel in PLUGIN_FILES + PLATFORM_FILES[plat]:
        f = base / rel
        s = read(f)
        if OLD not in s: sys.exit(f"{f}: no {OLD}")
        write(f, s.replace(OLD, NEW))
    for name, text in (("RELEASE-NOTES.txt", NOTES), ("VALIDATION.txt", VALIDATION)):
        f = base / name; s = read(f)
        nl = "\r\n" if "\r\n" in s else "\n"
        write(f, text.replace("\n", nl) + s)

for rel, entry, d_old, d_new in (("site/releases/index.html", EN_ENTRY, EN_DESC_OLD, EN_DESC_NEW),
                                 ("site/id/releases/index.html", ID_ENTRY, ID_DESC_OLD, ID_DESC_NEW)):
    f = ROOT / rel; s = read(f)
    at = s.find('<h2 id="v231111-')
    if at < 0: sys.exit(f"{f}: v2.3.11.11 entry not found")
    s = s[:at] + entry + s[at:]
    if s.count(d_old) < 1: sys.exit(f"{f}: description not found")
    s = s.replace(d_old, d_new).replace(f"Multicam AI v{OLD}", f"Multicam AI v{NEW}")
    write(f, s)

for f in (ROOT / "site").rglob("*"):
    if not f.is_file() or f.suffix not in (".html", ".js") or "downloads" in f.parts or "releases" in f.parts \
            or "sync-multicam-to-music" in f.parts or f.name == "pricing.js":
        continue
    s = read(f); t = s.replace(OLD, NEW)
    if t != s: write(f, t)

# The v2.3.11.9 ZIPs leave the site (their links already redirect); the new ZIP links redirect too.
red = ROOT / "site/_redirects"; s = read(red)
add = [f"/downloads/R-Project-Multicam-AI-{lab}-v{NEW}-PUBLIC.zip /?download={lab.lower()} 302" for lab in ("Windows", "macOS")]
old_lines = [f"/downloads/R-Project-Multicam-AI-{lab}-v{OLD}-PUBLIC.zip /?download={lab.lower()} 302" for lab in ("Windows", "macOS")]
if not all(l in s for l in old_lines): sys.exit(f"{red}: v{OLD} redirects missing")
write(red, "\n".join(add + [l for l in s.split("\n") if l not in add]))
for lab in ("Windows", "macOS"):
    (ROOT / f"site/downloads/R-Project-Multicam-AI-{lab}-v{OLD}-PUBLIC.zip").unlink()

fn = ROOT / "supabase/functions"
man = fn / "plugin-update-manifest/index.ts"; s = read(man)
m = re.search(r'release_notes: "([^"]*)"', s)
if not m: sys.exit(f"{man}: release_notes not found")
s = s.replace(m.group(0), f'release_notes: "{MANIFEST_NOTES_NEW}"')
# Only the two release entries move; MINIMUM_SUPPORTED is raised separately after the downloads are live.
if s.count(f'version: "{OLD}"') != 2 or s.count(f"version={OLD}") != 2: sys.exit(f"{man}: unexpected {OLD} references")
write(man, s.replace(f'version: "{OLD}"', f'version: "{NEW}"').replace(f"version={OLD}", f"version={NEW}"))

dl = fn / "plugin-update-download/index.ts"; s = read(dl)
s = s.replace(f'{{ windows: "{OLD}", macos: "{OLD}" }}', f'{{ windows: "{NEW}", macos: "{NEW}" }}')
m = re.search(r'  "2\.3\.11\.10": \{\n.*?\n  \},\n', s, re.S)
if not m: sys.exit(f"{dl}: 2.3.11.10 entry not found")
s = s.replace(m.group(0), "")
m = re.search(r'  "' + re.escape(OLD) + r'": \{\n.*?\n  \}\n', s, re.S)
if not m: sys.exit(f"{dl}: {OLD} entry not found")
prev = m.group(0)
cur = prev.replace(f'"{OLD}"', f'"{NEW}"').replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC").replace(OLD_PIN, PIN)
s = s.replace(prev, prev.rstrip("\n") + ",\n" + cur)
if PREV_PIN in s: sys.exit(f"{dl}: 2.3.11.10 pin still referenced")
write(dl, s)

wd = fn / "website-download/index.ts"; s = read(wd)
if s.count(f"-v{OLD}-PUBLIC") != 2: sys.exit(f"{wd}: unexpected {OLD} file names")
write(wd, s.replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC"))

old_test, new_test = ROOT / "scripts/test-public-231111.py", ROOT / "scripts/test-public-231112.py"
new_test.write_bytes(read(old_test).replace(OLD, NEW).encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-231111.py", "test-public-231112.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))
print("bumped to", NEW, "- next: update test-release-23112.cjs, build-plugin-release.py, then release-231112.py --sha; PIN is", PIN)
