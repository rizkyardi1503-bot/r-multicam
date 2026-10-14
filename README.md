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

This bundles and minifies the CSS (`home.css` for the homepage, `site.css` for all other pages), applies the shared header, footer, table of contents and breadcrumb data to every content page, and updates `sitemap.xml` dates for changed pages. CI fails if the build output is out of date. The 3D/motion layer lives in `site/motion3d.mjs`. Existing direct-upload project and domain are retained.

Reference: https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/

Media files are restored from the original immutable Cloudflare deployment with pinned SHA256 checks before publishing. Keep that deployment available until media is moved to repository storage.

## Languages (English / Indonesian)

Every page exists in English (`site/...`) and Indonesian (`site/id/...`).

- Edit the English page first, then update the matching `site/id/...` page. `python3 scripts/check-translation.py` fails if the Indonesian markup drifts from the English page (ids, classes, links, scripts must match; only text may differ). CI runs it.
- The build adds hreflang alternates, the EN/ID switch, Indonesian links, and a bilingual sitemap.
- Visitors from Indonesia (or with an Indonesian browser) are sent from English pages to the Indonesian version; a choice made with the EN/ID switch is remembered. Crawlers, login callbacks and download links are never redirected (`src/i18n/lang-router.js`).
- Text rendered by scripts (account, checkout, demo) is translated on `/id/` pages from `src/i18n/id.json`. Add new UI strings there.
- Prices follow location, not language: Indonesia shows IDR, everywhere else USD (`site/pricing.js`).
