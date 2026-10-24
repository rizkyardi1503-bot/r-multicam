# DaVinci v1.0.0 (Windows): test results, 24 Oct 2026

## Round 4 (review fixes before publishing)

`node tests\run-all.cjs` ran 7 test files, and all passed:

| Test file | Checks | New in this round |
|---|---|---|
| unit | 158 | Start of 10 s never shifts anything; mixed fps 29.97/23.976 and 23.976/29.97 (integer source frames rounded from exact boundaries, adjacent clips meet exactly); higher junction accepted, non-ASCII fallback and hash; ack file (L1); folder mismatch error (M2); Resolve closed → error in about 0.3 s (M3) |
| account | 52 | One shared in-flight refresh, and a newer session wins (M6); engine.lock is created atomically, a stale lock is replaced even when its pid is alive, and a running engine is detected through its status API (H2) |
| druva-e2e | pass | Uses the developer runner `tests/engine-cli.cjs`, because the shipped engine has no CLI entry (M7) |
| protocol | 276 | Engine reports "DaVinci Resolve closed while snapshot was running" about 0.5 s after Resolve disappears (M3) |
| lua | 78 | After the engine's ack the bridge clears Response, so Fusion.prefs stays under 2 KB (L1). With a non-ASCII profile path, the real Lua bridge and the engine pick the same `ProgramData\RProjectMulticam\bridge-<hash>` folder, and it is restricted to the user plus SYSTEM (M2) |
| installer | 22 | The script's ACL is protected, with Administrators + SYSTEM full control and Users read & execute; a reinstall recreates it and removes an old `.py` (M1). The uninstaller stops only our engine process, never stops halfway, leaves Fusion.prefs alone while Resolve runs, and removes the RProjectBridge block with a backup once Resolve is closed (L2) |
| pack | 39 | The packaged `rp-engine-cli.js` has no CLI entry; `Install-LuaScript.ps1` is packaged |

