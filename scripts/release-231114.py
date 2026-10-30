#!/usr/bin/env python3
"""Prepare plugin v2.3.11.14 (drone sync through a camera filmed in one long take).

* bumps 2.3.11.13 -> 2.3.11.14 in the plugin trees (handshakes, labels, installers, guides)
* prepends a v2.3.11.14 entry to RELEASE-NOTES.txt / VALIDATION.txt and the release pages (EN/ID)
* updates "current version" mentions on the website; the v2.3.11.13 ZIPs leave the site and the v2.3.11.14 ZIP links
  redirect to the signed-in download too
* points the update/download functions at v2.3.11.14; v2.3.11.13 stays downloadable for panels with a stale manifest
  (2.3.11.12 is dropped). The raw.githubusercontent pin of 2.3.11.14 is PIN (40 zeros) until the release commit exists:
  replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-231114.py (CI keeps calling test-public-23115.py, a shim) and updates test-conversion.cjs
The minimum supported version stays 2.3.11.11.
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-231114.py            (bump, notes, site, functions, tests)
       release-231114.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW = "2.3.11.13", "2.3.11.14"
DATE = "2026-10-30"
OLD_PIN, PIN = "699fec11d46764d84e7c3b031240cdc2ca26a83d", "0" * 40
PREV_PIN = "4b560220ebabf49382d01b11cbf5ec9f43416f06"   # 2.3.11.12, no longer served

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Drone sync through single-take cameras
New in this release:
- Sync Cameras to Music: a camera filmed in one long take now gives a trusted camera clock when it is the only clip that
  matched: after a high-confidence match of at least 2 minutes, or when the end of the same take lands on the same
  position in the music. Drone clips bridge through that clock, so drones sync on shoots where every camera is one
  long recording. Two or more clips of one camera must still agree, so a camera with a wrong clock stays untrusted.
- Optional update for v2.3.11.11 and later. Macs older than v2.3.11.11 install once from r-multicam.pages.dev.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Release, archive, token-refresh, signing, payment and website tests rerun; engine bench unchanged on both trees.
- Shoot with one long take per camera: drone clips placed through the DJI Osmo clock (MAVIC 40, FPV 10); multi-clip
  shoot and the sync benchmark unchanged; single-take clock test passes on both trees.

"""

EN_ENTRY = (
    f'<h2 id="v231114-public-windows-macos-drone-single-take">v{NEW} · PUBLIC · Windows &amp; macOS · Drone sync through single-take cameras</h2>'
    '<p>Sync Cameras to Music: a camera filmed in one long take now gives a trusted camera clock when it is the only clip that matched (a high-confidence match of at least 2 minutes, or the end of the take landing on the same spot in the music). Drone clips bridge through that clock, so drones sync on shoots where every camera is one long recording. Optional update for v2.3.11.11 and later; Macs older than v2.3.11.11 install once from this website.</p>'
)
ID_ENTRY = (
    f'<h2 id="v231114-public-windows-macos-drone-single-take">v{NEW} · PUBLIC · Windows &amp; macOS · Sync drone lewat kamera satu take panjang</h2>'
    '<p>Sync Cameras to Music: kamera yang merekam satu take panjang sekarang memberi jam kamera yang dipercaya bila hanya klip itu yang cocok (cocok dengan keyakinan tinggi minimal 2 menit, atau akhir take jatuh di posisi yang sama di musik). Klip drone disambungkan lewat jam itu, jadi drone bisa sync di shoot yang semua kameranya satu rekaman panjang. Update opsional untuk v2.3.11.11 ke atas; Mac yang lebih lama dari v2.3.11.11 perlu instal sekali dari website ini.</p>'
)
EN_DESC_OLD = "v2.3.11.13 fixes the Windows installer FFmpeg fallback and the macOS low-memory mode, for Windows and macOS."
EN_DESC_NEW = "v2.3.11.14 syncs drone clips through a camera filmed in one long take, for Windows and macOS."
ID_DESC_OLD = "v2.3.11.13 memperbaiki fallback FFmpeg di installer Windows dan mode memori rendah macOS."
ID_DESC_NEW = "v2.3.11.14 menyinkronkan klip drone lewat kamera yang merekam satu take panjang."
MANIFEST_NOTES_NEW = ("v2.3.11.14 PUBLIC Windows and macOS: Sync Cameras to Music trusts the clock of a camera filmed in one long take "
                      "(high-confidence match of 2 minutes or more, or the end of the take matching the same spot), so drone clips sync "
                      "through it. On macOS the update installs while Premiere is open; restart Premiere afterwards. Mac panels older "
                      "than v2.3.11.11 cannot finish the in-panel update: install v2.3.11.14 once from r-multicam.pages.dev (sign in, "
                      "Download for Mac, run Install-macOS.command).")


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
    at = s.find('<h2 id="v231113-')
    if at < 0: sys.exit(f"{f}: v2.3.11.13 entry not found")
    s = s[:at] + entry + s[at:]
    if s.count(d_old) < 1: sys.exit(f"{f}: description not found")
    s = s.replace(d_old, d_new).replace(f"Multicam AI v{OLD}", f"Multicam AI v{NEW}").replace(f"Release Notes: v{OLD}", f"Release Notes: v{NEW}")
    write(f, s)

for f in (ROOT / "site").rglob("*"):
    if not f.is_file() or f.suffix not in (".html", ".js") or "downloads" in f.parts or "releases" in f.parts \
            or "sync-multicam-to-music" in f.parts or f.name == "pricing.js":
        continue
    s = read(f); t = s.replace(OLD, NEW)
    if t != s: write(f, t)

# The v2.3.11.13 ZIPs leave the site (their links already redirect); the new ZIP links redirect too.
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
m = re.search(r'  "2\.3\.11\.12": \{\n.*?\n  \},\n', s, re.S)
if not m: sys.exit(f"{dl}: 2.3.11.12 entry not found")
s = s.replace(m.group(0), "")
m = re.search(r'  "' + re.escape(OLD) + r'": \{\n.*?\n  \}\n', s, re.S)
if not m: sys.exit(f"{dl}: {OLD} entry not found")
prev = m.group(0)
cur = prev.replace(f'"{OLD}"', f'"{NEW}"').replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC").replace(OLD_PIN, PIN)
s = s.replace(prev, prev.rstrip("\n") + ",\n" + cur)
if PREV_PIN in s: sys.exit(f"{dl}: 2.3.11.12 pin still referenced")
write(dl, s)

wd = fn / "website-download/index.ts"; s = read(wd)
if s.count(f"-v{OLD}-PUBLIC") != 2: sys.exit(f"{wd}: unexpected {OLD} file names")
write(wd, s.replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC"))

old_test, new_test = ROOT / "scripts/test-public-231113.py", ROOT / "scripts/test-public-231114.py"
new_test.write_bytes(read(old_test).replace(OLD, NEW).encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-231113.py", "test-public-231114.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))
print("bumped to", NEW, "- next: update test-release-23112.cjs, build-plugin-release.py, then release-231114.py --sha; PIN is", PIN)
