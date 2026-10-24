// Builds the user package dist/R-Project-Multicam-AI-DaVinci-Windows-v1.0.0.zip (+ .sha256), deterministically:
// fixed file list, sorted entries, fixed timestamps, deflate level 9, LF/CRLF untouched. No npm dependencies.
// Usage: node pack-davinci.cjs            (runs build-davinci.cjs first so engine/ matches the Premiere build)
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto'), cp = require('child_process');

const VERSION = '1.0.0';
const NAME = 'R-Project-Multicam-AI-DaVinci-Windows-v' + VERSION;
const HERE = __dirname, DIST = path.join(HERE, 'dist');
const DOS_TIME = 0, DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 24;     // 2026-10-24 00:00:00 for every entry

// Everything a user gets. Nothing from tests/, legacy/, dist/ or dev files.
function fileList() {
  const top = ['Install-DaVinci.bat', 'Install-DaVinci.ps1', 'Install-LuaScript.ps1', 'Uninstall-DaVinci.bat', 'Uninstall-DaVinci.ps1', 'R Project Multicam AI.lua',
    'rp-davinci-engine.js', 'rp-engine-cli.js', 'README-DaVinci.md', 'THIRD-PARTY-NOTICES.txt'];
  const sub = (d) => fs.readdirSync(path.join(HERE, d)).filter((f) => /\.(js|json)$/.test(f)).sort().map((f) => d + '/' + f);
  return top.concat(sub('lib'), sub('engine')).sort();
}

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8'), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp); centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(locals.concat([cd, end]));
}

function main() {
  // Engine files must be byte-identical to the Premiere build.
  cp.execFileSync(process.execPath, [path.join(HERE, 'build-davinci.cjs')], { stdio: 'ignore' });
  const src = path.join(HERE, '..', 'windows', 'Plugin');
  for (const f of fs.readdirSync(path.join(HERE, 'engine')).filter((x) => x.endsWith('.js')))
    if (!fs.readFileSync(path.join(HERE, 'engine', f)).equals(fs.readFileSync(path.join(src, f)))) throw Error('engine/' + f + ' differs from the Premiere build');
  const files = fileList();
  for (const f of files) if (!fs.existsSync(path.join(HERE, f))) throw Error('Missing package file: ' + f);
  if (files.some((f) => /^(tests|legacy|dist|node_modules)\//.test(f))) throw Error('dev files in the package');
  const entries = files.map((f) => ({ name: NAME + '/' + f, data: fs.readFileSync(path.join(HERE, f)) }));
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, NAME + '.zip'), buf = zip(entries);
  fs.writeFileSync(out, buf);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  fs.writeFileSync(out + '.sha256', sha + '  ' + NAME + '.zip\n');
  console.log(out + '\n' + buf.length + ' bytes · ' + files.length + ' files · SHA256 ' + sha);
  return { out, sha, size: buf.length, files };
}

if (require.main === module) main();
module.exports = { main, fileList, zip, crc32, NAME };
