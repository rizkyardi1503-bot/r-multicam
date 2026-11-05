#!/usr/bin/env python3
"""Prepare plugin v2.3.11.19 (LUT for All Footage; camera sync and reliability fixes).

* bumps 2.3.11.18 -> 2.3.11.19 in the plugin trees (handshakes, labels, installers, guides)
* prepends a v2.3.11.19 entry to RELEASE-NOTES.txt / VALIDATION.txt and the release pages (EN/ID)
* updates "current version" mentions on the website; the v2.3.11.18 ZIPs leave the site and the v2.3.11.19 ZIP links
  redirect to the signed-in download too
* points the update/download functions at v2.3.11.19; v2.3.11.18 stays downloadable for panels with a stale manifest
  (2.3.11.17 is dropped). The raw.githubusercontent pin of 2.3.11.19 is PIN (40 zeros) until the release commit exists:
  replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-231119.py (CI keeps calling test-public-23115.py, a shim), updates test-conversion.cjs and
  test-release-23112.cjs
The minimum supported version stays 2.3.11.11.
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-231119.py            (bump, notes, site, functions, tests)
       release-231119.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW, PREV = "2.3.11.18", "2.3.11.19", "2.3.11.17"
DATE = "2026-11-05"
OLD_PIN, PIN = "7f519c44125f9bc1c2f9fa751189fe2582e5c9a9", "0" * 40
PREV_PIN = "c4e8faebcf94788e66e45c36885fbbf678fbe09c"   # 2.3.11.17, no longer served

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — LUT for All Footage; camera sync and reliability fixes
New in this release:
- LUT for All Footage (tool 02B, Premiere Pro 2026 version 26 and later): puts one .cube LUT on every footage clip of
  the active sequence, or only on the selected clips, at the intensity you choose. It uses its own Lumetri Color
  effect: a Lumetri you already graded with is never changed, and Remove LUT deletes only the plugin's effect. Pick
  from your own LUTs or Premiere's Creative LUTs. Changing only the intensity keeps a grade made inside that effect.
  Locked or hidden tracks, disabled clips, graphics, nested sequences and offline clips are skipped and reported.
- Sync Cameras to Music: clips placed from another camera's audio, or from a search outside the music, are marked for
  checking instead of being trusted as high confidence. Network (UNC) paths work, audio-only files are left out, and
  an analysis that stops responding ends with a readable error instead of waiting forever.
- Drone sync: a clip without a recording date is no longer treated as having a clock.
- Stop still works after the panel reconnects to Premiere. The Windows installer reports a failed file copy.
- Optional update for v2.3.11.11 and later. Macs older than v2.3.11.11 install once from r-multicam.pages.dev.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- LUT for All Footage, live on Windows, Premiere Pro 26.3, measured on exported frames: apply and intensity values
  exact, change LUT, remove, save and reopen, an editor's own Lumetri with keyframes left intact through all of them,
  locked tracks, stills, a 2x speed clip, 23.976, 29.97 and 59.94 fps, a non-ASCII path, cancelled file dialog.
- macOS: the same code passes the automated suite but has NOT been run live in Premiere on a Mac.
- Automated plugin suite: 89 of 93 pass. The other 4 are real-footage drone tests that need a drive not mounted for
  this run, so the camera and drone sync changes were not re-run against those real shoots.

"""

