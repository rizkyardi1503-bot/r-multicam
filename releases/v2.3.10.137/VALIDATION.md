# v2.3.10.137 PUBLIC — Windows and macOS

Verified before activating the public updater:

- All plugin JavaScript syntax, package checksums, host/panel/manifest version handshake, PUBLIC labels and fresh PUBLIC music-cache identity.
- Optional learning/trainer/benchmark schema tests; no trained model is shipped.
- Synthetic 90–180 BPM fixtures, PCM/FFT pipeline, drop/onset timing and negative fixtures.
- Windows isolated fresh installation, .136 upgrade and backup, forced staged-move failure with rollback restoring .136, and installation from the extracted final ZIP.
- macOS Bash syntax and isolated fresh/upgrade/backup/forced-failure rollback under Git Bash with mocked macOS processes, defaults and FFmpeg. This is NOT native macOS verification.
- Generated Windows/macOS updater helpers: syntax and mocked startup/status handshake. Actual unattended helper execution inside Premiere/macOS is NOT verified.
- Windows/macOS updater platform routing, required-update metadata, latest-version checks and checksum selection.
- ZIP extraction and per-file SHA-256 verification. macOS installer has Unix executable mode 0755 in ZIP.
- Website analytics/auth/checkout/download regressions; Google login and interactive-demo source retained unchanged.
- GitHub pinned binary downloads match the package SHA-256 values in manifest.json.

Real recording spot check: Wild ones atlas, 46.38 seconds, independently analyzed with both engines at Balanced/64-beat spacing. .137 reports ~126 BPM consistently; .136 reports 240 BPM initially and ~126 BPM later (overall median rounded to 183). Both select 00:30.150. Human reference labels were not provided; this does not prove generalized accuracy.

Users on .136 or older must update at their next online entitlement check. .137 TEST users must manually reinstall the .137 PUBLIC ZIP because the numeric version is identical. Save/duplicate the Premiere project, close Adobe apps, run Analyze Music again and generate a fresh plan. No existing trial or lifetime license is reset by this release.

Limitations: native Premiere runtime, native Intel/Apple Silicon macOS, Windows ARM/32-bit systems, and all possible OS/Premiere versions are not certified by these checks. Dependency availability and OS security prompts can still affect installation. An already-open offline plugin cannot be remotely interrupted.

Supabase guidance influenced deployment ordering, preservation of endpoint authentication, restricted release-cache access and server entitlement regression checks. Public updater activation is last, after both packages are downloadable.

