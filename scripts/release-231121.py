#!/usr/bin/env python3
"""Prepare plugin v2.3.11.21 (drones follow the DJI Osmo's clock; drone offsets remembered).

* bumps 2.3.11.20 -> 2.3.11.21 in the plugin trees (handshakes, labels, installers, guides)
* prepends a v2.3.11.21 entry to RELEASE-NOTES.txt / VALIDATION.txt and the release pages (EN/ID)
* updates "current version" mentions on the website; the v2.3.11.20 ZIPs leave the site and the v2.3.11.21 ZIP links
  redirect to the signed-in download too
* points the update/download functions at v2.3.11.21; v2.3.11.20 stays downloadable for panels with a stale manifest
  (2.3.11.19 is dropped). The raw.githubusercontent pin of 2.3.11.21 is PIN (40 zeros) until the release commit exists:
  replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-231121.py (CI keeps calling test-public-23115.py, a shim), updates test-conversion.cjs and
  test-release-23112.cjs
The minimum supported version stays 2.3.11.11.
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-231121.py            (bump, notes, site, functions, tests)
       release-231121.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW, PREV = "2.3.11.20", "2.3.11.21", "2.3.11.19"
DATE = "2026-11-28"
OLD_PIN, PIN = "5974a0e31874f0198c225a1bf301fbbf316a0572", "0" * 40
PREV_PIN = "c1a2853dd2bd39771d2acb885a124b059f35ec10"   # 2.3.11.19, no longer served

NOTES = f"""v{NEW} PUBLIC — Drones follow the DJI Osmo's clock
- Sync Cameras to Music, drones and FPV without audio: when a DJI Osmo recorded, any drone is placed from the Osmo's
  clock (set from the phone), before any other camera. Zumana 27 Nov 2026: the Osmo agreed with the DJI Mini 4 Pro's GPS
  clock within 1 s, while a Blackmagic with most clips was 19.5 s off and was followed before.
- A drone remembers the camera it was paired with (model and serial) and its offset per shoot day; the same day uses the
  remembered offset at once. The Final Cut Pro app shares the same drone memory.
- Analyze no longer runs the venue-light check, which read whole camera files (about 1.5 min on an 80-min set).
- Optional update for v2.3.11.11 and later. Macs older than v2.3.11.11 install once from r-multicam.pages.dev.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Real shoot (Zumana 27 Nov 2026: Blackmagic Pocket 4K, DJI Osmo Pocket 4P, 2 Sony, Android phone, DJI Mini 4 Pro, 49
  drone clips): the drone is bridged through the Osmo and lands within 1 s of the venue-light match on two audio-synced
  cameras; through the Blackmagic (v{OLD}) it was 19.5 s late.
- scripts/test-drone-sync.cjs: 20 tests on both builds (any drone follows an Osmo first, remembered pairing wins, old
  ranking without an Osmo); scripts/test-drone-memory.cjs: 6 tests (offset remembered, same-day skip);
  scripts/test-drone-visual.cjs: 9 tests.
- Not yet run live in Premiere Pro on Windows or macOS with this build.