EN_ENTRY = (
    f'<h2 id="v231119-public-windows-macos-lut-for-all-footage">v{NEW} · PUBLIC · Windows &amp; macOS · LUT for All Footage; camera sync and reliability fixes</h2>'
    '<p>New tool: LUT for All Footage puts one .cube LUT on every footage clip of the sequence, or only the selected clips, at the intensity you choose (Premiere Pro 2026, version 26 and later). It uses its own Lumetri Color effect, so a Lumetri you already graded with is never changed, and Remove LUT deletes only the plugin effect. Sync Cameras to Music now marks less certain placements for checking, works on network paths and ends with a clear error if an analysis stops responding. Optional update for v2.3.11.11 and later; Macs older than v2.3.11.11 install once from this website.</p>'
)
ID_ENTRY = (
    f'<h2 id="v231119-public-windows-macos-lut-for-all-footage">v{NEW} · PUBLIC · Windows &amp; macOS · LUT for All Footage; perbaikan sync kamera dan keandalan</h2>'
    '<p>Tool baru: LUT for All Footage memasang satu LUT .cube ke semua klip footage di sequence, atau hanya klip yang dipilih, dengan intensitas yang kamu tentukan (Premiere Pro 2026, versi 26 ke atas). Tool ini memakai efek Lumetri Color sendiri, jadi Lumetri yang sudah kamu grade tidak pernah berubah, dan Remove LUT hanya menghapus efek milik plugin. Sync Cameras to Music kini menandai penempatan yang kurang pasti untuk dicek, berjalan di path jaringan, dan berhenti dengan pesan jelas kalau analisis tidak merespons. Update opsional untuk v2.3.11.11 ke atas; Mac di bawah v2.3.11.11 cukup instal sekali dari website ini.</p>'
)
EN_DESC_OLD = "v2.3.11.18 opens Sync Cameras to Music to the 7-day trial and syncs cameras even when the master covers only part of the shoot, for Windows and macOS."
EN_DESC_NEW = "v2.3.11.19 adds LUT for All Footage: one .cube LUT on every clip at the intensity you choose, without touching your own Lumetri grade, for Windows and macOS."
ID_DESC_OLD = "v2.3.11.18 membuka Sync Cameras to Music untuk trial 7 hari dan menyinkronkan kamera walau rekaman master hanya menutup sebagian shoot."
ID_DESC_NEW = "v2.3.11.19 menambah LUT for All Footage: satu LUT .cube ke semua klip dengan intensitas pilihanmu, tanpa mengubah grade Lumetri milikmu."
MANIFEST_NOTES_NEW = ("v2.3.11.19 PUBLIC Windows and macOS: new LUT for All Footage puts one .cube LUT on every footage clip or the selected "
                      "clips at the intensity you choose (Premiere Pro 26 and later), without changing a Lumetri you already graded with. "
                      "Sync Cameras to Music marks less certain placements for checking and works on network paths. On macOS the update "
                      "installs while Premiere is open; restart Premiere afterwards. Mac panels older than v2.3.11.11 cannot finish the "
                      "in-panel update: install v2.3.11.19 once from r-multicam.pages.dev (sign in, Download for Mac, run Install-macOS.command).")


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
    at = s.find('<h2 id="v231118-')
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

# The v2.3.11.18 ZIPs leave the site (their links already redirect); the new ZIP links redirect too.
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

old_test, new_test = ROOT / "scripts/test-public-231118.py", ROOT / "scripts/test-public-231119.py"
t = read(old_test).replace(OLD, NEW)
if t.count("ENGINE = ['Plugin/audio-core.js',") != 1: sys.exit("test-public: ENGINE list not found")
new_test.write_bytes(t.replace("ENGINE = ['Plugin/audio-core.js',", "ENGINE = ['Plugin/lut-ui.js', 'Plugin/lumetri-look.xml', 'Plugin/audio-core.js',").encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-231118.py", "test-public-231119.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))

# Release test: current -> NEW on PIN, previous -> OLD on OLD_PIN, PREV joins the versions that are no longer served.
tr = ROOT / "scripts/test-release-23112.cjs"; s = read(tr)
s = s.replace(OLD, NEW).replace(OLD_PIN, PIN).replace(PREV, OLD).replace(PREV_PIN, OLD_PIN)
if s.count(f"'2.3.11.16','{OLD}'") != 2: sys.exit(f"{tr}: version lists not found")
s = s.replace(f"'2.3.11.16','{OLD}'", f"'2.3.11.16','{PREV}','{OLD}'")
sub_old = "for(const v of ['2.3.11.16','2.3.11.14',"
if s.count(sub_old) != 1: sys.exit(f"{tr}: not-served list not found")
write(tr, s.replace(sub_old, f"for(const v of ['{PREV}','2.3.11.16','2.3.11.14',"))
print("bumped to", NEW, "- next: build-plugin-release.py, release-231119.py --sha, commit, then replace PIN with the release SHA")
