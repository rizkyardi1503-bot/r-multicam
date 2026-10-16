#!/usr/bin/env python3
"""Prepare plugin v2.3.11.6 (folds the never-published v2.3.11.5 into it).

* bumps 2.3.11.5 -> 2.3.11.6 in the plugin trees (version handshakes, labels, installers, guides)
* marks Sync to Master Music as Beta in the panel
* replaces the v2.3.11.5 entries in RELEASE-NOTES.txt / VALIDATION.txt with a v2.3.11.6 entry
* updates "current version" mentions on the website and replaces the v2.3.11.5 release-page entry (EN/ID)
* adds test-public-23116.py (CI keeps calling test-public-23115.py, now a shim)
Files are read and written as bytes with LF line endings. Run once; it refuses to run twice.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW = "2.3.11.5", "2.3.11.6"
DATE = "2026-10-16"

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Sync to Master Music (beta), faster cleanup, Camera Role Contrast and reliability
New in this release:
- Sync to Master Music (beta, lifetime license): places every camera clip, including very short ones,
  at its position on the master music on A1, using each clip's own audio and the camera clock. It
  builds a NEW synced sequence; the current sequence is not changed. Clips it is unsure about go to a
  muted Review track; medium-confidence clips are marked [CHECK] for a quick look.
- Music engine: faster beat-drop detection; cuts land on the kick/bass entry; M4A/MP4 masters no longer
  cut about 2 frames late.
- Removing unused camera pieces is much faster on long sets (pieces are unlinked in batches).
- The backup copy of the sequence before Apply is now optional (checkbox under the main buttons; on by
  default). Turn it off on very long sets to save memory.
- Cleaner panel: Sync to Master Music and Podcast AI Director on the main screen, Continue Multicam
  shows when a job can be resumed, and the activity log moved to Help.
- Random Zoom keeps its v2.3.11.3 behaviour.
Also included (first public with this release):
- Camera Roles now steer the cut: the panel reads each role's shot size (wide / medium wide,
  medium, close / deck / detail) and direction (behind, left, right, front, top, crowd, side).
  Two angles of the same kind never follow each other (for example wide after wide). When no
  other covered camera exists, the shot continues instead of cutting to the same kind of angle.
- 4-beat cuts are kept at 25/30 fps (frame-rounded 4-beat shots are no longer merged).
- Music analysis of long sets is much faster with identical results; the music map is stored on
  disk only (no more browser-storage quota errors on long sets).
- Sequence In/Out is respected when applying an AI plan (before, Apply failed with
  "Edit point outside sequence In/Out").
- Stop works reliably; Windows: Continue after Stop works again (it reported "Camera media changed").
- Clips you disabled stay disabled; muted camera tracks are never touched; Keep Clips can be re-planned
  in the same Premiere session; manual-marker Begin works; many markers no longer disable the panel;
  unsupported frame rates are reported before any edit.
- No more stuck buttons after a slow Premiere response; longer limits for long sequences.
- macOS: no false "low memory" pauses; updates wait only for Premiere (not Photoshop/After Effects).
- Account: works offline for up to 72 hours after the last online check; two open panels no
  longer sign each other out; clear update and Google sign-in messages; promo codes at checkout.
- Installer: download timeouts, rollback of incomplete installs, clearer macOS privacy message.
- Supports Premiere Pro 2022 (v22) and newer.
- Optional update: v2.3.11.2 and newer keep working. Delivered through Check Update. Save and close
  Premiere before installing.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Sync to Master Music: synthetic DJ-set benchmark (clips 0.4-240 s, good/none/bad camera clocks) with no
  high-confidence misplacement; clips under 1 s go to Review instead of stopping the analysis; real-FFmpeg
  end-to-end test (MP4/AAC, MOV) placed within 1 frame; mock-Premiere build tests (new sequence, A1 untouched,
  camera audio muted, Review lanes, Stop, sequence switch, other jobs blocked while syncing); real panel.js
  integration (15 checks).
- Music engine: beat-drop benchmark and format test (WAV/M4A/MP4) identical drops, AAC seek within 1 ms.
- Cleanup: mock full delete/angle jobs (winners kept, losers removed, camera audio intact, selection restored,
  failure paths: isolation, mid-batch remove, nodeId renumbering); optional backup copy honoured.
- Panel layout: rendered panel checked in Chromium at 300 px; no element ids lost; id-reference guard clean.
- Random Zoom: identical keyframes to v2.3.11.3 in mock Premiere (numeric/Time keys, pre-animated, moved clips).
- Earlier v2.3.11.5 checks (camera role contrast, 4-beat guard, host/panel/account vm tests, installer) re-run.
- Not verified natively: Premiere Pro panel load on macOS hardware.

"""

