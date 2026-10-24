// Package tests: the ZIP is deterministic, contains exactly the user files (no tests/legacy/dev files), extracts
// with Windows' own Expand-Archive, and its files are byte-identical to the sources. Usage: node tests/pack-tests.cjs
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process'), crypto = require('crypto'), assert = require('assert');
const pack = require('../pack-davinci.cjs');

let checks = 0;
const ok = (c, msg) => { checks++; assert(c, msg); };
const ROOT = path.join(__dirname, '..');

const a = pack.main(), b = pack.main();
ok(a.sha === b.sha && a.size === b.size, 'two builds give the same SHA-256 (deterministic): ' + a.sha);
ok(fs.readFileSync(a.out + '.sha256', 'utf8') === a.sha + '  ' + pack.NAME + '.zip\n', '.sha256 file next to the zip');
ok(a.files.every((f) => !/^(tests|legacy|dist|node_modules)\//.test(f) && !/\.(cjs|py)$/.test(f)), 'no tests/, legacy/, dist/, node_modules or dev scripts');
for (const need of ['Install-DaVinci.bat', 'Install-DaVinci.ps1', 'Uninstall-DaVinci.ps1', 'R Project Multicam AI.lua', 'README-DaVinci.md', 'lib/account.js', 'lib/google-auth.js', 'engine/ai-director.js', 'rp-davinci-engine.js'])
  ok(a.files.includes(need), 'package contains ' + need);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-pack-'));
const r = cp.spawnSync('powershell', ['-NoProfile', '-Command', "Expand-Archive -LiteralPath '" + a.out + "' -DestinationPath '" + tmp + "'"], { encoding: 'utf8' });
ok(r.status === 0, 'Expand-Archive extracts the zip: ' + r.stderr);
const top = path.join(tmp, pack.NAME);
// M7: the packaged engine library has no command-line entry (the paid analysis only runs behind the license check)
const cliPkg = path.join(top, 'rp-engine-cli.js');
ok(!/require\.main|process\.argv/.test(fs.readFileSync(cliPkg, 'utf8')), 'packaged rp-engine-cli.js has no CLI entry');
const run = cp.spawnSync(process.execPath, [cliPkg, 'analyze', 'in.json', 'out.json'], { encoding: 'utf8', cwd: top });
ok(run.status === 0 && !run.stdout && !fs.existsSync(path.join(top, 'out.json')), 'running it with CLI arguments does nothing');
ok(a.files.includes('Install-LuaScript.ps1') && !a.files.some((f) => /engine-cli\.cjs/.test(f)), 'elevated helper packaged; dev CLI runner not packaged');
for (const f of a.files) ok(crypto.createHash('sha256').update(fs.readFileSync(path.join(top, f))).digest('hex') === crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'), 'extracted ' + f + ' equals the source');
fs.rmSync(tmp, { recursive: true, force: true });
console.log('PASS package: ' + pack.NAME + '.zip · ' + a.size + ' bytes · ' + a.files.length + ' files · SHA256 ' + a.sha + ' (deterministic, Expand-Archive OK, files identical)');
console.log('ALL PASS (' + checks + ' checks)');