**Checked by hand:**
- fuscript (DaVinci's Lua): `bmd.fileexists` opens a non-ASCII UTF-8 path, but `loadfile` cannot. This is the reason for the ProgramData fallback.

**Not tested:**
- The UAC prompt path: tests use `-NoElevate`.
- The refusal when the installer is elevated as a different user than the desktop owner: that needs a second account.
- M5 (a copied FFmpeg that cannot run on its own): no such build is available here.

**Package:** `R-Project-Multicam-AI-DaVinci-Windows-v1.0.0.zip`, 117,900 bytes, 24 files, SHA256
`7fdc0a6b300f2dfe3a57e25cd18be4368a6330982020f671981f053431806c4a`. Reinstalled on this PC from the zip with
`-NoElevate`, so no UAC prompt appeared during your live test. The engine that was running was not stopped.

## Round 3 (license, runtime, package)

`node tests\run-all.cjs` ran 7 test files, and all passed:

| Test file | Checks | What it covers |
|---|---|---|
| unit-tests | 93 | Unchanged from round 2. |
| account-tests | 45 | Mocked Supabase, no network. |
| druva-e2e | pass | Same numbers as round 2. |
| protocol-test | 275 | Unchanged from round 2. |
| lua-tests | 73 | Unchanged from round 2. |
| installer-tests | 17 | Redirected profile folders, local test packages, no downloads. |
| pack-tests | 35 | Deterministic zip. |

### Account tests
```
PASS device id: same algorithm and file as Premiere license.js; existing id reused; invalid replaced
PASS sign-in: trial "Trial: 4 days left", device registered, entitlement checked, session saved without the password
PASS tokens: restore, refresh rotation, retry after JWT expiry, rejected refresh signs out
PASS license states: lifetime, trial expired, update required, update available, signed in on another device
PASS offline grace: allowed within 72 h of the last check (also after an engine restart), refused after
PASS forgot password: /auth/v1/recover with redirect, 65 s cooldown
PASS engine gate: Analyze / Multicam / Best Drops return 403 until signed in and allowed; sign-in/out via API; no secrets in logs or status
```
The device-id test runs the Premiere `license.js` (`tests/fixtures/license-premiere.js`, from origin/main) in a vm. On this
PC it produces the same id as `lib/account.js`, so the same PC is the same device.

The only real Supabase call was one read-only smoke request, `GET /auth/v1/settings`. It returned HTTP 200, which
confirms the URL and publishable key; email and Google sign-in are both enabled.

### Installer tests
```
PASS A: Node.js package with a wrong SHA-256 refused, nothing half-installed
PASS B: verified Node.js package installed to runtime\; shortcut, Lua script, engine, FFmpeg path, command folder
PASS C: reinstall reuses runtime\node.exe and keeps session.json
PASS D: Node.js >= 18 on PATH is used when there is no private copy
PASS E: FFmpeg package with a wrong SHA-256 refused
PASS F: uninstaller removes the script, engine (incl. runtime and session) and shortcuts; keeps shared FFmpeg
```

### Package tests
```
PASS package: R-Project-Multicam-AI-DaVinci-Windows-v1.0.0.zip · 111752 bytes · 23 files ·
     SHA256 4bee749b85101aeb71d9b58c97c10afb1a62bb787596874bc3fd7dca7ed9be6f (deterministic, Expand-Archive OK, files identical)
```

### Reinstall on this PC
- The packaged zip was extracted to a temp folder and its `Install-DaVinci.ps1` was run. It exited 0.
- **Node.js:** v24.20.0 from PATH, so no download was needed.
- **FFmpeg:** the existing pinned 9.0.2 in `tools\`.
- **Files:** the installed engine and lib files, and the ProgramData `.lua`, are identical to the sources.
- **Account:** the engine is signed out; no `session.json` exists.
- **Device id:** `RP-37EB-72F9-2439-01FA`, the same file as the Premiere plugin.

# Round 2 (Lua bridge + R Project Engine), 24 Oct 2026

- **Environment:**
  - Windows 11, Node v24.20.0.
  - The Lua checks run in DaVinci's standalone script interpreter `fuscript.exe` (LuaJIT 2.1, Lua 5.1), which does
    not start or control the Resolve application.
  - Resolve itself was not launched or controlled.
- **Command:** `node tests\run-all.cjs`, run from `r-multicam\plugin\davinci`.
- **Previous live test** (coordinator, Resolve 21.1 Free): every step passed; the issues found there are fixed below.

## Results after the live-test fixes

```
=== unit-tests.cjs ===
PASS parseFps / fpsString: NDF/DF, NTSC snapping and formatting
PASS buildSnapshot + planSegments + musicInfos (exclusive endFrame)
PASS L-4: clip FPS used for every item; lengths from GetDuration; inclusive srcEnd at media end tolerated
PASS read rules: transitions (M4), speed (M5), Start (M8, Start=0), track rules, A1 errors
PASS Best Drops settings: Mark In/Out frames, engine-chosen free names, forward-slash folder
PASS lua-snippets: escaping, nonce shape, original/current-timeline guards (11 ops)
PASS bridge: prefs parsing, folder security (public/junction), M1 stale hello, nonce, call/answer/torn/error/timeout reuse, Beat re-sync, same-id restart, new session
PASS workflow: busy guard, H1/H2 guards, render cleanup always runs
ALL PASS (93 checks)
=== druva-e2e.cjs ===   (engine on the real Druva media)
WARN main drop is 2.96 beats from the expected 60.29 s      (engine says 58.89 s; same as the live test)
PASS analyze / PASS plan / PASS drops · ALL PASS
=== protocol-test.cjs ===   (HTTP API + bridge + workflow vs a Node mock DaVinci with live behaviour)
PASS analyze via bridge: BPM 127, drops 1, energy HIGH, drop score 99
PASS multicam via bridge: 44 camera clips + 1 music clip in 1 append command; endFrame exclusive; WAV in 24 fps source frames; original unchanged
PASS Best Drops via bridge: Best Drop 01 - 000059 (2) MarkIn 87494 MarkOut 88249; format + mode + marks restored; job deleted
PASS sessions: restart resumes from Beat; timeout reuses n; Beat re-syncs counter; same-id restart and new session reset to 1; wrong nonce rejected; stale prefs not connected
PASS H2: fps mismatch -> new timeline deleted, original kept, nothing appended
PASS H1: new timeline not current -> nothing appended
PASS M2: wrong lengths are logged as mismatches; no automatic endFrame flip
PASS Q1: placed clip with a different source in-point -> "SOURCE IN" mismatch
PASS L4: partial AppendToTimeline result matched by (track, start)
PASS H3: blank roles -> clips on V1 and V3
PASS M3/L7: idle render queue -> stopped after 3 polls, format restored; in-only mark reported
ALL PASS (275 checks)
=== lua-tests.cjs ===   (fuscript.exe)
PASS syntax: bridge + Lua mock + 11 snippets parse and return (nonce, function) from an empty environment; broken file detected
PASS round trip: quotes, backslashes, newline, ]] and UTF-8 survive the JS -> Lua literal
PASS security: forged commands rejected (wrong nonce; outer-chunk code has no environment); engine re-synced numbering
PASS Lua end to end: real bridge + Lua mock Resolve; 44 camera clips + 1 music clip (24 fps WAV) with exclusive endFrame;
     original timeline + marks unchanged; Best Drop rendered in mode 1 with DaVinci suffix off; format, mode and marks restored; job deleted; bridge stopped cleanly
