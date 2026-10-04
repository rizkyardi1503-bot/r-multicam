import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  BridgeCommand,
  BridgeStatus,
  CommandResult,
  JsonValue,
  PluginRegistration
} from "./contracts.js";

type PendingCommand = {
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-rproject-token",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end(payload);
}

function empty(res: ServerResponse, status = 204): void {
  res.writeHead(status, {
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-rproject-token",
    "access-control-allow-methods": "GET,POST,OPTIONS"
  });
  res.end();
}

async function readJson(req: IncomingMessage, maxBytes = 1_000_000): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > maxBytes) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(part);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

export class PremiereBridge {
  readonly host: string;
  readonly port: number;
  readonly token: string;
  readonly timeoutMs: number;

  private registration: PluginRegistration | null = null;
  private state: JsonValue | null = null;
  private lastSeen = 0;
  private stateUpdated = 0;
  private queue: BridgeCommand[] = [];
  private pending = new Map<string, PendingCommand>();
  private server = createServer((req, res) => void this.handle(req, res));

  constructor() {
    this.host = process.env.RPROJECT_MCP_HOST || "127.0.0.1";
    this.port = Number(process.env.RPROJECT_MCP_PORT || "47821");
    this.timeoutMs = Number(process.env.RPROJECT_MCP_COMMAND_TIMEOUT_MS || "45000");
    this.token = process.env.RPROJECT_MCP_TOKEN || randomBytes(24).toString("hex");

    if (this.host !== "127.0.0.1" && this.host !== "localhost") {
      throw new Error("R Project MCP bridge must bind to localhost only.");
    }
    if (!Number.isInteger(this.port) || this.port < 1024 || this.port > 65535) {
      throw new Error("Invalid RPROJECT_MCP_PORT.");
    }
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.port, this.host, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Bridge stopped."));
    }
    this.pending.clear();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  getStatus(): BridgeStatus {
    const recent = this.lastSeen > 0 && Date.now() - this.lastSeen < 10_000;
    return {
      connected: recent,
      lastSeenAt: this.lastSeen ? new Date(this.lastSeen).toISOString() : null,
      stateUpdatedAt: this.stateUpdated ? new Date(this.stateUpdated).toISOString() : null,
      registration: this.registration,
      queuedCommands: this.queue.length,
      pendingCommands: this.pending.size
    };
  }

  getState(): JsonValue | null {
    return this.state;
  }

  invoke(name: string, args: Record<string, JsonValue>, timeoutMs = this.timeoutMs): Promise<JsonValue> {
    if (!this.getStatus().connected) {
      return Promise.reject(new Error("Premiere plugin is not connected to the local MCP bridge."));
    }
    if (this.queue.length >= 50) {
      return Promise.reject(new Error("Command queue is full."));
    }

    const command: BridgeCommand = {
      id: randomUUID(),
      name,
      args,
      createdAt: new Date().toISOString()
    };
    this.queue.push(command);

    return new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(command.id);
        reject(new Error(`Premiere command timed out: ${name}`));
      }, timeoutMs);
      this.pending.set(command.id, { resolve, reject, timer });
    });
  }

  private authorized(req: IncomingMessage): boolean {
    const candidate = String(req.headers["x-rproject-token"] || "");
    return Boolean(candidate) && safeEqual(candidate, this.token);
  }

  private touch(): void {
    this.lastSeen = Date.now();
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method === "OPTIONS") return empty(res);

      const url = new URL(req.url || "/", `http://${this.host}:${this.port}`);
      if (url.pathname === "/health" && req.method === "GET") {
        return json(res, 200, { ok: true, service: "r-project-premiere-mcp" });
      }

      if (!this.authorized(req)) return json(res, 401, { error: "UNAUTHORIZED" });
      this.touch();

      if (url.pathname === "/v1/register" && req.method === "POST") {
        const body = (await readJson(req)) as PluginRegistration;
        if (!body?.pluginName || !body?.pluginVersion) {
          return json(res, 400, { error: "INVALID_REGISTRATION" });
        }
        this.registration = {
          pluginName: String(body.pluginName).slice(0, 100),
          pluginVersion: String(body.pluginVersion).slice(0, 50),
          hostName: body.hostName ? String(body.hostName).slice(0, 100) : undefined,
          hostVersion: body.hostVersion ? String(body.hostVersion).slice(0, 50) : undefined,
          platform: body.platform ? String(body.platform).slice(0, 50) : undefined,
          capabilities: Array.isArray(body.capabilities)
            ? body.capabilities.map(String).slice(0, 100)
            : []
        };
        return json(res, 200, { ok: true });
      }

      if (url.pathname === "/v1/state" && req.method === "POST") {
        const body = (await readJson(req)) as JsonValue;
        this.state = body;
        this.stateUpdated = Date.now();
        return json(res, 200, { ok: true });
      }

      if (url.pathname === "/v1/status" && req.method === "GET") {
        return json(res, 200, this.getStatus());
      }

      if (url.pathname === "/v1/commands/next" && req.method === "GET") {
        const command = this.queue.shift();
        if (!command) return empty(res);
        return json(res, 200, command);
      }

      const resultMatch = /^\/v1\/commands\/([0-9a-f-]+)\/result$/i.exec(url.pathname);
      if (resultMatch && req.method === "POST") {
        const id = resultMatch[1];
        const pending = this.pending.get(id);
        if (!pending) return json(res, 404, { error: "COMMAND_NOT_PENDING" });

        const body = (await readJson(req)) as CommandResult;
        clearTimeout(pending.timer);
        this.pending.delete(id);

        if (body?.ok) pending.resolve(body.result ?? null);
        else pending.reject(new Error(body?.error || "Premiere command failed."));
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: "NOT_FOUND" });
    } catch (error) {
      return json(res, 500, {
        error: error instanceof Error ? error.message : "INTERNAL_ERROR"
      });
    }
  }
}