"""

EN_ENTRY = (
    f'<h2 id="v231121-public-windows-macos-drone-follows-osmo">v{NEW} · PUBLIC · Windows &amp; macOS · Drones follow the DJI Osmo&#39;s clock</h2>'
    '<p>Sync Cameras to Music places drone and FPV clips without audio from a camera clock. When a DJI Osmo recorded, every drone now follows the Osmo&#39;s clock, which is set from your phone, so a camera with a wrong clock can no longer push the drone out of sync. The drone also remembers the camera it was paired with and its offset per shoot day. Analyze is faster: it no longer reads whole camera files to compare the venue light. Optional update for v2.3.11.11 and later; Macs older than v2.3.11.11 install once from this website.</p>'
)
ID_ENTRY = (
    f'<h2 id="v231121-public-windows-macos-drone-follows-osmo">v{NEW} · PUBLIC · Windows &amp; macOS · Drone mengikuti jam DJI Osmo</h2>'
    '<p>Sync Cameras to Music menempatkan klip drone dan FPV tanpa audio lewat jam kamera. Kalau ada DJI Osmo yang merekam, semua drone sekarang mengikuti jam Osmo yang disetel dari HP-mu, jadi kamera dengan jam yang salah tidak bisa lagi membuat drone tidak sinkron. Drone juga mengingat kamera pasangannya dan offset-nya per hari syuting. Analyze lebih cepat: tidak lagi membaca seluruh file kamera untuk membandingkan cahaya venue. Update opsional untuk v2.3.11.11 ke atas; Mac di bawah v2.3.11.11 cukup instal sekali dari website ini.</p>'
)
EN_DESC_OLD = "v2.3.11.20: drone sync follows a camera with a working clock, so one wrong camera clock no longer drops every drone clip. Windows and macOS."
EN_DESC_NEW = "v2.3.11.21: drones follow the DJI Osmo's clock and remember their offset, and Analyze is faster. Windows and macOS."
ID_DESC_OLD = "v2.3.11.20: sinkron drone mengikuti kamera dengan jam yang benar, jadi satu jam kamera yang salah tidak lagi membuang semua klip drone."
ID_DESC_NEW = "v2.3.11.21: drone mengikuti jam DJI Osmo dan mengingat offset-nya, dan Analyze lebih cepat."
MANIFEST_NOTES_NEW = ("v2.3.11.21 PUBLIC Windows and macOS: drones without audio follow the DJI Osmo's clock when an Osmo recorded, "
                      "remember their camera pairing and offset per shoot day, and Analyze no longer reads whole camera files for the "
                      "venue-light check. On macOS the update installs while Premiere is open; restart Premiere afterwards. Mac panels "
                      "older than v2.3.11.11 cannot finish the in-panel update: install v2.3.11.21 once from r-multicam.pages.dev (sign "
                      "in, Download for Mac, run Install-macOS.command).")


PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

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
    at = s.find('<h2 id="v231120-')
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

# The v2.3.11.20 ZIPs leave the site (their links already redirect); the new ZIP links redirect too.
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

old_test, new_test = ROOT / "scripts/test-public-231120.py", ROOT / "scripts/test-public-231121.py"
t = read(old_test).replace(OLD, NEW)
anchor = "    host = new.read('Plugin/jsx/host.jsx').decode('utf-8-sig')\n"
if t.count(anchor) != 1: sys.exit("test-public: host anchor not found")
t = t.replace(anchor, "    drone = new.read('Plugin/drone-sync.js').decode('utf-8-sig')\n"
              "    assert '/osmo/i.test(String(c.model||c.name||' in drone and 'po.osmo=true' in drone, 'drones follow the Osmo first: missing'\n"
              "    assert 'pp.paired=true' in drone, 'remembered drone pairing missing'\n"
              "    sui = new.read('Plugin/sync-ui.js').decode('utf-8-sig')\n"
              "    assert 'if(deps&&deps.visual)await verifyDrones' in sui, 'Analyze must not run the light check by default'\n"
              "    assert '(deps.saveLearned||saveLearned)(cam.key,total,cam.shootDay,cam.reference)' in sui, 'light-check result is not remembered'\n"
              + anchor)
new_test.write_bytes(t.encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-231120.py", "test-public-231121.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))

# Release test: current -> NEW on PIN, previous -> OLD on OLD_PIN, PREV joins the versions that are no longer served.
tr = ROOT / "scripts/test-release-23112.cjs"; s = read(tr)
s = s.replace(OLD, NEW).replace(OLD_PIN, PIN).replace(PREV, OLD).replace(PREV_PIN, OLD_PIN)
if s.count(f"'2.3.11.18','{OLD}'") != 2: sys.exit(f"{tr}: version lists not found")
s = s.replace(f"'2.3.11.18','{OLD}'", f"'2.3.11.18','{PREV}','{OLD}'")
sub_old = "for(const v of ['2.3.11.18','2.3.11.17','2.3.11.16','2.3.11.14',"
if s.count(sub_old) != 1: sys.exit(f"{tr}: not-served list not found")
write(tr, s.replace(sub_old, f"for(const v of ['{PREV}','2.3.11.18','2.3.11.17','2.3.11.16','2.3.11.14',"))
print("bumped to", NEW, "- next: build-plugin-release.py, release-231121.py --sha, commit, then replace PIN with the release SHA")
