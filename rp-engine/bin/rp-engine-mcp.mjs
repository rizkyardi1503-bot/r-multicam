#!/usr/bin/env node
// R Project Multicam AI — MCP server (stdio, JSON-RPC 2.0, newline-delimited).
// Zero dependencies: runs with plain Node 18+ so it can ship next to the plugin.
// stdout carries protocol messages only; all logging goes to stderr.
import readline from "node:readline";
import { TOOLS } from "../lib/tools.mjs";
import { killChildren } from "../lib/media.mjs";

const SERVER = { name: "r-project-multicam-engine", version: "1.0.0" };
const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const error = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

// Running tool calls by request id (for notifications/cancelled) and every message still being handled
// (so closing stdin does not drop results that are not sent yet).
const running = new Map();
const active = new Set();

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
  const controller = new AbortController();
  running.set(id, controller);
  try {
    const result = await tool.run(params.arguments || {}, progress, { signal: controller.signal });
    if (!controller.signal.aborted) reply(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result });
  } catch (e) {
    // A cancelled request gets no response (MCP: the client has already forgotten it).
    if (!controller.signal.aborted) reply(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
  } finally {
    running.delete(id);
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
    case "notifications/cancelled": return running.get(params?.requestId)?.abort();
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
    const job = Promise.resolve(handle(m)).catch((e) => m.id != null && error(m.id, -32603, String(e?.message || e)));
    active.add(job);
    job.finally(() => active.delete(job));
  }
});
// stdin closed: finish the calls in flight (their results are still written to stdout), then stop.
rl.on("close", async () => {
  await Promise.allSettled([...active]);
  killChildren();
  process.exitCode = 0;
  setTimeout(() => process.exit(0), 5000).unref();
});
// Asked to stop: cancel running calls and kill their FFmpeg children instead of leaving them behind.
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { for (const c of running.values()) c.abort(); killChildren(); process.exit(0); });
process.on("exit", killChildren);
console.error(`${SERVER.name} ${SERVER.version} ready (stdio)`);
