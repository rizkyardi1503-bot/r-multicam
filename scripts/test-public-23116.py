#!/usr/bin/env python3
"""Validate the public 2.3.11.6 archives: integrity, versions, pinned FFmpeg, no internal tools,
and that the 2.3.11.6 engine and reliability fixes (camera role contrast, 4-beat guard, tempo-map cache) are shipped."""
import hashlib, io, json, pathlib, re, zipfile
root = pathlib.Path(__file__).resolve().parent.parent
dl = root / 'site' / 'downloads'
FF_WIN = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba'
FF_MAC = {'arm64': 'c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924',
          'amd64': '7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4'}
ENGINE = ['Plugin/audio-core.js', 'Plugin/audio-engine.js', 'Plugin/ai-director.js', 'Plugin/music-intelligence-v10.js',
          'Plugin/music-learning.js', 'Plugin/spectral-features.js', 'Plugin/online-music-ai.js',
          'Plugin/plugin-google-auth.js', 'Plugin/compact-ui.js', 'Plugin/compact-ui.css', 'Plugin/CSInterface.js']
for os_ in ('Windows', 'macOS'):
    new = zipfile.ZipFile(dl / f'R-Project-Multicam-AI-{os_}-v2.3.11.6-PUBLIC.zip')
    assert new.testzip() is None
    names = new.namelist()
    assert not any(n.startswith('Training-Tools/') for n in names), 'internal tools shipped'
    sums = new.read(f'SHA256SUMS-{os_}.txt').decode()
    assert sums == new.read('SHA256SUMS.txt').decode()
    listed = {}
    for line in sums.splitlines():
        h, rel = re.match(r'([0-9a-f]{64})  (.+)$', line).groups()
        assert hashlib.sha256(new.read(rel)).hexdigest() == h, rel
        listed[rel] = h
    assert set(listed) == {n for n in names if not n.startswith('SHA256SUMS')}, 'inventory incomplete'
    manifest = new.read('Plugin/CSXS/manifest.xml').decode('utf-8-sig')
    assert 'ExtensionBundleVersion="2.3.11.6"' in manifest and 'Version="2.3.11.6"' in manifest
    assert "version:'2.3.11.6'" in new.read('Plugin/jsx/host.jsx').decode('utf-8-sig')
    assert "r.version==='2.3.11.6'" in new.read('Plugin/panel.js').decode('utf-8-sig')
    assert "var CURRENT='2.3.11.6'" in new.read('Plugin/update-manager.js').decode('utf-8-sig')
    cfg = json.loads(new.read('Plugin/commercial-config.json'))
    assert cfg['version'] == '2.3.11.6' and cfg['purchase_mode'] == 'midtrans-checkout' and cfg['lifetime_price_idr'] == 3575000
    assert 'PayPal' not in json.dumps(cfg)
    if os_ == 'Windows':
        inst = new.read('Install-Windows.ps1').decode('utf-8-sig')
        assert "$version = '2.3.11.6'" in inst and FF_WIN in inst
        assert 'ffmpeg-release-essentials.zip' not in inst, 'unpinned FFmpeg URL'
        assert inst.count('ffmpeg-9.0.2-essentials_build.zip') >= 2 and '(Get-SafeSha256 $zip) -eq $ffmpegSha256' in inst
    else:
        inst = new.read('Install-macOS.command').decode()
        assert 'VERSION="2.3.11.6"' in inst and all(h in inst for h in FF_MAC.values())
        assert 'redirect/latest' not in inst, 'unpinned FFmpeg URL'
        assert '[ "$FFACTUAL" = "$FFSHA" ] || fail' in inst
        info = new.getinfo('Install-macOS.command')
        assert (info.external_attr >> 16) & 0o111, 'installer not executable'
    assert 'Plugin/dropfinder-auto.js' not in names and 'Plugin/music-pacing-auto.js' in names
    for n in names:
        if n.endswith(('.js', '.html', '.jsx', '.txt', '.json')):
            assert not re.search(r'drop[ -]?finder', new.read(n).decode('utf-8-sig'), re.I), f'competitor name left in {n}'
    for rel in ENGINE + ['Plugin/music-pacing-auto.js']:
        assert rel in names, f'missing engine file {rel}'
    director = new.read('Plugin/ai-director.js').decode('utf-8-sig')
    assert 'function enforceRoleContrast' in director and 'contrastPool(antiRepeatPool(' in director, 'role contrast missing'
    assert 'var SHOT_BEAT_TOLERANCE=.25;' in director and 'r.beats>=4-SHOT_BEAT_TOLERANCE' in director, '4-beat guard tolerance missing'
    assert 'r.beats<4-1e-6' not in director, '4-beat validate/block must use the same tolerance as the merge'
    assert 'TEMPO_MAP_CACHE' in new.read('Plugin/music-pacing-auto.js').decode('utf-8-sig'), 'tempo map cache missing'
    host = new.read('Plugin/jsx/host.jsx').decode('utf-8-sig')
    assert 'var rp_stepRanges=null;' in host, 'step range declaration missing'
    assert 'No music cuts fall inside the sequence In/Out' in host, 'In/Out clipping missing'
    assert 'if(clip.disabled&&j.winners[first]<0)continue;' in host, 'user-disabled clip guard missing'
    assert 'function rp_razorFormat(frame)' in host and 'live.clone()' in host, 'fps check / backup missing'
    assert 'Version="[22.0,99.9]"' in manifest, 'host range still capped'
    auth = new.read('Plugin/account-auth.js').decode('utf-8-sig')
    assert "'2.3.11.6-public-v18'" in auth, 'account version handshake'
print('PASS public 2.3.11.6 archives: CRC/SHA inventories, version handshakes, pinned+verified FFmpeg 9.0.2, '
      'no internal tools, no competitor names, accurate config, role contrast + 4-beat guard + tempo cache shipped')
