#!/usr/bin/env python3
"""Prepare plugin v2.3.11.16 (drones sync through a DJI camera filmed as a split take).

* bumps 2.3.11.15 -> 2.3.11.16 in the plugin trees (handshakes, labels, installers, guides)
* prepends a v2.3.11.16 entry to RELEASE-NOTES.txt / VALIDATION.txt and the release pages (EN/ID)
* updates "current version" mentions on the website; the v2.3.11.15 ZIPs leave the site and the v2.3.11.16 ZIP links
  redirect to the signed-in download too
* points the update/download functions at v2.3.11.16; v2.3.11.15 stays downloadable for panels with a stale manifest
  (2.3.11.14 is dropped). The raw.githubusercontent pin of 2.3.11.16 is PIN (40 zeros) until the release commit exists:
  replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-231116.py (CI keeps calling test-public-23115.py, a shim), updates test-conversion.cjs and
  test-release-23112.cjs
The minimum supported version stays 2.3.11.11.
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-231116.py            (bump, notes, site, functions, tests)
       release-231116.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW, PREV = "2.3.11.15", "2.3.11.16", "2.3.11.14"
DATE = "2026-10-31"
OLD_PIN, PIN = "d0f3515431bc2ed06cc1c859165f90a7a1f884e0", "0" * 40
PREV_PIN = "c3d29904be31a68829f89d9a1ed50deefbb4c348"   # 2.3.11.14, no longer served

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Drones sync through DJI cameras
New in this release:
- Sync Cameras to Music: a camera whose clips all match the music with medium confidence now gives a trusted camera
  clock when a clip's end, searched separately over the whole music, lands on the same position as its start (two
  independent matches of one clip) and a second clip agrees. Drones bridge through it: on a shoot with a DJI Osmo
  split take, all 19 drone clips were excluded before and are now placed by the DJI clock.
- A long take that started well before the music (its start excerpt has no music to match) is placed by a high
  match of its end instead of going to Review.
- Optional update for v2.3.11.11 and later. Macs older than v2.3.11.11 install once from r-multicam.pages.dev.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Real shoot (DJI Osmo split take, Sony 73 min take, 19 drone clips, 51 min master WAV): DJI clock trusted, every drone
  clip placed within 0.74 s of reference positions; Sony take placed at its end match (independent cross-correlation
  agrees within 0.05 s). Earlier real shoots (FULL MOON parts 1 and 2, Kaehla, Artbat drone) and the sync benchmark
  unchanged; plugin suites pass on both trees.

"""

EN_ENTRY = (
    f'<h2 id="v231116-public-windows-macos-dji-drone-clock">v{NEW} · PUBLIC · Windows &amp; macOS · Drones sync through DJI cameras</h2>'
    '<p>Sync Cameras to Music trusts the clock of a camera whose clips all match with medium confidence when a clip&#39;s start and end are found at the same place in the music and a second clip agrees, so drones are placed through it (a DJI Osmo split take now carries all 19 drone clips of a shoot that were excluded before). A long take that started well before the music is placed by its end. Optional update for v2.3.11.11 and later; Macs older than v2.3.11.11 install once from this website.</p>'
)
ID_ENTRY = (
    f'<h2 id="v231116-public-windows-macos-dji-drone-clock">v{NEW} · PUBLIC · Windows &amp; macOS · Drone sinkron lewat kamera DJI</h2>'
    '<p>Sync Cameras to Music sekarang memercayai jam kamera yang semua kliknya cocok dengan keyakinan sedang bila awal dan akhir sebuah klip ditemukan di posisi yang sama di musik dan klip kedua sepakat, sehingga drone ditempatkan lewat kamera itu (take DJI Osmo yang terbagi sekarang membawa ke-19 klip drone yang sebelumnya tidak terpasang). Take panjang yang dimulai jauh sebelum musik ditempatkan lewat akhirnya. Update opsional untuk v2.3.11.11 ke atas; Mac di bawah v2.3.11.11 cukup instal sekali dari website ini.</p>'
)
EN_DESC_OLD = "v2.3.11.15 syncs long single takes by their audio and checks Camera roles before Auto Cut, for Windows and macOS."
EN_DESC_NEW = "v2.3.11.16 syncs drones through DJI cameras whose clips match with medium confidence, for Windows and macOS."
ID_DESC_OLD = "v2.3.11.15 menyinkronkan take panjang lewat audionya dan mengecek Camera roles sebelum Auto Cut."
ID_DESC_NEW = "v2.3.11.16 menyinkronkan drone lewat kamera DJI yang kliknya cocok dengan keyakinan sedang."
MANIFEST_NOTES_NEW = ("v2.3.11.16 PUBLIC Windows and macOS: Sync Cameras to Music trusts a camera clock when a clip's start and end "
                      "are found at the same place in the music and a second clip agrees, so drones sync through DJI cameras whose clips "
                      "match with medium confidence; a long take that started before the music is placed by its end. On macOS the update "
                      "installs while Premiere is open; restart Premiere afterwards. Mac panels older than v2.3.11.11 cannot finish the "
                      "in-panel update: install v2.3.11.16 once from r-multicam.pages.dev (sign in, Download for Mac, run "
                      "Install-macOS.command).")



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
    at = s.find('<h2 id="v231115-')
    if at < 0: sys.exit(f"{f}: v{OLD} entry not found")
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

# The v2.3.11.15 ZIPs leave the site (their links already redirect); the new ZIP links redirect too.
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
m = re.search(r'  "' + re.escape(PREV) + r'": \{\n.*?\n  \},\n', s, re.S)
if not m: sys.exit(f"{dl}: {PREV} entry not found")
s = s.replace(m.group(0), "")
m = re.search(r'  "' + re.escape(OLD) + r'": \{\n.*?\n  \}\n', s, re.S)
if not m: sys.exit(f"{dl}: {OLD} entry not found")
prev = m.group(0)
cur = prev.replace(f'"{OLD}"', f'"{NEW}"').replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC").replace(OLD_PIN, PIN)
s = s.replace(prev, prev.rstrip("\n") + ",\n" + cur)
if PREV_PIN in s: sys.exit(f"{dl}: {PREV} pin still referenced")
write(dl, s)

wd = fn / "website-download/index.ts"; s = read(wd)
if s.count(f"-v{OLD}-PUBLIC") != 2: sys.exit(f"{wd}: unexpected {OLD} file names")
write(wd, s.replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC"))

old_test, new_test = ROOT / "scripts/test-public-231115.py", ROOT / "scripts/test-public-231116.py"
new_test.write_bytes(read(old_test).replace(OLD, NEW).encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-231115.py", "test-public-231116.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))

# Release test: current -> NEW on PIN, previous -> OLD on OLD_PIN, PREV joins the versions that are no longer served.
tr = ROOT / "scripts/test-release-23112.cjs"; s = read(tr)
s = s.replace(OLD, NEW).replace(OLD_PIN, PIN).replace(PREV, OLD).replace(PREV_PIN, OLD_PIN)
if s.count(f"'2.3.11.13','{OLD}'") != 2: sys.exit(f"{tr}: version lists not found")
s = s.replace(f"'2.3.11.13','{OLD}'", f"'2.3.11.13','{PREV}','{OLD}'")
sub_old = "for(const v of ['2.3.11.13','2.3.11.12',"
if s.count(sub_old) != 1: sys.exit(f"{tr}: not-served list not found")
write(tr, s.replace(sub_old, f"for(const v of ['{PREV}','2.3.11.13','2.3.11.12',"))
print("bumped to", NEW, "- next: build-plugin-release.py, release-231116.py --sha, commit, then replace PIN with the release SHA")
