#!/usr/bin/env python3
"""Prepare plugin v2.3.11.8 (online checkout back in the panel).

* bumps 2.3.11.7 -> 2.3.11.8 in the plugin trees (version handshakes, labels, installers, guides)
* prepends a v2.3.11.8 entry to RELEASE-NOTES.txt / VALIDATION.txt (v2.3.11.7 was published: its entry stays)
* adds the v2.3.11.8 entry to the release pages (EN/ID) and updates "current version" mentions on the website
* redirects the v2.3.11.7 ZIP links and removes those ZIPs (build-plugin-release.py writes the new ones)
* points the update/download functions at v2.3.11.8. Their raw.githubusercontent pin is PIN (40 zeros) until the
  release commit exists: replace it with that commit's SHA, then run with --sha to write the ZIP checksums.
* adds test-public-23118.py (CI keeps calling test-public-23115.py, a shim) and updates test-release-23112.cjs
Files are read and written as bytes with their own line endings. Run once; it refuses to run twice.
Usage: release-23118.py            (bump, notes, site, functions, tests)
       release-23118.py --sha      (after build-plugin-release.py: write the new ZIP checksums into the manifest)
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW = "2.3.11.7", "2.3.11.8"
DATE = "2026-10-18"
OLD_PIN, PIN = "25750823107ccca578d25c3e5391d0e31747414b", "0" * 40

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Buy Lifetime in the panel
New in this release:
- Online lifetime checkout is open again: Buy Lifetime and Check Payment are back in the panel (account bar and
  the Sync Cameras to Music card) for signed-in accounts without a lifetime license. Buy asks before it opens
  the Midtrans checkout in your browser; Check Payment activates the license when the payment is received.
- A trial that has ended says "Buy Lifetime to continue" again.
- Everything else is unchanged from v2.3.11.7.
- Optional update: v2.3.11.2 and newer keep working. Delivered through Check Update. Save and close
  Premiere before installing.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Panel checkout (real panel.js, sync-ui.js and license.js in a fake DOM, mocked account service) on Windows
  and macOS copies: Buy/Check Payment hidden for lifetime accounts and shown for trials; a declined confirm
  opens nothing; a confirmed Buy opens the Midtrans URL once; the Sync card Buy uses the same checkout; a paid
  check hides Buy. Fails when CHECKOUT_OPEN is false (mutation check).
- Live payment functions (no transaction): unauthenticated and forged-token calls refused, webhook rejects a
  forged signature. New checkout orders send X-Override-Notification with the webhook URL (check the first
  real order in the Midtrans notification history).
- All v2.3.11.7 host/panel/pacing/sync/drone/license suites rerun on Windows and macOS copies.
- Not verified natively: macOS Premiere panel, macOS installer and Keychain on Apple hardware; a real paid
  Midtrans transaction.

"""

