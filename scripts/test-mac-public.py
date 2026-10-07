from pathlib import Path
import hashlib, zipfile, json
root=Path(__file__).resolve().parent.parent
site=root/'site'
mac=site/'downloads/R-Project-Multicam-AI-macOS-v2.3.11.1-PUBLIC.zip'
assert hashlib.sha256(mac.read_bytes()).hexdigest()=='f945488da9be7d45e97e6744d1ca4cde87b64583895bac1d74c1d24bebe1eded'
windows=site/'downloads/R-Project-Multicam-AI-Windows-v2.3.11.0-PUBLIC.zip'
assert hashlib.sha256(windows.read_bytes()).hexdigest()=='317f3412b0c0db3f4df5adc87e1f9e7668194f39217f094e38fb068bc0a052a2'
with zipfile.ZipFile(mac) as archive:
    assert archive.testzip() is None
    assert archive.getinfo('Install-macOS.command').external_attr >> 16 == 0o100755
    for line in archive.read('SHA256SUMS-macOS.txt').decode().splitlines():
        digest, name = line.split('  ',1)
        assert hashlib.sha256(archive.read(name)).hexdigest()==digest, name
    for name in ['Plugin/CSXS/manifest.xml','Plugin/panel.js','Plugin/jsx/host.jsx','Plugin/update-manager.js','Install-macOS.command']:
        content=archive.read(name).decode()
        assert '2.3.11.1' in content and '2.3.11.0' not in content, name
    assert json.loads(archive.read('Plugin/commercial-config.json'))['version']=='2.3.11.1'
    assert 'Low Memory mode' in archive.read('Plugin/panel.js').decode()
    assert "run(profile.hardwareFrames)" in archive.read('Plugin/ai-director.js').decode()
    assert 'resourceProfile.batchDelay' in archive.read('Plugin/panel.js').decode()
    assert 'preflight' in archive.read('Plugin/audio-engine.js').decode()
    with zipfile.ZipFile(site/'downloads/R-Project-Multicam-AI-macOS-v2.3.11.0-PUBLIC.zip') as old:
        for file in ['audio-core.js','music-intelligence-v10.js','dropfinder-auto.js','plugin-google-auth.js','account-auth.js','license.js','jsx/host.jsx']:
            assert archive.read('Plugin/'+file).decode().replace('2.3.11.1','2.3.11.0')==old.read('Plugin/'+file).decode(),file
print('PASS macOS 2.3.11.1 ZIP/inventory/permissions/version/auth/music; Windows archive unchanged')
