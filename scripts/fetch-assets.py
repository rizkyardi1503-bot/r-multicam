from pathlib import Path
import hashlib,json,subprocess
root=Path(__file__).resolve().parent.parent
for asset in json.loads((root/'scripts/assets.json').read_text()):
    target=root/'site'/asset['path']
    target.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(['curl','--fail','--silent','--show-error','--location','--retry','2',asset['url'],'--output',str(target)],check=True)
    if hashlib.sha256(target.read_bytes()).hexdigest()!=asset['sha256']:
        raise SystemExit('Asset checksum mismatch: '+asset['path'])
print('Verified all website media assets')
