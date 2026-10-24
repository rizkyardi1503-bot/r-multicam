#!/usr/bin/env python3
"""Prepare plugin v2.3.11.9 (music engine V19, visual quality, Rp prices in the panel, macOS FFmpeg fix).

* bumps 2.3.11.8 -> 2.3.11.9 and MUSIC ENGINE V18 -> V19 in the plugin trees (handshakes, labels, installers, guides)
* the panel's commercial-config price follows the website (Rp2.000.000)
* prepends a v2.3.11.9 entry to RELEASE-NOTES.txt / VALIDATION.txt (v2.3.11.8 was published: its entry stays)
* adds the v2.3.11.9 entry to the release pages (EN/ID) and updates "current version" mentions on the website
* redirects the v2.3.11.8 ZIP links and removes those ZIPs (build-plugin-release.py writes the new ones)
* points the update/download functions at v2.3.11.9; v2.3.11.8 stays downloadable for panels with a stale manifest
  (2.3.11.7 is dropped). The raw.githubusercontent pin of 2.3.11.9 is PIN (40 zeros) until the release commit
  exists: replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-23119.py (CI keeps calling test-public-23115.py, a shim) and updates the release tests
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-23119.py            (bump, notes, site, functions, tests)
       release-23119.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW = "2.3.11.8", "2.3.11.9"
DATE = "2026-10-25"
OLD_PIN, PIN = "249c11973e230e0a791a4d6bc351c9713629a5bc", "0" * 40
PREV_PIN = "25750823107ccca578d25c3e5391d0e31747414b"   # 2.3.11.7, no longer served

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Music engine V19
New in this release:
- Music engine V19: a new beat tracker follows one continuous beat chain through the whole song, so cuts stay
  on the beat on long DJ sets and tempo changes.
- Visual quality: the AI director scores each camera for brightness, sharpness and shake (keyframes only,
  cached) and avoids dark, blurry or shaky moments.
- Prices in the panel now match the website: Lifetime Rp2.000.000 one-time.
- The panel renews its sign-in shortly before it expires, so license checks no longer fail first and retry.
- Settings > FFmpeg: a saved FFmpeg that no longer runs is skipped and a working one is used.
- macOS installer: always installs the pinned, verified FFmpeg 9.0.2. An existing Homebrew FFmpeg is only used
  as a fallback, in place, and is no longer copied (a copy stopped working after "brew upgrade"). Apple Silicon
  is detected even when Terminal runs under Rosetta.
- Optional update: v2.3.11.2 and newer keep working. Delivered through Check Update. Save and close
  Premiere before installing.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Release tests on Windows: release/manifest/download chain, public archive inventory (test-public-23119.py),
  token refresh before plugin_entitlement/heartbeat on Windows and macOS copies (fails on v2.3.11.8 code),
  signed-entitlement grace harness, payment/checkout function tests, website tests.
- FFmpeg selection: a broken saved path falls back to the working tools FFmpeg (checked on Windows).
- macOS installer: bash -n syntax check and archive attributes (LF, executable bit) only.
- Not verified natively: macOS Premiere panel, macOS installer FFmpeg download and Keychain on Apple hardware
  (Apple Silicon and Intel); a real paid Midtrans transaction; V19 engine on a full live Premiere edit.

"""

EN_ENTRY = (
    f'<h2 id="v23119-public-windows-macos-engine-v19">v{NEW} · PUBLIC · Windows &amp; macOS · Music engine V19</h2>'
    '<p>A new beat tracker (music engine V19) follows one continuous beat chain through the whole song, so cuts stay on the beat on long DJ sets. The AI director now also checks each camera for brightness, sharpness and shake and avoids dark, blurry or shaky moments. Prices in the panel match the website (Lifetime Rp2.000.000 one-time), the panel renews its sign-in before it expires, and a broken FFmpeg path falls back to a working one. On macOS the installer always uses the verified FFmpeg build; a Homebrew FFmpeg is only a fallback and is no longer copied. The update is optional (v2.3.11.2 and newer keep working): use Check Update in the panel or the website download, and save and close Premiere before installing.</p>'
)
ID_ENTRY = (
    f'<h2 id="v23119-public-windows-macos-engine-v19">v{NEW} · PUBLIC · Windows &amp; macOS · Mesin musik V19</h2>'
    '<p>Pelacak beat baru (mesin musik V19) mengikuti satu rangkaian beat yang utuh di sepanjang lagu, jadi potongan tetap pas di beat pada DJ set yang panjang. AI director kini juga mengecek kecerahan, ketajaman dan goyangan tiap kamera, lalu menghindari momen yang gelap, blur atau goyang. Harga di panel kini sama dengan website (Lifetime Rp2.000.000 sekali bayar), panel memperbarui login sebelum kedaluwarsa, dan path FFmpeg yang rusak otomatis diganti yang berfungsi. Di macOS, installer selalu memakai FFmpeg terverifikasi; FFmpeg dari Homebrew hanya jadi cadangan dan tidak lagi disalin. Update ini opsional (v2.3.11.2 ke atas tetap berfungsi): gunakan Check Update di panel atau unduh dari website, lalu simpan dan tutup Premiere sebelum instalasi.</p>'
)
EN_DESC_OLD = "v2.3.11.8 brings Buy Lifetime back to the panel; v2.3.11.7 added drone and FPV sync by camera clock and exact 2/4/6/8-beat Cut Pace for Windows and macOS."
EN_DESC_NEW = "v2.3.11.9 adds music engine V19 and visual quality checks; v2.3.11.8 brought Buy Lifetime back to the panel, for Windows and macOS."
ID_DESC_OLD = "v2.3.11.8 mengembalikan Buy Lifetime ke panel; v2.3.11.7 menambah sync drone/FPV via jam kamera dan Cut Pace 2/4/6/8 beat."
ID_DESC_NEW = "v2.3.11.9 menambah mesin musik V19 dan cek kualitas visual; v2.3.11.8 mengembalikan Buy Lifetime ke panel."
MANIFEST_NOTES_NEW = ("v2.3.11.9 PUBLIC Windows and macOS: music engine V19 (one continuous beat chain), visual quality checks in the "
                      "AI director, Rp prices in the panel, sign-in renewed before it expires, macOS FFmpeg fix. Optional update: "
                      "v2.3.11.2 and newer keep working. Save and close Premiere before installing.")


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
    # Engine label and the account version handshake follow the V19 tracker.
    for f in base.rglob("*"):
        if f.is_file() and f.suffix in (".txt", ".html", ".js", ".ps1", ".command"):
            s = read(f); t = s.replace("MUSIC ENGINE V18", "MUSIC ENGINE V19").replace(f"'{NEW}-public-v18'", f"'{NEW}-public-v19'")
            if t != s: write(f, t)
    sub(base / "Plugin/commercial-config.json", '"lifetime_price_idr": 3575000', '"lifetime_price_idr": 2000000')
    for name, text in (("RELEASE-NOTES.txt", NOTES), ("VALIDATION.txt", VALIDATION)):
        f = base / name; s = read(f)
        nl = "\r\n" if "\r\n" in s else "\n"
        write(f, text.replace("\n", nl) + s)

