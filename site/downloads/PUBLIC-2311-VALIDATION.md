# Public 2.3.11.0 — Google plugin login

Windows/macOS packages include Continue with Google, a local Google icon, browser-to-plugin PKCE code return, cancellation and five-minute timeout. Manual email/password remains available. The plugin verifies `/auth/v1/user` and the Google identity before registering the device and checking server entitlement. Provider tokens are discarded; Google passwords and the PKCE verifier are never persisted. Trial dates, existing paid licenses, single-active-device rules, Music Engine V18 and its PUBLIC cache format are retained.

Validation: real loopback HTTP tests with mocked Supabase sessions for both platform branches; PKCE challenge/verifier match; invalid path/host, missing code, replay, cancellation, timeout, disabled provider, invalid identity, expired license, browser-open failure and manual login checks. Website relay tests validate code-only return, expiry and allowed origins while preserving website sign-in. Both package checksum inventories and updater metadata pass. Windows isolated installer fresh/upgrade/backup/rollback passes. macOS installer and updater are simulated with Git Bash/mocks, not native Mac execution. Engine synthetic regression tests pass.

Native Premiere, native macOS and a real user's final Google-consent login remain unverified. No database schema or license dates changed. Existing Supabase advisories remain: authenticated security-definer RPCs and disabled leaked-password protection; private/server-managed tables intentionally deny direct client access. Reference: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

Staged installer commit: `2c60fe73ab57abeabc427532af282b2f21bcdf6b`.
Windows ZIP SHA256: `317f3412b0c0db3f4df5adc87e1f9e7668194f39217f094e38fb068bc0a052a2`.
macOS ZIP SHA256: `a21bb1d9bc38bb74a2557785efe7668d41a547b74a3036e77c9e81929c073bf3`.

Publication activation is performed only after immutable GitHub installer checksums and the website relay are available. No minimum-version change is made before then.