EN_ENTRY = (
    f'<h2 id="v23116-public-windows-macos-sync-to-master-music">v{NEW} · PUBLIC · Windows &amp; macOS · Sync to Master Music (beta) &amp; faster cleanup</h2>'
    '<p>New: <strong>Sync to Master Music</strong> (beta, lifetime license) places every camera clip, including very short ones, at its position on the master music on A1, using each clip&#39;s own audio and the camera clock. It builds a new synced sequence and leaves your current sequence unchanged. Clips it is unsure about go to a muted Review track, and medium-confidence clips are marked [CHECK] for a quick look. The music engine finds beat drops faster and cuts on the kick or bass entry, and M4A/MP4 masters no longer cut about two frames late. Removing unused camera pieces is much faster on long sets, the backup copy before Apply is now an option (on by default), and the panel is tidier: Sync to Master Music and Podcast AI Director are on the main screen and the activity log moved to Help. Random Zoom keeps its v2.3.11.3 behaviour.</p>'
    '<p>Also first public with this release: the panel reads the Camera Roles you type (shot size and direction) so two angles of the same kind never follow each other, four-beat cuts are kept at 25 and 30 fps, long DJ sets analyze much faster, a sequence In/Out range is respected when applying an AI plan, Stop and Continue work reliably, clips you disabled and muted camera tracks are never touched, and slow Premiere responses no longer leave buttons stuck. On Mac there are no more false low-memory pauses. The account keeps working offline for up to 72 hours, two open panels no longer sign each other out, and Premiere Pro 2022 (v22) and newer is supported. The update is optional (v2.3.11.2 and newer keep working): use Check Update in the panel or the website download, save and close Premiere before installing, and test on a duplicate project first.</p>'
)
ID_ENTRY = (
    f'<h2 id="v23116-public-windows-macos-sync-to-master-music">v{NEW} · PUBLIC · Windows &amp; macOS · Sync to Master Music (beta) &amp; pembersihan lebih cepat</h2>'
    '<p>Baru: <strong>Sync to Master Music</strong> (beta, lisensi lifetime) menaruh setiap klip kamera, termasuk yang sangat pendek, di posisinya pada musik master di A1, berdasarkan audio klip itu sendiri dan jam kamera. Hasilnya sequence baru yang sudah sinkron; sequence yang sedang kamu pakai tidak diubah. Klip yang belum pasti masuk ke track Review yang di-mute, dan klip dengan keyakinan sedang diberi tanda [CHECK] supaya cepat dicek. Music engine menemukan beat drop lebih cepat dan memotong tepat saat kick atau bass masuk, dan master M4A/MP4 tidak lagi terpotong sekitar dua frame terlambat. Menghapus potongan kamera yang tidak terpakai jauh lebih cepat di set panjang, salinan cadangan sebelum Apply sekarang bisa dimatikan (aktif secara default), dan panel lebih rapi: Sync to Master Music dan Podcast AI Director ada di menu utama, log aktivitas pindah ke Help. Random Zoom tetap seperti v2.3.11.3.</p>'
    '<p>Juga pertama kali publik di release ini: panel membaca Camera Roles yang kamu ketik (ukuran shot dan arah) sehingga dua angle sejenis tidak berurutan, cut empat beat terjaga di 25 dan 30 fps, DJ set panjang dianalisis jauh lebih cepat, rentang In/Out sequence dihormati saat menerapkan plan AI, Stop dan Continue berjalan andal, klip yang kamu nonaktifkan dan track kamera yang di-mute tidak disentuh, dan respons Premiere yang lambat tidak lagi membuat tombol macet. Di Mac tidak ada lagi jeda palsu karena memori. Akun tetap bisa dipakai offline sampai 72 jam, dua panel yang terbuka tidak lagi saling logout, dan Premiere Pro 2022 (v22) ke atas didukung. Update ini opsional (v2.3.11.2 ke atas tetap berfungsi): gunakan Check Update di panel atau unduh dari website, simpan dan tutup Premiere sebelum instalasi, dan uji dulu di project duplikat.</p>'
)

