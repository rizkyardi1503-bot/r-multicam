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
