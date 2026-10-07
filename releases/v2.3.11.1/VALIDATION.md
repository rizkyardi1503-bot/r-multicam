# macOS-only public release 2.3.11.1 — 2026-10-08

Windows stays public/minimum 2.3.11.0. Its pinned ZIP, hash and download target are unchanged. macOS public/minimum advances to 2.3.11.1 with the existing zero-grace rule, effective on the next online entitlement check. Accounts/trial dates/licenses are not reset.

macOS ZIP: R-Project-Multicam-AI-macOS-v2.3.11.1-PUBLIC.zip; 150678 bytes; SHA256 f945488da9be7d45e97e6744d1ca4cde87b64583895bac1d74c1d24bebe1eded.
Windows ZIP: R-Project-Multicam-AI-Windows-v2.3.11.0-PUBLIC.zip; SHA256 317f3412b0c0db3f4df5adc87e1f9e7668194f39217f094e38fb068bc0a052a2.

On macOS <=12 GiB (including M1 8 GB/Rosetta), automatic Low Memory mode uses one CPU decoder thread, up to 24 optional visual samples, existing light timeline batches and 250 ms scheduling. macOS VM reclaimable-page estimates replace Windows commit thresholds. Analyses preflight memory and periodically check audio decoding; last-clip feature references are released early. Audio timing algorithms, account/session keys and protected timeline cleanup are unchanged except mechanical release-version alignment.

Tests: mocked memory/profile/CPU decoder/cancellation checks; synthetic 90/120/128/140/180 BPM and drop-onset regressions; unchanged audio/auth/host-source comparison; split-OS manifest/download/auth/CORS tests; website account/checkout/download tests; ZIP CRC/inventory/Unix executable-mode checks; Bash installer syntax. Native M1/Premiere memory reductions and native installation remain unverified. Owner explicitly authorized public release despite that limitation. No guarantee that large high-resolution multicam projects fit in 8 GiB; proxies may remain necessary.

Release routing: immutable GitHub stage commit 245814b70cbac98a9fef9d2309571b3ff19c71e0 for the new Mac archive, existing immutable Windows source 2c60fe73ab57abeabc427532af282b2f21bcdf6b. Public updater endpoint keeps existing no-JWT config; website download retains JWT and verified/confirmed-account checks and private-storage first with pinned fallback. No credentials are bundled. Website account versions are selected from connected device OS, not a global latest string.

Fix to existing private latest_public() validator: use literal [.] separators, replacing doubled-backslash pattern that rejected valid version numbers. Preserve platform selection, monotonic cache, fail-closed checks and revoked public/anon/authenticated access. No new tables, account updates or permission grants.

Save/quit Premiere before installation. Check Update in the Mac plugin or sign in to the website and choose macOS. First test on a duplicate project. Existing installer keeps a prior-plugin backup. Keep the former installer; backend minimum would also need an authorized rollback if the public version were withdrawn.
