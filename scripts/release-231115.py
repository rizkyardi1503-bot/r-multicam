#!/usr/bin/env python3
"""Prepare plugin v2.3.11.15 (sync: long take placed by its end; Auto Cut: Camera roles guard).

* bumps 2.3.11.14 -> 2.3.11.15 in the plugin trees (handshakes, labels, installers, guides)
* prepends a v2.3.11.15 entry to RELEASE-NOTES.txt / VALIDATION.txt and the release pages (EN/ID)
* updates "current version" mentions on the website; the v2.3.11.14 ZIPs leave the site and the v2.3.11.15 ZIP links
  redirect to the signed-in download too
* points the update/download functions at v2.3.11.15; v2.3.11.14 stays downloadable for panels with a stale manifest
  (2.3.11.13 is dropped). The raw.githubusercontent pin of 2.3.11.15 is PIN (40 zeros) until the release commit exists:
  replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-231115.py (CI keeps calling test-public-23115.py, a shim), updates test-conversion.cjs and
  test-release-23112.cjs
The minimum supported version stays 2.3.11.11.
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-231115.py            (bump, notes, site, functions, tests)
       release-231115.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW, PREV = "2.3.11.14", "2.3.11.15", "2.3.11.13"
DATE = "2026-10-30"
OLD_PIN, PIN = "c3d29904be31a68829f89d9a1ed50deefbb4c348", "0" * 40
PREV_PIN = "699fec11d46764d84e7c3b031240cdc2ca26a83d"   # 2.3.11.13, no longer served

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Sync long takes by audio, Camera roles check
New in this release:
- Sync Cameras to Music: a camera with audio but no trusted clock, filmed in one long take, is now placed by its audio
  even when the start of the take is unclear: the end of the take is searched over the whole music and the start must
  match within 0.25 s of it. Before, such a take went to the Review track at a wrong position (a handheld DJI take was
  162 s late). The panel now says "audio only" for cameras synced by audio.
- Auto Cut Multicam: when Camera roles name tracks that are empty in this sequence and leave only one camera with
  footage, Auto Cut stops before the backup copy and any cut and names the tracks to use (for example V3, V2).
- Optional update for v2.3.11.11 and later. Macs older than v2.3.11.11 install once from r-multicam.pages.dev.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Real shoot (3 cameras, 43 min master WAV): every camera placed within 0.02 s of an independent audio
  cross-correlation (cam 3 DJI handheld take was 162.6 s late before). Real Kaehla and Artbat shoots and the sync
  benchmark (5 sets, 20 and 60 min) unchanged; Camera roles guard unit test passes; plugin suites pass on both trees.

"""

EN_ENTRY = (
    f'<h2 id="v231115-public-windows-macos-long-take-audio">v{NEW} · PUBLIC · Windows &amp; macOS · Long takes synced by audio, Camera roles check</h2>'
    '<p>Sync Cameras to Music places a camera filmed in one long take by its audio even when the start of the take is unclear: the end of the take is found in the music and the start must match it within 0.25 s, so it no longer lands on the Review track at a wrong position. Auto Cut Multicam stops before any change when Camera roles leave only one camera with footage, and names the tracks to use. Optional update for v2.3.11.11 and later; Macs older than v2.3.11.11 install once from this website.</p>'
)
ID_ENTRY = (
    f'<h2 id="v231115-public-windows-macos-long-take-audio">v{NEW} · PUBLIC · Windows &amp; macOS · Take panjang disinkron lewat audio, cek Camera roles</h2>'
    '<p>Sync Cameras to Music menempatkan kamera yang merekam satu take panjang lewat audionya walau awal take tidak jelas: akhir take dicari di musik dan awal take harus cocok dalam 0,25 detik, jadi tidak lagi masuk track Review di posisi yang salah. Auto Cut Multicam berhenti sebelum mengubah apa pun bila Camera roles hanya menyisakan satu kamera yang berisi footage, dan menyebut track yang harus dipakai. Update opsional untuk v2.3.11.11 ke atas; Mac di bawah v2.3.11.11 cukup instal sekali dari website ini.</p>'
)
EN_DESC_OLD = "v2.3.11.14 fixes Sync, Auto Cut and Analyze Music: drones sync through single-take cameras and Cut Pace never blocks Apply, for Windows and macOS."
EN_DESC_NEW = "v2.3.11.15 syncs long single takes by their audio and checks Camera roles before Auto Cut, for Windows and macOS."
ID_DESC_OLD = "v2.3.11.14 memperbaiki Sync, Auto Cut dan Analyze Music: drone sinkron lewat kamera satu take dan Cut Pace tidak lagi memblokir Apply."
ID_DESC_NEW = "v2.3.11.15 menyinkronkan take panjang lewat audionya dan mengecek Camera roles sebelum Auto Cut."
MANIFEST_NOTES_NEW = ("v2.3.11.15 PUBLIC Windows and macOS: Sync Cameras to Music places a long single take by its audio even when its "
                      "start is unclear (the end is found in the music and the start must match it), instead of sending it to Review at a "
                      "wrong position; Auto Cut Multicam stops before any change when Camera roles leave only one camera with footage and "
                      "names the tracks to use. On macOS the update installs while Premiere is open; restart Premiere afterwards. Mac "
                      "panels older than v2.3.11.11 cannot finish the in-panel update: install v2.3.11.15 once from r-multicam.pages.dev "
                      "(sign in, Download for Mac, run Install-macOS.command).")


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
    at = s.find('<h2 id="v231114-')
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

# The v2.3.11.14 ZIPs leave the site (their links already redirect); the new ZIP links redirect too.
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

old_test, new_test = ROOT / "scripts/test-public-231114.py", ROOT / "scripts/test-public-231115.py"
new_test.write_bytes(read(old_test).replace(OLD, NEW).encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-231114.py", "test-public-231115.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))

# Release test: current -> NEW on PIN, previous -> OLD on OLD_PIN, PREV joins the versions that are no longer served.
tr = ROOT / "scripts/test-release-23112.cjs"; s = read(tr)
s = s.replace(OLD, NEW).replace(OLD_PIN, PIN).replace(PREV, OLD).replace(PREV_PIN, OLD_PIN)
if s.count(f"'2.3.11.12','{OLD}'") != 2: sys.exit(f"{tr}: version lists not found")
s = s.replace(f"'2.3.11.12','{OLD}'", f"'2.3.11.12','{PREV}','{OLD}'")
sub_old = "for(const v of ['2.3.11.12','2.3.11.11',"
if s.count(sub_old) != 1: sys.exit(f"{tr}: not-served list not found")
write(tr, s.replace(sub_old, f"for(const v of ['{PREV}','2.3.11.12','2.3.11.11',"))
print("bumped to", NEW, "- next: build-plugin-release.py, release-231115.py --sha, commit, then replace PIN with the release SHA")
