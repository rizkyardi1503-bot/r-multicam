// Builds the user package releases/finalcut/R-Project-Multicam-AI-FinalCut-macOS-v1.0.0.zip, deterministically:
// fixed file list, sorted entries, fixed timestamps, deflate level 9, Unix permissions stored (the .command files are
// executable after macOS Archive Utility extracts them). Adds SHA256SUMS-FinalCut.txt, which the installer verifies.
// Usage: node pack-finalcut.cjs           build-finalcut.cjs first (shared files from the Mac engine, rp-engine and
//                                          DaVinci account code), then write the ZIP
//        node pack-finalcut.cjs --check   exit 1 when the shared copies or the committed ZIP are out of date (CI)
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');
const { build } = require('./build-finalcut.cjs');

const VERSION = '1.0.0';
const NAME = 'R-Project-Multicam-AI-FinalCut-macOS-v' + VERSION;
const HERE = __dirname, RELEASES = path.join(HERE, '..', '..', 'releases', 'finalcut');
const OUT = path.join(RELEASES, NAME + '.zip');
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 20;     // 2026-11-20 00:00:00 for every entry
const SUMS = 'SHA256SUMS-FinalCut.txt';

// Everything a user gets. Nothing from tests/, dist/ or dev files.
function fileList() {
  const top = ['Install-FinalCut.command', 'Uninstall-FinalCut.command', 'README-FinalCut.md', 'THIRD-PARTY-NOTICES.txt',
    'rp-finalcut-engine.js', 'rp-finalcut-job.mjs', 'MANIFEST.json'];
  const sub = (d) => fs.readdirSync(path.join(HERE, d)).filter((f) => /\.(js|mjs)$/.test(f)).sort().map((f) => d + '/' + f);
  return top.concat(sub('engine'), sub('lib'), sub('rp-engine/lib')).sort();
}
const modeOf = (f) => (/\.command$/.test(f) ? 0o100755 : 0o100644);

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, mode } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4);            // made by Unix: external attrs hold the mode
    central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(((mode >>> 0) << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp); centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

/** The ZIP bytes for the current sources (nothing written). */
function makeZip() {
  const files = fileList();
  for (const f of files) if (!fs.existsSync(path.join(HERE, f))) throw Error('Missing package file: ' + f);
  if (files.some((f) => /^(tests|dist|node_modules)\//.test(f) || /\.cjs$/.test(f))) throw Error('dev files in the package');
  const data = new Map(files.map((f) => [f, fs.readFileSync(path.join(HERE, f))]));
  for (const f of files) if (/\.command$/.test(f) && data.get(f).includes('\r')) throw Error(f + ' has CRLF line endings (bash cannot run it)');
  const sums = files.map((f) => crypto.createHash('sha256').update(data.get(f)).digest('hex') + '  ' + f).join('\n') + '\n';
  data.set(SUMS, Buffer.from(sums));
  const all = files.concat(SUMS).sort();
  const buf = zip(all.map((f) => ({ name: NAME + '/' + f, data: data.get(f), mode: modeOf(f) })));
  return { buf, files: all, sha: crypto.createHash('sha256').update(buf).digest('hex') };
}

function main() {
  const check = process.argv.includes('--check');
  const stale = build({ check, quiet: check });
  if (check && stale.length) throw Error('Final Cut shared files are out of date (' + stale.join(', ') + '). Run: node plugin/finalcut/pack-finalcut.cjs');
  const { buf, files, sha } = makeZip();
  if (check) {
    let cur = null;
    try { cur = fs.readFileSync(OUT); } catch (e) { /* missing */ }
    if (!cur || !cur.equals(buf)) throw Error(path.relative(process.cwd(), OUT) + ' is out of date. Run: node plugin/finalcut/pack-finalcut.cjs');
    console.log('Final Cut package is up to date: ' + NAME + '.zip · SHA256 ' + sha);
    return { out: OUT, sha, size: buf.length, files };
  }
  fs.mkdirSync(RELEASES, { recursive: true });
  for (const f of fs.readdirSync(RELEASES)) if (/^R-Project-Multicam-AI-FinalCut-macOS-v.*\.zip$/.test(f) && f !== NAME + '.zip') fs.rmSync(path.join(RELEASES, f));
  fs.writeFileSync(OUT, buf);
  console.log(OUT + '\n' + buf.length + ' bytes · ' + files.length + ' files · SHA256 ' + sha);
  return { out: OUT, sha, size: buf.length, files };
}

if (require.main === module) { try { main(); } catch (e) { console.error(e.message); process.exit(1); } }
module.exports = { main, makeZip, fileList, zip, crc32, NAME, OUT, SUMS };
