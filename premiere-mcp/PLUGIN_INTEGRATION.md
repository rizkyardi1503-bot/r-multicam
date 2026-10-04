# Connect R Project Multicam AI to the MCP bridge

The MCP server is deliberately separate from the production plugin. The adapter does nothing until the plugin explicitly registers handlers.

## 1. Include the adapter

Load:

`plugin-adapter/rproject-mcp-bridge.js`

from the Multicam AI panel.

## 2. Map existing plugin functions

Register handlers against the plugin's real internal API. Example:

```js
RProjectMCPBridge.registerHandler("get_active_sequence", async () => {
  return RProjectMulticam.getActiveSequenceSnapshot();
});

RProjectMCPBridge.registerHandler("get_camera_tracks", async () => {
  return RProjectMulticam.getCameraTracks();
});

RProjectMCPBridge.registerHandler("analyze_a1_music", async (args) => {
  return RProjectMulticam.analyzeMusic({
    useInOut: !!args.useInOut,
    onlineReview: !!args.onlineReview
  });
});

RProjectMCPBridge.registerHandler("generate_multicam_plan", async (args) => {
  return RProjectMulticam.generatePlan(args);
});

RProjectMCPBridge.registerHandler("apply_multicam_cuts", async (args) => {
  if (!args.confirmed) throw new Error("Confirmation required.");
  return RProjectMulticam.applyPlan({
    cleanupMode: args.cleanupMode || "keep_clips"
  });
});
```

The identifiers above are examples. Connect them to the actual functions used by the current plugin build rather than duplicating the editing engine.

## 3. Start the bridge from the panel

Use the same token printed by the local MCP process:

```js
await RProjectMCPBridge.start({
  token: "PASTE_THE_LOCAL_SESSION_TOKEN",
  pluginName: "R Project Multicam AI",
  pluginVersion: window.RP_VERSION || "unknown",
  hostName: "Adobe Premiere Pro",
  hostVersion: window.PREMIERE_VERSION || "unknown"
});
```

For a public build, do not hard-code one global token. Generate/store a per-machine token during local setup and use the same value in the MCP process environment.

## Recommended handler map

Read-only:
- `get_active_sequence`
- `get_camera_tracks`
- `get_music_analysis`
- `get_plugin_version`

Planner/settings:
- `analyze_a1_music`
- `set_camera_roles`
- `generate_multicam_plan`
- `find_best_drops`

Timeline-changing:
- `apply_multicam_cuts`
- `remove_unused_clips`
- `random_zoom`
- `export_best_drops`

Keep confirmation checks inside the plugin too. MCP-side confirmation is an extra guard, not a replacement for host-side validation.

## State snapshots

The plugin can periodically send a small, non-sensitive state snapshot:

```js
await RProjectMCPBridge.updateState({
  sequenceName: currentSequenceName,
  videoTracks: activeVideoTrackCount,
  audioTracks: activeAudioTrackCount,
  hasMusicOnA1: true,
  analysisReady: true,
  planReady: false
});
```

Do not send footage, passwords, API keys, access tokens, or license secrets through the state snapshot.