def read(p): return p.read_bytes().decode("utf-8")
def write(p, s):
    assert "\r\n" not in s or p.suffix in (".ps1", ".txt", ".command") and "\r\n" in read(p), p
    p.write_bytes(s.encode("utf-8"))

def drop_entry(text, header_prefix):
    m = re.search(r"^" + re.escape(header_prefix) + r".*?(?=^v2\.)", text, flags=re.M | re.S)
    if not m: sys.exit("entry not found: " + header_prefix)
    return text[:m.start()] + text[m.end():]

if f'ExtensionBundleVersion="{NEW}"' in read(ROOT / "plugin/windows/Plugin/CSXS/manifest.xml"):
    sys.exit("already at " + NEW)

for plat in ("windows", "macos"):
    base = ROOT / "plugin" / plat
    for rel in PLUGIN_FILES + PLATFORM_FILES[plat]:
        f = base / rel
        s = read(f)
        if OLD not in s: sys.exit(f"{f}: no {OLD}")
        write(f, s.replace(OLD, NEW))
    idx = base / "Plugin/index.html"
    s = read(idx); old_title = '00 / Sync to Master Music <span id="syncBadge"'
    assert s.count(old_title) == 1
    write(idx, s.replace(old_title, '00 / Sync to Master Music · Beta <span id="syncBadge"'))
    rn = base / "RELEASE-NOTES.txt"; s = read(rn)
    nl = "\r\n" if "\r\n" in s else "\n"
    write(rn, NOTES.replace("\n", nl) + drop_entry(s, f"v{OLD} PUBLIC"))
    va = base / "VALIDATION.txt"; s = read(va)
    nl = "\r\n" if "\r\n" in s else "\n"
    write(va, VALIDATION.replace("\n", nl) + drop_entry(s, f"v{OLD} PUBLIC validation"))

# Release pages: the never-published v2.3.11.5 entry becomes the v2.3.11.6 entry (TOC is rebuilt by build-site.py).
for rel, entry in (("site/releases/index.html", EN_ENTRY), ("site/id/releases/index.html", ID_ENTRY)):
    f = ROOT / rel; s = read(f)
    m = re.search(r'<h2 id="v23115-[^"]*">.*?(?=<h2 id="v23113-)', s, flags=re.S)
    if not m: sys.exit(f"{f}: v2.3.11.5 entry not found")
    s = s[:m.start()] + entry + s[m.end():]
    s = s.replace(f"Multicam AI v{OLD}", f"Multicam AI v{NEW}")
    write(f, s)

# Website: current-version mentions (release history above, downloads and redirects are handled separately).
for f in (ROOT / "site").rglob("*"):
    if not f.is_file() or f.suffix not in (".html", ".js") or "downloads" in f.parts:
        continue
    if "releases" in f.parts:
        continue
    s = read(f)
    t = s.replace(OLD, NEW)
    if t != s: write(f, t)

# Tests: the public-archive test follows the release.
old_test, new_test = ROOT / "scripts/test-public-23115.py", ROOT / "scripts/test-public-23116.py"
new_test.write_bytes(read(old_test).replace(OLD, NEW).encode("utf-8"))
# The workflow file stays unchanged: test-public-23115.py becomes a shim that runs test-public-23116.py.
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))
print("bumped to", NEW)
