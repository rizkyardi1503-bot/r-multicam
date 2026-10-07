# Website growth update — 8 October 2026

Website changes: lightweight mobile `/start/` landing page for social bio/post links; demo, Windows/macOS downloads and account CTA; existing regional price display retained; in-app Google-login browser guidance; social preview metadata using the existing verified 1200×630 PNG; visible home FAQ matching structured data; Indonesian search-intent title/description; current sitemap dates for changed home/Indonesian pages.

Analytics uses the existing Supabase endpoint and event names. Explicit campaign tags take priority; Instagram and Threads referrers are recognized; Google search and Google login are separated. Attribution persists across internal navigation and OAuth for up to 30 minutes in tab session storage. Blocked storage does not prevent events. Old historical traffic is not rewritten. No new database access policies, account/license changes, payments or plugin updates.

Use these links manually in social profiles/posts:

- Instagram bio: https://r-multicam.pages.dev/start/?utm_source=instagram&utm_medium=social&utm_campaign=profile
- Instagram story: https://r-multicam.pages.dev/start/?utm_source=instagram&utm_medium=social&utm_campaign=story
- Threads profile/post: https://r-multicam.pages.dev/start/?utm_source=threads&utm_medium=social&utm_campaign=profile
- Threads editing demo: https://r-multicam.pages.dev/start/?utm_source=threads&utm_medium=social&utm_campaign=editing_demo

Example post (no post has been published): “Edit multicam mengikuti musik di Premiere Pro: analisis beat, BPM dan drop untuk DJ set/konser. Coba demo interaktif, lalu trial 7 hari di Windows atau Mac.”

Google: crawlable home and Indonesian pages retain canonical/hreflang metadata; the social-only landing page is noindex/follow and is not added to the sitemap. Search Console submission and actual Google rankings are not verified or changed. SEO changes require recrawling and do not guarantee increased rankings or visits.

Verification includes automated attribution/expiry/OAuth/storage tests, mobile landing markup and CTA targets, social metadata, and account/checkout/download regressions. Native social-app rendering and platform preview-cache refresh remain external checks.
