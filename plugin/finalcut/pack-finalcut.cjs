// Builds releases/finalcut/R-Project-Multicam-AI-XML-v<version>.zip (+ .sha256) deterministically: fixed file
// list, sorted entries, fixed timestamps, Unix modes (the .command files stay executable after Archive Utility
// extracts them) and SHA256SUMS-FinalCut.txt for the installer's integrity check. No npm dependencies.
// Usage: node pack-finalcut.cjs [--check]   (--check rebuilds in memory and fails if the committed ZIP differs)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), cp = require('child_process');
const { crc32 } = require('../davinci/pack-davinci.cjs');
const zlib = require('zlib');

const VERSION = '1.2.0';
const NAME = 'R-Project-Multicam-AI-XML-v' + VERSION;          // Final Cut Pro + DaVinci Resolve, macOS + Windows
const HERE = __dirname, OUT_DIR = path.join(HERE, '..', '..', 'releases', 'finalcut');
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 20;     // 2026-11-20 00:00:00 for every entry
const EXEC = new Set(['Install-FinalCut.command', 'Uninstall-FinalCut.command']);

function walk(dir) {
  return fs.readdirSync(path.join(HERE, dir), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(dir + '/' + d.name) : [dir + '/' + d.name]);
}
/** Everything a user gets: installer, uninstaller, readme, notices and the app folder. Nothing from tests/. */
function fileList() {
  return ['Install-FinalCut.command', 'Uninstall-FinalCut.command', 'Install-Windows.bat', 'Install-Windows.ps1',
    'Uninstall-Windows.bat', 'Uninstall-Windows.ps1', 'README-FinalCut.md', 'THIRD-PARTY-NOTICES.txt', ...walk('app')].sort();
}

function zipUnix(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, mode } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp); centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

function build() {
  // app/ must carry byte-identical copies of the Premiere engine, rp-engine and the account modules.
  cp.execFileSync(process.execPath, [path.join(HERE, 'build-finalcut.cjs'), '--check'], { stdio: 'inherit' });
  const files = fileList();
  if (files.some((f) => /^(tests|dist|node_modules)\//.test(f))) throw Error('dev files in the package');
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const sums = files.filter((f) => !EXEC.has(f)).map((f) => sha(fs.readFileSync(path.join(HERE, f))) + '  ' + f).join('\n') + '\n';
  const entries = files.map((f) => ({ name: NAME + '/' + f, data: fs.readFileSync(path.join(HERE, f)), mode: EXEC.has(f) ? 0o755 : 0o644 }))
    .concat([{ name: NAME + '/SHA256SUMS-FinalCut.txt', data: Buffer.from(sums), mode: 0o644 }])
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const buf = zipUnix(entries);
  return { buf, sha: sha(buf), files: entries.length };
}

function main() {
  const { buf, sha, files } = build(), out = path.join(OUT_DIR, NAME + '.zip');
  if (process.argv.includes('--check')) {
    let cur = null;
    try { cur = fs.readFileSync(out); } catch (e) { /* missing */ }
    if (!cur || !cur.equals(buf)) { console.error(path.relative(process.cwd(), out) + ' is out of date. Run: node plugin/finalcut/pack-finalcut.cjs'); process.exit(1); }
    console.log('Final Cut package is up to date · SHA256 ' + sha);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, buf);
  fs.writeFileSync(out + '.sha256', sha + '  ' + NAME + '.zip\n');
  console.log(out + '\n' + buf.length + ' bytes · ' + files + ' files · SHA256 ' + sha);
}

if (require.main === module) main();
module.exports = { build, fileList, NAME, VERSION };
