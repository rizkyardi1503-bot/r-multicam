#!/usr/bin/env node
// R Project Multicam AI — MCP server (stdio, JSON-RPC 2.0, newline-delimited).
// Zero dependencies: runs with plain Node 18+ so it can ship next to the plugin.
// stdout carries protocol messages only; all logging goes to stderr.
import readline from "node:readline";
import { TOOLS } from "../lib/tools.mjs";

const SERVER = { name: "r-project-multicam-engine", version: "1.0.0" };
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

async function callTool(id, params) {
  const tool = TOOLS.find((t) => t.name === params?.name);
  if (!tool) return error(id, -32602, `Unknown tool: ${params?.name}`);
  const token = params?._meta?.progressToken;
  let last = 0;
  const progress = (p, message) => {
    if (token === undefined) return;
    const now = Date.now();
    if (now - last < 250 && p < 1) return;
    last = now;
    send({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: Math.round(Math.max(0, Math.min(1, Number(p) || 0)) * 100), total: 100, message: message ? String(message) : undefined } });
  };
  try {
    const result = await tool.run(params.arguments || {}, progress);
    reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
  } catch (e) {
    reply(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return reply(id, {
        protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions: "Local R Project Multicam AI engine. Use plan_multicam with a music file and camera files to get a rp-multicam-plan; export_fcpxml turns it into a Final Cut Pro project. Paths must be absolute paths on this computer."
      });
    }
    case "ping": return isRequest && reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": return callTool(id, params);
    default:
      if (isRequest) error(id, -32601, `Method not found: ${method}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return error(null, -32700, "Parse error"); }
  for (const m of Array.isArray(msg) ? msg : [msg]) {
    Promise.resolve(handle(m)).catch((e) => m.id != null && error(m.id, -32603, String(e?.message || e)));
  }
});
rl.on("close", () => process.exit(0));
console.error(`${SERVER.name} ${SERVER.version} ready (stdio)`);
