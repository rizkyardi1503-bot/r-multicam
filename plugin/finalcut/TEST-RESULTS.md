# Final Cut Pro v1.0.0 (macOS): test results, 20 Nov 2026

## How the build works

Final Cut Pro has no script or panel API like Premiere (CEP) or Resolve (Lua), so this build is a local
**R Project Engine** (Node.js, control page in the browser) that writes **FCPXML 1.10**, which Final Cut imports:

1. The user signs in (same R Project account and device id as the Mac Premiere plugin; platform `macOS`, version
   `2.3.11.19-finalcut-v1.0.0`, which the live server accepts: minimum 2.3.11.11, latest macOS 2.3.11.19).
2. The user picks the music and the clips of each camera (native macOS file chooser).
3. The engine syncs every clip by its own audio, analyzes the music with the **unchanged Mac Premiere engine**
   (`plugin/macos/Plugin`, 2.3.11.19), paces the cuts, picks cameras (`rp-engine` planner) and writes
   `Movies/R Project Multicam/<music> - Multicam AI.fcpxml` (+ `.rpplan.json`): one multicam clip (an angle per camera
   plus the music) and a project cut on the beat with drop markers. It then opens the file in Final Cut Pro.

Shared code is copied byte-identically by `build-finalcut.cjs` (`engine/` from the Mac Premiere plugin, `rp-engine/lib`,
`lib/account.js` + `lib/google-auth.js` from the DaVinci build). `pack-finalcut.cjs --check` fails in CI when a copy or
the committed ZIP is out of date.

## Round 1 (Linux, no Mac)

`node tests/run-all.cjs`: 2 test files, 103 checks, all passed.

| Test file | Checks | What it covers |
|---|---|---|
| engine-tests | 58 | Token / Host / Origin / JSON guards; path validation; license gate (403 before any work, nothing written); real end-to-end run on generated media: BPM 128, drops at 30 s and 75 s, 4 cameras / 5 clips each synced within 50 ms of the true position (incl. a camera with two clips), 41 cuts, every cut covered by footage, FCPXML 1.10 well-formed (xmllint), 5 angles, every clip referenced; never overwrites an earlier edit; Open in Final Cut option; Cancel stops the job; job file has no CLI entry; engine.lock |
| install-pack-tests | 45 | Deterministic ZIP, exact file list, `.command` files stored 0755 (Unix mode), committed ZIP current; installer run from the extracted ZIP into a test home: files, launcher, FFmpeg path, Premiere device id kept, reinstall; the installed engine starts, answers, writes its lock and analyzes music; tampered or missing file refused before anything is installed; uninstaller removes the engine and keeps the shared FFmpeg folder and device id |

**Package:** `releases/finalcut/R-Project-Multicam-AI-FinalCut-macOS-v1.0.0.zip`, 130,547 bytes, 25 files, SHA256
`e541aa708f53b5fc7629ee4db4856e228ce12db0a2bc635b7a7c2c7f4f9ffe14`.

**Not tested yet (needs a Mac with Final Cut Pro):**
- Gatekeeper on the downloaded `Install-FinalCut.command` (right-click > Open / Open Anyway, as for the Premiere installer).
- Node.js and FFmpeg downloads on a clean Mac (pinned URLs and SHA-256 are the official ones; Node hashes from
  nodejs.org SHASUMS256.txt, FFmpeg the same build as the Mac Premiere installer).
- `osacompile` app in ~/Applications, the `osascript` file chooser, `open -b com.apple.FinalCut`.
- Final Cut Pro importing the .fcpxml (the FCPXML comes from `rp-engine/lib/fcpxml.mjs`, the same exporter the
  rp-engine tests cover).
- A live sign-in (email and Google) against the real server.
