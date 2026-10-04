# R Project Premiere MCP

Local MCP server for **R Project Multicam AI** and Adobe Premiere Pro.

This project is intentionally isolated from the production plugin. It exposes MCP tools over stdio and uses an authenticated localhost bridge to communicate with the Premiere panel.

## Architecture

```
AI / MCP Host
      |
      | MCP stdio
      v
R Project Premiere MCP
      |
      | http://127.0.0.1:47821
      | x-rproject-token
      v
Premiere panel adapter
      |
      v
Existing R Project Multicam AI functions
      |
      v
Adobe Premiere Pro timeline
```

The MCP server does **not** reimplement the music engine or multicam engine. The plugin remains the source of truth for beat analysis, camera planning, cutting, cleanup, zoom and export.

## Requirements

- Node.js 20+
- R Project Multicam AI with the local bridge adapter integrated
- An MCP host that can launch a local stdio server

The current official TypeScript MCP SDK uses the v2 packages:
- `@modelcontextprotocol/server`
- `@modelcontextprotocol/server/stdio`

## Install

```bash
cd premiere-mcp
npm install
```

Set a local token.

Windows PowerShell:

```powershell
$env:RPROJECT_MCP_TOKEN="make-a-long-random-local-token"
npm start
```

macOS/Linux:

```bash
export RPROJECT_MCP_TOKEN="make-a-long-random-local-token"
npm start
```

If no token is supplied, the process generates a random session token and prints it to stderr. Use that same token in the Premiere panel adapter.

## Security defaults

- Bridge binds only to `127.0.0.1`.
- Every bridge endpoint except `/health` requires `x-rproject-token`.
- Request bodies are size-limited.
- Queue size is capped.
- Timeline-changing MCP tools require explicit confirmation.
- No Supabase service key, OpenAI key or licensing secret belongs in this server.

Do not expose port 47821 to the public internet.

## MCP tools

### Read-only
- `premiere_status`
- `get_active_sequence`
- `get_camera_tracks`
- `get_music_analysis`
- `get_plugin_version`

### Analysis / planning
- `analyze_a1_music`
- `set_camera_roles`
- `generate_multicam_plan`
- `find_best_drops`

### Timeline-changing
- `apply_multicam_cuts`
- `remove_unused_clips`
- `random_zoom`
- `export_best_drops`

The destructive tools require `confirm: true`.

## Example AI workflow

1. Call `premiere_status`.
2. Call `get_active_sequence`.
3. Call `get_camera_tracks`.
4. Call `analyze_a1_music`.
5. Call `generate_multicam_plan` with:
   - allowed beats `[4,6,8]`
   - max beats `8`
   - drop must switch `true`
6. Review the plan.
7. Only after user approval, call `apply_multicam_cuts` with `confirm: true`.

## Plugin integration

See [PLUGIN_INTEGRATION.md](./PLUGIN_INTEGRATION.md).

The adapter is already provided in:

`plugin-adapter/rproject-mcp-bridge.js`

The remaining integration step is mapping the adapter's command handlers to the real internal functions of the current Multicam AI build. This requires the actual current plugin source/package so the mapping can be done without guessing function names.

## Status

**MCP V1 foundation:** ready.

- stdio MCP server: implemented
- secure localhost bridge: implemented
- command queue/results: implemented
- Premiere panel adapter: implemented
- read/planner/action tools: implemented
- current production plugin function mapping: pending source integration
