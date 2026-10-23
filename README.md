# R Multicam website

Static website deployed to the existing Cloudflare Pages project `r-multicam` by GitHub Actions.

## One-time setup

1. Create a repository named `r-multicam` on `rizkyardi1503-bot` and initialize with a README. Grant the connected GitHub app access to this repository if needed.
2. Upload this source to its `main` branch. Preserve the `.github/workflows/deploy.yml` directory.
3. In Cloudflare https://dash.cloudflare.com/profile/api-tokens create a custom API token with Account → Cloudflare Pages → Edit, scoped only to account `3e561fc2707674ded69117e558d10a9f`.
4. In repository Settings → Secrets and variables → Actions, add a repository secret named `CLOUDFLARE_API_TOKEN`. Paste the token directly in GitHub, never into chat or source code. The workflow already includes the non-secret account ID.
5. Open Actions → Deploy r-multicam website → Run workflow → main. A successful run deploys to https://r-multicam.pages.dev/ .

After setup, pushes changing `site/` or `src/` on `main` deploy automatically. Branches named `preview/*` deploy to a separate preview URL; other branches do not deploy.

## Styles and shared layout

Edit stylesheets in `src/css/` (never `site/site.css` or `site/home.css` directly), then run:

```
python3 scripts/build-site.py
```

This bundles and minifies the CSS (`home.css` for the homepage, `site.css` for all other pages), applies the shared header, footer, table of contents and breadcrumb data to every content page, and updates `sitemap.xml` dates for changed pages. CI fails if the build output is out of date. The light motion layer (header state and one-time section reveal, no WebGL) lives in `site/motion.mjs`. Existing direct-upload project and domain are retained.

CI also runs `python3 scripts/check-weight.py` (Python 3 standard library only) as a page weight budget. For the two homepages (`site/index.html`, `site/id/index.html`): HTML at most 70 KB, linked CSS at most 45 KB, same-origin scripts at most 120 KB combined, no `<canvas>`, and no `<video>` that autoplays, preloads more than `metadata`, or is larger than 3.2 MB (use the `-lite` files in `site/media/`). The CSS bundles may not use `backdrop-filter`, infinite animations, `mix-blend-mode` or a `blur()` of 20px or more; top-level scripts may not use three.js, WebGL, `getContext(` or a CDN; and no page may load an external script except `static.cloudflareinsights.com`. Run it locally from the repository root after `python3 scripts/build-site.py`.

Reference: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/

Media files are restored from the original immutable Cloudflare deployment with pinned SHA256 checks before publishing. Keep that deployment available until media is moved to repository storage.

## Languages (English / Indonesian)

Every page exists in English (`site/...`) and Indonesian (`site/id/...`).

- Edit the English page first, then update the matching `site/id/...` page. `python3 scripts/check-translation.py` fails if the Indonesian markup drifts from the English page (ids, classes, links, scripts must match; only text may differ). CI runs it.
- The build adds hreflang alternates, the EN/ID switch, Indonesian links, and a bilingual sitemap.
- Visitors from Indonesia (or with an Indonesian browser) are sent from English pages to the Indonesian version; a choice made with the EN/ID switch is remembered. Crawlers, login callbacks and download links are never redirected (`src/i18n/lang-router.js`).
- Text rendered by scripts (account, checkout, demo) is translated on `/id/` pages from `src/i18n/id.json`. Add new UI strings there.
- One lifetime price, Rp2.000.000, in every country. `site/pricing.js` shows the previous list price struck through before it (Rp3.575.000 for Indonesia, US$200 elsewhere, by location, not language).

## Plugin releases

Plugin package sources live in `plugin/windows` and `plugin/macos`. To release:

1. Edit the sources and bump the version everywhere the installers check it (`CSXS/manifest.xml`, `jsx/host.jsx`, `panel.js`, `update-manager.js`, installer version variable).
2. `python3 scripts/build-plugin-release.py` builds deterministic ZIPs in `site/downloads/` and the checksum inventories (CI runs `--check`).
3. Commit, then point `supabase/functions/website-download` and `plugin-update-download` at that commit's raw files and deploy them.
4. Only change `plugin-update-manifest` when every existing user must update: the database (`plugin_entitlement`) blocks any plugin older than the manifest version.

FFmpeg is pinned (9.0.2) with SHA-256 checks in both installers. To move to a newer FFmpeg, update the URL(s) and hashes in `Install-Windows.ps1` / `Install-macOS.command` and in `scripts/test-public-23113.py`.

## Engine, Final Cut Pro and MCP (`rp-engine/`)

`rp-engine/` runs the plugin's own engine headless in Node. It turns music and camera
files into a host-neutral plan, `rp-multicam-plan/1`, with the schema in
`site/schema/rp-multicam-plan-1.json`.

From that plan it can:
- export Final Cut Pro FCPXML,
- expose everything as a local MCP server.

See `rp-engine/README.md`. Tests are in `rp-engine/test/run-tests.mjs` and run in
`.github/workflows/engine.yml`. The published schema must stay identical to
`rp-engine/schema/`.