# Release pages: the new entry goes above v2.3.11.8 (TOC is rebuilt by build-site.py).
for rel, entry, d_old, d_new in (("site/releases/index.html", EN_ENTRY, EN_DESC_OLD, EN_DESC_NEW),
                                 ("site/id/releases/index.html", ID_ENTRY, ID_DESC_OLD, ID_DESC_NEW)):
    f = ROOT / rel; s = read(f)
    at = s.find('<h2 id="v23118-')
    if at < 0: sys.exit(f"{f}: v2.3.11.8 entry not found")
    s = s[:at] + entry + s[at:]
    if s.count(d_old) < 1: sys.exit(f"{f}: description not found")
    s = s.replace(d_old, d_new).replace(f"Multicam AI v{OLD}", f"Multicam AI v{NEW}")
    write(f, s)

# Website: current-version mentions (release history, downloads, redirects and price notes are handled separately).
for f in (ROOT / "site").rglob("*"):
    if not f.is_file() or f.suffix not in (".html", ".js") or "downloads" in f.parts or "releases" in f.parts \
            or "sync-multicam-to-music" in f.parts or f.name == "pricing.js":
        continue
    s = read(f); t = s.replace(OLD, NEW)
    if t != s: write(f, t)

# The v2.3.11.8 ZIPs leave the site; old links go to the download page.
red = ROOT / "site/_redirects"; s = read(red)
add = [f"/downloads/R-Project-Multicam-AI-{lab}-v{OLD}-PUBLIC.zip /?download={lab.lower()} 302" for lab in ("Windows", "macOS")]
lines = [l for l in s.split("\n") if l not in add]
write(red, "\n".join(add + lines))
for lab in ("Windows", "macOS"):
    (ROOT / f"site/downloads/R-Project-Multicam-AI-{lab}-v{OLD}-PUBLIC.zip").unlink()

# Update and download functions.
fn = ROOT / "supabase/functions"
man = fn / "plugin-update-manifest/index.ts"; s = read(man)
m = re.search(r'release_notes: "([^"]*)"', s)
if not m: sys.exit(f"{man}: release_notes not found")
s = s.replace(m.group(0), f'release_notes: "{MANIFEST_NOTES_NEW}"')
if s.count(f'"{OLD}"') != 2 or s.count(f"version={OLD}") != 2: sys.exit(f"{man}: unexpected {OLD} references")
write(man, s.replace(f'"{OLD}"', f'"{NEW}"').replace(f"version={OLD}", f"version={NEW}"))

dl = fn / "plugin-update-download/index.ts"; s = read(dl)
s = s.replace(f'{{ windows: "{OLD}", macos: "{OLD}" }}', f'{{ windows: "{NEW}", macos: "{NEW}" }}')
m = re.search(r'  "2\.3\.11\.7": \{\n.*?\n  \},\n', s, re.S)
if not m: sys.exit(f"{dl}: 2.3.11.7 entry not found")
s = s.replace(m.group(0), "")
m = re.search(r'  "' + re.escape(OLD) + r'": \{\n.*?\n  \}\n', s, re.S)
if not m: sys.exit(f"{dl}: {OLD} entry not found")
prev = m.group(0)
cur = prev.replace(f'"{OLD}"', f'"{NEW}"').replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC").replace(OLD_PIN, PIN)
s = s.replace(prev, prev.rstrip("\n") + ",\n" + cur)
if PREV_PIN in s: sys.exit(f"{dl}: 2.3.11.7 pin still referenced")
write(dl, s)

wd = fn / "website-download/index.ts"; s = read(wd)
if s.count(f"-v{OLD}-PUBLIC") != 2: sys.exit(f"{wd}: unexpected {OLD} file names")
write(wd, s.replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC"))

# Tests follow the release.
old_test, new_test = ROOT / "scripts/test-public-23118.py", ROOT / "scripts/test-public-23119.py"
t = read(old_test).replace(OLD, NEW).replace(f"'{NEW}-public-v18'", f"'{NEW}-public-v19'").replace("lifetime_price_idr'] == 3575000", "lifetime_price_idr'] == 2000000")
new_test.write_bytes(t.encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-23118.py", "test-public-23119.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))
print("bumped to", NEW, "- next: update test-release-23112.cjs, build-plugin-release.py, then release-23119.py --sha; PIN is", PIN)
