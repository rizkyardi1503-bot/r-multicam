import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { PremiereBridge } from "./bridge.js";
import type { JsonValue } from "./contracts.js";

const bridge = new PremiereBridge();
await bridge.start();

console.error(`R Project Premiere MCP bridge: http://${bridge.host}:${bridge.port}`);
console.error(`R Project MCP token: ${bridge.token}`);
console.error("Keep this token private. The bridge accepts localhost connections only.");

const ok = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
});

const fail = (error: unknown) => ({
  content: [{
    type: "text" as const,
    text: error instanceof Error ? error.message : String(error)
  }],
  isError: true
});

async function callPremiere(name: string, args: Record<string, JsonValue> = {}) {
  try {
    return ok(await bridge.invoke(name, args));
  } catch (error) {
    return fail(error);
  }
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "r-project-premiere",
    version: "0.1.0"
  });

  server.registerTool(
    "premiere_status",
    {
      description: "Check whether R Project Multicam AI is connected to the local Premiere MCP bridge.",
      inputSchema: z.object({})
    },
    async () => ok({ ...bridge.getStatus(), state: bridge.getState() })
  );

  server.registerTool(
    "get_active_sequence",
    {
      description: "Read a snapshot of the active Adobe Premiere Pro sequence without changing the timeline.",
      inputSchema: z.object({})
    },
    async () => callPremiere("get_active_sequence")
  );

  server.registerTool(
    "get_camera_tracks",
    {
      description: "Read available multicam video tracks, roles and current footage coverage.",
      inputSchema: z.object({})
    },
    async () => callPremiere("get_camera_tracks")
  );

  server.registerTool(
    "get_music_analysis",
    {
      description: "Read the most recent A1 music analysis, including BPM, beat grid, phrases and ranked main drops.",
      inputSchema: z.object({})
    },
    async () => callPremiere("get_music_analysis")
  );

  server.registerTool(
    "analyze_a1_music",
    {
      description: "Run the plugin's A1 music analysis for the active sequence or selected In/Out range.",
      inputSchema: z.object({
        useInOut: z.boolean().default(false),
        onlineReview: z.boolean().default(false)
      })
    },
    async ({ useInOut, onlineReview }) =>
      callPremiere("analyze_a1_music", { useInOut, onlineReview })
  );

  server.registerTool(
    "set_camera_roles",
    {
      description: "Set camera roles used by the Multicam AI planner. This changes planner settings but does not cut the timeline.",
      inputSchema: z.object({
        roles: z.record(z.string(), z.string())
      })
    },
    async ({ roles }) =>
      callPremiere("set_camera_roles", { roles })
  );

  server.registerTool(
    "generate_multicam_plan",
    {
      description: "Generate a reviewable multicam camera plan. Does not apply physical cuts.",
      inputSchema: z.object({
        allowedBeats: z.array(z.number().int().min(1).max(32)).min(1).default([4, 6, 8]),
        maxBeats: z.number().int().min(1).max(32).default(8),
        dropMustSwitch: z.boolean().default(true),
        aggressive: z.boolean().default(false),
        useInOut: z.boolean().default(false)
      })
    },
    async ({ allowedBeats, maxBeats, dropMustSwitch, aggressive, useInOut }) =>
      callPremiere("generate_multicam_plan", {
        allowedBeats,
        maxBeats,
        dropMustSwitch,
        aggressive,
        useInOut
      })
  );

  server.registerTool(
    "apply_multicam_cuts",
    {
      description: "Apply the generated multicam plan to the Premiere timeline. Requires explicit confirm=true because it changes the active sequence.",
      inputSchema: z.object({
        confirm: z.literal(true),
        cleanupMode: z.enum(["keep_clips", "remove_unused"]).default("keep_clips")
      })
    },
    async ({ cleanupMode }) =>
      callPremiere("apply_multicam_cuts", { cleanupMode, confirmed: true })
  );

  server.registerTool(
    "remove_unused_clips",
    {
      description: "Remove unused multicam pieces after an applied plan. Requires explicit confirm=true because clips can be removed from the active sequence.",
      inputSchema: z.object({
        confirm: z.literal(true)
      })
    },
    async () => callPremiere("remove_unused_clips", { confirmed: true })
  );

  server.registerTool(
    "random_zoom",
    {
      description: "Apply the plugin's Random Zoom feature to active scenes. Requires confirm=true because Scale keyframes can be replaced.",
      inputSchema: z.object({
        minScale: z.number().min(1).max(1000).default(100),
        maxScale: z.number().min(1).max(1000).default(115),
        confirm: z.literal(true)
      }).refine((v) => v.maxScale >= v.minScale, {
        message: "maxScale must be greater than or equal to minScale"
      })
    },
    async ({ minScale, maxScale }) =>
      callPremiere("random_zoom", { minScale, maxScale, confirmed: true })
  );

  server.registerTool(
    "find_best_drops",
    {
      description: "Rank the best music drops from the latest analysis without exporting media.",
      inputSchema: z.object({
        count: z.number().int().min(1).max(50).default(15)
      })
    },
    async ({ count }) => callPremiere("find_best_drops", { count })
  );

  server.registerTool(
    "export_best_drops",
    {
      description: "Export selected best-drop highlights using the plugin's existing export workflow.",
      inputSchema: z.object({
        count: z.number().int().min(1).max(50),
        confirm: z.literal(true)
      })
    },
    async ({ count }) =>
      callPremiere("export_best_drops", { count, confirmed: true })
  );

  server.registerTool(
    "get_plugin_version",
    {
      description: "Read the connected R Project Multicam AI plugin version and host information.",
      inputSchema: z.object({})
    },
    async () => ok(bridge.getStatus().registration)
  );

  return server;
}

void serveStdio(createServer);

const shutdown = async () => {
  await bridge.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