ALL PASS (73 checks)
ALL TEST FILES PASSED (4)
```

The mocks follow the live facts:
- endFrame is exclusive, and the project runs at 24 fps while the timeline is at 25 fps.
- The WAV reports `FPS=24` and its source frames are in 24 fps units (3000 record frames = 2880 source frames), with an
  inclusive-looking `GetSourceEndFrame` at the end of the media.
- `CreateEmptyTimeline` makes the new timeline current.
- `SetCurrentRenderFormatAndCodec` returns false when the format is already selected, so a restore is only checked by
  reading the format back.
- The render mode is 1, and `MapPath("Profile:")` uses backslashes.

## Fixes and their checks

### Live findings

| Item | Fix | Check |
|---|---|---|
| L-1 | The installer writes the `.lua` to `C:\ProgramData\...\Fusion\Scripts\Utility`. If that folder is not writable it prints "run as administrator". Old `.lua`/`.py` copies are removed from both folders; other scripts (`rp_bridge_test.lua`) are kept. The uninstaller covers both folders. | Installer and uninstaller tested on temp folders (below). Real install done. |
| L-2 | `render_save` saves the format table `{format, codec}` and the render mode. Rendering uses `SetCurrentRenderMode(1)`. Cleanup restores both and **checks the format by reading it back**. | Protocol: mov/ProRes and mode 0 restored. Lua: the format is restored even though Set returns false for an unchanged value, and the job is rendered in mode 1. |
| L-3 | `UseUniqueFilenames=false`. The engine picks a free name itself (" (2)", " (3)") from the folder contents and the names already used in this batch. | Unit test and protocol ("Best Drop 01 - 000059 (2)" when the first name exists). |
| L-4 | The speed check uses each clip's own FPS. Clip lengths come from `GetDuration` and the fps ratio, never from `GetSourceEndFrame`. | Unit test: a 24 fps WAV on a 25 fps timeline (0–2879) gives end 2880 and is not flagged as a speed change; a stretched WAV is flagged. Protocol and Lua: the music is appended with `startFrame = T0*24`, `endFrame = +2880`, and is 3000 frames on the timeline. |
| L-5 | Every button click is logged in the page with its HTTP result or error. Buttons are never disabled from a stale status; only the server decides. The page refreshes when the tab becomes visible again. Log times are local time. | Protocol checks the page code. In the browser, a click on Render Best Drops logged "sending… / HTTP 202 — started" followed by the full run. |

### Security

| Item | Fix | Check |
|---|---|---|
| Command folder | The command folder is now `<Fusion profile>/RProjectBridge`. The Lua side takes it from `MapPath("Profile:")`; the engine takes it from the folder of `Fusion.prefs`. Public paths and links/junctions are refused (`lstat` and realpath). The `RP_BRIDGE_DIR`/env overrides are removed. | Unit tests: a public path, a junction parent and a junction folder are all refused. |
| Nonce | A per-session 32-hex nonce, mixed from `os.time`, `os.clock`, table and function addresses, `bmd.getappuuid` and `math.random`, is published only in Hello. It is not in file names and not in the status API. Each command file is `return "<nonce>", function(resolve, RP) ... end`. The outer chunk runs under `setfenv(chunk, {})`; the body gets the script environment. `RP` stays local, and there is no global `RP`. | Lua: a forged command with the wrong nonce is rejected. A forged command with the right nonce but `io.open` at top level is rejected and no file is written. The harness prints `RP` as nil. |
| Old shared folder | The installer deletes the old `C:\Users\Public\RProjectMulticam` only if the current user owns it and it contains no reparse points. | Temp test, and the real install removed it. |
| Web UI | Camera list built with `new Option()`. `Referrer-Policy: no-referrer`. POSTs with a foreign Origin get 403. A body over 1 MB gets 413 plus `req.destroy()`. At most 8 log streams (SSE). Token compared in constant time. | Protocol test. |
| FFmpeg `-protocol_whitelist` | **Not changed.** The only FFmpeg spawns are in `engine/audio-engine.js` and `engine/visual-quality.js`, which are copied unchanged from the Premiere build. The fix belongs in `plugin/windows` and `plugin/macos`, which I must not touch. | — |

### Code review

| Item | Fix | Check |
|---|---|---|
| H1 | When no command is pending, the Beat value is the source of truth for the command counter. The counter is incremented only after the rename succeeds. On a timeout, the file is deleted and its number reused if the bridge never consumed it. | Unit and protocol tests: timeout reuse, the 9→4 re-sync, and the counter catching up after forged commands. |
| H2 | A persistent `Session` counter in the prefs is part of the id. Any change of the Hello string, a Beat count that goes down, or a new `hello` state starts a new session. | Unit and protocol tests: a same-id restart and a new session both reset numbering to 1. Lua test: Session=1 is persisted. |
| M1 | A Hello already in the prefs at engine start counts as connected only after its Beat moves. | Unit and protocol: stale prefs are not connected. |
| M2 | The automatic endFrame flip is removed. Wrong lengths are logged as MISMATCH. | Protocol, "inclusive" scenario. |
| M5 | `render_save`, `render_start` and `append` verify the current timeline id after `SetCurrentTimeline`. | Snippet test. |
| M6 | Response is cleared when a command starts and on stop. The media index is cached across commands and rebuilt when the project or clip count changes, or on a lookup miss. Timeouts are per operation (snapshot/append 600 s, create 180 s, render_start 300 s, others 120 s). The snapshot is trimmed, and media properties are read once per file. | Lua end-to-end test. |
| M4 | The page log lists which Deliver settings stay changed. | Protocol test. |
| Q1 | Each placed clip's `GetSourceStartFrame` is compared with the requested startFrame; a difference counts as a loud "SOURCE IN" mismatch. `Start=0` never shifts anything. | Protocol, srcshift scenario; unit test. |
| Q3 | A torn hex or JSON read is retried on the next poll. | Unit test. |
| L1 | `timelineDropFrameTimecode` is copied. | Unit and protocol. |
| L2 | NTSC rates are written as "23.976", "29.97" and so on. | Unit. |
| L4 | A partial batch is matched by (track, start). | Protocol. |
| L5 | `reduce` replaces `Math.max(...spread)`. | — |
| L6 | `render_save` is a separate step, so cleanup always runs. | Unit: `render_start` throws and cleanup still runs with the saved format. |
| L7 | A mark with only In (or only Out) is reported in the log. | Protocol. |
| L8 | An old loop ends when Hello no longer carries its id, without overwriting the new keys. | Code only. |
| L3, `delete_items` | Calibration is gone, so `delete_items` is unused (kept, with its id guard). | — |

## Installer

- **Temp-folder test** (`LOCALAPPDATA`/`APPDATA` redirected, all folder parameters set to temp folders):
  - **Install:** installed the `.lua` into the ProgramData-style folder. Removed the old `.lua` and `.py` from the
    per-user folder and the `.py` from ProgramData, and kept `rp_bridge_test.lua`. Removed the old Public folder
    (owned by me, no links). Cleared a stale `lib\stale.js`. Created the profile `RProjectBridge` folder and the
    shortcut.
  - **Uninstall:** removed everything except `rp_bridge_test.lua`.
- **Real install on this PC:** `powershell -ExecutionPolicy Bypass -File Install-DaVinci.ps1` returned exit 0.
  - **Bridge script:** `C:\ProgramData\Blackmagic Design\DaVinci Resolve\Fusion\Scripts\Utility\R Project Multicam AI.lua`.
    Its sha256 matches the source.
  - **Removed:** the per-user copy and `C:\Users\Public\RProjectMulticam`.
  - **Engine:** in `%LOCALAPPDATA%\RProjectMulticam\davinci`; all 6 JS files are identical to the source.
  - **Command folder:** `%APPDATA%\...\Profiles\Default\RProjectBridge`.
  - **Shortcuts:** Desktop and Start menu.
  - **Warning:** the installer printed "R Project Engine is running with the previous version (pid 8604)". It must be
    closed and started again. The old bridge loop in Resolve had already stopped (Beat state `stopped`).

## Not verified here (needs the live test)

- `fusion:GetPrefs("Global.RProjectBridge.Session" / "Hello")` inside Resolve. `MapPath`, `setfenv`/`getfenv`,
  `os.time`/`clock`, `math.random` and `bmd.getappuuid` were verified live by the coordinator.
- Whether `SetCurrentRenderMode(1)` plus restoring the previous mode behaves as expected in the Deliver page.
- Whether `UseUniqueFilenames=false` with an engine-chosen name gives exactly "Best Drop 01 - 000059.mp4".
- `GetTrackTypeAndIndex` on appended items. It is only used to match a partial batch.
