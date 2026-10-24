// Developer runner for the engine commands (NOT part of the user package: the packaged engine has no CLI entry).
// Usage: node tests/engine-cli.cjs <analyze|plan|drops> <input.json> <output.json>
// stdout: one JSON object per line: {"type":"progress",...}, then {"type":"done",...} or {"type":"error",...} (exit 1).
'use strict';
const fs = require('fs'), path = require('path');
const { emit, cmdAnalyze, cmdPlan, cmdDrops, loadEngine } = require('../rp-engine-cli.js');

async function main() {
  const [cmd, inPath, outPath] = process.argv.slice(2);
  const commands = { analyze: cmdAnalyze, plan: cmdPlan, drops: cmdDrops };
  if (!commands[cmd] || !inPath || !outPath) throw Error('Usage: node rp-engine-cli.js <analyze|plan|drops> <input.json> <output.json>');
  const input = JSON.parse(fs.readFileSync(inPath, 'utf8').replace(/^﻿/, ''));
  const E = loadEngine();
  const started = Date.now();
  const out = await commands[cmd](E, input);
  out.elapsedMs = Date.now() - started;
  const tmp = outPath + '.tmp';
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, outPath);
  emit({ type: 'done', command: cmd, out: path.resolve(outPath), elapsedMs: out.elapsedMs });
}

main().catch((e) => { emit({ type: 'error', message: String(e && e.message || e) }); process.exitCode = 1; });
