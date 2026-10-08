from pathlib import Path
import hashlib,zipfile,json
root=Path(__file__).resolve().parent.parent
hashes={'Windows':'4de23a845ef06be4bcf7295c38c6fdb85fac48339d12532110c62e819253f553','macOS':'b50d796071cb91683afa902aa30e30e0578f1e983a27afe4cee3b4c291831c55'}
for os,digest in hashes.items():
    p=root/'site/downloads'/f'R-Project-Multicam-AI-{os}-v2.3.11.2-PUBLIC.zip'
    assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
    with zipfile.ZipFile(p) as a:
        assert a.testzip() is None
        for line in a.read(f'SHA256SUMS-{os}.txt').decode().splitlines():
            h,n=line.split('  ',1);assert hashlib.sha256(a.read(n)).hexdigest()==h,n
        for n in ['Plugin/panel.js','Plugin/jsx/host.jsx','Plugin/update-manager.js','Plugin/CSXS/manifest.xml']:
            s=a.read(n).decode();assert '2.3.11.2' in s and '2.3.11.1' not in s and '2.3.11.0' not in s,n
        assert json.loads(a.read('Plugin/commercial-config.json'))['version']=='2.3.11.2'
        assert 'validateMinimumPhysicalTransitions' in a.read('Plugin/ai-director.js').decode()
        assert 'validateMinimumPhysicalTransitions(aiPlan.choices' in a.read('Plugin/panel.js').decode()
        if os=='macOS':
            assert a.getinfo('Install-macOS.command').external_attr>>16==0o100755
            assert 'visionBudget:low?24:240' in a.read('Plugin/resource-guard.js').decode()
            assert 'resourceProfile.batchDelay' in a.read('Plugin/panel.js').decode()
print('PASS both public 2.3.11.2 archives, CRC/SHA inventories/version alignment/4-beat Apply guard/Mac memory controls')
