#!/usr/bin/env python3
"""Build the public plugin ZIPs from plugin/windows and plugin/macos.

For each platform:
  * reads the version from Plugin/CSXS/manifest.xml and checks the installer,
    host.jsx and panel.js handshakes agree with it,
  * writes SHA256SUMS.txt and SHA256SUMS-<Platform>.txt (all files except the sums),
  * writes a deterministic ZIP to site/downloads/R-Project-Multicam-AI-<Platform>-v<version>-PUBLIC.zip
    (fixed timestamps, Unix permissions, .command files executable),
  * prints the ZIP size and SHA-256 (needed for the update manifest / website download function).

`--check` rebuilds in memory and fails if the committed ZIPs or checksum files differ.
"""
import hashlib
import io
import pathlib
import re
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PLATFORMS = {'windows': 'Windows', 'macos': 'macOS'}
SKIP_DIRS = {'Training-Tools'}
FIXED_TIME = (1980, 1, 1, 0, 0, 0)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def package_version(src: pathlib.Path) -> str:
    manifest = (src / 'Plugin' / 'CSXS' / 'manifest.xml').read_text(encoding='utf-8-sig')
    version = re.search(r'ExtensionBundleVersion="([0-9.]+)"', manifest).group(1)
    checks = {
        'Plugin/jsx/host.jsx': f"version:'{version}'",
        'Plugin/panel.js': f"r.version==='{version}'",
        'Plugin/update-manager.js': f"var CURRENT='{version}'",
    }
    for rel, needle in checks.items():
        if needle not in (src / rel).read_text(encoding='utf-8-sig'):
            sys.exit(f'{src.name}: {rel} does not contain {needle!r}')
    installer = (src / ('Install-Windows.ps1' if src.name == 'windows' else 'Install-macOS.command')).read_text(encoding='utf-8-sig')
    if version not in installer:
        sys.exit(f'{src.name}: installer version does not match {version}')
    return version


def files_of(src: pathlib.Path):
    out = []
    for f in sorted(src.rglob('*')):
        if not f.is_file():
            continue
        rel = f.relative_to(src).as_posix()
        if rel.split('/')[0] in SKIP_DIRS or rel.startswith('SHA256SUMS'):
            continue
        out.append((rel, f.read_bytes()))
    return out


def build_platform(key: str):
    src = ROOT / 'plugin' / key
    label = PLATFORMS[key]
    version = package_version(src)
    files = files_of(src)
    sums = ''.join(f'{sha256(data)}  {rel}\n' for rel, data in files)
    sum_files = {'SHA256SUMS.txt': sums, f'SHA256SUMS-{label}.txt': sums}
    entries = files + [(name, text.encode()) for name, text in sum_files.items()]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for rel, data in sorted(entries):
            info = zipfile.ZipInfo(rel, FIXED_TIME)
            info.create_system = 3
            mode = 0o755 if rel.endswith(('.command', '.sh')) else 0o644
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)
    name = f'R-Project-Multicam-AI-{label}-v{version}-PUBLIC.zip'
    return version, name, buf.getvalue(), {src / n: t for n, t in sum_files.items()}


def main(check: bool):
    stale = []
    for key in PLATFORMS:
        version, name, data, sum_files = build_platform(key)
        target = ROOT / 'site' / 'downloads' / name
        outputs = {target: data, **{p: t.encode() for p, t in sum_files.items()}}
        for path, content in outputs.items():
            current = path.read_bytes() if path.exists() else None
            if current != content:
                stale.append(path.relative_to(ROOT).as_posix())
                if not check:
                    path.write_bytes(content)
        print(f'{PLATFORMS[key]:8} v{version}  {name}  {len(data)} bytes  sha256 {sha256(data)}')
    if check and stale:
        print('Plugin release output is out of date:\n  ' + '\n  '.join(stale))
        sys.exit(1)


if __name__ == '__main__':
    main('--check' in sys.argv)
