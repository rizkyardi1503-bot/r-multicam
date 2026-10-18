#!/usr/bin/env python3
"""Prepare plugin v2.3.11.7.

* bumps 2.3.11.6 -> 2.3.11.7 in the plugin trees (version handshakes, labels, installers, guides)
* prepends a v2.3.11.7 entry to RELEASE-NOTES.txt / VALIDATION.txt (v2.3.11.6 was published: its entry stays)
* adds the v2.3.11.7 entry to the release pages (EN/ID) and updates "current version" mentions on the website
* redirects the v2.3.11.6 ZIP links and removes those ZIPs (build-plugin-release.py writes the new ones)
* points the update/download functions at v2.3.11.7. Their raw.githubusercontent pin is PIN (40 zeros) until the
  release commit exists: replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-23117.py (CI keeps calling test-public-23115.py, a shim) and updates test-release-23112.cjs
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-23117.py            (bump, notes, site, functions, tests)
       release-23117.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW = "2.3.11.6", "2.3.11.7"
DATE = "2026-10-18"
OLD_PIN, PIN = "776a5d26e9b47c0de5e03b2f48b7b20bf3b6ea43", "0" * 40

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Drone & FPV sync, exact Cut Pace and reliability
New in this release:
- Sync Cameras to Music (formerly Sync to Master Music; beta, lifetime license only): drone and FPV clips (no audio) are placed from their camera clock, bridged
  through a camera that synced by audio, on their own [CLOCK] track. Correct one clip with "Use selected
  clip" (or the nudge buttons) and every clip of that drone follows; the correction is remembered per drone
  and shoot date, so the next project of the same shoot needs no fix. Gyroflow FPV exports are remembered by
  their bin name. Build refuses when the open sequence or its A1 changed since Find camera sources.
- Simpler panel: five numbered steps in working order (Analyze Music, Sync Cameras to Music, Auto Cut
  Multicam, Best Drops, Random Zoom). Music detection runs with built-in settings, and the optional online
  AI music review was removed (analysis is always local).
- Cut Pace 2/4/6/8 now counts real beats: cuts land every selected number of beats, also when the beat
  detector misses or doubles beats, and stay on the beat when a second song starts on A1.
- No more "4-beat minimum" blocking Apply near drops; 2 Beat no longer holds one camera for a whole section.
- When a camera's footage ends inside a shot, the edit switches to the camera that continues, on a beat
  both cameras share.
- Music engine: tempo no longer locks at half speed (Best Drop windows have the promised length); drop
  spacing presets work; the optional online music review stays off until you enable it.
- Continue Multicam works after a stop that had already emptied a camera track; Stop before cutting no
  longer leaves a saved job behind; a sync left running by a closed panel is stopped; workflow presets set
  the right Cut Pace.
- Updates and installers: Windows auto-update works with non-English letters in the user name; the macOS
  installer waits for Premiere to quit; a pending update is shown after restarting Premiere; Windows
  backup and rollback work across drives; downloads are https only.
- Online lifetime checkout is closed for now, so Buy Lifetime is hidden. Trials and existing licenses are
  not affected.
- Optional update: v2.3.11.2 and newer keep working. Delivered through Check Update. Save and close
  Premiere before installing.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Drone/FPV clock sync: real footage (argy: Mavic 4 + Gyroflow FPV via a Blackmagic reference) placed at the
  editor's corrected positions with 0 frames error after one remembered correction per shoot; mock-Premiere
  drone moves (overlap refusal, deleted clips skipped, rollback without Array.indexOf).
- Cut Pace: all 15 selections of 2/4/6/8 through the real pacing engine, director and Apply guard on real
  music maps (normal cameras, camera hand-overs, Mark In/Out); steady beat grid re-locks after phase jumps
  and between two songs on A1; synthetic 10/60/180-minute drop benchmark unchanged (all drops, 0 false).
- Tempo tracker: half-tempo windows on a 38-minute DJ set 210 -> 111 with identical benchmark drops.
- Host/panel regressions: resume after an emptied camera, cancelled apply checkpoint, orphan sync, presets,
  music options, delete/zoom/sync/guard/lifetime suites on Windows and macOS copies.
- Installers: Windows install and half-move rollback in a scratch profile; non-ASCII profile path update
  helper (PowerShell 5.1); macOS installer wait loop with mocked processes (bash -n).
- Not verified natively: macOS Premiere panel, macOS installer and Keychain on Apple hardware.

"""