EN_ENTRY = (
    f'<h2 id="v23118-public-windows-macos-buy-lifetime">v{NEW} · PUBLIC · Windows &amp; macOS · Buy Lifetime in the panel</h2>'
    '<p>Online lifetime checkout is open again. Buy Lifetime and Check Payment are back in the panel for signed-in accounts without a lifetime license, in the account bar and on the Sync Cameras to Music card. Buy shows the IDR amount and asks before it opens the Midtrans checkout in your browser; after paying, Check Payment activates the license (it also activates on its own when Midtrans confirms the payment). Everything else is unchanged from v2.3.11.7. The update is optional (v2.3.11.2 and newer keep working): use Check Update in the panel or the website download, and save and close Premiere before installing.</p>'
)
ID_ENTRY = (
    f'<h2 id="v23118-public-windows-macos-buy-lifetime">v{NEW} · PUBLIC · Windows &amp; macOS · Buy Lifetime di panel</h2>'
    '<p>Checkout lifetime online dibuka lagi. Tombol Buy Lifetime dan Check Payment kembali ada di panel untuk akun yang sudah login dan belum punya lisensi lifetime, di bar akun dan di kartu Sync Cameras to Music. Buy menampilkan jumlah dalam IDR dan meminta konfirmasi sebelum membuka checkout Midtrans di browser; setelah membayar, Check Payment mengaktifkan lisensi (lisensi juga aktif sendiri saat Midtrans mengonfirmasi pembayaran). Selebihnya sama dengan v2.3.11.7. Update ini opsional (v2.3.11.2 ke atas tetap berfungsi): gunakan Check Update di panel atau unduh dari website, lalu simpan dan tutup Premiere sebelum instalasi.</p>'
)
EN_DESC_OLD = "v2.3.11.7 adds drone and FPV sync by camera clock, exact 2/4/6/8-beat Cut Pace and many reliability fixes for Windows and macOS."
EN_DESC_NEW = "v2.3.11.8 brings Buy Lifetime back to the panel; v2.3.11.7 added drone and FPV sync by camera clock and exact 2/4/6/8-beat Cut Pace for Windows and macOS."
ID_DESC_OLD = "v2.3.11.7 menambah sync drone dan FPV dari jam kamera, Cut Pace 2/4/6/8 beat yang tepat, dan banyak perbaikan keandalan untuk Windows dan macOS."
ID_DESC_NEW = "v2.3.11.8 mengembalikan Buy Lifetime ke panel; v2.3.11.7 menambah sync drone dan FPV dari jam kamera dan Cut Pace 2/4/6/8 beat yang tepat untuk Windows dan macOS."
MANIFEST_NOTES_NEW = ("v2.3.11.8 PUBLIC Windows and macOS: Buy Lifetime and Check Payment are back in the panel (online checkout "
                      "through Midtrans is open again). Includes everything from v2.3.11.7. Optional update: "
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

# Release pages: the new entry goes above v2.3.11.7 (TOC is rebuilt by build-site.py).
for rel, entry, d_old, d_new in (("site/releases/index.html", EN_ENTRY, EN_DESC_OLD, EN_DESC_NEW),
                                 ("site/id/releases/index.html", ID_ENTRY, ID_DESC_OLD, ID_DESC_NEW)):
    f = ROOT / rel; s = read(f)
    at = s.find('<h2 id="v23117-')
    if at < 0: sys.exit(f"{f}: v2.3.11.7 entry not found")
    s = s[:at] + entry + s[at:]
    if s.count(d_old) < 1: sys.exit(f"{f}: description not found")
    s = s.replace(d_old, d_new).replace(f"Multicam AI v{OLD}", f"Multicam AI v{NEW}")
    write(f, s)

# Website: current-version mentions (release history, downloads and redirects are handled separately).
for f in (ROOT / "site").rglob("*"):
    if not f.is_file() or f.suffix not in (".html", ".js") or "downloads" in f.parts or "releases" in f.parts or "sync-multicam-to-music" in f.parts:
        continue
    s = read(f); t = s.replace(OLD, NEW)
    if t != s: write(f, t)

# The v2.3.11.7 ZIPs leave the site; old links go to the download page.
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
old_test, new_test = ROOT / "scripts/test-public-23117.py", ROOT / "scripts/test-public-23118.py"
new_test.write_bytes(read(old_test).replace(OLD, NEW).encode("utf-8"))
sub(ROOT / "scripts/test-public-23115.py", "test-public-23117.py", "test-public-23118.py", count=2)
tc = ROOT / "scripts/test-conversion.cjs"; write(tc, read(tc).replace(OLD, NEW))
tr = ROOT / "scripts/test-release-23112.cjs"; s = read(tr)
s = s.replace("'2.3.11.6','2.3.11.7','bad'", "'2.3.11.6','2.3.11.7','2.3.11.8','bad'")
s = s.replace("for(const v of ['2.3.11.6','2.3.11.5',", "for(const v of ['2.3.11.7','2.3.11.6','2.3.11.5',")
s = s.replace(OLD_PIN, PIN).replace(f"assert.equal(d.version,'{OLD}')", f"assert.equal(d.version,'{NEW}')")
s = s.replace(f"v{OLD}-PUBLIC", f"v{NEW}-PUBLIC").replace(f"version={OLD}", f"version={NEW}").replace(f"PASS {OLD}", f"PASS {NEW}")
s = s.replace(f"windows:'{OLD}',macos:'{OLD}'", f"windows:'{NEW}',macos:'{NEW}'")
# Left over: only the old-version lists (client versions asking for an update, versions no longer served).
if re.sub(r"\[[^\]]*\]", "", s).count(OLD): sys.exit(f"{tr}: unhandled {OLD} reference")
write(tr, s)
print("bumped to", NEW, "- next: build-plugin-release.py, then release-23118.py --sha; PIN is", PIN)
