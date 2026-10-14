# R Project Multicam AI — Engine, shared plan format, FCPXML and MCP

One engine, one plan, every editor.

```
music + camera files ──► rp-engine (the plugin's own engine code)
                              │
                              ▼
                   rp-multicam-plan/1 (JSON)
                    │                    │
                    ▼                    ▼
       Final Cut Pro (.fcpxml)     Premiere (panel / premiere-mcp)
```

- **Same engine.** `lib/runtime.mjs` loads the unmodified plugin files (`audio-core.js`,
  `spectral-features.js`, `audio-engine.js`, `music-intelligence-v10.js`,
  `music-pacing-auto.js`, `ai-director.js`) into a Node VM with a small `cep_node` shim.
  `lib/engine.mjs` calls them in the same order as `panel.js`: analyze, enrich, pace,
  constrain to the selected cadences, apply pacing, build the director snapshot, then run
  the director. BPM, beats, drops, pacing and camera choices come from the same code as
  in Premiere.
- **Same model.** Every run produces an `rp-multicam-plan/1` JSON
  ([schema](schema/rp-multicam-plan-1.json), published at
  `https://r-multicam.pages.dev/schema/rp-multicam-plan-1.json`):
  - music (BPM, tempo map, beats, downbeats, sections, drops, pacing),
  - cameras (file, role, sync offset),
  - frame-exact cuts that change only when the camera changes.
- **Final Cut Pro.** `lib/fcpxml.mjs` exports FCPXML 1.10 (FCP 10.6+), checked against
  Apple's DTD. It contains:
  - one multicam clip, with one angle per camera plus a Music angle,
  - a project cut on the planned angle switches, with drop markers.

  The cuts stay live multicam edits, so you can still change angles in FCP.
- **Camera sync.** If a camera has no `offset`, it is synced from its own scratch audio
  (onset-envelope cross-correlation at 10 ms). The plan records the sync method and
  confidence. Cameras that start before the music (negative offset) are supported.
- **Real shoots.**
  - Each camera can have many clips (`files: [...]`). Every clip is synced on its own.
  - Matches are checked against the camera's own clock (file `creation_time`): one camera
    has one clock, so creation time minus timeline offset must be the same for all its
    clips. Each clip is then searched only near where its clock places it.
  - A clip that overlaps another clip of the same camera, or that the clock places outside
    the music, is left out and listed in `excluded_clips`.
- **Multi-part nights.** Pass `music` as an array, e.g. a recorder stopped between sets.
  - The time between part starts is voted by all camera clocks.
  - A camera that is well synced in one part guides its clips in the other parts
    (`lib/session.mjs`).
  - Each part gets its own plan and `.fcpxml`.
- **Resumable.** `cache_dir` stores the music analysis, the music envelope and every clip
  sync, so a long set can be processed in steps.
- **Reproducible.** The director's random anti-repeat step is seeded, so the same inputs
  give the same plan.
- **Local only.** Media never leaves the computer. FFmpeg is found the same way the plugin
  finds it (Settings path, installer `tools` folder, then PATH). `ffprobe` is not needed.

Requirements: Node.js 18+ and FFmpeg. There are no npm dependencies.

The engine looks for the plugin code in this order:
1. `RP_PLUGIN_DIR`
2. the installed CEP extension (`…/Adobe/CEP/extensions/RProjectMulticamAI`)
3. `../plugin/*/Plugin` in this repo

## CLI

```bash
node bin/rp-engine.mjs analyze song.wav --out song.music.json
node bin/rp-engine.mjs plan --music song.wav \
  --camera wide.mp4="Master Wide" --camera dj.mp4="DJ Close-Up" --camera crowd.mp4="Crowd Reaction" \
  --out set.rpplan.json --fcpxml set.fcpxml --cadence 4,6,8
node bin/rp-engine.mjs fcpxml set.rpplan.json --out set.fcpxml --media-dir /Volumes/Footage/Set1
node bin/rp-engine.mjs validate set.rpplan.json
```

- Write a camera as `FILE[=ROLE][@OFFSET]`. `@12.5` places the camera's first frame at
  12.5 s and turns audio sync off.
- `--drop-camera N` uses camera N (0-based) on every drop.
- `--vision` samples frames to avoid dark or blurry angles.

## MCP server

`bin/rp-engine-mcp.mjs` is a stdio MCP server with these tools:

| Tool | What it does |
| --- | --- |
| `analyze_music` | BPM, tempo map, sections, build-ups and drops |
| `plan_multicam` | music + cameras, then sync, pacing and camera choice; writes the plan JSON and optional `.fcpxml` |
| `export_fcpxml` | plan JSON to FCPXML (optional `media_dir` relink for another computer) |
| `validate_plan` | structural check of a plan |
| `describe_plan_format` | returns the JSON Schema |

Long jobs send `notifications/progress` when the client passes a progress token.

Claude Desktop / any MCP client (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "r-project-engine": {
      "command": "node",
      "args": ["/Users/me/r-multicam/rp-engine/bin/rp-engine-mcp.mjs"],
      "env": { "RP_FFMPEG": "/opt/homebrew/bin/ffmpeg" }
    }
  }
}
```

Example request: *"Make a multicam plan for ~/Sets/set1.wav with wide.mp4 (Master Wide),
dj.mp4 (DJ Close-Up), crowd.mp4 (Crowd Reaction) and export it for Final Cut Pro."*
Then in Final Cut Pro, choose **File → Import → XML…** and pick the `.fcpxml`.

## Tests

```bash
node test/run-tests.mjs   # needs ffmpeg; builds a synthetic 128 BPM track + 3 cameras
```

The tests cover:
- tempo, beat count and both drops,
- audio sync (0 s, +6 s and −3 s cameras),
- plan validity and drop cuts,
- FCPXML structure,
- the MCP JSON-RPC handshake and tool calls,
- the CLI.

They run in `.github/workflows/engine.yml`.
