#!/usr/bin/env python3
"""Prepare plugin v2.3.11.5 (folds the never-published v2.3.11.4 into it).

* bumps 2.3.11.4 -> 2.3.11.5 in the plugin trees (version handshakes, labels, installers, guides)
* replaces the v2.3.11.4 entries in RELEASE-NOTES.txt / VALIDATION.txt with a v2.3.11.5 entry
* updates "current version" mentions on the website (not the release history / redirects)
* adds the v2.3.11.5 entry to the EN/ID release-notes pages
Run once; it refuses to run twice.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OLD, NEW = "2.3.11.4", "2.3.11.5"
DATE = "2026-10-15"

PLUGIN_FILES = [
    "Plugin/BUILD-ID.txt", "Plugin/CSXS/manifest.xml", "Plugin/account-auth.js", "Plugin/commercial-config.json",
    "Plugin/customer-experience.js", "Plugin/index.html", "Plugin/jsx/host.jsx", "Plugin/license.js", "Plugin/panel.js",
    "Plugin/resource-guard.js", "Plugin/update-manager.js", "TEST-GUIDE.txt",
]
PLATFORM_FILES = {"windows": ["Install-Windows.ps1", "README-Windows.txt"], "macos": ["Install-macOS.command", "README-macOS.txt", "MAC-INSTALL-GUIDE.txt"]}

NOTES = f"""v{NEW} PUBLIC — Camera Role Contrast, reliability and payment fixes
- Camera Roles now steer the cut: the panel reads each role's shot size (wide / medium wide,
  medium, close / deck / detail) and direction (behind, left, right, front, top, crowd, side).
  Two angles of the same kind never follow each other (for example wide after wide). When no
  other covered camera exists, the shot continues instead of cutting to the same kind of angle.
- 4-beat cuts are kept at 25/30 fps (frame-rounded 4-beat shots are no longer merged).
- Music analysis of long sets is much faster with identical results; the music map is stored on
  disk only (no more browser-storage quota errors on long sets).
- Sequence In/Out is respected when applying an AI plan (before, Apply failed with
  "Edit point outside sequence In/Out").
- A backup copy of the sequence is made before an AI plan is applied.
- Windows: Continue after Stop works again (it reported "Camera media changed").
- Clips you disabled stay disabled; Keep Clips can be re-planned; manual-marker Begin works;
  many markers no longer disable the panel; unsupported frame rates are reported before any edit.
- Random Zoom is relative to each clip's own Scale and skips still images.
- No more stuck buttons after a slow Premiere response; longer limits for long sequences.
- macOS: no false "low memory" pauses; updates wait only for Premiere (not Photoshop/After Effects).
- Account: works offline for up to 72 hours after the last online check; two open panels no
  longer sign each other out; clear update and Google sign-in messages; promo codes at checkout.
- Installer: download timeouts, rollback of incomplete installs, clearer macOS privacy message.
- Supports Premiere Pro 2022 (v22) and newer.
- Delivered through Check Update. Save and close Premiere before installing.

"""
VALIDATION = f"""v{NEW} PUBLIC validation — {DATE}
- Camera Role Contrast: synthetic 4-camera plans contain no wide-to-wide cuts; exact-drop cameras unchanged.
- 4-beat guard: 128 BPM at 30 fps keeps 4-beat cadence; music analysis output identical, enrich much faster.
- Mock Premiere host tests: In/Out apply, Windows resume, manual-marker Begin, user-disabled clips, Keep Clips re-plan,
  sequence-scoped resume, relative Random Zoom, license change mid-job, A1 messages (fail on v2.3.11.4, pass now).
- Panel vm tests: pending flag cleared on timeout, merged Resume, disk-only music cache, async preset scan, macOS memory guard.
- Account vm tests: offline grace 72 h, clock rollback, server denial, refresh-token sharing, bind-before-save, update labels.
- Installer/update: helper wait loops simulated (Premiere only, timeout, superseded attempt, bad checksum); PowerShell parse
  and bash -n checks; FFmpeg checksum pinning unchanged.
- Not verified natively: Premiere Pro panel load on Windows/macOS hardware.

"""

def sub_file(path: pathlib.Path, pairs):
    s = path.read_text(encoding="utf-8")
    for old, new in pairs:
        s = s.replace(old, new)
    path.write_text(s, encoding="utf-8")

def drop_entry(text: str, header_prefix: str) -> str:
    # remove the block that starts with header_prefix up to (not including) the next 'v2.' header line
    m = re.search(r"^" + re.escape(header_prefix) + r".*?(?=^v2\.)", text, flags=re.M | re.S)
    return text[:m.start()] + text[m.end():] if m else text

manifest = (ROOT / "plugin/windows/Plugin/CSXS/manifest.xml").read_text()
if f'ExtensionBundleVersion="{NEW}"' in manifest:
    sys.exit("already at " + NEW)

for plat in ("windows", "macos"):
    base = ROOT / "plugin" / plat
    for rel in PLUGIN_FILES + PLATFORM_FILES[plat]:
        f = base / rel
        s = f.read_text(encoding="utf-8")
        if OLD not in s:
            sys.exit(f"{f}: no {OLD}")
        f.write_text(s.replace(OLD, NEW), encoding="utf-8")
    rn = base / "RELEASE-NOTES.txt"
    rn.write_text(NOTES + drop_entry(rn.read_text(encoding="utf-8"), f"v{OLD} PUBLIC"), encoding="utf-8")
    va = base / "VALIDATION.txt"
    va.write_text(VALIDATION + drop_entry(va.read_text(encoding="utf-8"), f"v{OLD} PUBLIC validation"), encoding="utf-8")

# Website: current-version mentions (release history and redirects keep their versions).
for f in (ROOT / "site").rglob("*"):
    if not f.is_file() or f.suffix not in (".html", ".js") or "releases" in f.parts or "downloads" in f.parts:
        continue
    s = f.read_text(encoding="utf-8")
    t = s.replace("v2.3.11.3", "v" + NEW).replace("v2.3.11.4", "v" + NEW).replace("2.3.11.3; macOS 2.3.11.3", f"{NEW}; macOS {NEW}").replace("Windows 2.3.11.3", "Windows " + NEW)
    if t != s:
        f.write_text(t, encoding="utf-8")
print("bumped to", NEW)