EN_ENTRY = (
    f'<h2 id="v23117-public-windows-macos-drone-fpv-sync">v{NEW} · PUBLIC · Windows &amp; macOS · Drone &amp; FPV sync, exact Cut Pace</h2>'
    '<p>New in <strong>Sync Cameras to Music</strong> (formerly Sync to Master Music; beta, lifetime license only): drone and FPV clips without audio are placed from their camera clock, bridged through a camera that synced by audio, on their own [CLOCK] track. Correct one clip with Use selected clip and every clip of that drone follows; the correction is remembered per drone and shoot date, and Gyroflow FPV exports are remembered by their bin name. Cut Pace 2, 4, 6 and 8 now counts real beats, so cuts land exactly every chosen number of beats and stay on the beat when a second song starts. Apply is no longer blocked near drops, 2 Beat no longer holds one camera for a whole section, and when a camera&#39;s footage ends inside a shot the edit switches to the camera that continues on a shared beat.</p>'
    '<p>The panel is now five numbered steps in working order: Analyze Music, Sync Cameras to Music, Auto Cut Multicam, Best Drops and Random Zoom. Music detection runs with built-in settings, and the optional online AI music review was removed, so analysis is always local. Also fixed: the tempo no longer locks at half speed, so Best Drop windows have the promised length; Continue Multicam works after a stop that emptied a camera track; Windows auto-update works with non-English letters in the user name; the macOS installer waits for Premiere to quit; and a pending update is shown after restarting Premiere. Online lifetime checkout is closed for now, so Buy Lifetime is hidden; trials and existing licenses are not affected. The update is optional (v2.3.11.2 and newer keep working): use Check Update in the panel or the website download, save and close Premiere before installing, and test on a duplicate project first.</p>'
)
ID_ENTRY = (
    f'<h2 id="v23117-public-windows-macos-drone-fpv-sync">v{NEW} · PUBLIC · Windows &amp; macOS · Sync drone &amp; FPV, Cut Pace yang tepat</h2>'
    '<p>Baru di <strong>Sync Cameras to Music</strong> (sebelumnya Sync to Master Music; beta, khusus lisensi lifetime): klip drone dan FPV tanpa audio ditaruh dari jam kameranya, dijembatani lewat kamera yang sinkron dari audio, di track [CLOCK] sendiri. Perbaiki satu klip dengan Use selected clip dan semua klip drone itu ikut; koreksinya diingat per drone dan tanggal shooting, dan ekspor FPV Gyroflow diingat lewat nama bin-nya. Cut Pace 2, 4, 6 dan 8 sekarang menghitung beat yang sebenarnya, jadi cut jatuh tepat setiap jumlah beat yang dipilih dan tetap di beat saat lagu kedua dimulai. Apply tidak lagi terblokir di dekat drop, 2 Beat tidak lagi menahan satu kamera sepanjang satu bagian, dan saat footage sebuah kamera habis di tengah shot, edit pindah ke kamera yang berlanjut di beat yang sama.</p>'
    '<p>Panel sekarang berupa lima langkah bernomor sesuai urutan kerja: Analyze Music, Sync Cameras to Music, Auto Cut Multicam, Best Drops dan Random Zoom. Deteksi musik memakai pengaturan bawaan, dan review musik AI online dihapus, jadi analisis selalu lokal. Juga diperbaiki: tempo tidak lagi terkunci di setengah kecepatan, jadi jendela Best Drop sesuai panjang yang dijanjikan; Continue Multicam berjalan setelah stop yang sudah mengosongkan track kamera; auto-update Windows berjalan dengan huruf non-Inggris di nama user; installer macOS menunggu Premiere tertutup; dan update yang tertunda ditampilkan setelah Premiere dibuka lagi. Checkout lifetime online ditutup untuk sementara, jadi tombol Buy Lifetime disembunyikan; trial dan lisensi yang sudah ada tidak terpengaruh. Update ini opsional (v2.3.11.2 ke atas tetap berfungsi): gunakan Check Update di panel atau unduh dari website, simpan dan tutup Premiere sebelum instalasi, dan uji dulu di project duplikat.</p>'
)
EN_DESC_OLD = "v2.3.11.6 adds Sync to Master Music (beta), faster multicam cleanup, Camera Role Contrast and safe apply/continue for Windows and macOS."
EN_DESC_NEW = "v2.3.11.7 adds drone and FPV sync by camera clock, exact 2/4/6/8-beat Cut Pace and many reliability fixes for Windows and macOS."
ID_DESC_OLD = "v2.3.11.6 menambah Sync to Master Music (beta), pembersihan multicam lebih cepat, Camera Role Contrast, serta apply/lanjutkan yang aman untuk Windows dan macOS."
ID_DESC_NEW = "v2.3.11.7 menambah sync drone dan FPV dari jam kamera, Cut Pace 2/4/6/8 beat yang tepat, dan banyak perbaikan keandalan untuk Windows dan macOS."
MANIFEST_NOTES_NEW = ("v2.3.11.7 PUBLIC Windows and macOS: drone and FPV clips sync by camera clock in Sync Cameras to Music (beta, lifetime) "
                      "with remembered corrections; Cut Pace 2/4/6/8 counts real beats; no blocked Apply near drops; camera switch "
                      "where footage ends; tempo no longer locks at half speed; update and installer fixes. Optional update: "
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
    for name, text in (("RELEASE-NOTES.txt", NOTES), ("VALIDATION.txt", VALIDATION)):
        f = base / name; s = read(f)
        nl = "\r\n" if "\r\n" in s else "\n"
        write(f, text.replace("\n", nl) + s)

# Release pages: the new entry goes above v2.3.11.6 (TOC is rebuilt by build-site.py).
for rel, entry, d_old, d_new in (("site/releases/index.html", EN_ENTRY, EN_DESC_OLD, EN_DESC_NEW),
                                 ("site/id/releases/index.html", ID_ENTRY, ID_DESC_OLD, ID_DESC_NEW)):
    f = ROOT / rel; s = read(f)
    at = s.find('<h2 id="v23116-')
    if at < 0: sys.exit(f"{f}: v2.3.11.6 entry not found")
    s = s[:at] + entry + s[at:]
    if s.count(d_old) < 3: sys.exit(f"{f}: description not found")
    s = s.replace(d_old, d_new).replace(f"Multicam AI v{OLD}", f"Multicam AI v{NEW}")
    write(f, s)

# Website: current-version mentions (release history, downloads and redirects are handled separately).
for f in (ROOT / "site").rglob("*"):
    if not f.is_file() or f.suffix not in (".html", ".js") or "downloads" in f.parts or "releases" in f.parts:
        continue
    s = read(f); t = s.replace(OLD, NEW)
    if t != s: write(f, t)

# The v2.3.11.6 ZIPs leave the site; old links go to the download page.
red = ROOT / "site/_redirects"; s = read(red)
lines = s.split("\n")
add = [f"/downloads/R-Project-Multicam-AI-{lab}-v{OLD}-PUBLIC.zip /?download={lab.lower()} 302" for lab in ("Windows", "macOS")]
write(red, "\n".join(add + lines))
for lab in ("Windows", "macOS"):
    (ROOT / f"site/downloads/R-Project-Multicam-AI-{lab}-v{OLD}-PUBLIC.zip").unlink()

# Update and download functions: only the current release is served.
fn = ROOT / "supabase/functions"
man = fn / "plugin-update-manifest/index.ts"; s = read(man)
m = re.search(r'release_notes: "([^"]*)"', s)
if not m: sys.exit(f"{man}: release_notes not found")
s = s.replace(m.group(0), f'release_notes: "{MANIFEST_NOTES_NEW}"')
if s.count(f'"{OLD}"') != 2 or s.count(f"version={OLD}") != 2: sys.exit(f"{man}: unexpected {OLD} references")
write(man, s.replace(f'"{OLD}"', f'"{NEW}"').replace(f"version={OLD}", f"version={NEW}"))
dl = fn / "plugin-update-download/index.ts"; s = read(dl)
s = s.replace(f'"{OLD}"', f'"{NEW}"').replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC").replace(OLD_PIN, PIN)
write(dl, s)
wd = fn / "website-download/index.ts"; s = read(wd)
write(wd, s.replace(f"-v{OLD}-PUBLIC", f"-v{NEW}-PUBLIC").replace(OLD_PIN, PIN))

# Tests follow the release.
old_test, new_test = ROOT / "scripts/test-public-23116.py", ROOT / "scripts/test-public-23117.py"
new_test.write_bytes(read(old_test).replace(OLD, NEW).encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-23116.py", "test-public-23117.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))
tr = ROOT / "scripts/test-release-23112.cjs"; s = read(tr)
s = s.replace("'2.3.11.5','2.3.11.6','bad'", "'2.3.11.5','2.3.11.6','2.3.11.7','bad'")
s = s.replace("for(const v of ['2.3.11.5','2.3.11.4',", "for(const v of ['2.3.11.6','2.3.11.5','2.3.11.4',")
s = s.replace(OLD_PIN, PIN).replace(f"assert.equal(d.version,'{OLD}')", f"assert.equal(d.version,'{NEW}')")
s = s.replace(f"v{OLD}-PUBLIC", f"v{NEW}-PUBLIC").replace(f"version={OLD}", f"version={NEW}").replace(f"PASS {OLD}", f"PASS {NEW}")
s = s.replace(f"windows:'{OLD}',macos:'{OLD}'", f"windows:'{NEW}',macos:'{NEW}'")
# Left over: only the old-version lists (client versions asking for an update, versions no longer served).
if re.sub(r"\[[^\]]*\]", "", s).count(OLD): sys.exit(f"{tr}: unhandled {OLD} reference")
write(tr, s)
print("bumped to", NEW, "- next: build-plugin-release.py, then release-23117.py --sha; PIN is", PIN)
